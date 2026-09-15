# precall-mau — landing de precualificación, lanzamiento MAU (LZ)

Landing que precualifica leads antes de enseñarles el Calendly de los closers. Plazo: 17/09/2026.

## Especificación completa

Toda la lógica de negocio vive en `brief-landing-precualificacion-mau-lz.md`, en la raíz de este repo: preguntas exactas y opciones, fórmula de gate, columnas de Google Sheets, parámetros de Calendly, credenciales de ActiveCampaign a usar. Es el resultado de inspeccionar en vivo el CRM real (Make, Airtable, Calendly) — no reinventes ni "mejores" nada de ahí sin preguntar antes. Léelo entero antes de escribir una sola línea.

## Límite duro — no negociable

**No toques Make, Airtable ni Calendly**, aunque tengas conectores MCP disponibles para ellos en este entorno. Esta tarea es únicamente la landing y su Apps Script. El escenario de Make que gestiona las reservas (OP00) es de producción, factura en directo, y ya se ha roto en silencio dos veces por cambios mal medidos. Si algo de lo que estás construyendo parece requerir tocar esos sistemas, para y pregunta — no lo resuelvas por tu cuenta con las herramientas que tengas a mano.

## Stack

- **Frontend:** HTML/CSS/JS estático. Sin framework, sin build step.
- **Backend:** un único Google Apps Script Web App (`doPost`). Nada de servidor propio para lógica — el servidor SSH/FTP solo aloja los ficheros estáticos.
- **Destinos de datos:** Google Sheets (`[DASH00] - Backup-Sincronizacion-AT-DS`, pestaña `Leads`) + API de ActiveCampaign. Ambos detallados en el brief.
- **Despliegue:** `precall-mau.kuestiona.com`, vía SSH/FTP.
- **Config:** todo lo que cambia entre lanzamientos (umbrales, IDs, URL de Calendly) va en un único `config.json`, nunca hardcodeado en el JS del formulario — el objetivo es reutilizar esta landing en el próximo lanzamiento cambiando solo ese fichero.

## Cómo entregar

Cuatro cortes. Para y espera confirmación entre cada uno — no sigas al siguiente sin que se revise el anterior:

1. Formulario + lógica de gate (funcional en el navegador, sin backend todavía)
2. Apps Script + escritura correcta en Sheets (verificar en concreto que un teléfono con "+" se guarda como texto, no como `#ERROR!`)
3. Integración con ActiveCampaign (tag + automatización 20 para no cualificados)
4. Despliegue en `precall-mau.kuestiona.com`

## Credenciales

- Nunca en el código, nunca pegadas en el chat. Variables de entorno o `.env` excluido por `.gitignore`.
- El Apps Script gestiona sus propias credenciales de Google/ActiveCampaign vía Script Properties — no exportes ni dupliques claves en otro sitio.
- Acceso SSH/FTP: pídelo cuando lo necesites, no asumas que ya lo tienes.

## Antes de dar algo por cerrado

Usa el checklist final del brief (sección 9) literalmente, no de memoria. Incluye casos límite de la lógica de gate y el caso LATAM-con-huso-horario-europeo que motivó este rediseño.

## Fuera de alcance de este repo

- Que las respuestas lleguen a la ficha de Airtable del closer — lo monta el usuario junto con Claude en Make, en paralelo, y depende de una verificación pendiente sobre OP00.
- Cualquier edición del escenario Make `[OP00] - CALENDLY - CREAR CONTACTOS...` (ID 9187780) o de las tablas de Airtable que usa.
