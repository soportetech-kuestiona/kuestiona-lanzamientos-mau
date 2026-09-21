/**
 * Llamadas a la API de ActiveCampaign (sección 4.2). Credenciales en Script
 * Properties (Extensiones > Propiedades del proyecto), nunca hardcodeadas:
 *   AC_API_URL  -> ej. https://tuCuenta.api-us1.com
 *   AC_API_KEY  -> API Key de ActiveCampaign
 */
function getAcCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('AC_API_URL');
  const apiKey = props.getProperty('AC_API_KEY');
  if (!apiUrl || !apiKey) {
    throw new Error('Faltan AC_API_URL / AC_API_KEY en las Propiedades del script');
  }
  return { apiUrl, apiKey };
}

// throttleFn (opcional): se invoca justo antes de la llamada HTTP. Lo usa
// drainToActiveCampaign_ para respetar el límite de 5 req/s de la API de AC
// a lo largo de TODO un lote de leads, no solo entre leads distintos — cada
// llamada individual (contact/sync + cada etiqueta) cuenta.
function acRequest_(path, method, payload, throttleFn) {
  if (throttleFn) throttleFn();
  const { apiUrl, apiKey } = getAcCredentials_();
  const options = {
    method,
    contentType: 'application/json',
    headers: { 'Api-Token': apiKey },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);

  const res = UrlFetchApp.fetch(apiUrl.replace(/\/$/, '') + path, options);
  const code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    return JSON.parse(res.getContentText());
  }
  throw new Error('AC API ' + path + ' -> HTTP ' + code + ': ' + res.getContentText());
}

/**
 * fieldValues: array de {field, value} — SOLO funnel_name + UTMs (sección
 * "Datos en AC" acordada con el usuario). Las respuestas del cuestionario
 * (Q1-Q4, resultado_gate) NUNCA se mandan a AC: viven solo en Sheets y
 * pasan a la Oportunidad de Airtable si el lead cualifica y agenda, vía la
 * automatización de Make (fuera de alcance de esta landing).
 */
function acCreateOrUpdateContact_(email, phone, firstName, lastName, fieldValues, throttleFn) {
  const contact = { email, phone, firstName, lastName };
  if (fieldValues && fieldValues.length) contact.fieldValues = fieldValues;

  const data = acRequest_('/api/3/contact/sync', 'POST', { contact }, throttleFn);
  return data.contact && data.contact.id;
}

function buildAcFieldValues_(customFieldIds, lead) {
  const values = {
    funnel_name: lead.funnel_name,
    utm_source: lead.utm_source,
    utm_medium: lead.utm_medium,
    utm_campaign: lead.utm_campaign,
    utm_content: lead.utm_content,
    utm_term: lead.utm_term
  };

  return Object.entries(customFieldIds || {})
    .filter(([name]) => name !== '_comment' && values[name])
    .map(([name, fieldId]) => ({ field: fieldId, value: values[name] }));
}

/**
 * El id numérico de la etiqueta se busca en AC_TAG_IDS (Config.gs), NUNCA
 * por nombre en cada petición: /api/3/tags?filters[name]=... no filtraba
 * como cabía esperar y devolvía el id de OTRA etiqueta ya existente en la
 * cuenta — el contacto se etiquetaba igual, pero con la etiqueta
 * equivocada, y sin ningún error (así apareció "Formulario Enviado" en vez
 * de "mau_lead" en las pruebas del lanzamiento).
 *
 * Se loguea el HTTP y el cuerpo completo de ESTA llamada siempre, no solo
 * si lanza excepción, para poder ver el fallo exacto la próxima vez en
 * lugar de descubrirlo por ausencia.
 */
function acAddTagToContact_(contactId, tagName, throttleFn) {
  const tagId = AC_TAG_IDS[tagName];
  if (!tagId) {
    Logger.log('acAddTagToContact_: no hay id numérico conocido para la etiqueta "' + tagName + '" en AC_TAG_IDS (Config.gs)');
    return;
  }

  if (throttleFn) throttleFn();
  const { apiUrl, apiKey } = getAcCredentials_();
  const res = UrlFetchApp.fetch(apiUrl.replace(/\/$/, '') + '/api/3/contactTags', {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Api-Token': apiKey },
    payload: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } }),
    muteHttpExceptions: true
  });
  Logger.log(
    'contactTags contact=' + contactId + ' tag=' + tagName + ' (id ' + tagId + ') -> ' +
    'HTTP ' + res.getResponseCode() + ': ' + res.getContentText()
  );
}

/**
 * Etiquetado (esquema acordado, mismo que ya usa Make en la landing de
 * registro de este lanzamiento): TODOS los leads llevan las etiquetas de
 * config.ac_tags.universal ("mau_lead", "mau-lanz-2609"); quien NO cualifica
 * lleva además config.ac_tags.no_cualifica ("mau-2609-nc"), que es el
 * trigger en AC de la automatización del correo posterior — por eso ya NO
 * se llama a ninguna automatización directamente desde aquí: si lo
 * hiciéramos Y la etiqueta también la disparase, el contacto entraría dos
 * veces (la automatización tiene multientry activo) y recibiría el correo
 * duplicado.
 */
function syncActiveCampaign_(config, lead, throttleFn) {
  try {
    const fieldValues = buildAcFieldValues_(config.ac_custom_fields, lead);
    const contactId = acCreateOrUpdateContact_(lead.email, lead.phone, lead.first_name, lead.last_name, fieldValues, throttleFn);
    if (!contactId) return null;

    (config.ac_tags.universal || []).forEach((tag) => acAddTagToContact_(contactId, tag, throttleFn));

    if (!lead.resultado_gate && config.ac_tags.no_cualifica) {
      acAddTagToContact_(contactId, config.ac_tags.no_cualifica, throttleFn);
    }

    return contactId;
  } catch (e) {
    Logger.log('Error sincronizando con ActiveCampaign para ' + lead.email + ': ' + e);
    return null;
  }
}

/**
 * Drenado hacia ActiveCampaign de un lote de leads recién volcados (ver
 * Buzon.gs::volcarBuzon). Se llama YA FUERA del LockService del volcado —
 * este ritmo de 5 req/s puede tardar varios segundos en un lote grande, y
 * no tiene sentido retener un lock global (que bloquearía el appendRow de
 * cualquier doPost concurrente) durante ese tiempo.
 *
 * El throttle es una única closure compartida para TODO el lote: se aplica
 * a cada llamada HTTP individual (contact/sync + cada etiqueta), no una vez
 * por lead — 5 req/s es un límite de la API, no de "leads por segundo".
 *
 * Igual que antes: solo se sincronizan los leads realmente nuevos de este
 * volcado (wasNew=true) — un reintento nunca debe volver a tocar AC, porque
 * add_contact_to_automation (vía la etiqueta no_cualifica) no es idempotente.
 */
function drainToActiveCampaign_(config, newRowsInfo) {
  const toSync = (newRowsInfo || []).filter((r) => r.wasNew);
  if (toSync.length === 0) return;

  const AC_MIN_INTERVAL_MS = 200; // 5 req/s
  let lastCallAt = 0;
  const throttle = function () {
    const wait = AC_MIN_INTERVAL_MS - (Date.now() - lastCallAt);
    if (wait > 0) Utilities.sleep(wait);
    lastCallAt = Date.now();
  };

  toSync.forEach(({ leadId, resultadoGate, payload }) => {
    try {
      syncActiveCampaign_(config, {
        email: payload.email,
        phone: payload.phone,
        first_name: payload.first_name,
        last_name: payload.last_name,
        latam_detectado: Boolean(payload.latam_detectado),
        resultado_gate: resultadoGate,
        funnel_name: payload.funnel_name || config.funnel_name,
        utm_source: payload.utm_source,
        utm_medium: payload.utm_medium,
        utm_campaign: payload.utm_campaign,
        utm_content: payload.utm_content,
        utm_term: payload.utm_term
      }, throttle);
    } catch (e) {
      Logger.log('drainToActiveCampaign_: error sincronizando lead_id=' + leadId + ': ' + e);
      // No se relanza: un fallo de AC para un lead no debe tumbar el resto del lote.
    }
  });
}