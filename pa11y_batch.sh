#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ----------------------------------------
# Ayuda / Uso
# ----------------------------------------
mostrar_ayuda() {
  cat <<EOF
Uso:
  $0 <formato> <nivel> <espera_ms> <archivo_urls> [selector_raiz] [selectores_ocultos] [estandar] [captura_pantalla] [idioma] [--ci]
  $0   (modo interactivo si se ejecuta sin argumentos)

Argumentos:
  <formato>             Tipo de reporte: html, json, csv, tsv, cli
  <nivel>               Nivel de severidad: errors, warnings, notices
  <espera_ms>           Tiempo de espera en ms antes del análisis (ej. 3000)
  <archivo_urls>        Ruta al archivo .txt con formato alias|url por línea
  [selector_raiz]       (Opcional) Selector CSS para limitar el análisis (-R)
  [selectores_ocultos]  (Opcional) Selectores CSS separados por coma a ocultar (-E)
  [estandar]            (Opcional) Estándar WCAG: WCAG2A, WCAG2AA (default), WCAG2AAA
  [captura_pantalla]    (Opcional) Guardar captura PNG de evidencia: si / no (default: no)
  [idioma]              (Opcional) Idioma de los reportes: es (default) / en
  [--ci]                (Opcional) Devuelve código de salida != 0 si hay hallazgos o fallos

Ejemplos:
  $0 html warnings 4000 urls.txt "#main" ".cookie-banner,.ads" WCAG2AA si es
  $0 json errors 3000 urls.txt "" "" WCAG2AA no es --ci
EOF
}

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  mostrar_ayuda
  exit 0
fi

# Detectar bandera --ci en cualquier posición
CI_MODE=false
POSITIONAL_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--ci" ]]; then
    CI_MODE=true
  else
    POSITIONAL_ARGS+=("$arg")
  fi
done
set -- "${POSITIONAL_ARGS[@]}"

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

# Determinar si se invocó en modo interactivo (sin argumentos posicionales)
INTERACTIVE_MODE=false
if [ $# -eq 0 ]; then
  INTERACTIVE_MODE=true
fi

# ----------------------------------------
# Captura de argumentos o preguntas interactivas
# ----------------------------------------
REPORTER="$1"
LEVEL="$2"
WAIT="$3"
URL_FILE="$4"
ROOT_SELECTOR="$5"
HIDE_SELECTORS="$6"
STANDARD="$7"
SCREENSHOT="$8"
REPORT_LANG="$9"

# Formato
if [ -z "$REPORTER" ]; then
  echo "Selecciona el formato del reporte (html, json, csv, tsv, cli):"
  read -r REPORTER
fi

# Nivel con menú numérico
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
else
  if [[ ! " ${VALID_LEVELS[*]} " =~ " $LEVEL " ]]; then
    echo "Nivel inválido. Usa uno de: errors, warnings, notices"
    exit 1
  fi
fi

# Tiempo de espera
if [ -z "$WAIT" ]; then
  echo "Indica el tiempo de espera en milisegundos antes de iniciar el análisis [default: 3000]:"
  echo "(Este valor permite que la página cargue completamente antes de analizar su accesibilidad)"
  read -r WAIT
  WAIT="${WAIT:-3000}"
fi

# Archivo de URLs
if [ -z "$URL_FILE" ]; then
  echo "Indica la ruta al archivo de URLs a analizar (formato alias|url por línea):"
  read -r URL_FILE
fi

# Parámetros opcionales: preguntar solo en modo interactivo
if [ "$INTERACTIVE_MODE" = true ]; then
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
else
  STANDARD="${STANDARD:-WCAG2AA}"
  SCREENSHOT="${SCREENSHOT:-no}"
  REPORT_LANG="${REPORT_LANG:-es}"
fi

# ----------------------------------------
# Validaciones
# ----------------------------------------
if [[ ! " ${VALID_REPORTERS[*]} " =~ " $REPORTER " ]]; then
  echo "Tipo de reporte inválido. Usa uno de: html, json, csv, tsv, cli"
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

if ! [[ "$WAIT" =~ ^[0-9]+$ ]]; then
  echo "Tiempo de espera inválido ('$WAIT'). Debe ser un número entero en milisegundos."
  exit 1
fi

if [ ! -f "$URL_FILE" ]; then
  echo "El archivo $URL_FILE no existe o no es válido."
  exit 1
fi

TAKE_SCREENSHOT=false
if [[ "$SCREENSHOT" =~ ^(si|sí|yes|true|1)$ ]]; then
  TAKE_SCREENSHOT=true
fi

# ----------------------------------------
# Configurar opciones base de Pa11y (captura JSON interna para traducción y formateo)
# ----------------------------------------
PA11Y_ARGS=(-e axe -e htmlcs -s "$STANDARD" -w "$WAIT" -r json)

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
# Preparar carpeta de salida y archivos de resumen
# ----------------------------------------
OUTPUT_DIR="./artifacts"
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date +%s)
FECHA_HUMANA=$(date "+%Y-%m-%d %H:%M:%S")
SUMMARY_CSV="${OUTPUT_DIR}/summary-${TIMESTAMP}.csv"
INDEX_HTML="${OUTPUT_DIR}/index-report-${TIMESTAMP}.html"

echo "\"Alias\",\"URL\",\"Estado\",\"Errores\",\"Advertencias\",\"Avisos\",\"Codigo_Salida\",\"Reporte\",\"Captura\"" > "$SUMMARY_CSV"

# ----------------------------------------
# Mostrar configuración
# ----------------------------------------
echo "-----------------------------------------"
echo "Ejecutando pruebas de accesibilidad con Pa11y"
echo "Formato del reporte   : $REPORTER"
echo "Idioma del reporte    : $REPORT_LANG"
echo "Estándar WCAG         : $STANDARD"
echo "Nivel de severidad    : $LEVEL"
echo "Tiempo de espera      : ${WAIT}ms"
echo "Archivo de URLs       : $URL_FILE"
echo "Selector raíz (-R)    : ${ROOT_SELECTOR:-<sin usar>}"
echo "Ocultar elementos (-E): ${HIDE_SELECTORS:-<sin usar>}"
echo "Captura de pantalla   : $SCREENSHOT"
echo "Modo CI               : $CI_MODE"
echo "Carpeta de salida     : $OUTPUT_DIR"
echo "Timestamp             : $TIMESTAMP"
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
  # Limpiar posibles retornos de carro (\r) de archivos CRLF
  alias="${alias%$'\r'}"
  url="${url%$'\r'}"

  # Ignorar líneas vacías o comentarios (#)
  if [[ -z "$alias" && -z "$url" ]] || [[ "$alias" =~ ^[[:space:]]*# ]]; then
    continue
  fi

  # Validar formato alias|url
  if [[ -z "$alias" || -z "$url" ]]; then
    echo "Línea inválida u omitida: '$alias|$url'"
    continue
  fi

  TOTAL_URLS=$((TOTAL_URLS + 1))
  report_filename="${alias}-report-${TIMESTAMP}.${REPORTER}"
  output_file="${OUTPUT_DIR}/${report_filename}"
  raw_json_tmp=$(mktemp)
  capture_filename=""
  RUN_ARGS=("${PA11Y_ARGS[@]}")

  if [ "$TAKE_SCREENSHOT" = true ]; then
    capture_filename="${alias}-capture-${TIMESTAMP}.png"
    RUN_ARGS+=(--screen-capture "${OUTPUT_DIR}/${capture_filename}")
  fi

  echo "Analizando: $alias → $url"
  echo "Guardando en: $output_file"

  pa11y "$url" "${RUN_ARGS[@]}" > "$raw_json_tmp"
  exit_code=$?

  estado_label=""
  badge_class=""
  report_link="-"
  capture_link="-"
  url_errors=0
  url_warnings=0
  url_notices=0

  if [ -n "$capture_filename" ] && [ -f "${OUTPUT_DIR}/${capture_filename}" ]; then
    capture_link="<a href=\"${capture_filename}\" target=\"_blank\" rel=\"noopener\">Ver captura</a>"
  fi

  if { [ "$exit_code" -eq 0 ] || [ "$exit_code" -eq 2 ]; } && [ -s "$raw_json_tmp" ]; then
    stats_line=$(node "$SCRIPT_DIR/scripts/format_report.js" "$raw_json_tmp" "$output_file" "$REPORTER" "$REPORT_LANG" "$alias" "$url" "$STANDARD" 2>/dev/null)
    format_status=$?

    if [ "$format_status" -eq 0 ] && [ -s "$output_file" ]; then
      IFS='|' read -r _tag _tot url_errors url_warnings url_notices <<< "$stats_line"
      url_errors="${url_errors:-0}"
      url_warnings="${url_warnings:-0}"
      url_notices="${url_notices:-0}"
      LOTE_ERRORES=$((LOTE_ERRORES + url_errors))
      LOTE_ADVERTENCIAS=$((LOTE_ADVERTENCIAS + url_warnings))
      LOTE_AVISOS=$((LOTE_AVISOS + url_notices))

      if [ "$exit_code" -eq 0 ] && [ "$url_errors" -eq 0 ]; then
        echo "Reporte generado para $alias (sin errores · ${url_warnings} advertencias · ${url_notices} avisos)"
        OK_SIN_HALLAZGOS=$((OK_SIN_HALLAZGOS + 1))
        estado_label="Sin hallazgos"
        badge_class="status-ok"
      else
        echo "Reporte generado para $alias (${url_errors} errores · ${url_warnings} advertencias · ${url_notices} avisos)"
        OK_CON_HALLAZGOS=$((OK_CON_HALLAZGOS + 1))
        estado_label="Con hallazgos"
        badge_class="status-warn"
      fi
      report_link="<a href=\"${report_filename}\" target=\"_blank\" rel=\"noopener\">Abrir reporte (${REPORTER})</a>"
    else
      echo "Falló el formateo del reporte para $alias"
      rm -f "$output_file"
      FALLIDOS=$((FALLIDOS + 1))
      estado_label="Fallido (Error)"
      badge_class="status-fail"
      report_filename=""
    fi
  else
    echo "Falló la generación del reporte para $alias (código de salida: $exit_code)"
    rm -f "$output_file"
    FALLIDOS=$((FALLIDOS + 1))
    estado_label="Fallido (Error)"
    badge_class="status-fail"
    report_filename=""
  fi

  rm -f "$raw_json_tmp"

  echo "\"${alias}\",\"${url}\",\"${estado_label}\",\"${url_errors}\",\"${url_warnings}\",\"${url_notices}\",\"${exit_code}\",\"${report_filename}\",\"${capture_filename}\"" >> "$SUMMARY_CSV"

  HTML_ROWS="${HTML_ROWS}
        <tr>
          <td><strong>${alias}</strong></td>
          <td><a href=\"${url}\" target=\"_blank\" rel=\"noopener\">${url}</a></td>
          <td><span class=\"badge ${badge_class}\">${estado_label}</span></td>
          <td><strong>${url_errors}</strong></td>
          <td>${url_warnings}</td>
          <td>${url_notices}</td>
          <td>${report_link}</td>
          <td>${capture_link}</td>
        </tr>"

  echo "-----------------------------------------"
done < "$URL_FILE"

# ----------------------------------------
# Generar Dashboard HTML consolidado del lote
# ----------------------------------------
cat <<EOF > "$INDEX_HTML"
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resumen de Auditoría Pa11y Batch · ${TIMESTAMP}</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
      --primary: #0f766e;
    }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main { max-width: 1140px; margin: 0 auto; }
    header {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    .meta { color: var(--muted); font-size: 0.92rem; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
    }
    .kpi-label { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
    .kpi-value { font-size: 1.8rem; font-weight: 800; margin-top: 4px; }
    .table-wrap {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th, td { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 0.95rem; }
    th { background: #f1f5f9; font-weight: 700; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 700;
    }
    .status-ok { background: #dcfce7; color: #14532d; }
    .status-warn { background: #fef3c7; color: #78350f; }
    .status-fail { background: #fee2e2; color: #7f1d1d; }
    a { color: #0369a1; font-weight: 600; }
    a:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Dashboard de Auditoría de Accesibilidad · Pa11y Batch</h1>
      <div class="meta">
        Fecha: <strong>${FECHA_HUMANA}</strong> · Estándar: <strong>${STANDARD}</strong> ·
        Idioma: <strong>${REPORT_LANG}</strong> · Severidad: <strong>${LEVEL}</strong> ·
        Formato: <strong>${REPORTER}</strong> · Espera: <strong>${WAIT}ms</strong>
      </div>
    </header>

    <section class="kpi-grid" aria-label="Indicadores resumen del lote">
      <div class="kpi-card">
        <div class="kpi-label">Total URLs procesadas</div>
        <div class="kpi-value">${TOTAL_URLS}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Sin hallazgos</div>
        <div class="kpi-value" style="color: #15803d;">${OK_SIN_HALLAZGOS}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Con hallazgos</div>
        <div class="kpi-value" style="color: #b45309;">${OK_CON_HALLAZGOS}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Errores</div>
        <div class="kpi-value" style="color: #dc2626;">${LOTE_ERRORES}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Advertencias</div>
        <div class="kpi-value" style="color: #d97706;">${LOTE_ADVERTENCIAS}</div>
      </div>
    </section>

    <section class="table-wrap" aria-label="Detalle de reportes por URL">
      <table>
        <thead>
          <tr>
            <th scope="col">Alias</th>
            <th scope="col">URL Evaluada</th>
            <th scope="col">Estado</th>
            <th scope="col">Errores</th>
            <th scope="col">Advertencias</th>
            <th scope="col">Avisos</th>
            <th scope="col">Reporte Individual</th>
            <th scope="col">Evidencia Visual</th>
          </tr>
        </thead>
        <tbody>${HTML_ROWS}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>
EOF

echo "Resumen del lote:"
echo "  Total procesadas                 : $TOTAL_URLS"
echo "  Exitosas (sin hallazgos)         : $OK_SIN_HALLAZGOS"
echo "  Exitosas (con hallazgos report.) : $OK_CON_HALLAZGOS"
echo "  Fallidas (error de ejecución)    : $FALLIDOS"
echo "  Total hallazgos en el lote       : ${LOTE_ERRORES} errores · ${LOTE_ADVERTENCIAS} advertencias · ${LOTE_AVISOS} avisos"
echo "  Dashboard HTML consolidado       : $INDEX_HTML"
echo "  Resumen CSV consolidado          : $SUMMARY_CSV"
echo "-----------------------------------------"

if [ "$CI_MODE" = true ]; then
  if [ "$FALLIDOS" -gt 0 ]; then
    exit 1
  elif [ "$OK_CON_HALLAZGOS" -gt 0 ]; then
    exit 2
  fi
fi
