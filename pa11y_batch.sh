#!/bin/bash

# ----------------------------------------
# Ayuda / Uso
# ----------------------------------------
mostrar_ayuda() {
  cat <<EOF
Uso:
  $0 <formato> <nivel> <espera_ms> <archivo_urls> [selector_raiz] [selectores_ocultos]
  $0   (modo interactivo si se ejecuta sin argumentos)

Argumentos:
  <formato>             Tipo de reporte: html, json, csv, tsv, cli
  <nivel>               Nivel de severidad: errors, warnings, notices
  <espera_ms>           Tiempo de espera en ms antes del análisis (ej. 3000)
  <archivo_urls>        Ruta al archivo .txt con formato alias|url por línea
  [selector_raiz]       (Opcional) Selector CSS para limitar el análisis (-R)
  [selectores_ocultos]  (Opcional) Selectores CSS separados por coma a ocultar (-E)

Ejemplo:
  $0 html warnings 4000 urls.txt "#main" ".cookie-banner,.ads"
EOF
}

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  mostrar_ayuda
  exit 0
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

# Determinar si se invocó en modo interactivo (sin argumentos)
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
fi

# ----------------------------------------
# Validaciones
# ----------------------------------------
if [[ ! " ${VALID_REPORTERS[*]} " =~ " $REPORTER " ]]; then
  echo "Tipo de reporte inválido. Usa uno de: html, json, csv, tsv, cli"
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

# ----------------------------------------
# Configurar opciones de Pa11y
# ----------------------------------------
PA11Y_ARGS=(-e axe -e htmlcs -w "$WAIT" -r "$REPORTER")

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
# Preparar carpeta de salida
# ----------------------------------------
OUTPUT_DIR="./artifacts"
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date +%s)

# ----------------------------------------
# Mostrar configuración
# ----------------------------------------
echo "-----------------------------------------"
echo "Ejecutando pruebas de accesibilidad con Pa11y"
echo "Formato del reporte   : $REPORTER"
echo "Nivel de severidad    : $LEVEL"
echo "Tiempo de espera      : ${WAIT}ms"
echo "Archivo de URLs       : $URL_FILE"
echo "Selector raíz (-R)    : ${ROOT_SELECTOR:-<sin usar>}"
echo "Ocultar elementos (-E): ${HIDE_SELECTORS:-<sin usar>}"
echo "Carpeta de salida     : $OUTPUT_DIR"
echo "Timestamp             : $TIMESTAMP"
echo "-----------------------------------------"

TOTAL_URLS=0
OK_SIN_HALLAZGOS=0
OK_CON_HALLAZGOS=0
FALLIDOS=0

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
  output_file="${OUTPUT_DIR}/${alias}-report-${TIMESTAMP}.${REPORTER}"
  echo "Analizando: $alias → $url"
  echo "Guardando en: $output_file"

  pa11y "$url" "${PA11Y_ARGS[@]}" > "$output_file"
  exit_code=$?

  # Códigos de salida de Pa11y:
  # 0 = Ejecución exitosa sin hallazgos de accesibilidad que superen el umbral
  # 2 = Ejecución exitosa con hallazgos de accesibilidad reportados
  # 1 (u otro) = Error técnico de ejecución
  if [ "$exit_code" -eq 0 ] && [ -s "$output_file" ]; then
    echo "Reporte generado para $alias (sin hallazgos de accesibilidad)"
    OK_SIN_HALLAZGOS=$((OK_SIN_HALLAZGOS + 1))
  elif [ "$exit_code" -eq 2 ] && [ -s "$output_file" ]; then
    echo "Reporte generado para $alias (con hallazgos de accesibilidad)"
    OK_CON_HALLAZGOS=$((OK_CON_HALLAZGOS + 1))
  else
    echo "Falló la generación del reporte para $alias (código de salida: $exit_code)"
    rm -f "$output_file"
    FALLIDOS=$((FALLIDOS + 1))
  fi

  echo "-----------------------------------------"
done < "$URL_FILE"

echo "Resumen del lote:"
echo "  Total procesadas                 : $TOTAL_URLS"
echo "  Exitosas (sin hallazgos)         : $OK_SIN_HALLAZGOS"
echo "  Exitosas (con hallazgos report.) : $OK_CON_HALLAZGOS"
echo "  Fallidas (error de ejecución)    : $FALLIDOS"
echo "-----------------------------------------"
