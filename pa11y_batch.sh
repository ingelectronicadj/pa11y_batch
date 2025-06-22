#!/bin/bash

# Validar si pa11y está instalado
if ! command -v pa11y &> /dev/null; then
  echo "Error: pa11y no está instalado. Instálalo con: npm install -g pa11y"
  exit 1
fi

# Parámetros válidos
VALID_REPORTERS=("html" "json" "csv" "tsv" "cli")
VALID_LEVELS=("errors" "warnings" "notices")

# Preguntar por el formato del reporte
if [ -z "$1" ]; then
  echo "Selecciona el formato del reporte (html,json,csv,tsv,cli):"
  read -r REPORTER
else
  REPORTER="$1"
fi

# Preguntar por el nivel de severidad
if [ -z "$2" ]; then
  echo "Selecciona el nivel de severidad (errors, warnings, notices) [default: errors (Enter)]:"
  read -r LEVEL
  LEVEL="${LEVEL:-errors}"
else
  LEVEL="$2"
fi

# Preguntar por el tiempo de espera
if [ -z "$3" ]; then
  echo "Indica el tiempo de espera en milisegundos antes de iniciar el análisis [default: 3000ms (Enter)]:"
  echo "(Este valor permite que la página cargue completamente antes de analizar su accesibilidad)"
  read -r WAIT
  WAIT="${WAIT:-3000}"
else
  WAIT="$3"
fi

# Preguntar por el archivo externo de URLs
if [ -z "$4" ]; then
  echo "Indica la ruta del archivo .txt con las URLs (formato alias|url):"
  read -r URL_FILE
else
  URL_FILE="$4"
fi

# Validar tipo de reporter
if [[ ! " ${VALID_REPORTERS[*]} " =~ " $REPORTER " ]]; then
  echo "Tipo de reporte inválido. Usa uno de: html, json, csv, tsv, cli"
  exit 1
fi

# Validar nivel
if [[ ! " ${VALID_LEVELS[*]} " =~ " $LEVEL " ]]; then
  echo "Nivel inválido. Usa uno de: errors, warnings, notices"
  exit 1
fi

# Validar existencia del archivo
if [ ! -f "$URL_FILE" ]; then
  echo "El archivo '$URL_FILE' no existe. Verifica la ruta."
  exit 1
fi

# Leer lista de URLs
URLS=()
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
  URLS+=("$line")
done < "$URL_FILE"

if [ "${#URLS[@]}" -eq 0 ]; then
  echo "El archivo '$URL_FILE' no contiene líneas válidas (formato alias|url)"
  exit 1
fi

# Configurar opciones de severidad
INCLUDE_WARNINGS=""
INCLUDE_NOTICES=""
if [[ "$LEVEL" == "warnings" ]]; then
  INCLUDE_WARNINGS="--include-warnings"
elif [[ "$LEVEL" == "notices" ]]; then
  INCLUDE_WARNINGS="--include-warnings"
  INCLUDE_NOTICES="--include-notices"
fi

# Crear carpeta de salida
OUTPUT_DIR="./artifacts"
mkdir -p "$OUTPUT_DIR"

# Timestamp
TIMESTAMP=$(date +%s)

echo "-----------------------------------------"
echo "Ejecutando Pa11y con los siguientes parámetros:"
echo "Formato del reporte: $REPORTER"
echo "Nivel de severidad: $LEVEL"
echo "Tiempo de espera: ${WAIT}ms"
echo "Archivo de URLs: $URL_FILE"
echo "Carpeta de salida: $OUTPUT_DIR"
echo "Timestamp: $TIMESTAMP"
echo "-----------------------------------------"

# Iterar por cada URL
for entry in "${URLS[@]}"; do
  IFS="|" read -r alias url <<< "$entry"
  output_file="${OUTPUT_DIR}/${alias}-report-${TIMESTAMP}.${REPORTER}"

  echo "Escaneando: $url"
  echo "Guardando en: $output_file"

  pa11y "$url" \
    -e axe -e htmlcs \
    -w "$WAIT" \
    $INCLUDE_WARNINGS \
    $INCLUDE_NOTICES \
    -r "$REPORTER" \
    > "$output_file"

  exit_code=$?

  if [ -s "$output_file" ]; then
    echo "Reporte generado para $alias (salida: $exit_code)"
  else
    echo "Falló la generación del reporte para $alias (salida: $exit_code)"
  fi

  echo "-----------------------------------------"
done
