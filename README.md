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

## 🚀 Uso del script

Puedes ejecutarlo con argumentos o de forma interactiva:

### Opción 1: con argumentos

```bash
./pa11y_batch.sh <formato> <nivel> <espera_ms> <archivo_urls> [selector_raiz] [selectores_ocultos] [estandar] [captura_pantalla] [idioma] [--ci]
``` 

- `<formato>`: Tipo de reporte (`html`, `json`, `csv`, `tsv`, `cli`)
- `<nivel>`: Nivel de severidad (`errors`, `warnings`, `notices`)
- `<espera_ms>`: Tiempo de espera en milisegundos antes de iniciar el análisis (para garantizar la carga completa de la página)
- `<archivo_urls>`: Ruta al archivo `.txt` con URLs
- `[selector_raiz]`: (opcional) Selector CSS para limitar el análisis (ej: `#main`, `.contenido`)
- `[selectores_ocultos]`: (opcional) Selectores CSS a ocultar (separados por coma, ej: `.banner,.popup`)
- `[estandar]`: (opcional) Estándar de conformidad WCAG: `WCAG2A`, `WCAG2AA` *(por defecto)*, `WCAG2AAA`
- `[captura_pantalla]`: (opcional) Guardar captura de pantalla `.png` como evidencia de cada URL evaluada (`si` / `no`, por defecto `no`)
- `[idioma]`: (opcional) Idioma de traducción de los reportes (`es` por defecto para reportes en español, o `en` para inglés original)
- `[--ci]`: (opcional) En entornos CI/CD, devuelve código de salida `1` si hubo errores técnicos o `2` si se detectaron hallazgos de accesibilidad.
- `-h, --help`: Muestra la ayuda rápida por consola.

**Ejemplo:**

```bash
./pa11y_batch.sh html warnings 4000 urls.txt "#main" ".cookie-banner,.ads" WCAG2AA si es
``` 

### Opción 2: interactiva (sin argumentos)

El script te pedirá los datos paso a paso: formato, nivel de severidad, tiempo de espera, ruta del archivo de URLs, (opcional) un selector raíz para limitar el análisis a un elemento específico del DOM, (opcional) selectores separados por comas para ocultar elementos durante el análisis.

```bash
./pa11y_batch.sh
``` 

## 📁 Resultados

Los reportes individuales, las capturas de pantalla opcionales y los índices consolidados del lote se guardan automáticamente en la carpeta `./artifacts`:
```bash
artifacts/index-report-1750552763.html     # Dashboard HTML ejecutivo del lote
artifacts/summary-1750552763.csv           # Resumen consolidado en CSV
artifacts/inicio-report-1750552763.html    # Reporte individual por alias
artifacts/inicio-capture-1750552763.png    # Captura de pantalla (si se activó)
...
``` 
El nombre incluye el alias definido en la lista y un timestamp para identificar el lote de ejecución.

## Características

- Valida que `pa11y` esté instalado.
- Soporta runners `axe` y `htmlcs` simultáneamente.
- Permite elegir el estándar de conformidad (`WCAG2A`, `WCAG2AA`, `WCAG2AAA`).
- Permite incluir advertencias (`warnings`) y avisos (`notices`) según el nivel de severidad indicado.
- Ejecuta con un tiempo de espera configurable para garantizar que la página cargue completamente antes de la evaluación.
- Genera reportes individuales en formatos compatibles: `html`, `json`, `csv`, `tsv` o salida por consola (`cli`).
- **Traducción automática de reportes al español (`es` por defecto, o `en`)**: incluye diccionarios completos en [`locales/es.json`](locales/es.json) y [`locales/htmlcs_es.json`](locales/htmlcs_es.json) con las **105 reglas y 100 checks de `axe-core`**, las **244 entradas oficiales de `HTML_CodeSniffer` (`htmlcs`)** y los **87 criterios WCAG 2.2**, generando reportes HTML interactivos con buscador y filtros por severidad mediante [`scripts/format_report.js`](scripts/format_report.js).
- Genera automáticamente un **Dashboard HTML consolidado (`index-report-<timestamp>.html`)** y un **CSV resumen (`summary-<timestamp>.csv`)** con el conteo detallado de errores, advertencias y avisos por cada URL.
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
