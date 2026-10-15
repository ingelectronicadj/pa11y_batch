#!/usr/bin/env node
/**
 * Traductor y generador de reportes de accesibilidad para Pa11y Batch (ES / EN).
 * Traduce hallazgos de axe-core (vía locales/es.json) y HTML_CodeSniffer (htmlcs),
 * y exporta en formatos: html, json, csv, tsv, cli.
 *
 * Uso:
 *   node scripts/format_report.js <raw_json_path> <output_path> <format> <lang> <alias> <url> <standard>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const [
	,
	,
	rawJsonPath,
	outputPath,
	format = 'html',
	lang = 'es',
	alias = 'reporte',
	targetUrl = '',
	standard = 'WCAG2AA'
] = process.argv;

if (!rawJsonPath || !outputPath) {
	process.exit(1);
}

const localePath = path.join(__dirname, '..', 'locales', 'es.json');
const esCatalog = fs.existsSync(localePath)
	? JSON.parse(fs.readFileSync(localePath, 'utf8'))
	: { rules: {}, checks: {}, wcagCriteria: {}, htmlcs: {} };

// Construir índices a partir del diccionario completo de HTML_CodeSniffer (244 entradas)
const htmlcsExactMap = new Map();
const htmlcsTemplateMatchers = [];

function normalizeSpaces (str) {
	return String(str || '').replace(/\s+/g, ' ').trim();
}

if (esCatalog.htmlcs && typeof esCatalog.htmlcs === 'object') {
	for (const [key, entry] of Object.entries(esCatalog.htmlcs)) {
		const enText = entry && entry.en ? entry.en : '';
		const esText = entry && entry.es ? entry.es : (typeof entry === 'string' ? entry : '');
		if (!enText || !esText) continue;

		if (enText.includes('{{')) {
			const varNames = [];
			const regexPattern = normalizeSpaces(enText)
				.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
				.replace(/\\\{\\\{(\w+)\\\}\\\}/g, (_m, vName) => {
					varNames.push(vName);
					return '(.+?)';
				});
			htmlcsTemplateMatchers.push({
				key,
				regex: new RegExp(`^${regexPattern}$`, 'i'),
				varNames,
				esTemplate: esText
			});
		} else {
			htmlcsExactMap.set(normalizeSpaces(enText).toLowerCase(), esText);
		}
	}
}

const HTMLCS_PATTERNS = [
	[
		/This element has insufficient contrast at this conformance level\. Expected a contrast ratio of at least ([^,]+), but text in this element has a contrast ratio of ([0-9.]+:1)\.(?:\s*Recommendation:\s*(.*))?/i,
		(_m, exp, act, rec) => {
			let msg = `Este elemento tiene un contraste insuficiente para este nivel de conformidad. Se esperaba una relación de contraste de al menos ${exp}, pero el texto tiene una relación de ${act}.`;
			if (rec) {
				const recEs = rec
					.replace(/change text colour to/gi, 'cambiar el color del texto a')
					.replace(/change background to/gi, 'cambiar el fondo a');
				msg += ` Recomendación: ${recEs}`;
			}
			return msg;
		}
	],
	[
		/Img element missing an alt attribute\. Use the alt attribute to specify a short text alternative\./i,
		'El elemento <img> no tiene atributo alt. Utilice el atributo alt para especificar una alternativa textual breve.'
	],
	[
		/Img element is the only content of the link, but is missing alt text\. The alt text should describe the purpose of the link\./i,
		'El elemento <img> es el único contenido del enlace, pero no tiene texto alternativo (alt). El texto alternativo debe describir el propósito del enlace.'
	],
	[
		/Img element with empty alt text must have absent or empty title attribute\./i,
		'Un elemento <img> con atributo alt vacío debe carecer de atributo title o tenerlo vacío.'
	],
	[
		/Anchor element found with a valid href attribute, but no link content has been supplied\./i,
		'Se encontró un enlace (<a>) con un atributo href válido, pero sin texto ni contenido descriptivo.'
	],
	[
		/Anchor element found with no link content and no name and\/or ID attribute\./i,
		'Se encontró un elemento de enlace (<a>) sin contenido de texto ni atributo name o id.'
	],
	[
		/This link points to a named anchor "([^"]+)" within the document, but no anchor exists with that name\./i,
		(_m, anchor) => `Este enlace apunta a un ancla interna "#${anchor}" dentro del documento, pero no existe ningún elemento con ese id o nombre.`
	],
	[
		/This form field should be labelled in some way\. Use the label element \(either with a "for" attribute or wrapped around the form field\), or "title", "aria-label" or "aria-labelledby" attributes as appropriate\./i,
		'Este campo de formulario debe estar etiquetado. Utilice un elemento <label> (con atributo "for" o envolviendo el campo), o los atributos "title", "aria-label" o "aria-labelledby".'
	],
	[
		/This (input|select|textarea|button) element does not have a name available to an accessibility API\. Valid names are: (.*)/i,
		(_m, el, valid) => `Este elemento <${el}> no tiene un nombre accesible disponible para las tecnologías de apoyo. Nombres válidos: ${valid}`
	],
	[
		/This button element does not have a name available to an accessibility API\. Valid names are: (.*)/i,
		(_m, valid) => `Este elemento <button> no tiene un nombre accesible disponible para las tecnologías de apoyo. Nombres válidos: ${valid}`
	],
	[
		/The html element should have a lang or xml:lang attribute which describes the language of the document\./i,
		'El elemento <html> debe tener un atributo lang o xml:lang que identifique el idioma principal del documento.'
	],
	[
		/The language specified in the lang attribute of the document element does not appear to be well-formed\./i,
		'El idioma especificado en el atributo lang del documento no tiene un formato BCP 47 válido.'
	],
	[
		/A title should be provided for the document, using a non-empty title element in the head section\./i,
		'Se debe proporcionar un título para el documento mediante un elemento <title> no vacío dentro de la sección <head>.'
	],
	[
		/Iframe element requires a non-empty title attribute that identifies the frame\./i,
		'El elemento <iframe> requiere un atributo title no vacío que identifique el propósito del marco.'
	],
	[
		/Duplicate id attribute value "([^"]+)" found on the web page\./i,
		(_m, idVal) => `Se encontró un valor de atributo id duplicado ("${idVal}") en la página.`
	],
	[
		/Heading tag found with no content\. Text that is not intended as a heading should not be marked up with heading tags\./i,
		'Se encontró una etiqueta de encabezado vacía. El texto que no tenga función de encabezado no debe marcarse con etiquetas <h1>-<h6>.'
	],
	[
		/The heading structure is not logically nested\. This h(\d) element (.*) appears to be the primary document heading, so should be an h1 element\./i,
		(_m, lvl) => `La estructura de encabezados no está anidada lógicamente. Este elemento <h${lvl}> parece ser el encabezado principal del documento, por lo que debería ser un <h1>.`
	],
	[
		/The heading structure is not logically nested\. This h(\d) element should be an h(\d) to be properly nested\./i,
		(_m, cur, exp) => `La estructura de encabezados no está anidada lógicamente. Este elemento <h${cur}> debería ser un <h${exp}> para mantener la jerarquía.`
	],
	[
		/Check that the title attribute of this element contains text that identifies the frame\./i,
		'Verifique que el atributo title de este marco (frame/iframe) contenga texto que identifique su propósito.'
	],
	[
		/Ensure that theImg element's alt text serves the same purpose and presents the same information as the image\./i,
		'Asegúrese de que el texto alternativo (alt) de la imagen cumpla el mismo propósito y presente la misma información que la imagen.'
	],
	[
		/Ensure that the img element's alt text serves the same purpose and presents the same information as the image\./i,
		'Asegúrese de que el texto alternativo (alt) de la imagen cumpla el mismo propósito y presente la misma información que la imagen.'
	],
	[
		/If this image cannot be fully described in a short alt text, ensure a long text alternative is also available, such as in the body text or through a link\./i,
		'Si esta imagen compleja no puede describirse completamente en un texto alt breve, asegúrese de ofrecer también una descripción extensa en el texto adyacente o mediante un enlace.'
	],
	[
		/Check that the link text combined with programmatically determined link context identifies the purpose of the link\./i,
		'Verifique que el texto del enlace, combinado con su contexto determinado por software, identifique claramente el propósito del enlace.'
	],
	[
		/This element's text is placed on a background image\. Ensure the contrast ratio between the text and all covered parts of the image are at least ([^.]+)\./i,
		(_m, ratio) => `El texto de este elemento está sobre una imagen de fondo. Asegúrese de que la relación de contraste entre el texto y todas las partes cubiertas de la imagen sea de al menos ${ratio}.`
	],
	[
		/Accessible name for this element does not contain the visible label text\. Check that accessible name "([^"]*)" contains the visible label text "([^"]*)"\./i,
		(_m, acc, vis) => `El nombre accesible de este elemento no contiene el texto de la etiqueta visible. Verifique que el nombre accesible ("${acc}") incluya el texto visible ("${vis}").`
	],
	[
		/This form does not contain a submit button, which creates issues for those who cannot submit the form using the keyboard\./i,
		'Este formulario no contiene un botón de envío (submit), lo que dificulta su envío para usuarios de teclado.'
	],
	[
		/Fieldset does not contain a legend element\. All fieldsets should contain a legend element that describes a description of the field group\./i,
		'El elemento <fieldset> no contiene un elemento <legend> que describa el grupo de campos.'
	]
];

function extractWcagFromIssue (issue) {
	const code = issue.code || '';
	const m = code.match(/(\d)_(\d)_(\d+)/);
	if (m) {
		const crit = `${m[1]}.${m[2]}.${m[3]}`;
		const titleEs = esCatalog.wcagCriteria[crit];
		return titleEs ? `${crit} - ${titleEs}` : crit;
	}
	return '';
}

function translateHtmlcsMessage (msg, issueCode) {
	if (!msg) return '';
	const normMsg = normalizeSpaces(msg);

	// 1. Coincidencia exacta en el catálogo de 244 reglas de HTML_CodeSniffer
	const exactMatch = htmlcsExactMap.get(normMsg.toLowerCase());
	if (exactMatch) {
		return exactMatch;
	}

	// 2. Coincidencia por plantilla con variables dinámicas ({{id}}, {{headingNum}}, etc.)
	for (const matcher of htmlcsTemplateMatchers) {
		const m = normMsg.match(matcher.regex);
		if (m) {
			let result = matcher.esTemplate;
			matcher.varNames.forEach((vName, idx) => {
				let val = m[idx + 1] || '';
				if (vName === 'msgNodeType') {
					val = val
						.replace(/^input element$/i, 'elemento de entrada (input)')
						.replace(/^element$/i, 'elemento');
				}
				result = result.replace(new RegExp(`\\{\\{${vName}\\}\\}`, 'g'), val);
			});
			return result;
		}
	}

	// 3. Patrones compuestos (como fallo de contraste + recomendación concatenada)
	for (const [regex, replacement] of HTMLCS_PATTERNS) {
		if (regex.test(normMsg)) {
			if (typeof replacement === 'function') {
				return normMsg.replace(regex, replacement);
			}
			return replacement;
		}
	}

	// 4. Búsqueda directa por sufijo del código de regla (ej. 1_1_1_H37)
	if (issueCode && esCatalog.htmlcs) {
		const codeMatch = issueCode.match(/(\d_\d_\d+(?:_[A-Za-z0-9.,_]+)?)$/);
		if (codeMatch) {
			const candidateKey = codeMatch[1].replace(/\./, '_');
			const entry = esCatalog.htmlcs[candidateKey] || esCatalog.htmlcs[codeMatch[1]];
			if (entry && entry.es && !entry.es.includes('{{')) {
				return entry.es;
			}
		}
	}

	return msg;
}

function translateIssue (issue, targetLang) {
	const type = (issue.type || 'error').toLowerCase();
	const typeLabelsEs = {
		error: 'Error',
		warning: 'Advertencia',
		notice: 'Aviso'
	};
	const typeLabelsEn = {
		error: 'Error',
		warning: 'Warning',
		notice: 'Notice'
	};

	const wcag = extractWcagFromIssue(issue);
	const runner = issue.runner || 'pa11y';
	const code = issue.code || '';
	const helpUrl = (issue.runnerExtras && issue.runnerExtras.helpUrl) ? issue.runnerExtras.helpUrl : '';

	if (targetLang !== 'es') {
		return {
			...issue,
			typeLabel: typeLabelsEn[type] || 'Error',
			wcagCriterion: wcag || '-',
			helpUrl,
			translatedMessage: issue.message || ''
		};
	}

	let translated = issue.message || '';
	let ruleDescription = '';

	if (runner === 'axe' && esCatalog.rules && esCatalog.rules[code]) {
		const ruleEntry = esCatalog.rules[code];
		const helpEs = ruleEntry.help || '';
		const descEs = ruleEntry.description || '';
		ruleDescription = descEs;

		if (helpEs && descEs && helpEs !== descEs) {
			translated = `${helpEs}. ${descEs}`;
		} else {
			translated = helpEs || descEs || translated;
		}
	} else {
		translated = translateHtmlcsMessage(translated, code);
	}

	return {
		...issue,
		typeLabel: typeLabelsEs[type] || 'Error',
		wcagCriterion: wcag || (runner === 'axe' ? `Regla axe: ${code}` : '-'),
		ruleDescription,
		helpUrl,
		originalMessage: issue.message || '',
		message: translated,
		translatedMessage: translated
	};
}

function escapeHtml (str) {
	return String(str || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeCsv (val, sep) {
	const s = String(val == null ? '' : val).replace(/\r?\n/g, ' ');
	if (sep === '\t') {
		return s.replace(/\t/g, ' ');
	}
	return `"${s.replace(/"/g, '""')}"`;
}

let rawIssues = [];
try {
	const content = fs.readFileSync(rawJsonPath, 'utf8').trim();
	if (content) {
		rawIssues = JSON.parse(content);
	}
} catch {
	process.exit(1);
}

if (!Array.isArray(rawIssues)) {
	process.exit(1);
}

const issues = rawIssues.map(i => translateIssue(i, lang));
const errorsCount = issues.filter(i => i.type === 'error').length;
const warningsCount = issues.filter(i => i.type === 'warning').length;
const noticesCount = issues.filter(i => i.type === 'notice').length;

const isEs = lang === 'es';
const nowStr = new Date().toLocaleString(isEs ? 'es-ES' : 'en-US');

if (format === 'json') {
	fs.writeFileSync(outputPath, JSON.stringify(issues, null, 2) + '\n', 'utf8');
} else if (format === 'csv' || format === 'tsv') {
	const sep = format === 'tsv' ? '\t' : ',';
	const headers = isEs
		? ['Tipo', 'Codigo', 'Motor', 'Criterio_WCAG', 'Mensaje', 'Selector_CSS', 'Contexto_HTML']
		: ['type', 'code', 'runner', 'wcag_criterion', 'message', 'selector', 'context'];
	const lines = [headers.map(h => escapeCsv(h, sep)).join(sep)];
	for (const item of issues) {
		lines.push([
			item.typeLabel,
			item.code,
			item.runner,
			item.wcagCriterion,
			item.translatedMessage,
			item.selector,
			item.context
		].map(v => escapeCsv(v, sep)).join(sep));
	}
	fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
} else if (format === 'cli') {
	const lines = [];
	lines.push('======================================================================');
	lines.push(isEs
		? `REPORTE DE ACCESIBILIDAD WEB: ${alias} (${targetUrl})`
		: `WEB ACCESSIBILITY REPORT: ${alias} (${targetUrl})`);
	lines.push(isEs
		? `Estándar: ${standard} | Fecha: ${nowStr}`
		: `Standard: ${standard} | Date: ${nowStr}`);
	lines.push(isEs
		? `Resumen: ${errorsCount} Errores · ${warningsCount} Advertencias · ${noticesCount} Avisos`
		: `Summary: ${errorsCount} Errors · ${warningsCount} Warnings · ${noticesCount} Notices`);
	lines.push('======================================================================\n');

	if (issues.length === 0) {
		lines.push(isEs
			? 'No se detectaron hallazgos de accesibilidad.'
			: 'No accessibility issues detected.');
	} else {
		issues.forEach((item, idx) => {
			lines.push(`[${idx + 1}] [${item.typeLabel.toUpperCase()}] (${item.runner}) ${item.code}`);
			if (item.wcagCriterion && item.wcagCriterion !== '-') {
				lines.push(`    WCAG    : ${item.wcagCriterion}`);
			}
			lines.push(`    ${isEs ? 'Mensaje' : 'Message'} : ${item.translatedMessage}`);
			if (item.selector) {
				lines.push(`    Selector: ${item.selector}`);
			}
			if (item.context) {
				lines.push(`    HTML    : ${String(item.context).replace(/\s+/g, ' ').trim()}`);
			}
			lines.push('');
		});
	}
	fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
} else {
	// Formato HTML accesible en Español / Inglés
	const cardsHtml = issues.length === 0
		? `<div class="empty-box">${isEs ? 'No se encontraron hallazgos de accesibilidad para los criterios seleccionados.' : 'No accessibility issues were found for the selected criteria.'}</div>`
		: issues.map((item, idx) => {
			const typeClass = item.type === 'error' ? 'type-error' : (item.type === 'warning' ? 'type-warning' : 'type-notice');
			const helpLink = item.helpUrl
				? `<a href="${escapeHtml(item.helpUrl)}" target="_blank" rel="noopener" class="help-link">${isEs ? 'Documentación de la regla ↗' : 'Rule documentation ↗'}</a>`
				: '';
			return `
      <article class="issue-card ${typeClass}" data-type="${escapeHtml(item.type)}" data-runner="${escapeHtml(item.runner)}">
        <div class="issue-header">
          <div class="badges">
            <span class="badge ${typeClass}">${escapeHtml(item.typeLabel)}</span>
            <span class="badge badge-runner">${escapeHtml(item.runner)}</span>
            <span class="badge badge-wcag">${escapeHtml(item.wcagCriterion)}</span>
          </div>
          <span class="issue-index">#${idx + 1}</span>
        </div>
        <h2 class="issue-message">${escapeHtml(item.translatedMessage)}</h2>
        <div class="issue-meta">
          <div><strong>${isEs ? 'Código técnico' : 'Rule code'}:</strong> <code>${escapeHtml(item.code)}</code></div>
          ${item.selector ? `<div><strong>${isEs ? 'Selector CSS' : 'CSS Selector'}:</strong> <code>${escapeHtml(item.selector)}</code></div>` : ''}
        </div>
        ${item.context ? `<div class="context-block"><strong>${isEs ? 'Fragmento HTML' : 'HTML Context'}:</strong><pre><code>${escapeHtml(item.context)}</code></pre></div>` : ''}
        ${helpLink ? `<div class="issue-footer">${helpLink}</div>` : ''}
      </article>`;
		}).join('\n');

	const htmlDoc = `<!DOCTYPE html>
<html lang="${isEs ? 'es' : 'en'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isEs ? 'Reporte de Accesibilidad' : 'Accessibility Report'} · ${escapeHtml(alias)}</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
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
    main { max-width: 1080px; margin: 0 auto; }
    header.report-header {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    h1 { margin: 0 0 8px; font-size: 1.45rem; }
    .meta { color: var(--muted); font-size: 0.92rem; word-break: break-all; }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .kpi {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 18px;
    }
    .kpi-label { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
    .kpi-val { font-size: 1.75rem; font-weight: 800; margin-top: 2px; }
    .filter-bar {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 18px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
    }
    .filter-btns { display: flex; flex-wrap: wrap; gap: 8px; }
    .filter-btn {
      background: #e2e8f0;
      color: var(--text);
      border: 2px solid transparent;
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
    }
    .filter-btn[aria-pressed="true"] {
      background: #0f172a;
      color: #ffffff;
    }
    .search-box {
      padding: 7px 12px;
      border: 2px solid #94a3b8;
      border-radius: 8px;
      font-size: 0.9rem;
      min-width: 240px;
    }
    .issue-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-left: 6px solid #64748b;
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 14px;
    }
    .issue-card.type-error { border-left-color: #dc2626; }
    .issue-card.type-warning { border-left-color: #d97706; }
    .issue-card.type-notice { border-left-color: #0284c7; }
    .issue-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge {
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 700;
    }
    .badge.type-error { background: #fee2e2; color: #7f1d1d; }
    .badge.type-warning { background: #fef3c7; color: #78350f; }
    .badge.type-notice { background: #e0f2fe; color: #0c4a6e; }
    .badge-runner { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; text-transform: uppercase; }
    .badge-wcag { background: #ede9fe; color: #4c1d95; }
    .issue-index { color: var(--muted); font-size: 0.85rem; font-weight: 700; }
    .issue-message { margin: 0 0 10px; font-size: 1.05rem; line-height: 1.45; }
    .issue-meta { font-size: 0.88rem; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85em;
      word-break: break-all;
    }
    .context-block { margin-top: 10px; font-size: 0.88rem; }
    pre {
      background: #0f172a;
      color: #f8fafc;
      padding: 10px 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 6px 0 0;
    }
    pre code { background: transparent; color: inherit; padding: 0; }
    .issue-footer { margin-top: 10px; }
    .help-link { color: #0369a1; font-size: 0.88rem; font-weight: 600; }
    .empty-box {
      background: #dcfce7;
      color: #14532d;
      padding: 20px;
      border-radius: 10px;
      font-weight: 700;
      text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <header class="report-header">
      <h1>${isEs ? 'Reporte de Accesibilidad Web' : 'Web Accessibility Report'}: ${escapeHtml(alias)}</h1>
      <div class="meta">
        URL: <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener">${escapeHtml(targetUrl)}</a> ·
        ${isEs ? 'Estándar' : 'Standard'}: <strong>${escapeHtml(standard)}</strong> ·
        ${isEs ? 'Fecha' : 'Date'}: <strong>${escapeHtml(nowStr)}</strong>
      </div>
    </header>

    <section class="kpi-row" aria-label="${isEs ? 'Resumen de hallazgos' : 'Findings summary'}">
      <div class="kpi">
        <div class="kpi-label">${isEs ? 'Total hallazgos' : 'Total findings'}</div>
        <div class="kpi-val">${issues.length}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">${isEs ? 'Errores' : 'Errors'}</div>
        <div class="kpi-val" style="color: #dc2626;">${errorsCount}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">${isEs ? 'Advertencias' : 'Warnings'}</div>
        <div class="kpi-val" style="color: #d97706;">${warningsCount}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">${isEs ? 'Avisos' : 'Notices'}</div>
        <div class="kpi-val" style="color: #0284c7;">${noticesCount}</div>
      </div>
    </section>

    <section class="filter-bar" aria-label="${isEs ? 'Filtros de hallazgos' : 'Filter findings'}">
      <div class="filter-btns" role="group" aria-label="${isEs ? 'Filtrar por severidad' : 'Filter by severity'}">
        <button type="button" class="filter-btn" data-filter="all" aria-pressed="true">${isEs ? 'Todos' : 'All'} (${issues.length})</button>
        <button type="button" class="filter-btn" data-filter="error" aria-pressed="false">${isEs ? 'Errores' : 'Errors'} (${errorsCount})</button>
        <button type="button" class="filter-btn" data-filter="warning" aria-pressed="false">${isEs ? 'Advertencias' : 'Warnings'} (${warningsCount})</button>
        <button type="button" class="filter-btn" data-filter="notice" aria-pressed="false">${isEs ? 'Avisos' : 'Notices'} (${noticesCount})</button>
      </div>
      <input
        id="searchIssues"
        type="search"
        class="search-box"
        placeholder="${isEs ? 'Buscar por regla, criterio o selector...' : 'Search by rule, criterion or selector...'}"
        aria-label="${isEs ? 'Buscar en los hallazgos' : 'Search findings'}"
      />
    </section>

    <section id="issuesContainer" aria-label="${isEs ? 'Listado detallado de hallazgos' : 'Detailed findings list'}">
      ${cardsHtml}
    </section>
  </main>

  <script>
    (function () {
      var btns = document.querySelectorAll('.filter-btn');
      var searchInput = document.getElementById('searchIssues');
      var cards = document.querySelectorAll('.issue-card');
      var activeType = 'all';

      function applyFilter () {
        var q = (searchInput.value || '').toLowerCase();
        cards.forEach(function (card) {
          var matchesType = activeType === 'all' || card.getAttribute('data-type') === activeType;
          var matchesText = !q || card.textContent.toLowerCase().indexOf(q) !== -1;
          card.style.display = (matchesType && matchesText) ? '' : 'none';
        });
      }

      btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeType = btn.getAttribute('data-filter');
          btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
          applyFilter();
        });
      });

      if (searchInput) {
        searchInput.addEventListener('input', applyFilter);
      }
    })();
  </script>
</body>
</html>`;

	fs.writeFileSync(outputPath, htmlDoc + '\n', 'utf8');
}

process.stdout.write(`STATS|${issues.length}|${errorsCount}|${warningsCount}|${noticesCount}\n`);
