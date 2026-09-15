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

function acCreateOrUpdateContact_(email, phone, firstName, lastName) {
  const data = acRequest_('/api/3/contact/sync', 'POST', {
    contact: { email, phone, firstName, lastName }
  });
  return data.contact && data.contact.id;
}

function acGetTagIdByName_(tagName) {
  const data = acRequest_('/api/3/tags?filters[name]=' + encodeURIComponent(tagName), 'GET');
  if (data.tags && data.tags.length) return data.tags[0].id;
  const created = acRequest_('/api/3/tags', 'POST', { tag: { tag: tagName, tagType: 'contact' } });
  return created.tag.id;
}

function acAddTagToContact_(contactId, tagName) {
  const tagId = acGetTagIdByName_(tagName);
  acRequest_('/api/3/contactTags', 'POST', {
    contactTag: { contact: contactId, tag: tagId }
  });
}

function acAddContactToAutomation_(contactId, automationId) {
  acRequest_('/api/3/contactAutomations', 'POST', {
    contactAutomation: { contact: contactId, automation: automationId }
  });
}

/**
 * Orquesta las tres llamadas de la sección 4.2 en orden. Los tags dependen de
 * si detectamos LATAM; la automatización de "no cualifica" solo se dispara si
 * resultado_gate es false. Cualquier fallo aquí se registra pero no debe tumbar
 * la respuesta al usuario (el lead ya quedó guardado en Sheets).
 */
function syncActiveCampaign_(config, lead) {
  try {
    const contactId = acCreateOrUpdateContact_(lead.email, lead.phone, lead.first_name, lead.last_name);
    if (!contactId) return null;

    acAddTagToContact_(contactId, config.ac_tags.base);
    acAddTagToContact_(contactId, lead.latam_detectado ? config.ac_tags.latam : config.ac_tags.no_latam);

    if (!lead.resultado_gate) {
      acAddContactToAutomation_(contactId, config.ac_automation_no_cualifica);
    }
    return contactId;
  } catch (e) {
    Logger.log('Error sincronizando con ActiveCampaign para ' + lead.email + ': ' + e);
    return null;
  }
}
