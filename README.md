# Landing de precualificación — Máster en Autoconocimiento (LZ)

Implementación del brief `brief-landing-precualificacion-mau-lz.md`. Resumen de qué es cada carpeta y cómo desplegarlo.

## Estructura

```
site/                  Carpeta de salida: TODO lo que se sirve en precall-mau.kuestiona.com,
                        tal cual (HTML/CSS/JS + config/config.json), sin build.
                        Es la única carpeta que se sincroniza al servidor (ver despliegue).
apps-script/           Código del Google Apps Script Web App (backend único).
.github/workflows/     Despliegue automático por SSH/rsync (push a main o manual).
```

## 1. Desplegar la landing (sección 7)

Automático vía GitHub Actions (`.github/workflows/deploy.yml`): cada push a `main`
(o ejecución manual desde la pestaña Actions) sincroniza el contenido de `site/`
por rsync+SSH a `/home/kuestiona/precall-mau.kuestiona.com`, dejando:
```
precall-mau.kuestiona.com/index.html
precall-mau.kuestiona.com/css/...
precall-mau.kuestiona.com/js/...
precall-mau.kuestiona.com/config/config.json
```
Requiere el secret `DEPLOY_SSH_KEY` (clave privada) configurado en el repo.
No hace falta build ni bundler: son ficheros estáticos tal cual.

## 2. Desplegar el Apps Script (backend único, sección 4)

1. Crea un proyecto de Google Apps Script (script.google.com) y copia dentro los
   ficheros de `apps-script/` (`Code.gs`, `Config.gs`, `Sheet.gs`, `ActiveCampaign.gs`,
   `appsscript.json`). Si usas `clasp`, apunta el `rootDir` a esta carpeta.
2. En **Extensiones → Propiedades del proyecto → Propiedades del script**, añade:
   - `AC_API_URL` — URL base de la API de ActiveCampaign (ej. `https://tuCuenta.api-us1.com`)
   - `AC_API_KEY` — API Key de ActiveCampaign
   - `CONFIG_URL` (opcional) — por defecto usa `https://precall-mau.kuestiona.com/config/config.json`;
     solo hace falta si quieres apuntar a otro sitio en pruebas.
3. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo** (el usuario que despliega)
   - Quién tiene acceso: **Cualquier usuario**
4. Copia la URL de la implementación (`.../exec`) y pégala en
   `site/config/config.json` → `backend_web_app_url`. Haz commit y push a `main`
   (el workflow de despliegue lo sube solo) o súbelo a mano si vas con prisa.
5. El script da permiso de acceso a Sheets/UrlFetch la primera vez que se ejecuta
   (autorización estándar de Apps Script) — hazlo con una llamada de prueba antes
   de dar el lanzamiento por cerrado.

**Nota sobre credenciales de ActiveCampaign:** este documento explica dónde configurarlas;
no se ha creado, modificado ni probado nada contra la cuenta real de ActiveCampaign ni
contra ningún escenario de Make durante esta implementación.

**Qué se manda a ActiveCampaign (y qué no):** contacto (email/teléfono/nombre) + tags
(`MAU-LZ` y `LATAM`/`no-LATAM`) + automatización 20 si no cualifica + los custom fields
`funnel_name`/UTMs listados en `ac_custom_fields` de `config.json` (IDs verificados por
API contra la cuenta real — hay un juego de campos UTM con guion bajo al final que es
inválido/legacy, no usarlo). Las respuestas del cuestionario (Q1-Q4, `resultado_gate`)
**no** se mandan a AC bajo ningún concepto: viven solo en Sheets, y de ahí pasan a la
Oportunidad de Airtable si el lead cualifica y agenda, vía la automatización de Make
existente (fuera de alcance de esta landing).

## 3. Config centralizada (sección 6)

Todo lo que cambia de un lanzamiento a otro vive en `site/config/config.json`:
textos y opciones de las preguntas, umbrales del gate, tags de AC, ID del automation
de "no cualifica", URL de Calendly, IDs de Sheets. El Apps Script lo lee del propio
sitio publicado (con caché de 6h) para no duplicar lógica; si el fetch falla, usa una
copia de seguridad embebida en `Config.gs` que hay que mantener sincronizada a mano
si cambian los `gate_rules` o los tags.

Para el próximo lanzamiento: duplica `site/config/config.json`, cambia los valores, despliega.

## 4. Limitaciones conocidas (no son bugs)

- **+1 no se trata como LATAM por prefijo** (EE.UU./Canadá comparten código con
  RD/Puerto Rico). El huso horario del navegador sí puede disparar la pregunta 4
  para quien tenga huso horario latinoamericano aunque su prefijo sea +1.
- Calendly permite precargar nombre/email/teléfono por URL pero el usuario puede
  editarlos antes de reservar; no hay forma de bloquear esos campos.
- `ac_identifier` y `calendly_event_reservado` se dejan vacíos: esta landing no
  sabe si la persona llegó a reservar en Calendly (eso lo resuelve la maquinaria
  existente, OP00, fuera de alcance — ver sección 8 del brief).
- El copy de la pantalla de "no cualifica" (`site/index.html`, sección `#step-fail`)
  es un placeholder — el brief lo deja pendiente de definir por el equipo.

## 5. Checklist antes de publicar (sección 9)

- [ ] Probar un teléfono con "+" y confirmar que se guarda como texto en Sheets
      (columna `phone`), no como `#ERROR!` — lógica en `Sheet.gs::writeTextValue_`.
- [ ] Probar los 4 casos límite del gate: Q1=d, Q2=c, LATAM con inversión baja/alta
      — lógica en `Code.gs::evaluateGate_`.
- [ ] Confirmar que un prefijo LATAM con huso horario europeo, y un prefijo no-LATAM
      con huso horario LATAM, muestran igualmente la pregunta 4 — `site/js/latam.js`.
- [ ] Confirmar que al fallar el gate no se muestra Calendly y sí se llama a
      `add_contact_to_automation` con el ID 20 — `ActiveCampaign.gs`.
- [ ] Confirmar que al pasar el gate el link de Calendly abre con nombre/email
      precargados — `site/js/main.js::renderResult`.
- [ ] Confirmar que las preguntas abiertas se pueden saltar sin bloquear nada
      — botón "Saltar" en `#step-open`.
- [ ] Confirmar que la fila de Sheets tiene las columnas nuevas al final sin tocar
      las existentes — `Sheet.gs::getHeaderMap_` es idempotente y no reordena.
- [ ] Rellenar `backend_web_app_url` en `site/config/config.json` con la URL real del
      deploy de Apps Script antes de dar el lanzamiento por cerrado.
- [ ] Rellenar `AC_API_URL` / `AC_API_KEY` en las Propiedades del script.
