#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.npm-global/bin:$PATH"

if [ -z "$PUPPETEER_EXECUTABLE_PATH" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

# ----------------------------------------
# Ayuda / Uso
# ----------------------------------------
mostrar_ayuda() {
  cat <<EOF
Uso:
  1) Con banderas (recomendado para CI/CD y reportes para Stakeholders):
     $0 --urls <archivo_urls> [--format html|json|csv|tsv|cli] [--level errors|warnings|notices]
        [--wait 3000] [--standard WCAG2A|WCAG2AA|WCAG2AAA] [--runners ambos|axe|htmlcs]
        [--viewport desktop|tablet|mobile|reflow|WxH] [--dedupe|--no-dedupe]
        [--lang es|en] [--root "#main"] [--hide ".banner,.ads"] [--screenshot si|no]
        [--headers-file headers.json] [--cookies-file cookies.json] [--actions-file actions.txt]
        [--sitemap https://ejemplo.com/sitemap.xml] [--max-urls 25]
        [--project "Portal Corporativo"] [--auditor "Diego Mena"] [--standalone]
        [--threshold 0] [--ci]

  2) Con argumentos posicionales:
     $0 <formato> <nivel> <espera_ms> <archivo_urls> [selector_raiz] [selectores_ocultos] [estandar] [captura_pantalla] [idioma] [motores] [--ci]

  3) Modo interactivo (sin argumentos):
     $0

  4) Modo servidor web interactivo (Pa11y Batch Web Studio):
     $0 --web [--port 8098] [--host 127.0.0.1] [--allow-local-targets]

  5) Autodiagnóstico interno sin red:
     $0 --self-test

Variables de entorno soportadas (para CI/CD):
  PA11Y_FORMAT, PA11Y_LEVEL, PA11Y_WAIT, PA11Y_URLS, PA11Y_ROOT, PA11Y_HIDE,
  PA11Y_STANDARD, PA11Y_SCREENSHOT, PA11Y_LANG, PA11Y_RUNNERS, PA11Y_PROJECT,
  PA11Y_AUDITOR, PA11Y_STANDALONE, PA11Y_THRESHOLD, PA11Y_CI

Artefactos generados automáticamente en ./artifacts/latest/ y ./artifacts/<YYYY-MM-DD_HH-MM-SS>/:
  - index.html                   (Dashboard HTML del lote con acceso a Vista Stakeholders e Ingeniería)
  - findings-consolidated.csv    (CSV Maestro de 23 columnas con todos los hallazgos)
  - wcag-matrix.csv              (Matriz de cumplimiento por Criterio WCAG)
  - summary.csv                  (Resumen tabular enriquecido de 25 columnas por URL)
  - summary.md                   (Resumen Markdown para GitHub Step Summary / Azure DevOps)
  - junit.xml                    (Reporte JUnit XML para Azure DevOps / GitLab CI / GitHub Actions)
  - gl-code-quality-report.json  (Reporte Code Quality para Merge Requests en GitLab CI)
EOF
}

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  mostrar_ayuda
  exit 0
fi

# ----------------------------------------
# Parseo híbrido: Banderas con nombre, Variables de entorno o Posicionales
# ----------------------------------------
CI_MODE="${PA11Y_CI:-false}"
THRESHOLD="${PA11Y_THRESHOLD:-0}"
PROJECT_NAME="${PA11Y_PROJECT:-}"
AUDITOR_NAME="${PA11Y_AUDITOR:-}"
STANDALONE_MODE="${PA11Y_STANDALONE:-false}"
VIEWPORT="${PA11Y_VIEWPORT:-desktop}"
DEDUPE_MODE="${PA11Y_DEDUPE:-true}"
HEADERS_FILE="${PA11Y_HEADERS_FILE:-}"
COOKIES_FILE="${PA11Y_COOKIES_FILE:-}"
ACTIONS_FILE="${PA11Y_ACTIONS_FILE:-}"
SITEMAP_URL="${PA11Y_SITEMAP:-}"
MAX_SITEMAP_URLS="${PA11Y_MAX_URLS:-25}"
SELF_TEST_MODE=false
WEB_MODE=false
WEB_PORT="${PORT:-8098}"
WEB_HOST="${HOST:-127.0.0.1}"
ALLOW_LOCAL_TARGETS="${PA11Y_ALLOW_LOCAL:-false}"
FLAG_MODE=false

REPORTER="${PA11Y_FORMAT:-}"
LEVEL="${PA11Y_LEVEL:-}"
WAIT="${PA11Y_WAIT:-}"
URL_FILE="${PA11Y_URLS:-}"
ROOT_SELECTOR="${PA11Y_ROOT:-}"
HIDE_SELECTORS="${PA11Y_HIDE:-}"
STANDARD="${PA11Y_STANDARD:-}"
SCREENSHOT="${PA11Y_SCREENSHOT:-}"
REPORT_LANG="${PA11Y_LANG:-}"
RUNNERS_CHOICE="${PA11Y_RUNNERS:-}"

POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci)
      CI_MODE=true
      shift
      ;;
    --format|-r)
      REPORTER="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --level|-l)
      LEVEL="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --wait|-w)
      WAIT="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --urls|-u)
      URL_FILE="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --root|-R)
      ROOT_SELECTOR="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --hide|-E)
      HIDE_SELECTORS="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --standard|-s)
      STANDARD="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --screenshot|-S)
      SCREENSHOT="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --lang)
      REPORT_LANG="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --runners|-e)
      RUNNERS_CHOICE="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --threshold|-T)
      THRESHOLD="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --project|-p)
      PROJECT_NAME="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --auditor|-a)
      AUDITOR_NAME="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --standalone)
      STANDALONE_MODE=true
      FLAG_MODE=true
      shift
      ;;
    --viewport|-V)
      VIEWPORT="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --dedupe)
      DEDUPE_MODE=true
      FLAG_MODE=true
      shift
      ;;
    --no-dedupe)
      DEDUPE_MODE=false
      FLAG_MODE=true
      shift
      ;;
    --headers-file)
      HEADERS_FILE="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --cookies-file)
      COOKIES_FILE="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --actions-file)
      ACTIONS_FILE="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --sitemap)
      SITEMAP_URL="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --max-urls)
      MAX_SITEMAP_URLS="$2"
      FLAG_MODE=true
      shift 2
      ;;
    --self-test)
      SELF_TEST_MODE=true
      shift
      ;;
    --web|--serve)
      WEB_MODE=true
      shift
      ;;
    --port)
      WEB_PORT="$2"
      shift 2
      ;;
    --host)
      WEB_HOST="$2"
      shift 2
      ;;
    --allow-local-targets)
      ALLOW_LOCAL_TARGETS=true
      shift
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done
set -- "${POSITIONAL_ARGS[@]}"

if [ "$SELF_TEST_MODE" = true ]; then
  exec node "$SCRIPT_DIR/scripts/self_test.js"
fi

if [ "$WEB_MODE" = true ]; then
  WEB_EXTRA_ARGS=()
  if [ "$ALLOW_LOCAL_TARGETS" = true ]; then
    WEB_EXTRA_ARGS+=(--allow-local-targets)
  fi
  exec node "$SCRIPT_DIR/scripts/web_server.js" --port "$WEB_PORT" --host "$WEB_HOST" "${WEB_EXTRA_ARGS[@]}"
fi

# ----------------------------------------
# Validar si pa11y está instalado
# ----------------------------------------
if ! command -v pa11y &> /dev/null; then
  echo "Error: pa11y no está instalado. Instálalo con: npm install -g pa11y"
  exit 1
fi

# ----------------------------------------
# Parámetros válidos
# ----------------------------------------
VALID_REPORTERS=("html" "json" "csv" "tsv" "cli")
VALID_LEVELS=("errors" "warnings" "notices")
VALID_STANDARDS=("WCAG2A" "WCAG2AA" "WCAG2AAA")
VALID_LANGS=("es" "en")
VALID_RUNNERS=("ambos" "both" "axe,htmlcs" "htmlcs,axe" "axe" "htmlcs")

INTERACTIVE_MODE=false
if [ $# -eq 0 ] && [ "$FLAG_MODE" = false ] && [ -z "$URL_FILE" ]; then
  INTERACTIVE_MODE=true
fi

# Si se usaron argumentos posicionales, asignarlos
if [ $# -gt 0 ]; then
  REPORTER="${1:-$REPORTER}"
  LEVEL="${2:-$LEVEL}"
  WAIT="${3:-$WAIT}"
  URL_FILE="${4:-$URL_FILE}"
  ROOT_SELECTOR="${5:-$ROOT_SELECTOR}"
  HIDE_SELECTORS="${6:-$HIDE_SELECTORS}"
  STANDARD="${7:-$STANDARD}"
  SCREENSHOT="${8:-$SCREENSHOT}"
  REPORT_LANG="${9:-$REPORT_LANG}"
  RUNNERS_CHOICE="${10:-$RUNNERS_CHOICE}"
fi

# En modo flag o variables de entorno, aplicar valores por defecto si no fueron provistos
if [ "$INTERACTIVE_MODE" = false ]; then
  REPORTER="${REPORTER:-html}"
  LEVEL="${LEVEL:-warnings}"
  WAIT="${WAIT:-3000}"
  STANDARD="${STANDARD:-WCAG2AA}"
  SCREENSHOT="${SCREENSHOT:-no}"
  REPORT_LANG="${REPORT_LANG:-es}"
  RUNNERS_CHOICE="${RUNNERS_CHOICE:-ambos}"
fi

# Modo interactivo paso a paso
if [ "$INTERACTIVE_MODE" = true ]; then
  if [ -z "$REPORTER" ]; then
    echo "Selecciona el formato del reporte (html, json, csv, tsv, cli) [default: html]:"
    read -r REPORTER
    REPORTER="${REPORTER:-html}"
  fi

  if [ -z "$LEVEL" ]; then
    echo "Selecciona el nivel de severidad:"
    echo "  1) Solo errores"
    echo "  2) Errores + advertencias"
    echo "  3) Errores + advertencias + avisos"
    echo "Oprime Enter para usar el valor por defecto: 1 (solo errores)"
    read -r LEVEL_INPUT

    case "$LEVEL_INPUT" in
      1|"") LEVEL="errors" ;;
      2) LEVEL="warnings" ;;
      3) LEVEL="notices" ;;
      *)
        echo "Selección inválida. Usando valor por defecto: errors"
        LEVEL="errors"
        ;;
    esac
  fi

  if [ -z "$WAIT" ]; then
    echo "Indica el tiempo de espera en milisegundos antes de iniciar el análisis [default: 3000]:"
    read -r WAIT
    WAIT="${WAIT:-3000}"
  fi

  if [ -z "$URL_FILE" ]; then
    echo "Indica la ruta al archivo de URLs a analizar (formato alias|url por línea):"
    read -r URL_FILE
  fi

  echo "¿Deseas limitar el análisis a un elemento específico del DOM? (ej. #main, .contenedor) [Enter para omitir]:"
  read -r ROOT_SELECTOR

  echo "¿Deseas ocultar elementos durante el análisis? (ej. .modal,.cookie-banner) [Enter para omitir]:"
  read -r HIDE_SELECTORS

  echo "Selecciona el estándar WCAG (WCAG2A, WCAG2AA, WCAG2AAA) [default: WCAG2AA]:"
  read -r STANDARD
  STANDARD="${STANDARD:-WCAG2AA}"

  echo "¿Deseas guardar captura de pantalla PNG por cada URL evaluada? (si/no) [default: no]:"
  read -r SCREENSHOT
  SCREENSHOT="${SCREENSHOT:-no}"

  echo "Selecciona el idioma de los reportes (es / en) [default: es]:"
  read -r REPORT_LANG
  REPORT_LANG="${REPORT_LANG:-es}"

  echo "Selecciona los motores de evaluación:"
  echo "  1) Ambos: axe + htmlcs [default]"
  echo "  2) Solo axe (axe-core)"
  echo "  3) Solo htmlcs (HTML_CodeSniffer)"
  read -r RUNNER_INPUT
  case "$RUNNER_INPUT" in
    2|"axe") RUNNERS_CHOICE="axe" ;;
    3|"htmlcs") RUNNERS_CHOICE="htmlcs" ;;
    *) RUNNERS_CHOICE="ambos" ;;
  esac
fi

# ----------------------------------------
# Validaciones
# ----------------------------------------
if [[ ! " ${VALID_REPORTERS[*]} " =~ " $REPORTER " ]]; then
  echo "Tipo de reporte inválido ('$REPORTER'). Usa uno de: html, json, csv, tsv, cli"
  exit 1
fi

if [[ ! " ${VALID_LEVELS[*]} " =~ " $LEVEL " ]]; then
  echo "Nivel inválido ('$LEVEL'). Usa uno de: errors, warnings, notices"
  exit 1
fi

if [[ ! " ${VALID_STANDARDS[*]} " =~ " $STANDARD " ]]; then
  echo "Estándar inválido ('$STANDARD'). Usa uno de: WCAG2A, WCAG2AA, WCAG2AAA"
  exit 1
fi

if [[ ! " ${VALID_LANGS[*]} " =~ " $REPORT_LANG " ]]; then
  echo "Idioma inválido ('$REPORT_LANG'). Usa uno de: es, en"
  exit 1
fi

if [[ ! " ${VALID_RUNNERS[*]} " =~ " $RUNNERS_CHOICE " ]]; then
  echo "Motor inválido ('$RUNNERS_CHOICE'). Usa uno de: ambos, axe, htmlcs"
  exit 1
fi

if ! [[ "$WAIT" =~ ^[0-9]+$ ]]; then
  echo "Tiempo de espera inválido ('$WAIT'). Debe ser un número entero en milisegundos."
  exit 1
fi

if ! [[ "$THRESHOLD" =~ ^[0-9]+$ ]]; then
  echo "Umbral inválido ('$THRESHOLD'). Debe ser un número entero >= 0."
  exit 1
fi

SITEMAP_TMP=""
if [ -n "$SITEMAP_URL" ] && [ -z "$URL_FILE" ]; then
  SITEMAP_TMP="/tmp/pa11y-sitemap-$$-${RANDOM}.txt"
  echo "Extrayendo URLs desde sitemap: $SITEMAP_URL (máx. $MAX_SITEMAP_URLS)..."
  if ! node "$SCRIPT_DIR/scripts/fetch_sitemap.js" "$SITEMAP_URL" "$SITEMAP_TMP" "$MAX_SITEMAP_URLS"; then
    rm -f "$SITEMAP_TMP"
    exit 1
  fi
  URL_FILE="$SITEMAP_TMP"
fi

if [ ! -f "$URL_FILE" ]; then
  echo "El archivo '$URL_FILE' no existe o no es válido."
  exit 1
fi

TAKE_SCREENSHOT=false
if [[ "$SCREENSHOT" =~ ^(si|sí|yes|true|1)$ ]]; then
  TAKE_SCREENSHOT=true
fi

# ----------------------------------------
# Configuración de Chromium para contenedores CI/Docker (--no-sandbox)
# ----------------------------------------
PA11Y_CONFIG_TMP="/tmp/pa11y-config-$$-${RANDOM}.json"
cat <<EOF > "$PA11Y_CONFIG_TMP"
{
  "chromeLaunchConfig": {
    "args": [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  }
}
EOF
trap 'rm -f "$PA11Y_CONFIG_TMP" "$SITEMAP_TMP"' EXIT

# ----------------------------------------
# Configurar opciones base de Pa11y
# ----------------------------------------
PA11Y_ARGS=(-c "$PA11Y_CONFIG_TMP")
RUNNERS_LABEL="axe + htmlcs"

if [[ "$RUNNERS_CHOICE" == "axe" ]]; then
  PA11Y_ARGS+=(-e axe)
  RUNNERS_LABEL="axe"
elif [[ "$RUNNERS_CHOICE" == "htmlcs" ]]; then
  PA11Y_ARGS+=(-e htmlcs)
  RUNNERS_LABEL="htmlcs"
else
  PA11Y_ARGS+=(-e axe -e htmlcs)
  RUNNERS_LABEL="axe + htmlcs"
fi

PA11Y_ARGS+=(-s "$STANDARD" -w "$WAIT" -r json)

if [[ "$LEVEL" == "warnings" ]]; then
  PA11Y_ARGS+=(--include-warnings)
elif [[ "$LEVEL" == "notices" ]]; then
  PA11Y_ARGS+=(--include-warnings --include-notices)
fi

if [ -n "$ROOT_SELECTOR" ]; then
  PA11Y_ARGS+=(--root-element "$ROOT_SELECTOR")
fi

if [ -n "$HIDE_SELECTORS" ]; then
  PA11Y_ARGS+=(--hide-elements "$HIDE_SELECTORS")
fi

# ----------------------------------------
# Preparar carpeta de salida organizada por fecha legible y carpeta fija latest/
# ----------------------------------------
ARTIFACTS_ROOT="./artifacts"
RUN_ID=$(date "+%Y-%m-%d_%H-%M-%S")
if [ -d "${ARTIFACTS_ROOT}/${RUN_ID}" ]; then
  RUN_ID="${RUN_ID}-$$"
fi
FECHA_HUMANA=$(date "+%Y-%m-%d %H:%M:%S")
RUN_DIR="${ARTIFACTS_ROOT}/${RUN_ID}"
LATEST_DIR="${ARTIFACTS_ROOT}/latest"
mkdir -p "$RUN_DIR"
DEBUG_LOG="${RUN_DIR}/debug.log"

SUMMARY_CSV="${RUN_DIR}/summary.csv"
INDEX_HTML="${RUN_DIR}/index.html"
CI_JSONL="${RUN_DIR}/.ci-items.jsonl"
ROOT_PORTAL_HTML="${ARTIFACTS_ROOT}/index.html"
RUNS_HISTORY_CSV="${ARTIFACTS_ROOT}/runs-history.csv"

if [ ! -f "$RUNS_HISTORY_CSV" ]; then
  echo "\"Run_ID\",\"Fecha\",\"Estandar\",\"Motores\",\"Nivel\",\"Formato\",\"Total_URLs\",\"Errores\",\"Advertencias\",\"Avisos\"" > "$RUNS_HISTORY_CSV"
fi

echo "\"Alias\",\"URL\",\"Estado\",\"Errores\",\"Advertencias\",\"Avisos\",\"Axe\",\"HTMLCS\",\"Codigo_Salida\",\"Reporte\",\"Captura\"" > "$SUMMARY_CSV"

# ----------------------------------------
# Mostrar configuración
# ----------------------------------------
echo "-----------------------------------------"
echo "Ejecutando pruebas de accesibilidad con Pa11y"
echo "ID de ejecución       : $RUN_ID"
echo "Formato del reporte   : $REPORTER"
echo "Idioma del reporte    : $REPORT_LANG"
echo "Motores activos       : $RUNNERS_LABEL"
echo "Estándar WCAG         : $STANDARD"
echo "Nivel de severidad    : $LEVEL"
echo "Tiempo de espera      : ${WAIT}ms"
echo "Archivo de URLs       : $URL_FILE"
echo "Selector raíz (-R)    : ${ROOT_SELECTOR:-<sin usar>}"
echo "Ocultar elementos (-E): ${HIDE_SELECTORS:-<sin usar>}"
echo "Captura de pantalla   : $SCREENSHOT"
echo "Modo CI               : $CI_MODE (umbral errores: $THRESHOLD)"
echo "Carpeta del lote      : $RUN_DIR"
echo "Carpeta fija CI       : $LATEST_DIR"
echo "-----------------------------------------"

TOTAL_URLS=0
OK_SIN_HALLAZGOS=0
OK_CON_HALLAZGOS=0
FALLIDOS=0
LOTE_ERRORES=0
LOTE_ADVERTENCIAS=0
LOTE_AVISOS=0
HTML_ROWS=""

# ----------------------------------------
# Leer el archivo de URLs línea por línea
# ----------------------------------------
while IFS='|' read -r alias url || [ -n "$alias" ]; do
  alias="${alias%$'\r'}"
  url="${url%$'\r'}"

  if [[ -z "$alias" && -z "$url" ]] || [[ "$alias" =~ ^[[:space:]]*# ]]; then
    continue
  fi

  if [[ -z "$alias" || -z "$url" ]]; then
    echo "Línea inválida u omitida: '$alias|$url'"
    continue
  fi

  TOTAL_URLS=$((TOTAL_URLS + 1))
  report_filename="${alias}-report.${REPORTER}"
  output_file="${RUN_DIR}/${report_filename}"
  raw_json_tmp="/tmp/pa11y-raw-$$-${TOTAL_URLS}-${RANDOM}.json"
  pa11y_err_tmp="/tmp/pa11y-err-$$-${TOTAL_URLS}-${RANDOM}.log"
  capture_filename=""
  RUN_ARGS=("${PA11Y_ARGS[@]}")

  if [ "$TAKE_SCREENSHOT" = true ]; then
    capture_filename="${alias}-capture.png"
    RUN_ARGS+=(--screen-capture "${RUN_DIR}/${capture_filename}")
  fi

  echo "[ETAPA 1/4] Analizando (${TOTAL_URLS}): $alias -> $url"
  echo "[ETAPA 2/4] Ejecutando motores WCAG 2.2 ($RUNNERS_LABEL · viewport $VIEWPORT) con espera de ${WAIT}ms..."
  echo "Guardando en: $output_file"

  if [ "$TAKE_SCREENSHOT" = true ] || [ "$REPORTER" = "html" ]; then
    capture_filename="${alias}-capture.png"
  fi

  UNIFIED_ARGS=(
    --url "$url"
    --out-json "$raw_json_tmp"
    --standard "$STANDARD"
    --runners "$RUNNERS_CHOICE"
    --level "$LEVEL"
    --wait "$WAIT"
    --viewport "$VIEWPORT"
  )
  if [ -n "$capture_filename" ]; then
    echo "[ETAPA 3/4] Capturando evidencia visual del DOM y recortes en una sola pasada para $alias..."
    UNIFIED_ARGS+=(--capture-png "${RUN_DIR}/${capture_filename}")
  fi
  if [ -n "$ROOT_SELECTOR" ]; then
    UNIFIED_ARGS+=(--root "$ROOT_SELECTOR")
  fi
  if [ -n "$HIDE_SELECTORS" ]; then
    UNIFIED_ARGS+=(--hide "$HIDE_SELECTORS")
  fi
  if [ -n "$HEADERS_FILE" ]; then
    UNIFIED_ARGS+=(--headers-file "$HEADERS_FILE")
  fi
  if [ -n "$COOKIES_FILE" ]; then
    UNIFIED_ARGS+=(--cookies-file "$COOKIES_FILE")
  fi
  if [ -n "$ACTIONS_FILE" ]; then
    UNIFIED_ARGS+=(--actions-file "$ACTIONS_FILE")
  fi
  if [ "$DEDUPE_MODE" = false ] || [ "$DEDUPE_MODE" = "0" ]; then
    UNIFIED_ARGS+=(--no-dedupe)
  else
    UNIFIED_ARGS+=(--dedupe)
  fi

  node "$SCRIPT_DIR/scripts/run_url_audit.js" "${UNIFIED_ARGS[@]}" 2> "$pa11y_err_tmp"
  exit_code=$?
  if [ -s "$pa11y_err_tmp" ]; then
    cat "$pa11y_err_tmp" >> "$DEBUG_LOG"
  fi

  estado_label=""
  badge_class=""
  report_link="-"
  capture_link="-"
  url_errors=0
  url_warnings=0
  url_notices=0
  url_axe=0
  url_htmlcs=0

  if [ -n "$capture_filename" ] && [ -f "${RUN_DIR}/${capture_filename}" ]; then
    capture_link="<a href=\"${capture_filename}\" target=\"_blank\" rel=\"noopener\">Ver captura</a>"
  else
    capture_filename=""
  fi

  if { [ "$exit_code" -eq 0 ] || [ "$exit_code" -eq 2 ]; } && [ -s "$raw_json_tmp" ]; then
    echo "[ETAPA 4/4] Traduciendo hallazgos y compilando reporte interactivo para $alias..."
    stats_line=$(node "$SCRIPT_DIR/scripts/format_report.js" "$raw_json_tmp" "$output_file" "$REPORTER" "$REPORT_LANG" "$alias" "$url" "$STANDARD" "$RUNNERS_LABEL" "$capture_filename" "$CI_JSONL" "$RUN_ID" "$PROJECT_NAME" "$AUDITOR_NAME" "$STANDALONE_MODE" 2>> "$DEBUG_LOG")
    format_status=$?

    if [ "$format_status" -eq 0 ] && [ -s "$output_file" ]; then
      IFS='|' read -r _tag _tot url_errors url_warnings url_notices url_axe url_htmlcs <<< "$stats_line"
      url_errors="${url_errors:-0}"
      url_warnings="${url_warnings:-0}"
      url_notices="${url_notices:-0}"
      url_axe="${url_axe:-0}"
      url_htmlcs="${url_htmlcs:-0}"
      LOTE_ERRORES=$((LOTE_ERRORES + url_errors))
      LOTE_ADVERTENCIAS=$((LOTE_ADVERTENCIAS + url_warnings))
      LOTE_AVISOS=$((LOTE_AVISOS + url_notices))

      if [ "$exit_code" -eq 0 ] && [ "$url_errors" -eq 0 ]; then
        echo "Reporte generado para $alias (sin errores · ${url_warnings} advertencias · ${url_notices} avisos | axe: ${url_axe}, htmlcs: ${url_htmlcs})"
        OK_SIN_HALLAZGOS=$((OK_SIN_HALLAZGOS + 1))
        estado_label="Sin hallazgos"
        badge_class="status-ok"
      else
        echo "Reporte generado para $alias (${url_errors} errores · ${url_warnings} advertencias · ${url_notices} avisos | axe: ${url_axe}, htmlcs: ${url_htmlcs})"
        OK_CON_HALLAZGOS=$((OK_CON_HALLAZGOS + 1))
        estado_label="Con hallazgos"
        badge_class="status-warn"

        # Anotaciones nativas para GitHub Actions y Azure DevOps
        if [ "$url_errors" -gt 0 ]; then
          if [ "$GITHUB_ACTIONS" = "true" ]; then
            echo "::error title=Accesibilidad WCAG ($alias)::${url_errors} errores y ${url_warnings} advertencias detectadas en ${url}"
          elif [ "$TF_BUILD" = "True" ]; then
            echo "##vso[task.logissue type=error]Accesibilidad WCAG (${alias}): ${url_errors} errores y ${url_warnings} advertencias en ${url}"
          fi
        fi
      fi
      report_link="<a href=\"${report_filename}\">Abrir reporte (${REPORTER})</a>"
    else
      echo "Falló el formateo del reporte para $alias"
      rm -f "$output_file"
      FALLIDOS=$((FALLIDOS + 1))
      estado_label="Fallido (Error)"
      badge_class="status-fail"
      report_filename=""
      echo "{\"alias\":\"${alias}\",\"url\":\"${url}\",\"status\":\"failed\",\"exitCode\":${exit_code},\"errorsCount\":0,\"warningsCount\":0,\"noticesCount\":0,\"axeCount\":0,\"htmlcsCount\":0,\"issues\":[]}" >> "$CI_JSONL"
    fi
  else
    echo "Falló la generación del reporte para $alias (código de salida: $exit_code)"
    if [ -s "$pa11y_err_tmp" ]; then
      cat "$pa11y_err_tmp"
    fi
    rm -f "$output_file"
    FALLIDOS=$((FALLIDOS + 1))
    estado_label="Fallido (Error)"
    badge_class="status-fail"
    report_filename=""
    echo "{\"alias\":\"${alias}\",\"url\":\"${url}\",\"status\":\"failed\",\"exitCode\":${exit_code},\"errorsCount\":0,\"warningsCount\":0,\"noticesCount\":0,\"axeCount\":0,\"htmlcsCount\":0,\"issues\":[]}" >> "$CI_JSONL"
  fi

  rm -f "$raw_json_tmp" "$pa11y_err_tmp"

  echo "\"${alias}\",\"${url}\",\"${estado_label}\",\"${url_errors}\",\"${url_warnings}\",\"${url_notices}\",\"${url_axe}\",\"${url_htmlcs}\",\"${exit_code}\",\"${report_filename}\",\"${capture_filename}\"" >> "$SUMMARY_CSV"

  HTML_ROWS="${HTML_ROWS}
        <tr>
          <td><strong>${alias}</strong></td>
          <td><a href=\"${url}\" target=\"_blank\" rel=\"noopener\">${url}</a></td>
          <td><span class=\"badge ${badge_class}\">${estado_label}</span></td>
          <td><strong>${url_errors}</strong></td>
          <td>${url_warnings}</td>
          <td>${url_notices}</td>
          <td>${url_axe}</td>
          <td>${url_htmlcs}</td>
          <td>${report_link}</td>
          <td>${capture_link}</td>
        </tr>"

  echo "-----------------------------------------"
done < "$URL_FILE"

# Generar artefactos nativos de CI/CD, Dashboard del lote y Centro de Reportes raíz
node "$SCRIPT_DIR/scripts/generate_ci_reports.js" "$RUN_DIR" "$RUN_ID" "$FECHA_HUMANA" "$STANDARD" "$RUNNERS_LABEL" "$LEVEL" "$REPORTER" "$THRESHOLD" "$ARTIFACTS_ROOT" "$PROJECT_NAME" "$AUDITOR_NAME" 2>> "$DEBUG_LOG" || true
if [ ! -s "$DEBUG_LOG" ]; then
  rm -f "$DEBUG_LOG"
fi

# Sincronizar carpeta fija ./artifacts/latest/ para pipelines de CI/CD
rm -rf "$LATEST_DIR"
mkdir -p "$LATEST_DIR"
cp -R "${RUN_DIR}/." "$LATEST_DIR/"

# Integración automática con resúmenes de GitHub Actions y Azure DevOps
if [ -n "$GITHUB_STEP_SUMMARY" ] && [ -f "${RUN_DIR}/summary.md" ]; then
  cat "${RUN_DIR}/summary.md" >> "$GITHUB_STEP_SUMMARY"
fi
if [ "$TF_BUILD" = "True" ] && [ -f "${RUN_DIR}/summary.md" ]; then
  echo "##vso[task.uploadsummary]$(cd "$RUN_DIR" && pwd)/summary.md"
fi

echo "Resumen del lote:"
echo "  ID de ejecución                  : $RUN_ID"
echo "  Total procesadas                 : $TOTAL_URLS"
echo "  Exitosas (sin hallazgos)         : $OK_SIN_HALLAZGOS"
echo "  Exitosas (con hallazgos report.) : $OK_CON_HALLAZGOS"
echo "  Fallidas (error de ejecución)    : $FALLIDOS"
echo "  Total hallazgos en el lote       : ${LOTE_ERRORES} errores · ${LOTE_ADVERTENCIAS} advertencias · ${LOTE_AVISOS} avisos"
echo "  Centro de reportes (raíz)        : $ROOT_PORTAL_HTML"
echo "  Carpeta fija CI/CD               : $LATEST_DIR/"
echo "  Reporte JUnit XML                : ${LATEST_DIR}/junit.xml"
echo "  Reporte GitLab Code Quality      : ${LATEST_DIR}/gl-code-quality-report.json"
echo "  Resumen Markdown                 : ${LATEST_DIR}/summary.md"
echo "-----------------------------------------"

if [[ "$CI_MODE" == "true" || "$CI_MODE" == "1" ]]; then
  if [ "$FALLIDOS" -gt 0 ]; then
    exit 1
  elif [ "$LOTE_ERRORES" -gt "$THRESHOLD" ]; then
    exit 2
  fi
fi
