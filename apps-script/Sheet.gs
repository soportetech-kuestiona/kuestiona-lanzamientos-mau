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

function writeTextValue_(sheet, row, col, value) {
  // Antepone un apóstrofo para forzar texto SIN tocar el formato de número de
  // la celda. `setNumberFormat('@')` "arreglaba" el valor pero dejaba la
  // celda marcada como Texto Plano de forma persistente — y Sheets extiende
  // el formato de la última fila escrita a las filas nuevas que se añaden
  // justo debajo, así que un lead de OTRO origen que llegara después heredaba
  // ese formato y su fecha se veía igual de mal (reportado en el lanzamiento).
  // El apóstrofo es solo una marca de entrada: no deja rastro en el valor
  // guardado ni en el formato de la celda.
  const str = String(value == null ? '' : value);
  sheet.getRange(row, col).setValue(str.startsWith("'") ? str : "'" + str);
}

// Columnas que Sheets tiende a "interpretar" si no se fuerzan a texto.
const FORCE_TEXT_COLUMNS = ['phone', 'registered_at'];

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

function writeRowFields_(sheet, headerMap, row, fields) {
  Object.entries(fields).forEach(([name, value]) => {
    const col = headerMap[name];
    if (!col) return; // ignora campos que no correspondan a ninguna columna conocida
    if (FORCE_TEXT_COLUMNS.includes(name)) {
      writeTextValue_(sheet, row, col, value);
    } else {
      sheet.getRange(row, col).setValue(value == null ? '' : value);
    }
  });
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
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getLeadsSheet_(config);
    const headerMap = getHeaderMap_(sheet);

    const existingRow = findRowByLeadId_(sheet, headerMap, leadId);
    if (existingRow !== -1) {
      return { row: existingRow, wasNew: false };
    }

    const row = sheet.getLastRow() + 1;
    writeRowFields_(sheet, headerMap, row, fields);
    return { row, wasNew: true };
  } finally {
    lock.releaseLock();
  }
}

function updateOpenQuestionsByLeadId_(config, leadId, openQ1, openQ2) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getLeadsSheet_(config);
    const headerMap = getHeaderMap_(sheet);

    const foundRow = findRowByLeadId_(sheet, headerMap, leadId);
    if (foundRow === -1) throw new Error('No se encontró lead_id ' + leadId);

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
