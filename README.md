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
./pa11y_batch.sh <formato> <nivel> <espera_ms> <archivo_urls>
``` 

- `<formato>`: Tipo de reporte (`html`, `json`, `csv`, `tsv`, `cli`)
- `<nivel>`: Nivel de severidad (`errors`, `warnings`, `notices`)
- `<espera_ms>`: Tiempo de espera en milisegundos antes de iniciar el análisis (para garantizar la carga completa de la página)
- `<archivo_urls>`: Ruta al archivo `.txt` con URLs

**Ejemplo:**

```bash
./pa11y_batch.sh html errors 5000 urls.txt
``` 

### Opción 2: interactiva (sin argumentos)

El script te pedirá los datos paso a paso: formato, nivel, espera y archivo de URLs.

```bash
./pa11y_batch.sh
``` 

## 📁 Resultados

Los reportes individuales se guardan automáticamente en la carpeta `./artifacts`, cada uno con nombre único. 
```bash
artifacts/inicio-report-1750552763.html
artifacts/transparencia-report-1750552763.json
...
``` 
El nombre incluye el alias definido en la lista y un timestamp para identificar el lote de ejecución.

## Características

- Valida que `pa11y` esté instalado.
- Soporta runners `axe` y `htmlcs` simultáneamente.
- Permite incluir advertencias (`warnings`) y avisos (`notices`) según el nivel de severidad indicado.
- Ejecuta con un tiempo de espera configurable para garantizar que la página cargue completamente antes de la evaluación.
- Genera reportes individuales en formatos compatibles: `html`, `json`, `csv`, `tsv` o salida por consola (`cli`).
- Los archivos se guardan automáticamente en la carpeta `./artifacts` con nombres únicos que incluyen alias y timestamp.
- Informa en consola si la generación del reporte fue exitosa o fallida por cada URL evaluada.