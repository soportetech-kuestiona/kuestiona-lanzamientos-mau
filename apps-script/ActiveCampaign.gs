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

function acRequest_(path, method, payload) {
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
function acCreateOrUpdateContact_(email, phone, firstName, lastName, fieldValues) {
  const contact = { email, phone, firstName, lastName };
  if (fieldValues && fieldValues.length) contact.fieldValues = fieldValues;

  const data = acRequest_('/api/3/contact/sync', 'POST', { contact });
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
function acAddTagToContact_(contactId, tagName) {
  const tagId = AC_TAG_IDS[tagName];
  if (!tagId) {
    Logger.log('acAddTagToContact_: no hay id numérico conocido para la etiqueta "' + tagName + '" en AC_TAG_IDS (Config.gs)');
    return;
  }

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
function syncActiveCampaign_(config, lead) {
  try {
    const fieldValues = buildAcFieldValues_(config.ac_custom_fields, lead);
    const contactId = acCreateOrUpdateContact_(lead.email, lead.phone, lead.first_name, lead.last_name, fieldValues);
    if (!contactId) return null;

    (config.ac_tags.universal || []).forEach((tag) => acAddTagToContact_(contactId, tag));

    if (!lead.resultado_gate && config.ac_tags.no_cualifica) {
      acAddTagToContact_(contactId, config.ac_tags.no_cualifica);
    }

    return contactId;
  } catch (e) {
    Logger.log('Error sincronizando con ActiveCampaign para ' + lead.email + ': ' + e);
    return null;
  }
}
