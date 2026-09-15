# Brief para Code — Landing de precualificación, lanzamiento MAU (LZ)

**Plazo: 17/09/2026.** Este documento es la especificación completa de lo que Code debe construir. Todo lo que toca Make/Airtable/Calendly lo llevamos aparte (usuario + Claude), en paralelo, y no bloquea nada de lo que hay aquí.

---

## 0. Qué es esto y qué NO es

Una landing de precualificación: recoge respuestas, decide si el lead cualifica, y si cualifica le enseña un Calendly; si no, le enseña un mensaje y lo manda a nurture por ActiveCampaign. Punto. No gestiona el CRM, no crea oportunidades, no toca Airtable. Eso lo hace la maquinaria que ya existe (OP00) cuando la persona reserva en Calendly.

---

## 1. Arquitectura

```
Usuario → Landing (HTML/JS estático en precall-mau.kuestiona.com)
             │
             ├─ POST a un Google Apps Script Web App (backend único)
             │     ├─ Escribe fila en Google Sheets [DASH00] → pestaña "Leads"
             │     └─ Llama a la API de ActiveCampaign (crear/actualizar contacto + tag + automatización si no cualifica)
             │
             └─ Si cualifica → muestra/redirige a Calendly
                Si no cualifica → muestra mensaje, sin acceso a agenda
```

Nada de backend propio en el servidor SSH/FTP: ese servidor solo aloja los ficheros estáticos (HTML/CSS/JS). Toda la lógica de escritura vive en el Apps Script, evitando gestionar credenciales de Google/AC en un servidor nuevo bajo presión de plazo.

---

## 2. Preguntas exactas, opciones y lógica de corte

**Pregunta 1 — dedicación (todos):**
"Esta formación dura 6 meses y requiere un compromiso de dedicación de 4-5 horas semanales, ¿tienes esa disponibilidad?"
- a) Sí, puedo dedicar unas 4 horas semanales
- b) Sí, aunque no siempre podré conectarme en directo
- c) Podría, pero debo organizarme
- d) Ahora mismo no podría comprometer ese tiempo

**Pregunta 2 — disposición a invertir (todos):**
"¿Estás dispuesto a invertir en tu desarrollo personal?"
- a) Sí, tengo recursos
- b) Sí, pero necesitaría financiación
- c) Ahora mismo no puedo invertir *(no agendes, por favor)*

**Pregunta 3 — situación laboral (todos, NO filtra, solo contexto):**
"¿Cuál es tu situación laboral actualmente?"
Opciones: Empleado / Desempleado / Autónomo / Empresario / Directivo

**Pregunta 4 — capacidad de inversión (SOLO si se detecta LATAM):**
"¿Cuál es tu capacidad de inversión en este momento?"
Opciones: Menos de 1.000€ / No estoy seguro / Entre 1.000€ y 2.000€ / Más de 2.000€

**Regla de corte (`Resultado`):**
```
PASA = (Q1 ≠ d) AND (Q2 ≠ c) AND (si es_latam: Q4 ∈ {Entre 1.000-2.000€, Más de 2.000€})
```
Q3 nunca entra en la regla. Guardar siempre las 4 respuestas, filtre o no.

**Dos preguntas abiertas — NO bloquean el flujo.** Se muestran DESPUÉS de la decisión de gate (ya sea que cualifique o no), en una pantalla/tarjeta secundaria, opcional y saltable ("una cosa más antes de irte"). Si el usuario las responde, se actualiza la misma fila de Sheets por `lead_id`. Si las salta, no pasa nada — el objetivo de los closers era agilizar, así que esto nunca debe retrasar la revelación del Calendly:
- "¿Qué te gustaría cambiar o mejorar de ti en tu proceso de evolución personal?"
- "¿Por qué crees que no lo has conseguido aún?"

---

## 3. Detección de LATAM

Combinar dos señales, no solo el prefijo telefónico:

1. **Prefijo telefónico** — lista estándar LATAM: +52 (México), +54 (Argentina), +57 (Colombia), +51 (Perú), +56 (Chile), +593 (Ecuador), +58 (Venezuela), +502 (Guatemala), +503 (El Salvador), +504 (Honduras), +505 (Nicaragua), +506 (Costa Rica), +507 (Panamá), +509 (Haití), +598 (Uruguay), +595 (Paraguay), +591 (Bolivia), +55 (Brasil).
   ⚠️ **+1 es ambiguo** (EE.UU./Canadá comparten prefijo con República Dominicana y Puerto Rico). Si el número empieza por +1, no lo trates como LATAM solo por eso — es un falso positivo conocido. Si quieres cubrir RD/PR de verdad hace falta tabla de códigos de área, pero para el 17/09 lo dejaría fuera (bajo volumen esperado) y lo señalo como limitación conocida, no como bug.

2. **Huso horario del navegador** — `Intl.DateTimeFormat().resolvedOptions().timeZone`, capturado en el mismo momento que el teléfono.

**Política:** si el prefijo dice LATAM, muestra la Pregunta 4 — el huso horario es una señal de apoyo, no un veto. Si el prefijo NO es LATAM pero el huso horario sí lo es (caso que motivó esta mejora), muéstrala también. Guarda ambas señales en Sheets (`phone_prefix_country`, `browser_timezone`) para poder auditar después cuántos casos de discrepancia hubo.

---

## 4. Backend (Google Apps Script Web App)

Un único endpoint `doPost(e)` que recibe el JSON del formulario y hace dos cosas en este orden:

### 4.1 Escribir en Google Sheets
Archivo: **`[DASH00] - Backup-Sincronizacion-AT-DS`**
ID: `1HWb5k_viFg-DB0SxlDfwyKxzoYQoERQ7YqMekV3VC-I`
Pestaña: **`Leads`**

**Cabecera actual real de la pestaña (verificada, NO la reinventes ni la reordenes):**
```
email, name, registered_at, utm_source, utm_campaign, utm_medium, utm_content, utm_term,
funnel_name, phone, fbc, fbp, lead_id, product_interest_id, origin, facebook_traceID,
gclid, wbraid, gbraid, ac_identifier, Situación (A1), Etapa (A2), Tipo de centro (A3),
Años de experiencia (A4), Frase avatar (B1), Dolores (B2), Disfrute 1-5 (B3), Cambiaría (B4)
```
Las columnas "(A1)" a "(B4)" son residuo de un test antiguo — **no las toques, no las reutilices, no las borres.** Añade las columnas nuevas de este lanzamiento AL FINAL de la hoja (después de "Cambiaría (B4)"), para no romper nada que dependa del orden actual:

```
latam_detectado, phone_prefix_country, browser_timezone, q1_disponibilidad,
q2_disposicion_invertir, q3_situacion_laboral, q4_capacidad_inversion,
resultado_gate, calendly_event_reservado, open_q1_cambio_mejora, open_q2_por_que_no_logrado
```

**Valores a rellenar en las columnas existentes:**
- `email`, `phone` → del formulario
- `name` → la landing captura **Nombre y Apellidos en dos campos separados** (necesario para Calendly, ver sección 5); concatena ambos en esta columna como "Nombre Apellidos" para no romper el formato que ya usa el resto de filas de esta hoja. Guarda también `first_name`/`last_name` sueltos en las columnas nuevas del final si quieres tenerlos listos para la URL de Calendly sin reconstruirlos.
- `registered_at` → timestamp ISO
- `utm_source/campaign/medium/content/term` → de los parámetros de URL de la landing (si no hay, dejar vacío, no inventar)
- `funnel_name` → `"mau-lanz-2609"` si no hay campaña específica en la URL (es el código real que ya usa el resto del stack para este lanzamiento — verificado en Make)
- `lead_id` → genera uno propio, formato libre pero único (ej. `LZ-` + timestamp + random), lo necesitas para poder actualizar la fila luego con las preguntas abiertas
- `product_interest_id` → `"autoconocimiento"`
- `origin` → `"landing-mau-lz"`
- `fbc`, `fbp`, `gclid`, `wbraid`, `gbraid` → cógelos de cookies/URL si existen (mismo patrón que cualquier landing con tracking; si no hay, vacío)
- `ac_identifier` → lo puedes dejar vacío, o rellenarlo si guardas el ID que te devuelve ActiveCampaign al crear el contacto

**Importante — el bug de abril no se repite:** escribe `phone` como texto explícito (usa `Range.setNumberFormat("@")` antes de `setValue`, o antepone el valor con un carácter que fuerce texto). Si el número empieza por "+", Sheets lo puede interpretar como fórmula y guardar `#ERROR!`. Pruébalo con un número real tipo `+34600000000` antes de dar por cerrado esto.

### 4.2 Llamar a ActiveCampaign
- `create_or_update_contact` (email, phone, nombre)
- `add_tag_to_contact`: etiqueta algo como `MAU-LZ` y, según corresponda, `LATAM` / `no-LATAM`
- Si `resultado_gate = No` → `add_contact_to_automation` con **automation ID = 20** ("MAU Lead no cualificado" — automatización real, ya activa, verificada en la cuenta; no crear una nueva)

No hace falta mapear las respuestas a campos personalizados de ActiveCampaign para esta versión — mantenlo mínimo.

---

## 5. Calendly

- Nombre exacto del evento: **"Asesoramiento - Máster en Autoconocimiento (LZ)"** — verificado que este nombre no rompe la categorización aguas abajo.
- **URL real del evento:** `https://calendly.com/kuestiona-team/asesoramiento-master-en-autoconocimiento-lz`
- El formulario de invitado está configurado como **Nombre + Apellidos + Email por separado** (igual que el resto de calendarios de la organización), y **Teléfono es la Pregunta 1**. Confirmado directamente en la configuración del evento — ya no es una hipótesis.

**Precarga de datos (NO es un bloqueo, es solo para ahorrar tecleo):**

Calendly permite precargar campos por parámetros de URL, pero el usuario puede seguir editándolos — no hay forma nativa de dejarlos de solo lectura. No diseñes ninguna lógica que dependa de que el dato llegue igual que se guardó en DASH00; el cruce por email aguas abajo ya es tolerante a esto.

```
https://calendly.com/kuestiona-team/asesoramiento-master-en-autoconocimiento-lz
  ?first_name=<NOMBRE>
  &last_name=<APELLIDOS>
  &email=<EMAIL>
  &a1=<TELEFONO>
```

Si `resultado_gate = No`: no mostrar el link de Calendly bajo ningún concepto. Mostrar un mensaje de cierre (copy pendiente de definir por el equipo) y, opcionalmente, las preguntas abiertas de la sección 2.

---

## 6. Config centralizada (para reutilizar en el próximo lanzamiento)

Todo lo que cambia de un lanzamiento a otro va en un único fichero de configuración, no disperso en el código:
```json
{
  "funnel_name": "mau-lanz-2609",
  "product_interest_id": "autoconocimiento",
  "ac_automation_no_cualifica": 20,
  "ac_tags": ["MAU-LZ"],
  "calendly_url": "PENDIENTE",
  "sheet_id": "1HWb5k_viFg-DB0SxlDfwyKxzoYQoERQ7YqMekV3VC-I",
  "sheet_tab": "Leads",
  "gate_rules": { "...": "los umbrales de la sección 2, no hardcodeados en el JS del formulario" }
}
```

---

## 7. Despliegue

- Estático (HTML/CSS/JS), sin build complejo.
- Destino: `precall-mau.kuestiona.com`. El usuario dará acceso SSH/FTP al servidor cuando Code lo necesite.
- Sin `localStorage`/cookies de terceros más allá de lo estrictamente necesario para capturar UTMs/fbclid ya presentes en la URL.

---

## 8. Fuera de alcance para el 17/09 (fast-follow, no lo construyas ahora)

- Que las respuestas de precualificación aparezcan automáticamente dentro de la ficha de Airtable (Oportunidad) del CRM. Se está resolviendo aparte, con una automatización de Make independiente, condicionada a verificar primero que el Calendly aligerado no rompe la creación de Oportunidades en OP00.
- Cualquier cambio en el escenario Make OP00 (ID 9187780) o en los campos de Airtable existentes.
- Distinguir República Dominicana/Puerto Rico dentro del prefijo +1.

---

## 9. Checklist antes de publicar

- [ ] Un número de teléfono con "+" se guarda como texto en Sheets, no como `#ERROR!`
- [ ] Las 4 preguntas + gate se comportan según la tabla de la sección 2 (probar los 4 casos límite: Q1=d, Q2=c, LATAM con inversión baja, LATAM con inversión alta)
- [ ] Alguien con prefijo LATAM pero huso horario europeo ve igualmente la pregunta 4
- [ ] Al fallar el gate: no se muestra el Calendly, se dispara la automatización 20 en ActiveCampaign
- [ ] Al pasar el gate: el link de Calendly abre con nombre y email ya rellenos y bloqueados
- [ ] Las preguntas abiertas se pueden saltar sin bloquear nada
- [ ] La fila de Sheets tiene todas las columnas nuevas al final, sin tocar las existentes
