#!/bin/bash

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

# Selector raíz
if [ -z "$ROOT_SELECTOR" ]; then
  echo "¿Deseas limitar el análisis a un elemento específico del DOM? (ej. #main, .contenedor) [Enter para omitir]:"
  read -r ROOT_SELECTOR
fi

# Elementos a ocultar
if [ -z "$HIDE_SELECTORS" ]; then
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

if [ ! -f "$URL_FILE" ]; then
  echo "El archivo $URL_FILE no existe o no es válido."
  exit 1
fi

# ----------------------------------------
# Configurar opciones de severidad
# ----------------------------------------
INCLUDE_WARNINGS=""
INCLUDE_NOTICES=""
if [[ "$LEVEL" == "warnings" ]]; then
  INCLUDE_WARNINGS="--include-warnings"
elif [[ "$LEVEL" == "notices" ]]; then
  INCLUDE_WARNINGS="--include-warnings"
  INCLUDE_NOTICES="--include-notices"
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

# ----------------------------------------
# Leer el archivo de URLs línea por línea
# ----------------------------------------
while IFS='|' read -r alias url || [ -n "$alias" ]; do
  # Saltar líneas vacías o incompletas
  if [[ -z "$alias" || -z "$url" ]]; then
    echo "Línea inválida u omitida: '$alias|$url'"
    continue
  fi

  output_file="${OUTPUT_DIR}/${alias}-report-${TIMESTAMP}.${REPORTER}"
  echo "Analizando: $alias → $url"
  echo "Guardando en: $output_file"

  pa11y "$url" \
    -e axe -e htmlcs \
    -w "$WAIT" \
    $INCLUDE_WARNINGS \
    $INCLUDE_NOTICES \
    ${ROOT_SELECTOR:+--root-element "$ROOT_SELECTOR"} \
    ${HIDE_SELECTORS:+--hide-elements "$HIDE_SELECTORS"} \
    -r "$REPORTER" \
    > "$output_file"

  exit_code=$?

  if [ -s "$output_file" ]; then
    echo "Reporte generado para $alias"
  else
    echo "Falló la generación del reporte para $alias"
  fi

  echo "-----------------------------------------"
done < "$URL_FILE"
