/**
 * Escritura en [DASH00] - Backup-Sincronizacion-AT-DS, pestaña "Leads" (sección 4.1).
 *
 * No asumimos posiciones fijas de columna: leemos la fila de cabecera y mapeamos
 * nombre -> índice. Las columnas nuevas del lanzamiento se añaden AL FINAL si no
 * existen todavía (idempotente), sin tocar ni reordenar las que ya había.
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
// código — por eso writeRowFields_ solo hace String(valor), nunca toca el
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
// Code.gs::handleSubmit_) para que quede como fecha de verdad, igual que el
// resto de filas de DASH00 — forzarla a texto sería justo el problema
// contrario.
const FORCE_TEXT_COLUMNS = ['phone'];

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

// Cache de "lead_id -> fila" para no tener que volver a escanear toda la
// columna lead_id (findRowByLeadId_) en cada petición bajo carga: esa columna
// no es solo de este lanzamiento, es la de TODO el histórico de DASH00, así
// que escanearla dentro del lock es lo que hacía que 20 envíos a la vez se
// pisaran esperando el lock más de los 15s que le damos (visto en pruebas de
// concurrencia reales contra producción). No sirve para evitar colisiones de
// lead_id entre usuarios distintos (la fórmula del cliente ya las hace
// prácticamente imposibles) — sirve solo para reconocer el reintento del
// MISMO cliente para el MISMO lead_id sin tener que reescanear la hoja.
function getLeadRowCacheKey_(leadId) {
  return 'lead_row_' + leadId;
}

// Un solo setValues() sobre todo el rango en vez de un setValue() por campo
// (eran ~25 llamadas a la API de Sheets, una por campo, todas dentro del
// lock: bajo carga esa cola de llamadas era el segundo cuello de botella
// detectado en las pruebas de concurrencia, después del escaneo que ya
// arregla getLeadRowCacheKey_). Es seguro rellenar de '' los huecos entre
// medias porque esta función SOLO se usa para una fila recién creada
// (sheet.getLastRow() + 1 en appendOrUpdateLead_): no hay nada previo en
// esa fila que se pueda pisar. NO usar esta función para actualizar una
// fila ya existente con datos reales en otras columnas.
function writeRowFields_(sheet, headerMap, row, fields) {
  const entries = Object.entries(fields)
    .map(([name, value]) => ({ name, value, col: headerMap[name] }))
    .filter((e) => e.col); // ignora campos que no correspondan a ninguna columna conocida
  if (entries.length === 0) return;

  const minCol = Math.min(...entries.map((e) => e.col));
  const maxCol = Math.max(...entries.map((e) => e.col));
  const rowValues = new Array(maxCol - minCol + 1).fill('');

  entries.forEach(({ name, value, col }) => {
    const v = value == null ? '' : value;
    // Forzar String en el propio valor, nunca tocar el formato de la celda
    // (ver el comentario largo junto a FORCE_TEXT_COLUMNS sobre por qué
    // setNumberFormat() está prohibido en este fichero).
    rowValues[col - minCol] = FORCE_TEXT_COLUMNS.includes(name) ? String(v) : v;
  });

  sheet.getRange(row, minCol, 1, rowValues.length).setValues([rowValues]);
}

/**
 * Upsert idempotente por lead_id (generado en el cliente): si ya existe una
 * fila con ese lead_id, no crea una segunda — actualiza esa misma. Esto es lo
 * que evita el duplicado cuando un usuario reintenta el envío (doble clic,
 * "no ha pasado nada" y vuelve a pulsar, o una respuesta lenta del backend).
 * Todo bajo un LockService para que dos peticiones casi simultáneas para el
 * mismo lead_id no se cuelen ambas antes de que ninguna haya escrito aún.
 *
 * Devuelve { row, wasNew }.
 */
function appendOrUpdateLead_(config, leadId, fields) {
  const cache = CacheService.getScriptCache();
  const cacheKey = getLeadRowCacheKey_(leadId);

  const cachedRow = cache.get(cacheKey);
  if (cachedRow) {
    return { row: Number(cachedRow), wasNew: false };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Doble check ya dentro del lock: dos peticiones para el mismo lead_id
    // pueden haber pasado juntas la comprobación de cache de fuera del lock.
    const cachedRow2 = cache.get(cacheKey);
    if (cachedRow2) {
      return { row: Number(cachedRow2), wasNew: false };
    }

    const sheet = getLeadsSheet_(config);
    const headerMap = getHeaderMap_(sheet);
    const row = sheet.getLastRow() + 1;
    writeRowFields_(sheet, headerMap, row, fields);
    cache.put(cacheKey, String(row), 21600); // 6h, el máximo de CacheService
    return { row, wasNew: true };
  } finally {
    lock.releaseLock();
  }
}

function updateOpenQuestionsByLeadId_(config, leadId, openQ1, openQ2) {
  const cache = CacheService.getScriptCache();
  const cacheKey = getLeadRowCacheKey_(leadId);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getLeadsSheet_(config);
    const headerMap = getHeaderMap_(sheet);

    // Camino rápido: la fila ya está en cache porque el submit de este mismo
    // lead_id ya se resolvió. Si no (p.ej. llega antes de que el submit haya
    // terminado, por lo rápido que puede pulsar alguien "Enviar"), se cae al
    // escaneo de siempre — más lento, pero solo afecta a esta petición, no
    // encadena contención sobre las demás.
    const cachedRow = cache.get(cacheKey);
    const foundRow = cachedRow ? Number(cachedRow) : findRowByLeadId_(sheet, headerMap, leadId);
    if (foundRow === -1) throw new Error('No se encontró lead_id ' + leadId);
    if (!cachedRow) cache.put(cacheKey, String(foundRow), 21600);

    if (headerMap['open_q1_cambio_mejora']) {
      sheet.getRange(foundRow, headerMap['open_q1_cambio_mejora']).setValue(openQ1 || '');
    }
    if (headerMap['open_q2_por_que_no_logrado']) {
      sheet.getRange(foundRow, headerMap['open_q2_por_que_no_logrado']).setValue(openQ2 || '');
    }
  } finally {
    lock.releaseLock();
  }
}