/**
 * Orquesta el wizard: pinta preguntas desde config.json, valida cada paso,
 * calcula la detección LATAM y el gate, llama al backend y decide qué pantalla
 * final mostrar. Ver secciones 2, 3, 4 y 5 del brief.
 */
(function () {
  const STEP_ORDER = ['intro', 'contact', 'q1', 'q2', 'q3', 'q4'];

  const state = {
    config: null,
    tracking: {},
    latam: { latam_detectado: false, phone_prefix_country: '', browser_timezone: '' },
    answers: {
      q1_disponibilidad: null,
      q2_disposicion_invertir: null,
      q3_situacion_laboral: null,
      q4_capacidad_inversion: null
    },
    contact: { first_name: '', last_name: '', email: '', phone: '' },
    phone_country: '', // iso2 del selector de prefijo ('es', 'mx'...): decide qué Calendly ve
    q4_aplica: false, // Q4 (capacidad de inversión): fuera de la UE o LATAM detectado
    lead_id: null,
    resultado_gate: null,
    submitted: false,
    openQuestionsSent: false
  };

  // Mismo formato que Code.gs::generateLeadId_ — se genera aquí para no
  // tener que esperar la respuesta del backend antes de poder identificar
  // la fila (ni para revelar el resultado, ni para las preguntas abiertas).
  function generateLeadId() {
    return 'LZ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  const els = {};

  function showStep(name) {
    document.querySelectorAll('.step').forEach((el) => {
      el.hidden = el.dataset.step !== name;
    });
    updateProgress(name);
  }

  /**
   * Solo presentación: "Paso X de N" + barra. Q4 cuenta solo si el lead es
   * LATAM, que se sabe tras el paso de contacto — hasta entonces N asume 4.
   */
  function updateProgress(name) {
    const progress = document.getElementById('progress');
    const steps = STEP_ORDER.filter((s) => s !== 'intro' && (s !== 'q4' || state.q4_aplica));
    const idx = steps.indexOf(name);
    progress.hidden = idx === -1;
    if (idx === -1) return;
    document.getElementById('progress-label').textContent = 'Paso ' + (idx + 1) + ' de ' + steps.length;
    document.getElementById('progress-bar').style.transform = 'scaleX(' + (idx + 1) / steps.length + ')';
  }

  function nextAfter(current) {
    let idx = STEP_ORDER.indexOf(current);
    idx += 1;
    while (idx < STEP_ORDER.length) {
      const candidate = STEP_ORDER[idx];
      if (candidate === 'q4' && !state.q4_aplica) {
        idx += 1;
        continue;
      }
      return candidate;
    }
    return null; // fin del cuestionario, toca enviar
  }

  function renderQuestion(key, containerId, headingId) {
    const q = state.config.questions[key];
    document.getElementById(headingId).textContent = q.text;
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    Object.entries(q.options).forEach(([code, label]) => {
      const div = document.createElement('button');
      div.type = 'button';
      div.className = 'option';
      div.setAttribute('role', 'radio');
      div.setAttribute('aria-checked', 'false');
      div.dataset.value = code;
      div.textContent = label;
      div.addEventListener('click', () => {
        container.querySelectorAll('.option').forEach((o) => {
          o.classList.remove('selected');
          o.setAttribute('aria-checked', 'false');
        });
        div.classList.add('selected');
        div.setAttribute('aria-checked', 'true');
        state.answers[key] = code;
      });
      container.appendChild(div);
    });
  }

  function validateContact() {
    const errEl = document.getElementById('error-contact');
    const firstName = document.getElementById('input-first-name').value.trim();
    const lastName = document.getElementById('input-last-name').value.trim();
    const email = document.getElementById('input-email').value.trim();
    const rawPhone = document.getElementById('input-phone').value.trim();
    const phone = buildPhone(rawPhone);

    if (!firstName || !lastName || !email || !rawPhone) {
      errEl.textContent = 'Rellena todos los campos.';
      errEl.hidden = false;
      return false;
    }
    if (!phone) {
      errEl.textContent = 'Revisa el teléfono: elige tu país y escribe el número completo.';
      errEl.hidden = false;
      return false;
    }
    errEl.hidden = true;
    state.contact = { first_name: firstName, last_name: lastName, email, phone };
    state.phone_country = getPhoneCountry(phone);
    state.latam = window.LatamDetection.detectLatam(phone, state.config.latam_detection);
    state.q4_aplica = state.latam.latam_detectado || !isEuPhone();
    return true;
  }

  const MIN_PHONE_DIGITS = 6;
  let phoneInput = null; // instancia de intl-tel-input (selector de país)

  /**
   * Devuelve el teléfono en formato "+<prefijo><número>" (p.ej. +34600000000),
   * que es lo que esperan latam.js, Sheets y el a1 de Calendly, o null si no
   * es válido. Si la persona escribe el número ya con "+", manda lo que escribió.
   */
  function buildPhone(raw) {
    if (/^\+/.test(raw)) {
      const digits = raw.replace(/\D/g, '');
      return digits.length >= MIN_PHONE_DIGITS + 1 ? '+' + digits : null;
    }
    const national = raw.replace(/\D/g, '');
    const country = phoneInput && phoneInput.getSelectedCountry();
    if (!country || !country.dialCode || national.length < MIN_PHONE_DIGITS) return null;
    return '+' + country.dialCode + national;
  }

  /**
   * País del teléfono. Se fía del selector solo si su prefijo coincide con el
   * número final (quien escribe "+52..." a mano con España seleccionada no es
   * de España). Si no cuadra, devuelve '' y se trata como fuera de la UE.
   */
  function getPhoneCountry(phone) {
    const country = phoneInput && phoneInput.getSelectedCountry();
    if (!country || !country.dialCode) return '';
    return phone.startsWith('+' + country.dialCode) ? country.iso2 : '';
  }

  function initPhoneInput() {
    if (!window.intlTelInput) return; // sin la librería el campo sigue siendo un input normal
    phoneInput = window.intlTelInput(document.getElementById('input-phone'), {
      initialCountry: 'es',
      countryNameLocale: 'es', // nombres en español y orden alfabético por ellos
      separateDialCode: true,
      countrySearch: true,
      uiTranslations: {
        selectedCountryAriaLabel: 'Cambiar país, seleccionado ${countryName} (${dialCode})',
        noCountrySelected: 'Selecciona el país',
        countryListAriaLabel: 'Lista de países',
        searchPlaceholder: 'Buscar país',
        clearSearchAriaLabel: 'Borrar búsqueda',
        searchEmptyState: 'No se han encontrado resultados',
        searchSummaryAria: (count) => count + ' resultados'
      }
    });
  }

  function goNext(fromStep) {
    if (fromStep === 'contact' && !validateContact()) return;
    if (['q1', 'q2', 'q3', 'q4'].includes(fromStep)) {
      const key = document.getElementById(fromStep + '-options').dataset.question;
      if (!state.answers[key]) return; // requiere selección
    }
    const next = nextAfter(fromStep);
    if (next) {
      showStep(next);
    } else {
      submit();
    }
  }

  /**
   * Revela el resultado al instante calculando el gate en el propio
   * navegador (misma regla que el backend, ver gate.js) y SIN esperar a la
   * llamada de red: en un lanzamiento con mucha gente rellenando el
   * formulario a la vez, ese "un momento…" era la principal fuente de
   * lentitud percibida. El guardado en Sheets/AC pasa a segundo plano.
   */
  function submit() {
    if (state.submitted) return; // guard anti doble-envío (doble clic, reintento)
    state.submitted = true;
    document.querySelector('[data-action="submit"]').disabled = true;

    state.lead_id = generateLeadId();
    state.resultado_gate = window.Gate.evaluateGate(state.answers, state.q4_aplica, state.config.gate_rules);
    renderResult();

    syncInBackground();
  }

  async function syncInBackground() {
    const payload = {
      type: 'submit',
      lead_id: state.lead_id,
      resultado_gate: state.resultado_gate,
      ...state.contact,
      ...state.tracking,
      ...state.latam,
      q4_aplica: state.q4_aplica,
      answers: state.answers
    };
    try {
      await window.Api.postToBackend(state.config.backend_web_app_url, payload);
    } catch (err) {
      // El resultado ya se le mostró al usuario; esto solo afecta al registro
      // en Sheets/AC. Se registra para poder detectarlo, no bloquea nada.
      console.error('No se pudo guardar el lead en el backend', err);
    }
  }

  /**
   * Orden del flujo (corregido tras las pruebas): quien cualifica ve PRIMERO
   * las preguntas abiertas (opcionales) y SOLO DESPUÉS —al enviarlas o
   * saltarlas— el botón de reserva. No pueden aparecer las dos cosas a la
   * vez: si se enseña el botón antes y la persona se va a "una cosa más",
   * pierde la ocasión de reservar sin haberlo hecho todavía.
   */
  function renderResult() {
    if (state.resultado_gate) {
      showStep('open');
    } else {
      showStep('fail');
      // Sin preguntas abiertas para quien no cualifica (no tiene sentido
      // pedírselas): el flujo termina aquí, sin más transiciones.
    }
  }

  function showReserveStep() {
    showStep('pass');
    mountCalendlyCta();
  }

  /**
   * En vez de embeber el widget de Calendly (que en pruebas reales no
   * siempre cargaba a tiempo, o desaparecía antes de poder reservar), se
   * enseña directamente un botón a la página real de Calendly. Se abre en
   * la MISMA pestaña: una vez que la persona se va a reservar, esta landing
   * ya no pinta nada más (Calendly la lleva a su propia página de
   * confirmación), así que no tiene sentido gastar una pestaña nueva.
   */
  function isEuPhone() {
    return (state.config.calendly.eu_countries || []).includes(state.phone_country);
  }

  function getCalendlyBaseUrl() {
    const cal = state.config.calendly;
    if (isEuPhone() || !cal.url_fuera_ue) return cal.url;
    return cal.url_fuera_ue;
  }

  function mountCalendlyCta() {
    const calendlyUrl = new URL(getCalendlyBaseUrl());
    calendlyUrl.searchParams.set('first_name', state.contact.first_name);
    calendlyUrl.searchParams.set('last_name', state.contact.last_name);
    calendlyUrl.searchParams.set('email', state.contact.email);
    calendlyUrl.searchParams.set('a1', state.contact.phone);

    const container = document.getElementById('calendly-cta');
    container.innerHTML = '';
    const link = document.createElement('a');
    link.href = calendlyUrl.toString();
    link.className = 'btn btn-primary';
    link.textContent = 'Reservar mi sesión';
    container.appendChild(link);
  }

  async function sendOpenQuestions() {
    if (state.openQuestionsSent) return; // guard anti doble-envío
    state.openQuestionsSent = true;
    document.querySelector('[data-action="send-open"]').disabled = true;
    document.querySelector('[data-action="skip-open"]').disabled = true;

    // Igual que en el submit principal: se revela el botón de reserva al
    // instante y el guardado va en segundo plano, para no dejar al usuario
    // mirando un botón deshabilitado sin saber qué está pasando.
    showReserveStep();

    const payload = {
      type: 'update_open_questions',
      lead_id: state.lead_id,
      open_q1_cambio_mejora: document.getElementById('input-open-q1').value.trim(),
      open_q2_por_que_no_logrado: document.getElementById('input-open-q2').value.trim()
    };
    try {
      await window.Api.postToBackend(state.config.backend_web_app_url, payload);
    } catch (err) {
      console.error('No se pudieron guardar las preguntas abiertas', err);
    }
  }

  function wireEvents() {
    document.querySelector('[data-action="start"]').addEventListener('click', () => showStep('contact'));
    document.querySelector('[data-action="next-from-contact"]').addEventListener('click', () => goNext('contact'));
    document.querySelectorAll('[data-action="next"], [data-action="submit"]').forEach((btn) => {
      btn.addEventListener('click', () => goNext(btn.dataset.from));
    });
    document.querySelector('[data-action="skip-open"]').addEventListener('click', showReserveStep);
    document.querySelector('[data-action="send-open"]').addEventListener('click', sendOpenQuestions);
  }

  async function init() {
    const res = await fetch('config/config.json');
    state.config = await res.json();

    if (state.config.backend_web_app_url === 'PENDIENTE_URL_APPS_SCRIPT_DEPLOY') {
      console.warn('config.json: falta rellenar backend_web_app_url con la URL del deploy de Apps Script.');
    }

    state.tracking = window.Tracking.captureTracking();

    renderQuestion('q1_disponibilidad', 'q1-options', 'q1-text');
    renderQuestion('q2_disposicion_invertir', 'q2-options', 'q2-text');
    renderQuestion('q3_situacion_laboral', 'q3-options', 'q3-text');
    renderQuestion('q4_capacidad_inversion', 'q4-options', 'q4-text');
    document.getElementById('open-q1-text').textContent = state.config.questions.open_q1_cambio_mejora.text;
    document.getElementById('open-q2-text').textContent = state.config.questions.open_q2_por_que_no_logrado.text;

    initPhoneInput();
    wireEvents();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
