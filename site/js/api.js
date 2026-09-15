/**
 * Cliente contra el Web App de Google Apps Script (backend único, sección 4).
 *
 * Detalle no obvio: los Web Apps de Apps Script no responden bien a preflight
 * OPTIONS de CORS. El truco estándar es enviar el POST con
 * Content-Type: text/plain (que no dispara preflight) y parsear el body como
 * JSON manualmente en doPost. Si se usa 'application/json' aquí, el navegador
 * lanza un OPTIONS que Apps Script no gestiona y la petición falla.
 */
async function postToBackend(webAppUrl, payload, { timeoutMs = 15000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error desconocido del backend');
      return data;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
    }
  }
  throw lastError;
}

window.Api = { postToBackend };
