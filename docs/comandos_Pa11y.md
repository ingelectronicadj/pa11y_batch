# Referencia de Comandos de Pa11y

Guía rápida de opciones de línea de comandos y ejemplos prácticos de uso de [Pa11y](https://github.com/pa11y/pa11y).

## Sintaxis

```bash
pa11y [opciones] <url>
```

## Opciones principales

| Opción | Descripción |
| :--- | :--- |
| `-V, --version` | Muestra el número de versión. |
| `-n, --environment` | Muestra detalles sobre el entorno en el que se ejecutará Pa11y. |
| `-s, --standard <name>` | Estándar de accesibilidad a utilizar: `WCAG2A`, `WCAG2AA` (por defecto), `WCAG2AAA` *(solo utilizado por el runner `htmlcs`)*. |
| `-r, --reporter <reporter>` | Formato del reporte a utilizar: `cli` (por defecto), `csv`, `tsv`, `html`, `json`. |
| `-e, --runner <runner>` | Motores de pruebas que se utilizarán: `htmlcs` (por defecto), `axe`. |
| `-l, --level <level>` | Nivel de problema que debe fallar (salida con código `2`): `error`, `warning`, `notice`. |
| `-T, --threshold <número>` | Permite este número de errores, advertencias o avisos antes de fallar con código de salida `2`. |
| `-i, --ignore <ignore>` | Tipos y códigos de problemas a ignorar (valor repetible o separado por punto y coma). |
| `--include-notices` | Incluir avisos (`notices`) en el informe. |
| `--include-warnings` | Incluir advertencias (`warnings`) en el informe. |
| `-R, --root-element <selector>` | Selector CSS utilizado para limitar qué parte de una página se comprueba. |
| `-E, --hide-elements <hide>` | Selector(es) CSS separados por comas para ocultar elementos durante las pruebas. |
| `-c, --config <ruta>` | Ruta a un archivo de configuración JSON o JavaScript. |
| `-t, --timeout <ms>` | Tiempo máximo de espera general en milisegundos. |
| `-w, --wait <ms>` | Tiempo de espera en milisegundos antes de ejecutar las pruebas. |
| `-d, --debug` | Muestra mensajes de depuración durante la ejecución. |
| `-S, --screen-capture <ruta>` | Ruta en la que guardar una captura de pantalla de la página evaluada. |
| `-A, --add-rule <rule>` | Reglas WCAG 2.1 adicionales a incluir (valor repetible o separado por punto y coma, solo para `htmlcs`). |
| `-h, --help` | Muestra la información de ayuda. |

## Ejemplos de pruebas manuales

```bash
# Verificar el entorno de ejecución
pa11y https://sedeelectronica.sic.gov.co -n

# Evaluar con nivel WCAG 2 AAA (runner htmlcs)
pa11y https://sedeelectronica.sic.gov.co -s WCAG2AAA

# Evaluación básica por consola (CLI)
pa11y https://sedeelectronica.sic.gov.co

# Evaluar combinando los motores htmlcs y axe
pa11y https://sedeelectronica.sic.gov.co -e htmlcs -e axe

# Exportar reportes en distintos formatos (CSV, HTML, JSON)
pa11y https://sedeelectronica.sic.gov.co -e axe -e htmlcs -r csv > report.csv
pa11y https://sedeelectronica.sic.gov.co -e axe -e htmlcs -r html > report.html
pa11y https://sedeelectronica.sic.gov.co -e axe -e htmlcs -r json > report.json

# Incluir advertencias (warnings) y avisos (notices) en reporte HTML
pa11y https://sedeelectronica.sic.gov.co --include-notices --include-warnings -e axe -e htmlcs -r html > report2.html

# Configurar timeout (-t) o espera previa (-w) en milisegundos
pa11y https://sedeelectronica.sic.gov.co -t 5000 --include-notices --include-warnings -e axe -e htmlcs -r html > report2.html
pa11y https://sedeelectronica.sic.gov.co -w 5000 --include-notices --include-warnings -e axe -e htmlcs -r html > report2.html
```
