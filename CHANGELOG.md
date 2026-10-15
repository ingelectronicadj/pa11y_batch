# Versiones - Pa11y Batch

Historial de cambios del proyecto **Pa11y Batch**, script de automatización para evaluación de accesibilidad web con [Pa11y](https://github.com/pa11y/pa11y).

---

## Versión 0.1.0

> Fecha: 15-10-2026  
> Autor: Diego Javier Mena

### Reportes en español, Dashboard HTML consolidado, estándar WCAG, capturas y modo CI/CD

- **Traducción automática de reportes al Español (`es` por defecto, o `en`)**:
  - Creación de [`locales/htmlcs_es.json`](locales/htmlcs_es.json) con la traducción al español del **100 % del catálogo oficial de `HTML_CodeSniffer` (`244` entradas / `209` reglas WCAG)**.
  - Incorporación del catálogo unificado [`locales/es.json`](locales/es.json) con las **105 reglas y 100 checks de `axe-core` en español**, las **244 entradas de `HTML_CodeSniffer`** y los **87 criterios de conformidad WCAG 2.2**.
  - Nuevo procesador [`scripts/format_report.js`](scripts/format_report.js) en Node.js que traduce los hallazgos de `axe` y `htmlcs` (incluyendo interpolación de variables dinámicas `{{...}}`), mapea cada incidencia a su criterio WCAG en español y genera los 5 formatos (`html`, `json`, `csv`, `tsv`, `cli`) completamente en español.
  - Los reportes individuales HTML ahora incluyen indicadores por severidad, filtros interactivos (*Todos*, *Errores*, *Advertencias*, *Avisos*) y buscador en tiempo real.
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
