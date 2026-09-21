/**
 * Escritura en [DASH00] - Backup-Sincronizacion-AT-DS, pestaña "Leads" (sección 4.1).
 *
 * No asumimos posiciones fijas de columna: leemos la fila de cabecera y mapeamos
 * nombre -> índice. Las columnas nuevas del lanzamiento se añaden AL FINAL si no
 * existen todavía (idempotente), sin tocar ni reordenar las que ya había.
 *
 * Desde el rediseño del buzón (ver Buzon.gs), doPost ya NO escribe aquí
 * directamente: solo lo hace volcarBuzon() (Buzon.gs), una vez por minuto,
 * en lote. Las funciones de este fichero están pensadas para eso — escribir
 * VARIAS filas en una sola llamada, no una petición HTTP = una escritura.
 */
const NEW_COLUMNS_ORDER = [
  'latam_detectado', 'phone_prefix_country', 'browser_timezone',
  'q1_disponibilidad', 'q2_disposicion_invertir', 'q3_situacion_laboral', 'q4_capacidad_inversion',
  'resultado_gate', 'calendly_event_reservado',
  'open_q1_cambio_mejora', 'open_q2_por_que_no_logrado',
  'first_name', 'last_name'
];

function getLeadsSheet_(config) {
  const ss = SpreadsheetApp.openById(config.sheet_id);
  const sheet = ss.getSheetByName(config.sheet_tab);
  if (!sheet) throw new Error('No existe la pestaña "' + config.sheet_tab + '" en el Sheet ' + config.sheet_id);
  return sheet;
}

function getHeaderMap_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  header.forEach((name, idx) => {
    if (name) map[name] = idx + 1; // columnas de Sheets son 1-indexadas
  });

  // Añade solo las columnas nuevas que aún no existan, al final, sin tocar las existentes.
  let nextCol = lastCol;
  NEW_COLUMNS_ORDER.forEach((name) => {
    if (!map[name]) {
      nextCol += 1;
      sheet.getRange(1, nextCol).setValue(name);
      map[name] = nextCol;
    }
  });

  return map;
}

// Columnas que deben venir PRE-formateadas como Texto Plano en todo el rango
// de la columna, para que Sheets no las reinterprete como fórmula/número
// (p.ej. un teléfono "+34...").
//
// Historial de intentos fallidos (los dos dejaban rastro que Sheets extendía
// a las filas siguientes, escritas por OTROS orígenes como Make):
//  1) setNumberFormat('@') + setValue, dejando la celda en Texto Plano de
//     forma persistente: el bug se movía a las filas de después.
//  2) setNumberFormat('@') + setValue + volver a 'General': seguía dejando
//     un cambio de formato explícito en esta celda, y Sheets igual lo
//     extendía — las filas siguientes acababan en 'General' y una fecha
//     real (no forzada a texto) se ve en General como número de serie en
//     crudo (ej. "46281,57072"), que es justo lo reportado.
// El common denominator: CUALQUIER llamada a setNumberFormat() en esta
// celda, sea cual sea el valor, marca esa fila como "la última con formato
// explícito" y Sheets se lo copia a la fila nueva de debajo. La única forma
// de que esto no ocurra es no llamar a setNumberFormat() nunca desde el
// código — por eso writeRowsBatch_ solo hace String(valor), nunca toca el
// formato de la celda.
//
// Requisito (una sola vez, manual, fuera de este código): la columna `phone`
// debe estar formateada como Texto Plano en TODA la columna desde el propio
// Sheets (seleccionar la columna entera → Formato → Número → Texto plano).
// Con eso, cada fila nueva ya nace en Texto Plano sin que este script tenga
// que tocar el formato nunca, así que no hay ningún cambio que Sheets pueda
// "extender" a la fila siguiente.
//
// `registered_at` NO va aquí: se escribe como Date real (ver
// buildLeadFields_ más abajo) para que quede como fecha de verdad, igual
// que el resto de filas de DASH00 — forzarla a texto sería justo el
// problema contrario.
const FORCE_TEXT_COLUMNS = ['phone'];

// Usado como fallback cuando una actualización de preguntas abiertas llega
// para un lead_id que la cache todavía no conoce (ver Buzon.gs::applyOpenQuestionsBatch_).
// Ya no es la vía principal de deduplicación — eso lo hace CacheService
// (getLeadRowCacheKey_) — pero sigue siendo necesario como red de seguridad,
// así que se mantiene tal cual.
function findRowByLeadId_(sheet, headerMap, leadId) {
  const leadIdCol = headerMap['lead_id'];
  if (!leadIdCol) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const ids = sheet.getRange(2, leadIdCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === leadId) return i + 2;
  }
  return -1;
}

// Cache de "lead_id -> fila" en Leads. La pone writeSubmitsBatch_ justo
// después de escribir cada fila nueva; la lee applyOpenQuestionsBatch_ para
// no tener que escanear toda la columna lead_id (findRowByLeadId_) — esa
// columna es la de TODO el histórico de DASH00, no solo la de este
// lanzamiento, y escanearla es caro. También evita volver a escribir un
// lead_id que ya se volcó en un ciclo anterior si por lo que sea su fila del
// buzón no llegó a borrarse.
function getLeadRowCacheKey_(leadId) {
  return 'lead_row_' + leadId;
}

/**
 * A partir del payload crudo de un 'submit' (tal cual llegó al buzón) más la
 * hora real de recepción (no la del volcado, que puede ir hasta 1 minuto por
 * detrás), construye el objeto de campos -> valor para escribir en Leads.
 * Antes vivía en Code.gs::handleSubmit_; se mueve aquí porque ahora quien
 * escribe en Sheets es volcarBuzon(), no doPost.
 */
function buildLeadFields_(config, receivedAt, payload) {
  const answers = payload.answers || {};
  const latamDetectado = Boolean(payload.latam_detectado);
  // Misma regla que antes: si no llega q4_aplica (payload antiguo en cache
  // de cliente), se cae a la regla previa (solo LATAM).
  const q4Aplica = payload.q4_aplica === undefined ? latamDetectado : Boolean(payload.q4_aplica);
  const resultadoGate = evaluateGate_(answers, q4Aplica, config.gate_rules);
  const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(' ');

  const fields = {
    email: payload.email || '',
    name: fullName,
    registered_at: receivedAt,
    utm_source: payload.utm_source || '',
    utm_campaign: payload.utm_campaign || '',
    utm_medium: payload.utm_medium || '',
    utm_content: payload.utm_content || '',
    utm_term: payload.utm_term || '',
    funnel_name: payload.funnel_name || config.funnel_name,
    phone: payload.phone || '',
    fbc: payload.fbc || '',
    fbp: payload.fbp || '',
    lead_id: payload.lead_id,
    product_interest_id: config.product_interest_id,
    origin: config.origin,
    gclid: payload.gclid || '',
    wbraid: payload.wbraid || '',
    gbraid: payload.gbraid || '',
    latam_detectado: latamDetectado,
    phone_prefix_country: payload.phone_prefix_country || '',
    browser_timezone: payload.browser_timezone || '',
    q1_disponibilidad: answers.q1_disponibilidad || '',
    q2_disposicion_invertir: answers.q2_disposicion_invertir || '',
    q3_situacion_laboral: answers.q3_situacion_laboral || '',
    q4_capacidad_inversion: answers.q4_capacidad_inversion || '',
    resultado_gate: resultadoGate,
    first_name: payload.first_name || '',
    last_name: payload.last_name || ''
  };

  return { fields, resultadoGate, latamDetectado };
}

/**
 * Une varias filas (una por lead) en un único setValues(), calculando el
 * rango de columnas común a todas según headerMap. Sustituye al antiguo
 * writeRowFields_ (una fila = una llamada): ahora una sola llamada escribe
 * TODO el lote del volcado, sea de 1 lead o de 90.
 *
 * Igual que antes: es seguro rellenar de '' los huecos entre columnas
 * porque esta función SOLO se usa para filas recién creadas — nunca para
 * actualizar una fila ya existente con datos reales en otras columnas.
 */
function writeRowsBatch_(sheet, headerMap, startRow, fieldsArray) {
  if (fieldsArray.length === 0) return;

  let minCol = Infinity;
  let maxCol = -Infinity;
  fieldsArray.forEach((fields) => {
    Object.keys(fields).forEach((name) => {
      const col = headerMap[name];
      if (!col) return;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    });
  });
  if (!isFinite(minCol)) return; // ningún campo del lote mapea a una columna conocida

  const width = maxCol - minCol + 1;
  const values = fieldsArray.map((fields) => {
    const row = new Array(width).fill('');
    Object.entries(fields).forEach(([name, value]) => {
      const col = headerMap[name];
      if (!col) return;
      const v = value == null ? '' : value;
      row[col - minCol] = FORCE_TEXT_COLUMNS.includes(name) ? String(v) : v;
    });
    return row;
  });

  sheet.getRange(startRow, minCol, values.length, width).setValues(values);
}

/**
 * Escribe en Leads todos los 'submit' nuevos de un lote del buzón, en una
 * sola llamada a setValues() para el lote entero. Se llama desde dentro del
 * lock de volcarBuzon(), que ya garantiza que solo hay un volcado a la vez
 * — por eso basta un único getLastRow() para todo el lote, no uno por lead.
 *
 * Devuelve, por cada entrada de `submits`, { leadId, wasNew, row,
 * resultadoGate, payload } — así drainToActiveCampaign_ (ActiveCampaign.gs)
 * sabe a quién sincronizar (solo wasNew=true) sin volver a tocar Sheets.
 */
function writeSubmitsBatch_(config, submits) {
  const cache = CacheService.getScriptCache();
  const results = [];
  const seenInBatch = new Set();
  const toWrite = []; // { leadId, fields, resultadoGate, payload }

  submits.forEach(({ leadId, receivedAt, payload }) => {
    if (!leadId || seenInBatch.has(leadId) || cache.get(getLeadRowCacheKey_(leadId))) {
      // Duplicado dentro del mismo lote, o ya volcado en un ciclo anterior
      // (su fila del buzón no debería seguir aquí, pero por si acaso no se
      // vuelve a escribir ni se vuelve a mandar a AC).
      results.push({ leadId, wasNew: false, payload });
      return;
    }
    seenInBatch.add(leadId);
    const { fields, resultadoGate } = buildLeadFields_(config, receivedAt, payload);
    toWrite.push({ leadId, fields, resultadoGate, payload });
  });

  if (toWrite.length === 0) return results;

  const sheet = getLeadsSheet_(config);
  const headerMap = getHeaderMap_(sheet);
  const startRow = sheet.getLastRow() + 1;
  writeRowsBatch_(sheet, headerMap, startRow, toWrite.map((e) => e.fields));
  // Mismo motivo que en el fix de la colisión de filas: sin flush, el
  // próximo getLastRow() (de este mismo volcado o del siguiente) podría no
  // ver esta escritura todavía.
  SpreadsheetApp.flush();

  toWrite.forEach((entry, i) => {
    const row = startRow + i;
    cache.put(getLeadRowCacheKey_(entry.leadId), String(row), 21600); // 6h, el máximo de CacheService
    results.push({ leadId: entry.leadId, wasNew: true, row, resultadoGate: entry.resultadoGate, payload: entry.payload });
  });

  return results;
}

/**
 * Aplica las respuestas de preguntas abiertas de un lote del buzón,
 * localizando la fila de cada lead_id por cache (rápido) o, si no está
 * todavía, por escaneo (findRowByLeadId_ — más lento, pero es la excepción,
 * no la regla: solo pasa si esta actualización llegó al buzón antes de que
 * su 'submit' correspondiente se haya volcado, algo que en la práctica no
 * debería pasar salvo reordenación muy rara entre lotes).
 *
 * Nota consciente: si un lead_id no se encuentra, esta actualización se
 * pierde (queda solo un log de aviso) — volcarBuzon() borra el lote entero
 * del buzón al final, con éxito o sin él en casos sueltos como este. Es un
 * riesgo aceptado: afecta solo a las preguntas abiertas (opcionales), nunca
 * al lead en sí, que siempre se procesa primero en writeSubmitsBatch_.
 */
function applyOpenQuestionsBatch_(config, openQuestions) {
  if (openQuestions.length === 0) return;
  const cache = CacheService.getScriptCache();
  const sheet = getLeadsSheet_(config);
  const headerMap = getHeaderMap_(sheet);

  openQuestions.forEach(({ leadId, payload }) => {
    const cachedRow = cache.get(getLeadRowCacheKey_(leadId));
    const row = cachedRow ? Number(cachedRow) : findRowByLeadId_(sheet, headerMap, leadId);
    if (row === -1) {
      Logger.log(
        'applyOpenQuestionsBatch_: no se encontró lead_id ' + leadId +
        ' (si su submit está en este mismo lote debería haberse resuelto; si no, se pierde esta actualización opcional)'
      );
      return;
    }
    if (headerMap['open_q1_cambio_mejora']) {
      sheet.getRange(row, headerMap['open_q1_cambio_mejora']).setValue(payload.open_q1_cambio_mejora || '');
    }
    if (headerMap['open_q2_por_que_no_logrado']) {
      sheet.getRange(row, headerMap['open_q2_por_que_no_logrado']).setValue(payload.open_q2_por_que_no_logrado || '');
    }
  });

  SpreadsheetApp.flush();
}
