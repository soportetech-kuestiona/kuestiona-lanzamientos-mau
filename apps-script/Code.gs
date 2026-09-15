/**
 * Backend único (sección 4): un doPost(e) que recibe el JSON del formulario,
 * escribe en Sheets y llama a ActiveCampaign, en ese orden.
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
 * PASA = (Q1 != fail) AND (Q2 != fail) AND (si es_latam: Q4 in pass_options)
 * Q3 nunca entra en la regla.
 */
function evaluateGate_(answers, latamDetectado, gateRules) {
  const q1Fails = (gateRules.q1_fail_options || []).includes(answers.q1_disponibilidad);
  const q2Fails = (gateRules.q2_fail_options || []).includes(answers.q2_disposicion_invertir);
  let q4Passes = true;
  if (latamDetectado) {
    q4Passes = (gateRules.q4_pass_options_if_latam || []).includes(answers.q4_capacidad_inversion);
  }
  return !q1Fails && !q2Fails && q4Passes;
}

function handleSubmit_(config, body) {
  const answers = body.answers || {};
  const latamDetectado = Boolean(body.latam_detectado);
  // Recalculado siempre en servidor, aunque el cliente ya haya revelado un
  // resultado (sección "revelar al instante"): esta es la fuente de verdad
  // que se persiste y la que decide si se dispara la automatización de AC.
  const resultadoGate = evaluateGate_(answers, latamDetectado, config.gate_rules);
  // El lead_id lo genera el cliente (para poder pintar Calendly sin esperar
  // a esta respuesta) y viaja en el payload; si por lo que sea no llega
  // (cliente antiguo en caché), se genera aquí como red de seguridad.
  const leadId = body.lead_id || generateLeadId_();
  const fullName = [body.first_name, body.last_name].filter(Boolean).join(' ');

  // Upsert por lead_id bajo lock: si esta misma petición llega duplicada
  // (doble clic, reintento tras timeout), no crea una segunda fila.
  const { wasNew } = appendOrUpdateLead_(config, leadId, {
    email: body.email || '',
    name: fullName,
    registered_at: new Date().toISOString(),
    utm_source: body.utm_source || '',
    utm_campaign: body.utm_campaign || '',
    utm_medium: body.utm_medium || '',
    utm_content: body.utm_content || '',
    utm_term: body.utm_term || '',
    funnel_name: body.funnel_name || config.funnel_name,
    phone: body.phone || '',
    fbc: body.fbc || '',
    fbp: body.fbp || '',
    lead_id: leadId,
    product_interest_id: config.product_interest_id,
    origin: config.origin,
    gclid: body.gclid || '',
    wbraid: body.wbraid || '',
    gbraid: body.gbraid || '',
    latam_detectado: latamDetectado,
    phone_prefix_country: body.phone_prefix_country || '',
    browser_timezone: body.browser_timezone || '',
    q1_disponibilidad: answers.q1_disponibilidad || '',
    q2_disposicion_invertir: answers.q2_disposicion_invertir || '',
    q3_situacion_laboral: answers.q3_situacion_laboral || '',
    q4_capacidad_inversion: answers.q4_capacidad_inversion || '',
    resultado_gate: resultadoGate,
    first_name: body.first_name || '',
    last_name: body.last_name || ''
  });

  // Si la fila ya existía (mismo lead_id reintentado), no volvemos a tocar
  // ActiveCampaign: create_or_update_contact/add_tag son idempotentes, pero
  // add_contact_to_automation NO lo es — reintentarlo podría reenganchar al
  // contacto a la automatización de "no cualificado" una segunda vez.
  if (wasNew) {
    syncActiveCampaign_(config, {
      email: body.email,
      phone: body.phone,
      first_name: body.first_name,
      last_name: body.last_name,
      latam_detectado: latamDetectado,
      resultado_gate: resultadoGate
    });
  }

  return jsonResponse_({
    ok: true,
    lead_id: leadId,
    resultado_gate: resultadoGate,
    calendly_url: resultadoGate ? config.calendly.url : null
  });
}

function handleUpdateOpenQuestions_(config, body) {
  if (!body.lead_id) return jsonResponse_({ ok: false, error: 'Falta lead_id' });
  updateOpenQuestionsByLeadId_(config, body.lead_id, body.open_q1_cambio_mejora, body.open_q2_por_que_no_logrado);
  return jsonResponse_({ ok: true });
}
