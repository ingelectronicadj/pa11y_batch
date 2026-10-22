# Versiones - Pa11y Batch

Historial de cambios del proyecto **Pa11y Batch**, script de automatización para evaluación de accesibilidad web con [Pa11y](https://github.com/pa11y/pa11y).

---

## Versión 0.4.0

> Fecha: 22-10-2026  
> Autor: Diego Javier Mena

### Pa11y Batch Web Studio: Sitio Web Interactivo para Auditar URLs y Descargar Reportes

- **Nuevo Servidor e Interfaz Web (`scripts/web_server.js` + `./pa11y_batch.sh --web`)**:
  - Sitio web interactivo (`http://localhost:8098/`) sin dependencias externas que permite a cualquier persona ingresar una **URL única** o un **lote de URLs** (por texto o subiendo un archivo `.txt`) y ejecutar la auditoría WCAG en vivo desde el navegador.
  - Configuración completa de **Estándar WCAG** (`WCAG2A`, `WCAG2AA`, `WCAG2AAA`), **Motores** (`axe + htmlcs`, `axe`, `htmlcs`), **Nivel de severidad**, **Idioma** (`es` / `en`), **Evidencia visual DOM**, **Modo Standalone (Base64)** y opciones avanzadas (`--project`, `--auditor`, `--wait`, `--root`, `--hide`).
  - **Consola de progreso en tiempo real mediante Server-Sent Events (`/api/audit/:jobId/stream`)** con respaldo automático por polling JSON (`/api/audit/:jobId/status`).
- **Centro de Descargas Directas y Visor Integrado**:
  - Descarga con un clic del **Reporte HTML autocontenido** (`?download=1`), **Paquete Completo del Lote (`.zip`)** (`/api/runs/:runId/zip`), **CSV Maestro de Hallazgos (23 columnas para Excel)**, **Matriz WCAG (`.csv`)**, **Resumen por URL (`.csv`)** y **JUnit XML**.
  - Visor interactivo integrado en la misma página para alternar entre **Vista Stakeholders**, **Vista Ingeniería** y **Dashboard Consolidado del Lote**, además de tabla de historial de ejecuciones recientes.
  - Interfaz validada con el propio Pa11y (`axe-core` + `HTML_CodeSniffer`) con **0 errores y 0 advertencias WCAG 2.2 AA**, soporte de tema claro/oscuro y anuncios `aria-live="polite"`.

------------

## Versión 0.3.0

> Fecha: 19-10-2026  
> Autor: Diego Javier Mena

### Reportes Públicos para Stakeholders, Deep-Linking por URL e Inspección Visual de Hallazgos

- **Inspección Visual del Error en cada Tarjeta (`scripts/capture_visual_coords.js` + `scripts/format_report.js`)**:
  - Extracción automática mediante Puppeteer de las **coordenadas exactas en el DOM (`x, y, width, height`)**, **recorte gráfico de primer plano (`cropDataUrl`)** con recuadro resaltador sobre el componente afectado y **colores computados reales (`fgHex`, `bgHex`)**.
  - Botón **"Ver señalado en página completa (`x, y px`)"** que abre el visor modal, posiciona el indicador `#A11Y-XXXX` sobre las coordenadas exactas de la captura general y desplaza la vista automáticamente hasta el elemento.
  - **Simulador Visual de Contraste (`1.4.3`)**: Muestra lado a lado la apariencia actual del texto con los colores reales extraídos de la interfaz frente a una referencia accesible (`>= 4.5:1`).
  - **Simulador de Experiencia en Tecnologías de Apoyo**: Compara la experiencia actual en lectores de pantalla (*VoiceOver / NVDA / Teclado*) frente al comportamiento accesible esperado.
- **Modo `"Vista Stakeholders"` vs `"Vista Ingeniería"` y Deep-Linking por URL**:
  - Conmutador interactivo para presentar un informe limpio a negocio/producto (ocultando selectores CSS y bloques HTML) con **Distribución por los 4 Principios WCAG (POUR)**, **Perfiles de Personas Usuarias Afectadas** y **Priorización de Sprint (Análisis de Pareto 80/20)** priorizando errores bloqueantes.
  - Sincronización bidireccional de filtros en la URL (`?view=executive&type=error&runner=axe&wcag=...&q=...`) y enlaces directos por tarjeta (`#A11Y-0001`), con botones **"Compartir vista (URL)"** y **"Enlace #"**.
  - Enlaces de técnicas oficiales W3C verificados (`200 OK` hacia `/Techniques/general/`, `/html/`, `/failures/`, `/css/`, `/client-side-script/`, `/aria/`).
- **Publicación en GitHub Pages (`ci/github-pages-deploy.yml`) y Auditoría Responsiva**:
  - Nueva plantilla de despliegue automático en GitHub Pages y banderas `--project`, `--auditor` y `--standalone`.
  - Verificación automatizada de reflujo responsivo (`0` desbordamientos horizontales en `320px`, `390px`, `768px`, `1024px` y `1440px`).

------------

## Versión 0.2.0

> Fecha: 16-10-2026  
> Autor: Diego Javier Mena

### Integración Continua (GitHub Actions, GitLab CI, Azure DevOps), Organización de Artefactos y Filtros Avanzados

- **Artefactos nativos de CI/CD (`scripts/generate_ci_reports.js`)**:
  - Generación automática de **`junit.xml`** compatible con `PublishTestResults@2` de Azure DevOps, `artifacts:reports:junit` de GitLab CI y GitHub Actions.
  - Generación automática de **`gl-code-quality-report.json`** compatible con el widget de **Code Quality** en Merge Requests de GitLab.
  - Generación automática de **`summary.md`** con inyección directa en `$GITHUB_STEP_SUMMARY` (GitHub Actions) y `##vso[task.uploadsummary]` (Azure DevOps), además de anotaciones `::error` y `##vso[task.logissue]`.
- **CLI con banderas con nombre (`--urls`, `--format`, `--threshold`, `--ci`), variables `PA11Y_*` y soporte Docker**:
  - Soporte completo para argumentos con nombre y variables de entorno además del modo posicional e interactivo.
  - Nuevo parámetro `--threshold <N>` (`PA11Y_THRESHOLD`) para definir el umbral de errores permitidos antes de fallar el quality gate en `--ci`.
  - Configuración automática de Chromium con `--no-sandbox`, `--disable-setuid-sandbox` y `--disable-dev-shm-usage` para ejecución estable en contenedores Linux de CI/CD.
  - Plantillas listas para usar en [`ci/github-actions.yml`](ci/github-actions.yml), [`ci/gitlab-ci.yml`](ci/gitlab-ci.yml) y [`ci/azure-pipelines.yml`](ci/azure-pipelines.yml).
- **Gestión organizada de archivos en `./artifacts` y Sistema de 4 CSVs de Auditoría**:
  - Cada ejecución se almacena en `./artifacts/YYYY-MM-DD_HH-MM-SS/` con nombres limpios (`index.html`, `summary.csv`, `findings-consolidated.csv`, `wcag-matrix.csv`, `<alias>-report.html`, `<alias>-findings.csv`, `<alias>-capture.png`), se replica en `./artifacts/latest/` y actualiza el **Centro de Reportes** raíz (`./artifacts/index.html`).
  - Nuevos archivos CSV con **BOM UTF-8 (`\uFEFF`)** para apertura directa en Microsoft Excel:
    - `findings-consolidated.csv` y `<alias>-findings.csv` con **23 columnas** (`ID_Hallazgo`, `Principio_WCAG`, `Pauta_WCAG`, `Criterio_WCAG`, `Nombre_Criterio_WCAG`, `Nivel_WCAG`, `Nivel_Impacto`, `Elemento_HTML`, `Descripcion_Hallazgo_ES`, `Recomendacion_Tecnica`, `URL_Documentacion`, `Selector_CSS`, `Fragmento_HTML`, etc.).
    - `wcag-matrix.csv` con **14 columnas** agrupadas por criterio WCAG.
    - `summary.csv` enriquecido a **25 columnas** incluyendo conteos por nivel de impacto, por los 4 Principios WCAG y el Top 3 de criterios más afectados por URL.
- **Rediseño Frontend Ejecutivo y Responsivo (Desktop, Tablet y Mobile — WCAG 1.4.10 Reflow)**:
  - Nuevo sistema visual unificado con **Tema Claro / Oscuro** persistente, visor de fragmentos HTML con resaltado de sintaxis y numeración de líneas sin scroll horizontal, selectores CSS tokenizados, visor modal (`<dialog>`) de evidencia visual en las 3 vistas y tablas adaptativas que se convierten en tarjetas en dispositivos móviles y tablets.

------------

## Versión 0.1.0

> Fecha: 15-10-2026  
> Autor: Diego Javier Mena

### Reportes en español, Dashboard HTML consolidado, estándar WCAG, capturas y modo CI/CD

- **Traducción automática de reportes al Español (`es` por defecto, o `en`)**:
  - Creación de [`locales/htmlcs_es.json`](locales/htmlcs_es.json) con la traducción al español del **100 % del catálogo oficial de `HTML_CodeSniffer` (`244` entradas / `209` reglas WCAG)**.
  - Incorporación del catálogo unificado [`locales/es.json`](locales/es.json) con las **105 reglas y 100 checks de `axe-core` en español**, el mapeo `axeToWcag` de las 105 reglas hacia sus criterios WCAG 2.2, las **244 entradas de `HTML_CodeSniffer`** y los **87 criterios de conformidad WCAG 2.2**.
  - Nuevo procesador [`scripts/format_report.js`](scripts/format_report.js) en Node.js que traduce los hallazgos de `axe` y `htmlcs` (incluyendo interpolación de variables dinámicas `{{...}}` y nivel de impacto `Crítico`, `Serio`, `Moderado`, `Menor`), mapea cada incidencia de ambos motores a su criterio WCAG en español y genera los 5 formatos (`html`, `json`, `csv`, `tsv`, `cli`) completamente en español.
  - Los reportes individuales HTML ahora incluyen indicadores por severidad y por motor (`axe` / `htmlcs`), filtros interactivos combinables por **Severidad** (*Todos*, *Errores*, *Advertencias*, *Avisos*) y por **Motor** (*Todos*, *axe*, *htmlcs*), y buscador en tiempo real.
- **Selección de motores de evaluación (`ambos`, `axe`, `htmlcs`)**:
  - Permite ejecutar ambos motores (`axe + htmlcs`), únicamente `axe` o únicamente `htmlcs` tanto desde el asistente interactivo como por argumento CLI (`[motores]`).
- **Generación automática de Dashboard HTML consolidado (`artifacts/index-report-<timestamp>.html`)**:
  - Presenta indicadores ejecutivos del lote (Total URLs, Sin hallazgos, Con hallazgos, Total Errores, Total Advertencias) y una tabla accesible con enlaces directos a cada reporte individual y su evidencia visual.
- **Generación de resumen en CSV (`artifacts/summary-<timestamp>.csv`)**:
  - Consolida alias, URL, estado, conteo de errores/advertencias/avisos, código de salida, archivo de reporte y captura en un único archivo tabular.
- **Soporte de estándar WCAG (`WCAG2A`, `WCAG2AA`, `WCAG2AAA`)**:
  - Selección del nivel de conformidad tanto en modo interactivo como por argumento CLI (`[estandar]`, por defecto `WCAG2AA`).
- **Captura de pantalla de evidencia opcional (`--screen-capture`)**:
  - Permite guardar una imagen `.png` (`<alias>-capture-<timestamp>.png`) de cada URL evaluada indicando `si` en el octavo argumento o en el asistente interactivo.
- **Modo de integración continua (`--ci`)**:
  - Devuelve código de salida `1` si alguna URL falla técnicamente o `2` si se detectan hallazgos de accesibilidad, permitiendo bloquear pipelines en GitHub Actions o GitLab CI.

------------

## Versión 0.0.3

> Fecha: 15-10-2026  
> Autor: Diego Javier Mena

### Ejecución desatendida en CLI, manejo de códigos de salida y documentación en Markdown

- Corrección en el modo por argumentos (CLI): cuando se invoca el script pasando los 4 parámetros obligatorios sin los opcionales (`selector_raiz` y `selectores_ocultos`), ya no se bloquea esperando entrada por teclado (`read`).
- Incorporación de la opción `-h` / `--help` para consultar la ayuda desde la terminal.
- Validación numérica para el tiempo de espera (`espera_ms`).
- Construcción segura de argumentos hacia `pa11y` mediante arreglos de Bash (`PA11Y_ARGS`).
- Evaluación explícita de los códigos de salida de Pa11y (`0` sin hallazgos, `2` con hallazgos de accesibilidad, `1` fallo técnico de ejecución), eliminando archivos vacíos en caso de fallo y mostrando un resumen consolidado al finalizar el lote.
- Soporte para ignorar comentarios (`#`), líneas en blanco y retornos de carro (`\r` / CRLF) en el archivo de URLs.
- Adición de archivo `.gitignore` para excluir `./artifacts`.
- Conversión de la guía de referencia `docs/comandos_Pa11y.odt` a formato Markdown en [`docs/comandos_Pa11y.md`](docs/comandos_Pa11y.md).

------------

## Versión 0.0.2

> Fecha: 23-06-2025  
> Autor: Diego Javier Mena

### Soporte para análisis por secciones y ocultamiento de elementos

- Se incorporó soporte para los parámetros `-R` (`--root-element`) y `-E` (`--hide-elements`) de Pa11y.
  - Permiten delimitar el área a evaluar y ocultar elementos molestos como banners, headers o modales.
- Entrada interactiva para ambos parámetros si no se especifican en la línea de comandos.
- Validación de valores vacíos para aplicar el comportamiento por defecto (sin selector ni ocultamiento).
- El script ahora permite especificar:
  - Un `root-element` como `#main`, `.container`, etc.
  - Un `hide-elements` como `.cookie-banner, .popup-modal`.
- Mejora en el flujo interactivo para que los parámetros opcionales sean más intuitivos.

------------

## Versión 0.0.1

> Fecha: 21-06-2025 
> Autor: Diego Javier Mena

### Lanzamiento inicial del script con soporte para múltiples URLs

- Script Bash para ejecutar pruebas de accesibilidad con `pa11y` en múltiples URLs desde un archivo `.txt`.
- Soporte para los formatos de reporte: `html`, `json`, `csv`, `tsv`, `cli`.
- Soporte de niveles de severidad: `errors`, `warnings`, `notices`.
- Lectura de URLs desde archivo externo en formato `alias|url`.
- Generación automática de archivos de reporte en la carpeta `./artifacts` con nombre único (alias + timestamp).
- Inclusión de los runners `axe` y `htmlcs`.
- Interfaz interactiva si no se pasan argumentos.
- Validación de si `pa11y` está instalado antes de ejecutar.
- Mensajes de estado claros y seguimiento del resultado de cada análisis.

------------

## Versión 0.0.0 – Bitácora inicial de pruebas manuales

> Fecha: 16-02-2025  
> Autor: Diego Javier Mena

- Registro de pruebas realizadas manualmente con `pa11y` por línea de comandos.
- Exploración de configuraciones, reportes y runners disponibles (`axe`, `htmlcs`).
- Base de conocimiento que dio origen a la automatización del script batch.
- Documento de referencia disponible en [`docs/comandos_Pa11y.odt`](docs/comandos_Pa11y.odt).
