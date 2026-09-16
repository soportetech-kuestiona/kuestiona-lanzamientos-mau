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
const CONFIG_CACHE_TTL_SECONDS = 6 * 60 * 60;

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
