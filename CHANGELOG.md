# Versiones - Pa11y Batch

Historial de cambios del proyecto **Pa11y Batch**, script de automatización para evaluación de accesibilidad web con [Pa11y](https://github.com/pa11y/pa11y).

---

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
