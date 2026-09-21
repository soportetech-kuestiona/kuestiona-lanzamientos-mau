/**
 * Backend único (sección 4): un doPost(e) que recibe el JSON del formulario.
 * Desde el rediseño de concurrencia (ver Buzon.gs), doPost YA NO escribe en
 * Sheets ni llama a ActiveCampaign directamente — solo valida/calcula lo
 * mínimo para la respuesta instantánea y encola el payload crudo en
 * Buzon_Leads. El volcado real a Leads y el drenado a ActiveCampaign los
 * hace volcarBuzon_() (Buzon.gs), disparado por un trigger de tiempo cada
 * 1 minuto.
 *
 * El body llega como text/plain (ver comentario en site/js/api.js sobre por qué:
 * evita el preflight CORS que Apps Script no sabe responder), así que lo
 * parseamos manualmente en vez de usar e.parameter.
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'JSON inválido' });
  }

  try {
    const config = getConfig_();
    if (body.type === 'update_open_questions') {
      return handleUpdateOpenQuestions_(config, body);
    }
    return handleSubmit_(config, body);
  } catch (err) {
    Logger.log('Error en doPost: ' + err);
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function generateLeadId_() {
  return 'LZ-' + new Date().getTime() + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Regla de corte (sección 2), fuente de verdad única en el backend:
 * PASA = (Q1 != fail) AND (Q2 != fail) AND (si q4_aplica: Q4 in pass_options)
 * Q3 nunca entra en la regla.
 */
function evaluateGate_(answers, q4Aplica, gateRules) {
  const q1Fails = (gateRules.q1_fail_options || []).includes(answers.q1_disponibilidad);
  const q2Fails = (gateRules.q2_fail_options || []).includes(answers.q2_disposicion_invertir);
  let q4Passes = true;
  if (q4Aplica) {
    q4Passes = (gateRules.q4_pass_options_if_latam || []).includes(answers.q4_capacidad_inversion);
  }
  return !q1Fails && !q2Fails && q4Passes;
}

/**
 * doPost ya NO escribe en Sheets ni llama a ActiveCampaign directamente
 * (rediseño de concurrencia, ver Buzon.gs): solo calcula lo necesario para
 * la respuesta instantánea al cliente y encola el payload crudo en el
 * buzón, bajo la sección crítica más corta posible (un único appendRow en
 * enqueueToBuzon_). El volcado real a Leads y el drenado a ActiveCampaign
 * los hace volcarBuzon_() (Buzon.gs), una vez por minuto.
 *
 * El cliente NO lee resultado_gate ni calendly_url de esta respuesta para
 * pintar nada (ya reveló el resultado por su cuenta, ver
 * site/js/main.js::submit) — se calculan y se devuelven igualmente por
 * compatibilidad de la API y para poder verificarlos desde fuera (p. ej.
 * loadtest/run-api.mjs).
 */
function handleSubmit_(config, body) {
  const answers = body.answers || {};
  const latamDetectado = Boolean(body.latam_detectado);
  // Q4 aplica a todo teléfono de fuera de la UE (y a LATAM detectado por huso
  // horario): lo decide la landing con el país del selector de prefijo. Si
  // no llega (landing antigua en caché), se mantiene la regla anterior: solo LATAM.
  const q4Aplica = body.q4_aplica === undefined ? latamDetectado : Boolean(body.q4_aplica);
  // Este cálculo es solo para la respuesta instantánea; el que de verdad se
  // persiste lo recalcula buildLeadFields_ (Sheets.gs) en el volcado, con el
  // config vigente en ESE momento (podría no ser exactamente el mismo si
  // config.json cambió entre medias — riesgo aceptado, ventana de máximo 1
  // minuto).
  const resultadoGate = evaluateGate_(answers, q4Aplica, config.gate_rules);
  // El lead_id lo genera el cliente (para poder pintar Calendly sin esperar
  // a esta respuesta) y viaja en el payload; si por lo que sea no llega
  // (cliente antiguo en caché), se genera aquí como red de seguridad.
  const leadId = body.lead_id || generateLeadId_();

  enqueueToBuzon_(config, leadId, 'submit', Object.assign({}, body, { lead_id: leadId }));

  return jsonResponse_({
    ok: true,
    lead_id: leadId,
    resultado_gate: resultadoGate,
    calendly_url: resultadoGate ? config.calendly.url : null
  });
}

function handleUpdateOpenQuestions_(config, body) {
  if (!body.lead_id) return jsonResponse_({ ok: false, error: 'Falta lead_id' });
  enqueueToBuzon_(config, body.lead_id, 'update_open_questions', body);
  return jsonResponse_({ ok: true });
}