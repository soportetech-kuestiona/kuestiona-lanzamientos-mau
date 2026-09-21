/**
 * Buzón de intake (rediseño de concurrencia). doPost ya NO escribe en Leads
 * ni llama a ActiveCampaign directamente: valida lo mínimo y encola el
 * payload crudo aquí, bajo la sección crítica más corta posible (un único
 * appendRow()). El volcado real a Leads y el drenado a ActiveCampaign los
 * hace volcarBuzon(), disparado por un trigger de tiempo cada 1 minuto
 * (instalado a mano una vez con instalarTriggerVolcado, ver más abajo).
 *
 * Motivo del cambio: LockService.getScriptLock() es global a todo el
 * proyecto (no por hoja) y Apps Script limita a 30 ejecuciones simultáneas
 * por cuenta y 30s de timeout en doPost — ningún cambio de código elimina
 * ese techo, solo se puede acortar lo que se ejecuta dentro de cada lock.
 * Antes, cada doPost hacía TODO (escaneo/City, escritura en Leads, llamadas
 * a AC) bajo el mismo lock; ahora cada doPost solo hace un appendRow.
 *
 * Objetivo de diseño: soportar ráfagas de hasta 27 peticiones en 10s dentro
 * de una ventana de 90 en 60s (x3 sobre el pico real del lanzamiento
 * anterior). No está pensado para más volumen que ese sin confirmarlo antes.
 *
 * Buzon_Leads vive en su propio Google Sheet (config.buzon_sheet_id), NO en
 * el mismo archivo que Leads (config.sheet_id, DASH00) — ver el porqué en
 * el comentario de getBuzonSheet_ más abajo.
 */
const BUZON_TAB_NAME = 'Buzon_Leads';

/**
 * Pestaña de staging, en un Google Sheet PROPIO y pequeño
 * (config.buzon_sheet_id), separado a propósito de Leads (config.sheet_id,
 * el DASH00 compartido con años de histórico y varias pestañas). Medido en
 * pruebas de carga reales: abrir DASH00 por ID en cada doPost, solo para
 * hacer un appendRow, ya era en sí mismo el cuello de botella bajo 20
 * peticiones concurrentes — el archivo pequeño se abre mucho más rápido.
 *
 * Hay que crearla A MANO UNA VEZ en ese Sheet propio, con esta cabecera
 * exacta en la fila 1:
 *   received_at | lead_id | type | payload_json
 * No se crea sola por código a propósito: así un despliegue sin este paso
 * previo falla alto y claro (error explícito en los logs / en la respuesta
 * de doPost), en vez de crear una pestaña con un formato que nadie ha
 * decidido a propósito.
 */
function getBuzonSheet_(config) {
  const ss = SpreadsheetApp.openById(config.buzon_sheet_id);
  const sheet = ss.getSheetByName(BUZON_TAB_NAME);
  if (!sheet) {
    throw new Error(
      'No existe la pestaña "' + BUZON_TAB_NAME + '" en el Sheet ' + config.buzon_sheet_id +
      ' — créala a mano una vez, con esta cabecera en la fila 1: ' +
      'received_at | lead_id | type | payload_json'
    );
  }
  return sheet;
}

/**
 * Sección crítica mínima: SOLO el appendRow (+ flush, mismo motivo que en
 * Sheets.gs::writeSubmitsBatch_ — evitar que dos peticiones casi
 * simultáneas calculen la misma fila y se pisen). Nada de escaneo de
 * duplicados dentro del lock: el dedup por (type, lead_id) se comprueba con
 * CacheService ANTES de entrar a la cola del lock, así que un reintento del
 * mismo cliente ni siquiera llega a competir por él.
 */
function enqueueToBuzon_(config, leadId, type, payload) {
  if (!leadId) return { enqueued: false };

  const cache = CacheService.getScriptCache();
  const seenKey = 'buzon_seen_' + type + '_' + leadId;
  if (cache.get(seenKey)) return { enqueued: false };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (cache.get(seenKey)) return { enqueued: false }; // doble check ya dentro del lock
    const sheet = getBuzonSheet_(config);
    sheet.appendRow([new Date(), leadId, type, JSON.stringify(payload)]);
    SpreadsheetApp.flush();
    cache.put(seenKey, '1', 1200); // 20 min: cubre de sobra el único reintento del cliente (~30s)
    return { enqueued: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Instalar UNA VEZ desde el editor de Apps Script (seleccionar esta función
 * en el desplegable de arriba -> Ejecutar) después de desplegar este
 * código. Borra cualquier trigger anterior de volcarBuzon antes de crear
 * el nuevo, para no acabar con dos triggers duplicados corriendo el doble
 * de veces por error.
 *
 * SIN guion bajo al final a propósito (a diferencia del resto de funciones
 * "privadas" de este proyecto): Apps Script oculta de los desplegables de
 * "Ejecutar" y del selector de función de un activador cualquier función
 * cuyo nombre termine en "_" — con guion bajo, ni esta ni volcarBuzon
 * podrían seleccionarse nunca desde la interfaz, que es precisamente para
 * lo que existen.
 */
function instalarTriggerVolcado() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'volcarBuzon')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('volcarBuzon').timeBased().everyMinutes(1).create();
  Logger.log('Trigger instalado: volcarBuzon cada 1 minuto.');
}

/**
 * Volcado periódico (cada 1 minuto — el suelo real de granularidad de
 * triggers por tiempo en Apps Script). Lee todo lo pendiente en
 * Buzon_Leads, escribe en Leads en UN lote (Sheets.gs::writeSubmitsBatch_),
 * borra lo procesado, y SOLO ENTONCES —ya fuera del lock— drena a
 * ActiveCampaign.
 *
 * El lock se suelta ANTES del drenado a AC a propósito: LockService es
 * global a todo el proyecto (no por hoja), así que si lo mantuviéramos
 * durante el drenado (que con el ritmo de 5 req/s puede tardar varios
 * segundos en un lote grande), bloquearíamos cualquier doPost concurrente
 * que solo quiere hacer su appendRow rápido al buzón — reintroduciendo
 * exactamente el cuello de botella que este rediseño existe para eliminar.
 *
 * tryLock(0) en vez de waitLock: si ya hay un volcado en curso (no debería
 * pasar — Apps Script no solapa ejecuciones del MISMO trigger — pero cubre
 * el caso de que alguien duplique el trigger por error), este ciclo se
 * salta sin esperar; el siguiente minuto recoge lo que haya quedado.
 */
function volcarBuzon() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('volcarBuzon: ya hay un volcado en curso, se salta este ciclo.');
    return;
  }

  let newRowsInfo = [];
  try {
    const config = getConfig_();
    const buzon = getBuzonSheet_(config);
    const lastRow = buzon.getLastRow();
    if (lastRow < 2) return; // solo cabecera o vacío: nada que hacer

    const numRows = lastRow - 1;
    const rows = buzon.getRange(2, 1, numRows, 4).getValues();

    const submits = [];
    const openQuestions = [];
    rows.forEach(([receivedAt, leadId, type, payloadJson]) => {
      let payload;
      try {
        payload = JSON.parse(payloadJson);
      } catch (e) {
        Logger.log('volcarBuzon: JSON inválido para lead_id=' + leadId + ': ' + e);
        return;
      }
      if (type === 'submit') submits.push({ leadId, receivedAt, payload });
      else if (type === 'update_open_questions') openQuestions.push({ leadId, payload });
    });

    newRowsInfo = writeSubmitsBatch_(config, submits);
    applyOpenQuestionsBatch_(config, openQuestions);

    // Solo se borra el lote una vez escrito en Leads con éxito.
    buzon.deleteRows(2, numRows);
  } finally {
    lock.releaseLock();
  }

  // Deliberadamente fuera del try/lock de arriba: no toca Sheets y no debe
  // retener el lock global mientras dura.
  drainToActiveCampaign_(getConfig_(), newRowsInfo);
}
