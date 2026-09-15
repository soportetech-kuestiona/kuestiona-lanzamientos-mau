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
    lead_id: null,
    resultado_gate: null
  };

  const els = {};

  function showStep(name) {
    document.querySelectorAll('.step').forEach((el) => {
      el.hidden = el.dataset.step !== name;
    });
  }

  function nextAfter(current) {
    let idx = STEP_ORDER.indexOf(current);
    idx += 1;
    while (idx < STEP_ORDER.length) {
      const candidate = STEP_ORDER[idx];
      if (candidate === 'q4' && !state.latam.latam_detectado) {
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
      const div = document.createElement('div');
      div.className = 'option';
      div.dataset.value = code;
      div.textContent = label;
      div.addEventListener('click', () => {
        container.querySelectorAll('.option').forEach((o) => o.classList.remove('selected'));
        div.classList.add('selected');
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
    const phone = document.getElementById('input-phone').value.trim();

    if (!firstName || !lastName || !email || !phone) {
      errEl.textContent = 'Rellena todos los campos.';
      errEl.hidden = false;
      return false;
    }
    if (!/^\+?[0-9\s()-]{6,}$/.test(phone)) {
      errEl.textContent = 'Revisa el teléfono (usa el prefijo internacional, ej. +34).';
      errEl.hidden = false;
      return false;
    }
    errEl.hidden = true;
    state.contact = { first_name: firstName, last_name: lastName, email, phone };
    state.latam = window.LatamDetection.detectLatam(phone, state.config.latam_detection);
    return true;
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
      submitAnswers();
    }
  }

  async function submitAnswers() {
    showStep('loading');
    const payload = {
      type: 'submit',
      ...state.contact,
      ...state.tracking,
      ...state.latam,
      answers: state.answers
    };

    try {
      const webAppUrl = state.config.backend_web_app_url;
      const data = await window.Api.postToBackend(webAppUrl, payload);
      state.lead_id = data.lead_id;
      state.resultado_gate = data.resultado_gate;
      renderResult(data);
    } catch (err) {
      console.error('Fallo al enviar el formulario', err);
      showStep('fail');
      document.getElementById('fail-message').textContent =
        'Ha ocurrido un error al procesar tus respuestas. Por favor, inténtalo de nuevo en unos minutos.';
    }
  }

  function renderResult(data) {
    if (data.resultado_gate) {
      showStep('pass');
      const calendlyUrl = new URL(data.calendly_url || state.config.calendly.url);
      calendlyUrl.searchParams.set('first_name', state.contact.first_name);
      calendlyUrl.searchParams.set('last_name', state.contact.last_name);
      calendlyUrl.searchParams.set('email', state.contact.email);
      calendlyUrl.searchParams.set('a1', state.contact.phone);

      if (window.Calendly) {
        window.Calendly.initInlineWidget({
          url: calendlyUrl.toString(),
          parentElement: document.getElementById('calendly-embed')
        });
      }
    } else {
      showStep('fail');
    }

    // Preguntas abiertas: secundarias, tras la decisión, nunca bloquean (sección 2).
    setTimeout(() => showStep('open'), 1500);
  }

  async function sendOpenQuestions() {
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
    showStep('thanks');
  }

  function wireEvents() {
    document.querySelector('[data-action="start"]').addEventListener('click', () => showStep('contact'));
    document.querySelector('[data-action="next-from-contact"]').addEventListener('click', () => goNext('contact'));
    document.querySelectorAll('[data-action="next"], [data-action="submit"]').forEach((btn) => {
      btn.addEventListener('click', () => goNext(btn.dataset.from));
    });
    document.querySelector('[data-action="skip-open"]').addEventListener('click', () => showStep('thanks'));
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

    wireEvents();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
