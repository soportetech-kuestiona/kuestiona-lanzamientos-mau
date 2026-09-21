/**
 * Config centralizada (sección 6 del brief): en vez de duplicar los umbrales/textos
 * aquí, este backend lee el MISMO site/config/config.json que sirve la landing,
 * vía UrlFetchApp, cacheado 6h. Si el fetch falla (dominio caído, cambio de red,
 * etc.) cae a la copia embebida de más abajo como red de seguridad.
 *
 * IMPORTANTE: si tocas site/config/config.json en el repo, se sube solo
 * https://precall-mau.kuestiona.com/config/config.json (el mismo fichero que usa
 * la landing) y, si cambian los gate_rules o los tags, actualiza también el
 * fallback embebido aquí para que no queden desincronizados.
 */
const CONFIG_CACHE_KEY = 'mau_lz_config_v1';
// 5 minutos, no 6 horas: mientras se está iterando el mismo día del
// lanzamiento, una caché larga sirve config.json desactualizado en
// silencio (p. ej. etiquetas de AC que dejan de mandarse porque el campo
// que las lista ni siquiera existía en la versión cacheada). Si algún
// cambio necesita aplicarse YA, usa clearConfigCache() de más abajo en vez
// de esperar.
const CONFIG_CACHE_TTL_SECONDS = 5 * 60;

function getConfigUrl_() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('CONFIG_URL') || 'https://precall-mau.kuestiona.com/config/config.json';
}

function getConfig_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  try {
    const res = UrlFetchApp.fetch(getConfigUrl_(), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const config = JSON.parse(res.getContentText());
      cache.put(CONFIG_CACHE_KEY, JSON.stringify(config), CONFIG_CACHE_TTL_SECONDS);
      return config;
    }
  } catch (e) {
    Logger.log('No se pudo obtener config.json remoto, usando fallback embebido: ' + e);
  }

  return FALLBACK_CONFIG_;
}

/**
 * Ejecutar a mano desde el editor de Apps Script (seleccionar esta función
 * en el desplegable → Ejecutar) para forzar que la siguiente petición relea
 * config.json en vez de esperar a que caduque la caché de 5 minutos.
 */
function clearConfigCache() {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
}

/**
 * IDs numéricos reales de las etiquetas en esta cuenta de AC (verificados
 * por API, 2026-09-16). Fijos aquí en vez de resueltos por nombre en cada
 * petición: la búsqueda por nombre contra /api/3/tags (filters[name]=...)
 * no filtraba como se esperaba y devolvía el id de otra etiqueta ya
 * existente en la cuenta — el contacto se etiquetaba igualmente, pero con
 * la etiqueta equivocada, sin ningún error (ver ActiveCampaign.gs).
 * Si se crea una etiqueta nueva en AC, añadir aquí su id a mano.
 */
const AC_TAG_IDS = {
  'mau_lead': 45,
  'mau-lanz-2609': 88,
  'mau-2609-nc': 93
};

// Copia de seguridad de site/config/config.json — mantener en sync manualmente.
const FALLBACK_CONFIG_ = {
  funnel_name: 'mau-lanz-2609',
  product_interest_id: 'autoconocimiento',
  origin: 'landing-mau-lz',
  ac_tags: { universal: ['mau_lead', 'mau-lanz-2609'], no_cualifica: 'mau-2609-nc' },
  ac_custom_fields: { funnel_name: 6, utm_source: 12, utm_medium: 13, utm_campaign: 14, utm_content: 15, utm_term: 16 },
  sheet_id: '1HWb5k_viFg-DB0SxlDfwyKxzoYQoERQ7YqMekV3VC-I',
  sheet_tab: 'Leads',
  calendly: {
    event_name: 'Asesoramiento - Máster en Autoconocimiento (LZ)',
    url: 'https://calendly.com/kuestiona-team/asesoramiento-master-en-autoconocimiento-lz'
  },
  gate_rules: {
    q1_fail_options: ['d'],
    q2_fail_options: ['c'],
    q4_pass_options_if_latam: ['c', 'd']
  }
};