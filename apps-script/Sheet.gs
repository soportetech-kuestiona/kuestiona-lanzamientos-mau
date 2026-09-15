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
  // Evita que Sheets interprete "+34600000000" como fórmula/número (bug de abril).
  sheet.getRange(row, col).setNumberFormat('@').setValue(String(value == null ? '' : value));
}

function appendLead_(config, fields) {
  const sheet = getLeadsSheet_(config);
  const headerMap = getHeaderMap_(sheet);
  const row = sheet.getLastRow() + 1;

  Object.entries(fields).forEach(([name, value]) => {
    const col = headerMap[name];
    if (!col) return; // ignora campos que no correspondan a ninguna columna conocida
    if (name === 'phone') {
      writeTextValue_(sheet, row, col, value);
    } else {
      sheet.getRange(row, col).setValue(value == null ? '' : value);
    }
  });

  return row;
}

function updateOpenQuestionsByLeadId_(config, leadId, openQ1, openQ2) {
  const sheet = getLeadsSheet_(config);
  const headerMap = getHeaderMap_(sheet);
  const leadIdCol = headerMap['lead_id'];
  if (!leadIdCol) throw new Error('No existe la columna lead_id en la pestaña Leads');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No hay filas de leads todavía');

  const ids = sheet.getRange(2, leadIdCol, lastRow - 1, 1).getValues();
  let foundRow = -1;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === leadId) {
      foundRow = i + 2;
      break;
    }
  }
  if (foundRow === -1) throw new Error('No se encontró lead_id ' + leadId);

  if (headerMap['open_q1_cambio_mejora']) {
    sheet.getRange(foundRow, headerMap['open_q1_cambio_mejora']).setValue(openQ1 || '');
  }
  if (headerMap['open_q2_por_que_no_logrado']) {
    sheet.getRange(foundRow, headerMap['open_q2_por_que_no_logrado']).setValue(openQ2 || '');
  }
}
