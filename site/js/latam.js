/**
 * Detección de LATAM: prefijo telefónico + huso horario del navegador.
 * Ninguna señal veta a la otra: si cualquiera de las dos dice LATAM, se considera LATAM.
 * Ver sección 3 del brief para la política y el caso conocido de +1 (EE.UU./Canadá/RD/PR).
 */

/**
 * Extrae el prefijo de un teléfono en formato "+<código><resto>" y lo compara
 * contra la lista de prefijos LATAM, probando primero los de 3 dígitos y luego los de 2,
 * para no confundir p.ej. +593 (Ecuador) con +59 (inexistente) o +5 con nada.
 * +1 se excluye explícitamente (ambiguo con EE.UU./Canadá): ver excluded_ambiguous_prefixes.
 */
function detectPhonePrefixCountry(phone, latamConfig) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return null;

  const excluded = new Set(latamConfig.excluded_ambiguous_prefixes || []);
  const prefixes = latamConfig.phone_prefixes || {};
  const candidateLengths = [3, 2, 1];

  for (const len of candidateLengths) {
    const candidate = digits.slice(0, len);
    if (excluded.has(candidate)) continue;
    if (prefixes[candidate]) return prefixes[candidate];
  }
  return null;
}

/** Huso horario del navegador, capturado en el mismo momento que el teléfono. */
function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {
    return '';
  }
}

function isLatamTimezone(timezone, latamConfig) {
  if (!timezone) return false;
  return (latamConfig.timezones || []).includes(timezone);
}

/**
 * Señal combinada. Devuelve las dos señales crudas (para auditar discrepancias en Sheets)
 * y el resultado combinado que decide si se muestra la Pregunta 4.
 */
function detectLatam(phone, latamConfig) {
  const phone_prefix_country = detectPhonePrefixCountry(phone, latamConfig);
  const browser_timezone = getBrowserTimezone();
  const timezone_is_latam = isLatamTimezone(browser_timezone, latamConfig);
  const latam_detectado = Boolean(phone_prefix_country) || timezone_is_latam;

  return {
    latam_detectado,
    phone_prefix_country: phone_prefix_country || '',
    browser_timezone
  };
}

window.LatamDetection = { detectLatam, detectPhonePrefixCountry, getBrowserTimezone, isLatamTimezone };
