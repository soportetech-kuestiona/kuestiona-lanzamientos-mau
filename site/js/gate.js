/**
 * Regla de corte (sección 2 del brief), calculada en el cliente para poder
 * revelar el resultado al instante sin esperar la respuesta del backend.
 * El backend (Code.gs::evaluateGate_) recalcula EXACTAMENTE la misma regla
 * de forma independiente y es la que se persiste — este cálculo aquí es
 * solo para la UI, nunca la fuente de verdad.
 *
 * PASA = (Q1 != fail) AND (Q2 != fail) AND (si es_latam: Q4 in pass_options)
 * Q3 nunca entra en la regla. Los umbrales vienen de config.gate_rules, no
 * están hardcodeados aquí.
 */
function evaluateGate(answers, latamDetectado, gateRules) {
  const q1Fails = (gateRules.q1_fail_options || []).includes(answers.q1_disponibilidad);
  const q2Fails = (gateRules.q2_fail_options || []).includes(answers.q2_disposicion_invertir);

  let q4Passes = true;
  if (latamDetectado) {
    q4Passes = (gateRules.q4_pass_options_if_latam || []).includes(answers.q4_capacidad_inversion);
  }

  return !q1Fails && !q2Fails && q4Passes;
}

window.Gate = { evaluateGate };
