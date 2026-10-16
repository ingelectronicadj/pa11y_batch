# Pa11y Batch
Script en Bash para ejecutar pruebas automatizadas de accesibilidad web sobre múltiples URLs usando [Pa11y](https://github.com/pa11y/pa11y). Genera reportes en diferentes formatos y niveles de severidad, facilitando su integración en flujos de trabajo de validación de accesibilidad digital.

## Requisitos

- [Node.js](https://nodejs.org/)
- Pa11y (instalable vía npm)

### Instalación de Pa11y

```bash
npm install -g pa11y
``` 

## Formato del archivo de entrada

Debes proporcionar un archivo `.txt` que contenga las URLs a evaluar. Cada línea debe tener el formato:

alias|https://ejemplo.com

## Uso del script

Puedes ejecutarlo mediante **banderas con nombre** (recomendado para pipelines CI/CD), **argumentos posicionales** o de forma **interactiva**:

### Opción 1: con banderas con nombre (Ideal para CI/CD y automatización)

```bash
./pa11y_batch.sh \
  --urls urls.txt \
  --format html \
  --level warnings \
  --wait 3000 \
  --standard WCAG2AA \
  --runners ambos \
  --lang es \
  --screenshot si \
  --threshold 0 \
  --ci
```

| Bandera | Variable de Entorno | Descripción |
| :--- | :--- | :--- |
| `--urls, -u` | `PA11Y_URLS` | Ruta al archivo `.txt` con formato `alias\|url`. |
| `--format, -r` | `PA11Y_FORMAT` | Tipo de reporte: `html` *(default)*, `json`, `csv`, `tsv`, `cli`. |
| `--level, -l` | `PA11Y_LEVEL` | Severidad incluida: `errors`, `warnings` *(default)*, `notices`. |
| `--wait, -w` | `PA11Y_WAIT` | Espera en milisegundos antes de evaluar (`3000` por defecto). |
| `--standard, -s` | `PA11Y_STANDARD` | Estándar: `WCAG2A`, `WCAG2AA` *(default)*, `WCAG2AAA`. |
| `--runners, -e` | `PA11Y_RUNNERS` | Motores: `ambos` *(default: `axe` + `htmlcs`)*, `axe`, `htmlcs`. |
| `--lang` | `PA11Y_LANG` | Idioma de traducción: `es` *(default)*, `en`. |
| `--root, -R` | `PA11Y_ROOT` | Selector CSS raíz opcional (ej. `#main`). |
| `--hide, -E` | `PA11Y_HIDE` | Selectores CSS a ocultar separados por coma (ej. `.cookie-banner,.ads`). |
| `--screenshot, -S` | `PA11Y_SCREENSHOT` | Guardar captura `.png` de evidencia (`si` / `no`, por defecto `no`). |
| `--threshold, -T` | `PA11Y_THRESHOLD` | Máximo de errores permitidos en modo `--ci` antes de fallar (`0` por defecto). |
| `--ci` | `PA11Y_CI` | Activa modo CI/CD: devuelve código `1` en error técnico o `2` si `errores > threshold`. |

### Opción 2: con argumentos posicionales

```bash
./pa11y_batch.sh <formato> <nivel> <espera_ms> <archivo_urls> [selector_raiz] [selectores_ocultos] [estandar] [captura_pantalla] [idioma] [motores] [--ci]
``` 

**Ejemplo:**

```bash
./pa11y_batch.sh html warnings 4000 urls.txt "#main" ".cookie-banner,.ads" WCAG2AA si es ambos
``` 

### Opción 3: interactiva (sin argumentos)

El script te pedirá los datos paso a paso: formato, nivel de severidad, tiempo de espera, ruta del archivo de URLs, selector raíz, selectores ocultos, estándar WCAG, captura de pantalla, idioma y motores (`ambos`, `axe` o `htmlcs`).

```bash
./pa11y_batch.sh
``` 

## Resultados y Estructura de Artefactos

Cada ejecución se organiza automáticamente en su propia carpeta con fecha y hora legible (`./artifacts/YYYY-MM-DD_HH-MM-SS/`), sincroniza una copia fija en `./artifacts/latest/` para pipelines de CI/CD y actualiza el **Centro de Reportes** en `./artifacts/index.html`:
```bash
artifacts/
├── index.html                           # Centro de Reportes (último lote + historial de ejecuciones)
├── runs-history.csv                     # Historial acumulado de todos los lotes
├── latest/                              # Copia fija de la última ejecución (ideal para CI/CD)
│   ├── index.html                       # Dashboard ejecutivo del lote
│   ├── findings-consolidated.csv        # CSV Maestro de hallazgos del lote (23 columnas + BOM UTF-8)
│   ├── wcag-matrix.csv                  # Matriz de cumplimiento por Criterio WCAG (14 columnas)
│   ├── summary.csv                      # Resumen ejecutivo por URL (25 columnas: impacto, principios, top 3)
│   ├── summary.md                       # Resumen en Markdown ($GITHUB_STEP_SUMMARY / Azure DevOps)
│   ├── junit.xml                        # Reporte JUnit XML (Azure DevOps / GitLab / GitHub)
│   ├── gl-code-quality-report.json      # Reporte GitLab Code Quality para Merge Requests
│   ├── openbank-es-report.html          # Reporte individual interactivo por alias
│   ├── openbank-es-findings.csv         # CSV detallado de hallazgos de este sitio (23 columnas)
│   └── openbank-es-capture.png          # Captura de pantalla de evidencia (si se activó)
└── 2026-10-16_07-49-25/                 # Carpeta histórica del lote con fecha y hora legible
``` 

### Sistema de 4 Archivos CSV (Compatibles con Excel vía BOM UTF-8)
1. **`findings-consolidated.csv` y `<alias>-findings.csv` (23 columnas)**: `ID_Hallazgo` (`A11Y-0001`), `Lote_ID`, `Fecha_Hora`, `Alias_Sitio`, `URL_Evaluada`, `Estandar_Objetivo`, `Severidad`, `Nivel_Impacto`, `Principio_WCAG`, `Pauta_WCAG`, `Criterio_WCAG`, `Nombre_Criterio_WCAG`, `Nivel_WCAG`, `Motor_Evaluador`, `Codigo_Regla`, `Elemento_HTML`, `Descripcion_Hallazgo_ES`, `Recomendacion_Tecnica`, `URL_Documentacion`, `Selector_CSS`, `Fragmento_HTML`, `Mensaje_Original_EN`, `Archivo_Evidencia`.
2. **`wcag-matrix.csv` (14 columnas)**: Agrupa los hallazgos del lote por Principio, Pauta, Criterio y Nivel WCAG con el conteo por severidad, motor, reglas implicadas y sitios afectados.
3. **`summary.csv` (25 columnas)**: Resumen por cada URL con desglose por severidad, nivel de impacto (`Crítico`, `Serio`, `Moderado`, `Menor`), motor (`axe`, `htmlcs`), los 4 Principios WCAG (`Perceptible`, `Operable`, `Comprensible`, `Robusto`) y el `Top_3_Criterios_Afectados`.
4. **`runs-history.csv`**: Bitácora histórica acumulada de todas las ejecuciones.

## Integración Continua (GitHub Actions, GitLab CI y Azure DevOps)

El repositorio incluye plantillas listas para producción en la carpeta [`ci/`](./ci/):

1. **GitHub Actions ([`ci/github-actions.yml`](./ci/github-actions.yml))**:
   - Publica automáticamente la tabla de resultados en el **Job Summary (`$GITHUB_STEP_SUMMARY`)**, emite anotaciones `::error` por cada URL con incumplimientos y adjunta `./artifacts/latest/` como artefacto descargable.
2. **GitLab CI/CD ([`ci/gitlab-ci.yml`](./ci/gitlab-ci.yml))**:
   - Configurado con contenedor `node:22-bookworm` + Chromium y banderas `--no-sandbox`.
   - Conecta `artifacts/latest/junit.xml` a la pestaña **Tests** del pipeline y `artifacts/latest/gl-code-quality-report.json` al widget **Code Quality** del Merge Request.
3. **Azure DevOps Pipelines ([`ci/azure-pipelines.yml`](./ci/azure-pipelines.yml))**:
   - Emite directivas `##vso[task.logissue]` y `##vso[task.uploadsummary]`, publica `artifacts/latest/junit.xml` mediante `PublishTestResults@2` y adjunta los reportes HTML con `PublishBuildArtifacts@1`.

## Características

- Valida que `pa11y` esté instalado.
- Soporta runners `axe` y `htmlcs` simultáneamente.
- Permite elegir el estándar de conformidad (`WCAG2A`, `WCAG2AA`, `WCAG2AAA`).
- Permite incluir advertencias (`warnings`) y avisos (`notices`) según el nivel de severidad indicado.
- Ejecuta con un tiempo de espera configurable para garantizar que la página cargue completamente antes de la evaluación.
- Genera reportes individuales en formatos compatibles: `html`, `json`, `csv`, `tsv` o salida por consola (`cli`).
- **Traducción automática de reportes al español (`es` por defecto, o `en`)**: incluye diccionarios completos en [`locales/es.json`](locales/es.json) y [`locales/htmlcs_es.json`](locales/htmlcs_es.json) con las **105 reglas y 100 checks de `axe-core`** (más su mapeo `axeToWcag`), las **244 entradas oficiales de `HTML_CodeSniffer` (`htmlcs`)** y los **87 criterios WCAG 2.2**.
- **Interfaz Web Ejecutiva y 100 % Responsiva (Desktop, Tablet y Mobile — WCAG 1.4.10 Reflow)**:
  - Conmutador de **Tema Claro / Oscuro** persistente, visor de código HTML con resaltado de sintaxis y ajuste de línea sin scroll horizontal, ruta de selectores CSS en tokens visuales, visor modal (`<dialog>`) de capturas de evidencia en todas las vistas, y tablas adaptativas que se transforman en tarjetas en pantallas móviles.
- **Generación automática de artefactos CSV enriquecidos (23 y 25 columnas con BOM UTF-8)** y reportes nativos de CI/CD (`junit.xml`, `gl-code-quality-report.json`, `summary.md`).
- Soporte opcional de captura de pantalla (`--screen-capture`) por cada URL evaluada como evidencia visual.
- Modo `--ci` para integración en pipelines de integración continua (GitHub Actions, GitLab CI, Jenkins).
- Uso de `--root-element` para enfocar el análisis en una sección específica.
- Uso de `--hide-elements` para omitir secciones visuales molestas (modales, banners, etc.).
- Evaluación del código de salida de Pa11y (`0` sin hallazgos, `2` con hallazgos reportados, `1` error de ejecución) y resumen consolidado al finalizar el lote.
- Soporte para comentarios (`#`) y limpieza de saltos de línea CRLF en el archivo de URLs.
- Documentación de comandos de referencia en [`docs/comandos_Pa11y.md`](docs/comandos_Pa11y.md).

## Licencia

Este proyecto está licenciado bajo los términos de la **GNU GPL v3**. Si usas este script (total o parcialmente) en otros proyectos, por favor brinda atribución al autor original: **Diego Javier Mena Amado**  
Puedes hacerlo mediante una mención en el README, comentarios en el código, o en la documentación del sistema que lo utilice.
