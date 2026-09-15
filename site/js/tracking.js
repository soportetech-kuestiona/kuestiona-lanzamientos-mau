/**
 * Captura de UTMs y click-ids de la URL de la landing.
 * Se persisten en sessionStorage (no localStorage, no cookies de terceros) para
 * sobrevivir a la navegación entre pantallas del propio formulario en la misma sesión.
 * Si un parámetro no está presente en la URL, se deja vacío — nunca se inventa (sección 4).
 */
const TRACKED_PARAMS = [
  'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term',
  'gclid', 'wbraid', 'gbraid', 'funnel_name'
];

const STORAGE_KEY = 'mau_lz_tracking';

function readTrackingCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

function captureTracking() {
  const params = new URLSearchParams(window.location.search);
  const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');

  const tracking = { ...stored };
  for (const key of TRACKED_PARAMS) {
    const fromUrl = params.get(key);
    if (fromUrl) tracking[key] = fromUrl;
    else if (!(key in tracking)) tracking[key] = '';
  }

  // fbc/fbp los pone el propio pixel de Meta como cookies de primera parte (_fbc/_fbp).
  // No creamos cookies nuevas: solo leemos las que Meta ya haya podido dejar.
  if (!tracking.fbc) tracking.fbc = readTrackingCookie('_fbc') || params.get('fbclid') || '';
  if (!tracking.fbp) tracking.fbp = readTrackingCookie('_fbp') || '';

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tracking));
  return tracking;
}

window.Tracking = { captureTracking };
