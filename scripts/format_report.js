#!/usr/bin/env node
/**
 * Traductor y generador de reportes de accesibilidad para Pa11y Batch (ES / EN).
 * Traduce hallazgos de axe-core (vía locales/es.json) y HTML_CodeSniffer (htmlcs),
 * enriquece cada hallazgo con Principio, Pauta, Criterio, Nivel WCAG, Impacto,
 * Elemento HTML y Recomendación Técnica, y exporta en: html, json, csv, tsv, cli.
 * Además genera siempre <alias>-findings.csv con BOM UTF-8 listo para Excel.
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
	standard = 'WCAG2AA',
	runnersLabel = 'axe + htmlcs',
	captureFilename = '',
	ciJsonlPath = '',
	runId = ''
] = process.argv;

if (!rawJsonPath || !outputPath) {
	process.exit(1);
}

const localePath = path.join(__dirname, '..', 'locales', 'es.json');
const esCatalog = fs.existsSync(localePath)
	? JSON.parse(fs.readFileSync(localePath, 'utf8'))
	: { rules: {}, checks: {}, wcagCriteria: {}, htmlcs: {}, axeToWcag: {}, wcagLevels: {}, wcagPrinciples: {}, wcagGuidelines: {} };

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
	]
];

const IMPACT_ES = {
	critical: 'Crítico',
	serious: 'Serio',
	moderate: 'Moderado',
	minor: 'Menor'
};

const IMPACT_EN = {
	critical: 'Critical',
	serious: 'Serious',
	moderate: 'Moderate',
	minor: 'Minor'
};

function cleanBuiltAttrsEs (val) {
	return String(val || '')
		.replace(/\s+undefined\b/gi, '')
		.replace(/\belement content\b/gi, 'contenido del elemento')
		.replace(/\bvalue attribute\b/gi, 'atributo value')
		.replace(/\btitle\b/g, 'atributo title');
}

function cleanNodeTypeEs (val) {
	return String(val || '')
		.replace(/^button element$/i, 'elemento <button>')
		.replace(/^input element$/i, 'elemento <input>')
		.replace(/^select element$/i, 'elemento <select>')
		.replace(/^textarea element$/i, 'elemento <textarea>')
		.replace(/^a element$/i, 'elemento <a>')
		.replace(/^element$/i, 'elemento');
}

function extractWcagMetadata (issue, targetLang) {
	const code = issue.code || '';
	const runner = issue.runner || '';
	let crit = '';

	const m = code.match(/(\d)_(\d)_(\d+)/);
	if (m) {
		crit = `${m[1]}.${m[2]}.${m[3]}`;
	} else if (runner === 'axe' && esCatalog.axeToWcag && esCatalog.axeToWcag[code]) {
		crit = esCatalog.axeToWcag[code];
	}

	if (!crit) {
		return {
			criterionNumber: '-',
			criterionName: '-',
			wcagCriterion: runner === 'axe' ? `Regla axe: ${code}` : '-',
			wcagLevel: '-',
			principleNumber: '-',
			principleName: '-',
			guidelineName: '-'
		};
	}

	const parts = crit.split('.');
	const pNum = parts[0] || '1';
	const gNum = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : pNum;

	const langKey = targetLang === 'es' ? 'es' : 'en';
	const critName = (targetLang === 'es' && esCatalog.wcagCriteria && esCatalog.wcagCriteria[crit])
		? esCatalog.wcagCriteria[crit]
		: `WCAG ${crit}`;
	const wcagFull = (targetLang === 'es' && esCatalog.wcagCriteria && esCatalog.wcagCriteria[crit])
		? `${crit} - ${critName}`
		: `WCAG ${crit}`;
	const level = (esCatalog.wcagLevels && esCatalog.wcagLevels[crit]) ? esCatalog.wcagLevels[crit] : 'AA';
	const principleName = (esCatalog.wcagPrinciples && esCatalog.wcagPrinciples[pNum])
		? esCatalog.wcagPrinciples[pNum][langKey]
		: pNum;
	const guidelineName = (esCatalog.wcagGuidelines && esCatalog.wcagGuidelines[gNum])
		? esCatalog.wcagGuidelines[gNum][langKey]
		: gNum;

	return {
		criterionNumber: crit,
		criterionName: critName,
		wcagCriterion: wcagFull,
		wcagLevel: level,
		principleNumber: pNum,
		principleName,
		guidelineName
	};
}

function extractHtmlElementTag (issue) {
	const ctx = String(issue.context || '').trim();
	const mCtx = ctx.match(/^<\s*([a-zA-Z0-9-]+)/);
	if (mCtx) {
		return `<${mCtx[1].toLowerCase()}>`;
	}
	const sel = String(issue.selector || '').trim();
	if (sel) {
		const lastSeg = sel.split('>').pop().trim();
		const mSel = lastSeg.match(/^([a-zA-Z0-9-]+)/);
		if (mSel) {
			return `<${mSel[1].toLowerCase()}>`;
		}
	}
	return '-';
}

function extractW3CTechniqueUrl (code, helpUrl) {
	if (helpUrl) return helpUrl;
	const m = String(code || '').match(/\b(H\d+|G\d+|F\d+|ARIA\d+|SCR\d+|C\d+)\b/);
	if (m) {
		return `https://www.w3.org/WAI/WCAG22/Techniques/${m[1].replace(/[0-9]+$/, '')}/${m[1]}`;
	}
	return '';
}

function extractImpactLabel (issue, targetLang) {
	const rawImpact = (issue.runnerExtras && issue.runnerExtras.impact)
		? String(issue.runnerExtras.impact).toLowerCase()
		: '';
	if (rawImpact) {
		return targetLang === 'es' ? (IMPACT_ES[rawImpact] || rawImpact) : (IMPACT_EN[rawImpact] || rawImpact);
	}
	const type = (issue.type || 'error').toLowerCase();
	if (targetLang === 'es') {
		return type === 'error' ? 'Serio' : (type === 'warning' ? 'Moderado' : 'Menor');
	}
	return type === 'error' ? 'Serious' : (type === 'warning' ? 'Moderate' : 'Minor');
}

function translateHtmlcsMessage (msg, issueCode) {
	if (!msg) return '';
	const normMsg = normalizeSpaces(msg);

	const exactMatch = htmlcsExactMap.get(normMsg.toLowerCase());
	if (exactMatch) {
		return exactMatch;
	}

	for (const matcher of htmlcsTemplateMatchers) {
		const m = normMsg.match(matcher.regex);
		if (m) {
			let result = matcher.esTemplate;
			matcher.varNames.forEach((vName, idx) => {
				let val = m[idx + 1] || '';
				if (vName === 'msgNodeType') {
					val = cleanNodeTypeEs(val);
				} else if (vName === 'builtAttrs') {
					val = cleanBuiltAttrsEs(val);
				}
				result = result.replace(new RegExp(`\\{\\{${vName}\\}\\}`, 'g'), val);
			});
			return result;
		}
	}

	for (const [regex, replacement] of HTMLCS_PATTERNS) {
		if (regex.test(normMsg)) {
			if (typeof replacement === 'function') {
				return normMsg.replace(regex, replacement);
			}
			return replacement;
		}
	}

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

function translateIssue (issue, targetLang, idx) {
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

	const wcagMeta = extractWcagMetadata(issue, targetLang);
	const impactLabel = extractImpactLabel(issue, targetLang);
	const runner = issue.runner || 'pa11y';
	const code = issue.code || '';
	const rawHelpUrl = (issue.runnerExtras && issue.runnerExtras.helpUrl) ? issue.runnerExtras.helpUrl : '';
	const helpUrl = extractW3CTechniqueUrl(code, rawHelpUrl);
	const htmlElementTag = extractHtmlElementTag(issue);
	const findingId = `A11Y-${String(idx + 1).padStart(4, '0')}`;

	if (targetLang !== 'es') {
		return {
			...issue,
			findingId,
			typeLabel: typeLabelsEn[type] || 'Error',
			...wcagMeta,
			impactLabel,
			htmlElementTag,
			helpUrl,
			remediationAdvice: (issue.runnerExtras && issue.runnerExtras.description) || issue.message || '',
			originalMessage: issue.message || '',
			translatedMessage: issue.message || ''
		};
	}

	let translated = issue.message || '';
	let remediationAdvice = '';

	if (runner === 'axe' && esCatalog.rules && esCatalog.rules[code]) {
		const ruleEntry = esCatalog.rules[code];
		const helpEs = ruleEntry.help || '';
		const descEs = ruleEntry.description || '';
		remediationAdvice = descEs || helpEs;

		if (helpEs && descEs && helpEs !== descEs) {
			translated = `${helpEs}. ${descEs}`;
		} else {
			translated = helpEs || descEs || translated;
		}
	} else {
		translated = translateHtmlcsMessage(translated, code);
		const techMatch = code.match(/\b(H\d+|G\d+|F\d+|ARIA\d+|SCR\d+|C\d+)\b/);
		remediationAdvice = techMatch
			? `Aplicar técnica W3C ${techMatch[1]} para cumplir el criterio ${wcagMeta.wcagCriterion}.`
			: `Verificar y corregir el elemento ${htmlElementTag} según el criterio ${wcagMeta.wcagCriterion}.`;
	}

	return {
		...issue,
		findingId,
		typeLabel: typeLabelsEs[type] || 'Error',
		...wcagMeta,
		impactLabel,
		htmlElementTag,
		remediationAdvice,
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
	const s = String(val == null ? '' : val).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
	if (sep === '\t') {
		return s.replace(/\t/g, ' ');
	}
	return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Formatea e ilumina sintaxis de un fragmento HTML para mostrarlo limpio,
 * con saltos de línea legibles y sin scroll horizontal.
 */
function formatAndHighlightHtml (rawHtml) {
	if (!rawHtml) return '';
	// Limpiar espacios múltiples pero insertar saltos suaves entre etiquetas contiguas
	const normalized = String(rawHtml)
		.replace(/\r?\n/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim()
		.replace(/>(\s*)</g, '>\n<');

	const lines = normalized.split('\n');
	return lines.map((line, idx) => {
		const escaped = escapeHtml(line);
		const highlighted = escaped.replace(
			/(&lt;\/?)([a-zA-Z0-9-]+)(.*?)(\/?&gt;)/g,
			(_m, openBracket, tagName, attrsPart, closeBracket) => {
				const coloredAttrs = attrsPart.replace(
					/([a-zA-Z0-9_:-]+)(=)(&quot;[^&]*?&quot;)/g,
					'<span class="hl-attr">$1</span><span class="hl-punct">$2</span><span class="hl-val">$3</span>'
				);
				return `<span class="hl-punct">${openBracket}</span><span class="hl-tag">${tagName}</span>${coloredAttrs}<span class="hl-punct">${closeBracket}</span>`;
			}
		);
		return `<div class="code-line"><span class="line-num" aria-hidden="true">${idx + 1}</span><span class="line-content">${highlighted}</span></div>`;
	}).join('');
}

/**
 * Formatea un selector CSS largo en migas visuales envolventes para evitar scroll horizontal.
 */
function formatCssSelectorTokens (selector) {
	if (!selector) return '';
	const parts = String(selector).split(/\s*>\s*/);
	return parts.map((part, i) => {
		const seg = `<span class="sel-token">${escapeHtml(part)}</span>`;
		return i < parts.length - 1
			? `${seg}<span class="sel-arrow" aria-hidden="true">&rsaquo;</span>`
			: seg;
	}).join('');
}

function buildDetailedDelimitedContent (items, isEs, sep) {
	const headers = isEs
		? [
			'ID_Hallazgo',
			'Lote_ID',
			'Fecha_Hora',
			'Alias_Sitio',
			'URL_Evaluada',
			'Estandar_Objetivo',
			'Severidad',
			'Nivel_Impacto',
			'Principio_WCAG',
			'Pauta_WCAG',
			'Criterio_WCAG',
			'Nombre_Criterio_WCAG',
			'Nivel_WCAG',
			'Motor_Evaluador',
			'Codigo_Regla',
			'Elemento_HTML',
			'Descripcion_Hallazgo_ES',
			'Recomendacion_Tecnica',
			'URL_Documentacion',
			'Selector_CSS',
			'Fragmento_HTML',
			'Mensaje_Original_EN',
			'Archivo_Evidencia'
		]
		: [
			'Finding_ID',
			'Run_ID',
			'Timestamp',
			'Site_Alias',
			'Evaluated_URL',
			'Target_Standard',
			'Severity',
			'Impact_Level',
			'WCAG_Principle',
			'WCAG_Guideline',
			'WCAG_Criterion',
			'WCAG_Criterion_Name',
			'WCAG_Level',
			'Runner_Engine',
			'Rule_Code',
			'HTML_Element',
			'Finding_Description',
			'Technical_Recommendation',
			'Documentation_URL',
			'CSS_Selector',
			'HTML_Snippet',
			'Original_Message_EN',
			'Evidence_File'
		];

	const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
	const lines = [headers.map(h => escapeCsv(h, sep)).join(sep)];

	for (const item of items) {
		lines.push([
			item.findingId,
			runId || '-',
			nowIso,
			alias,
			targetUrl,
			standard,
			item.typeLabel,
			item.impactLabel || '-',
			item.principleName,
			item.guidelineName,
			item.criterionNumber,
			item.criterionName,
			item.wcagLevel,
			item.runner,
			item.code,
			item.htmlElementTag,
			item.translatedMessage,
			item.remediationAdvice,
			item.helpUrl || '-',
			item.selector || '-',
			item.context || '-',
			item.originalMessage || '-',
			captureFilename || '-'
		].map(v => escapeCsv(v, sep)).join(sep));
	}

	return '\uFEFF' + lines.join('\n') + '\n';
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

const issues = rawIssues.map((i, idx) => translateIssue(i, lang, idx));
const errorsCount = issues.filter(i => i.type === 'error').length;
const warningsCount = issues.filter(i => i.type === 'warning').length;
const noticesCount = issues.filter(i => i.type === 'notice').length;
const axeCount = issues.filter(i => i.runner === 'axe').length;
const htmlcsCount = issues.filter(i => i.runner === 'htmlcs').length;

const isEs = lang === 'es';
const nowStr = new Date().toLocaleString(isEs ? 'es-ES' : 'en-US');

const CompanionFindingsCsvFilename = `${alias}-findings.csv`;
const companionCsvPath = path.join(path.dirname(outputPath), CompanionFindingsCsvFilename);
fs.writeFileSync(companionCsvPath, buildDetailedDelimitedContent(issues, isEs, ','), 'utf8');

if (format === 'json') {
	fs.writeFileSync(outputPath, JSON.stringify(issues, null, 2) + '\n', 'utf8');
} else if (format === 'csv' || format === 'tsv') {
	const sep = format === 'tsv' ? '\t' : ',';
	fs.writeFileSync(outputPath, buildDetailedDelimitedContent(issues, isEs, sep), 'utf8');
} else if (format === 'cli') {
	const lines = [];
	lines.push('======================================================================');
	lines.push(isEs
		? `REPORTE DE ACCESIBILIDAD WEB: ${alias} (${targetUrl})`
		: `WEB ACCESSIBILITY REPORT: ${alias} (${targetUrl})`);
	lines.push(isEs
		? `Estándar: ${standard} | Motores: ${runnersLabel} | Fecha: ${nowStr}`
		: `Standard: ${standard} | Runners: ${runnersLabel} | Date: ${nowStr}`);
	lines.push(isEs
		? `Resumen: ${errorsCount} Errores · ${warningsCount} Advertencias · ${noticesCount} Avisos (axe: ${axeCount} | htmlcs: ${htmlcsCount})`
		: `Summary: ${errorsCount} Errors · ${warningsCount} Warnings · ${noticesCount} Notices (axe: ${axeCount} | htmlcs: ${htmlcsCount})`);
	lines.push('======================================================================\n');

	if (issues.length === 0) {
		lines.push(isEs
			? 'No se detectaron hallazgos de accesibilidad.'
			: 'No accessibility issues detected.');
	} else {
		issues.forEach((item, idx) => {
			const impactSuffix = item.impactLabel ? ` [${isEs ? 'Impacto' : 'Impact'}: ${item.impactLabel}]` : '';
			lines.push(`[${idx + 1}] [${item.typeLabel.toUpperCase()}] (${item.runner})${impactSuffix} ${item.code}`);
			if (item.wcagCriterion && item.wcagCriterion !== '-') {
				lines.push(`    WCAG    : ${item.wcagCriterion} (Nivel ${item.wcagLevel} · ${item.principleName})`);
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
	const wcagCountsMap = new Map();
	issues.forEach(item => {
		const w = item.wcagCriterion || '-';
		wcagCountsMap.set(w, (wcagCountsMap.get(w) || 0) + 1);
	});
	const sortedWcag = Array.from(wcagCountsMap.entries()).sort((a, b) => b[1] - a[1]);

	const wcagPillsHtml = sortedWcag.map(([crit, cnt]) => `
        <button type="button" class="wcag-chip" data-wcag="${escapeHtml(crit)}" aria-pressed="false">
          <span class="wcag-chip-text">${escapeHtml(crit)}</span>
          <span class="wcag-chip-count">${cnt}</span>
        </button>`).join('');

	const totalIssues = issues.length || 1;
	const errPct = Math.round((errorsCount / totalIssues) * 100);
	const warnPct = Math.round((warningsCount / totalIssues) * 100);
	const notPct = Math.max(0, 100 - errPct - warnPct);

	const cardsHtml = issues.length === 0
		? `<div class="empty-box">${isEs ? 'No se encontraron hallazgos de accesibilidad para los criterios seleccionados.' : 'No accessibility issues were found for the selected criteria.'}</div>`
		: issues.map((item, idx) => {
			const typeClass = item.type === 'error' ? 'type-error' : (item.type === 'warning' ? 'type-warning' : 'type-notice');
			const helpLink = item.helpUrl
				? `<a href="${escapeHtml(item.helpUrl)}" target="_blank" rel="noopener" class="help-link">${isEs ? 'Guía oficial de remediación' : 'Official remediation guide'} <span class="ico-ext" aria-hidden="true"></span></a>`
				: '';
			const impactBadge = item.impactLabel
				? `<span class="badge badge-impact">${isEs ? 'Impacto' : 'Impact'}: ${escapeHtml(item.impactLabel)}</span>`
				: '';
			const levelBadge = item.wcagLevel && item.wcagLevel !== '-'
				? `<span class="badge badge-impact">Nivel ${escapeHtml(item.wcagLevel)}</span>`
				: '';
			return `
      <article
        class="issue-card ${typeClass}"
        data-type="${escapeHtml(item.type)}"
        data-runner="${escapeHtml(item.runner)}"
        data-wcag="${escapeHtml(item.wcagCriterion)}"
      >
        <div class="issue-header">
          <div class="badges">
            <span class="badge ${typeClass}"><span class="dot ${typeClass}" aria-hidden="true"></span>${escapeHtml(item.typeLabel)}</span>
            <span class="badge badge-runner">${escapeHtml(item.runner)}</span>
            <span class="badge badge-wcag">${escapeHtml(item.wcagCriterion)}</span>
            ${levelBadge}
            ${impactBadge}
          </div>
          <span class="issue-index">${escapeHtml(item.findingId)} (#${idx + 1})</span>
        </div>

        <h2 class="issue-message">${escapeHtml(item.translatedMessage)}</h2>

        <div class="meta-boxes">
          <div class="meta-pill-box">
            <span class="detail-label">${isEs ? 'Principio y Pauta' : 'Principle & Guideline'}</span>
            <span class="meta-val">${escapeHtml(item.principleName)} &middot; ${escapeHtml(item.guidelineName)}</span>
          </div>
          <div class="meta-pill-box">
            <span class="detail-label">${isEs ? 'Regla técnica' : 'Technical rule'}</span>
            <span class="meta-val"><code class="rule-code">${escapeHtml(item.code)}</code></span>
          </div>
          ${item.htmlElementTag !== '-' ? `
          <div class="meta-pill-box">
            <span class="detail-label">${isEs ? 'Elemento' : 'Element'}</span>
            <span class="meta-val"><code class="el-tag-badge">${escapeHtml(item.htmlElementTag)}</code></span>
          </div>` : ''}
        </div>

        ${item.selector ? `
        <div class="snippet-panel selector-panel">
          <div class="snippet-bar">
            <span class="snippet-title">${isEs ? 'Ruta del Selector CSS en el DOM' : 'DOM CSS Selector Path'}</span>
            <button type="button" class="copy-mini-btn" data-copy="${escapeHtml(item.selector)}" aria-label="${isEs ? 'Copiar selector CSS' : 'Copy CSS selector'}">${isEs ? 'Copiar selector' : 'Copy selector'}</button>
          </div>
          <div class="selector-flow" aria-label="${escapeHtml(item.selector)}">
            ${formatCssSelectorTokens(item.selector)}
          </div>
        </div>` : ''}

        ${item.context ? `
        <div class="snippet-panel html-panel">
          <div class="snippet-bar snippet-bar-dark">
            <span class="snippet-title">${isEs ? 'Fragmento de Código HTML' : 'HTML Code Snippet'}</span>
            <button type="button" class="copy-mini-btn copy-dark" data-copy="${escapeHtml(item.context)}" aria-label="${isEs ? 'Copiar código HTML' : 'Copy HTML code'}">${isEs ? 'Copiar HTML' : 'Copy HTML'}</button>
          </div>
          <div class="code-viewer" role="region" aria-label="${isEs ? 'Código HTML del elemento' : 'Element HTML code'}">
            ${formatAndHighlightHtml(item.context)}
          </div>
        </div>` : ''}

        ${helpLink ? `<div class="issue-footer">${helpLink}</div>` : ''}
      </article>`;
		}).join('\n');

	const htmlDoc = `<!DOCTYPE html>
<html lang="${isEs ? 'es' : 'en'}" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isEs ? 'Reporte de Accesibilidad' : 'Accessibility Report'} · ${escapeHtml(alias)}</title>
  <style>
    :root {
      --bg-page: #f4f4f5;
      --bg-surface: #ffffff;
      --bg-subtle: #fafafa;
      --bg-code: #141417;
      --bg-code-bar: #1f1f24;
      --text-main: #09090b;
      --text-secondary: #52525b;
      --text-muted: #71717a;
      --border: #e4e4e7;
      --border-strong: #d4d4d8;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --err: #dc2626;
      --err-bg: #fef2f2;
      --err-border: #fecaca;
      --err-text: #991b1b;
      --warn: #d97706;
      --warn-bg: #fffbeb;
      --warn-border: #fde68a;
      --warn-text: #92400e;
      --not: #0284c7;
      --not-bg: #f0f9ff;
      --not-border: #bae6fd;
      --not-text: #075985;
      --ok: #16a34a;
      --ok-bg: #f0fdf4;
      --ok-text: #166534;
      --focus: #2563eb;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
    }
    html[data-theme="dark"] {
      --bg-page: #09090b;
      --bg-surface: #18181b;
      --bg-subtle: #121215;
      --bg-code: #0c0c0e;
      --bg-code-bar: #16161a;
      --text-main: #fafafa;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --border: #27272a;
      --border-strong: #3f3f46;
      --accent: #60a5fa;
      --accent-soft: #1e293b;
      --err-bg: rgba(220, 38, 38, 0.14);
      --err-border: rgba(220, 38, 38, 0.35);
      --err-text: #fca5a5;
      --warn-bg: rgba(217, 119, 6, 0.14);
      --warn-border: rgba(217, 119, 6, 0.35);
      --warn-text: #fcd34d;
      --not-bg: rgba(2, 132, 199, 0.14);
      --not-border: rgba(2, 132, 199, 0.35);
      --not-text: #7dd3fc;
      --ok-bg: rgba(22, 163, 74, 0.14);
      --ok-text: #86efac;
      --focus: #60a5fa;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      max-width: 100%;
      overflow-x: hidden;
      background: var(--bg-page);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .skip-link {
      position: absolute;
      left: -9999px;
      top: 8px;
      z-index: 9999;
      background: var(--text-main);
      color: var(--bg-surface);
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 700;
      text-decoration: none;
    }
    .skip-link:focus { left: 16px; }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 50;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border);
      padding: 10px 20px;
    }
    .topbar-inner {
      max-width: 1180px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .breadcrumbs {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 0.84rem;
      font-weight: 600;
    }
    .breadcrumbs a {
      color: var(--text-secondary);
      text-decoration: none;
      padding: 4px 8px;
      border-radius: 6px;
    }
    .breadcrumbs a:hover {
      background: var(--bg-subtle);
      color: var(--text-main);
    }
    .breadcrumbs .sep { color: var(--text-muted); }
    .breadcrumbs .current {
      color: var(--text-main);
      font-weight: 700;
      padding: 4px 8px;
    }
    .topbar-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .btn {
      background: var(--bg-surface);
      color: var(--text-main);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 7px 12px;
      min-height: 36px;
      font-size: 0.81rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn:hover { background: var(--bg-subtle); }
    .btn-primary {
      background: var(--text-main);
      color: var(--bg-surface);
      border-color: var(--text-main);
    }
    .btn-primary:hover { opacity: 0.9; background: var(--text-main); }
    .btn:focus-visible, .filter-btn:focus-visible, .wcag-chip:focus-visible, .search-box:focus-visible, .copy-mini-btn:focus-visible, .capture-thumb-btn:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    main {
      max-width: 1180px;
      margin: 20px auto 48px;
      padding: 0 20px;
    }
    .hero-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 22px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 20px;
      align-items: center;
    }
    .hero-eyebrow {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 700;
    }
    .status-pill.has-errors { background: var(--err-bg); color: var(--err-text); border: 1px solid var(--err-border); }
    .status-pill.clean { background: var(--ok-bg); color: var(--ok-text); }
    h1 {
      margin: 0 0 6px;
      font-size: clamp(1.25rem, 2.5vw, 1.55rem);
      font-weight: 800;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
    }
    .hero-url {
      font-size: 0.9rem;
      color: var(--accent);
      font-weight: 600;
      text-decoration: none;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .hero-url:hover { text-decoration: underline; }
    .hero-meta-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 18px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      font-size: 0.82rem;
      color: var(--text-secondary);
    }
    .capture-thumb-btn {
      background: var(--bg-subtle);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      padding: 6px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      width: 185px;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .capture-thumb-btn:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
    }
    .capture-thumb-btn img {
      width: 100%;
      height: 100px;
      object-fit: cover;
      object-position: top;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .capture-thumb-label {
      font-size: 0.73rem;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .kpi {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      box-shadow: var(--shadow-sm);
      position: relative;
      overflow: hidden;
    }
    .kpi::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--border-strong);
    }
    .kpi.kpi-err::before { background: var(--err); }
    .kpi.kpi-warn::before { background: var(--warn); }
    .kpi.kpi-axe::before { background: #6366f1; }
    .kpi.kpi-htmlcs::before { background: #0d9488; }
    .kpi-label { font-size: 0.78rem; color: var(--text-secondary); font-weight: 600; }
    .kpi-val {
      font-size: clamp(1.45rem, 2.2vw, 1.8rem);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      margin-top: 4px;
      line-height: 1.1;
    }
    .kpi-sub { font-size: 0.73rem; color: var(--text-muted); margin-top: 4px; }
    .breakdown-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
    }
    .breakdown-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--text-secondary);
    }
    .ratio-bar {
      height: 8px;
      width: 100%;
      background: var(--bg-subtle);
      border-radius: 999px;
      overflow: hidden;
      display: flex;
      margin-bottom: 12px;
    }
    .ratio-seg-err { background: var(--err); height: 100%; }
    .ratio-seg-warn { background: var(--warn); height: 100%; }
    .ratio-seg-not { background: var(--not); height: 100%; }
    .wcag-chips-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .wcag-chip {
      background: var(--bg-subtle);
      color: var(--text-main);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 5px 10px;
      min-height: 32px;
      font-size: 0.77rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      text-align: left;
      transition: all 0.12s ease;
    }
    .wcag-chip-text {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .wcag-chip:hover { border-color: var(--accent); }
    .wcag-chip[aria-pressed="true"] {
      background: var(--text-main);
      color: var(--bg-surface);
      border-color: var(--text-main);
    }
    .wcag-chip-count {
      background: var(--border);
      color: var(--text-main);
      border-radius: 999px;
      padding: 1px 6px;
      font-size: 0.71rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .filter-bar {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
    }
    .filter-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .filter-group-label {
      font-size: 0.79rem;
      font-weight: 700;
      color: var(--text-secondary);
      margin-right: 2px;
    }
    .filter-btn {
      background: var(--bg-subtle);
      color: var(--text-secondary);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 5px 11px;
      min-height: 34px;
      font-size: 0.79rem;
      font-weight: 600;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .filter-btn:hover { color: var(--text-main); }
    .filter-btn[aria-pressed="true"] {
      background: var(--text-main);
      color: var(--bg-surface);
      border-color: var(--text-main);
    }
    .search-box {
      flex: 1;
      min-width: 200px;
      padding: 8px 12px;
      min-height: 36px;
      background: var(--bg-subtle);
      color: var(--text-main);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font-size: 0.85rem;
    }
    .filter-status {
      font-size: 0.81rem;
      font-weight: 600;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
    }
    /* Tarjetas de hallazgos y nuevos paneles de código sin scroll horizontal */
    .issue-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-left: 4px solid #71717a;
      border-radius: 12px;
      padding: 18px;
      margin-bottom: 12px;
      box-shadow: var(--shadow-sm);
      max-width: 100%;
      overflow: hidden;
    }
    .issue-card.type-error { border-left-color: var(--err); }
    .issue-card.type-warning { border-left-color: var(--warn); }
    .issue-card.type-notice { border-left-color: var(--not); }
    .issue-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 0.73rem;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .dot.type-error { background: var(--err); }
    .dot.type-warning { background: var(--warn); }
    .dot.type-notice { background: var(--not); }
    .badge.type-error { background: var(--err-bg); color: var(--err-text); border: 1px solid var(--err-border); }
    .badge.type-warning { background: var(--warn-bg); color: var(--warn-text); border: 1px solid var(--warn-border); }
    .badge.type-notice { background: var(--not-bg); color: var(--not-text); border: 1px solid var(--not-border); }
    .badge-runner { background: var(--bg-subtle); color: var(--text-main); border: 1px solid var(--border-strong); text-transform: uppercase; letter-spacing: 0.03em; }
    .badge-wcag { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--border-strong); }
    .badge-impact { background: var(--bg-subtle); color: var(--text-secondary); border: 1px solid var(--border); }
    .issue-index { color: var(--text-muted); font-size: 0.78rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .issue-message {
      margin: 0 0 12px;
      font-size: 0.98rem;
      font-weight: 600;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .meta-boxes {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .meta-pill-box {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      max-width: 100%;
    }
    .detail-label {
      color: var(--text-secondary);
      font-weight: 600;
      font-size: 0.76rem;
    }
    .meta-val {
      font-weight: 600;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .rule-code, .el-tag-badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.79rem;
      color: var(--accent);
      overflow-wrap: anywhere;
      word-break: break-all;
    }
    /* Paneles estructurados para Selector CSS y Código HTML (CERO scroll horizontal) */
    .snippet-panel {
      margin-top: 10px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      overflow: hidden;
      max-width: 100%;
    }
    .selector-panel { background: var(--bg-subtle); }
    .html-panel { background: var(--bg-code); border-color: #27272a; }
    .snippet-bar {
      padding: 6px 12px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    .snippet-bar-dark {
      background: var(--bg-code-bar);
      border-bottom-color: #27272a;
    }
    .snippet-title {
      font-size: 0.73rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
    }
    .snippet-bar-dark .snippet-title { color: #a1a1aa; }
    .copy-mini-btn {
      background: var(--bg-subtle);
      color: var(--text-main);
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      padding: 3px 9px;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
    }
    .copy-mini-btn:hover { border-color: var(--accent); }
    .copy-dark {
      background: #27272a;
      color: #f4f4f5;
      border-color: #3f3f46;
    }
    .selector-flow {
      padding: 9px 12px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
    }
    .sel-token {
      background: var(--bg-surface);
      color: var(--text-main);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 2px 7px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .sel-arrow {
      color: var(--text-muted);
      font-weight: 700;
      padding: 0 2px;
    }
    .code-viewer {
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.81rem;
      line-height: 1.55;
      color: #e4e4e7;
      overflow-x: hidden;
    }
    .code-line {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 1px 0;
    }
    .line-num {
      color: #71717a;
      font-size: 0.73rem;
      text-align: right;
      user-select: none;
      font-variant-numeric: tabular-nums;
    }
    .line-content {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .hl-punct { color: #a1a1aa; }
    .hl-tag { color: #7dd3fc; font-weight: 700; }
    .hl-attr { color: #fcd34d; }
    .hl-val { color: #86efac; }
    .issue-footer { margin-top: 10px; }
    .help-link {
      color: var(--accent);
      font-size: 0.81rem;
      font-weight: 600;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .help-link:hover { text-decoration: underline; }
    .ico-ext {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-top: 1.5px solid currentColor;
      border-right: 1.5px solid currentColor;
      transform: translateY(-1px);
    }
    .empty-box {
      background: var(--ok-bg);
      color: var(--ok-text);
      padding: 24px;
      border-radius: 12px;
      font-weight: 700;
      text-align: center;
    }
    dialog.capture-modal {
      width: min(94vw, 1080px);
      max-height: 90vh;
      border: 1px solid var(--border-strong);
      border-radius: 14px;
      padding: 0;
      background: var(--bg-surface);
      color: var(--text-main);
      box-shadow: 0 24px 60px rgba(0,0,0,0.45);
    }
    dialog.capture-modal::backdrop { background: rgba(9, 9, 11, 0.75); }
    .capture-modal-header {
      padding: 12px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-weight: 700;
    }
    .capture-modal-body {
      padding: 14px;
      overflow-y: auto;
      overflow-x: hidden;
      max-height: calc(90vh - 60px);
    }
    .capture-modal-body img {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    @media (max-width: 768px) {
      .topbar { padding: 10px 14px; }
      main { padding: 0 14px; margin-top: 14px; }
      .hero-card { grid-template-columns: 1fr; padding: 16px; }
      .capture-thumb-btn { width: 100%; }
      .capture-thumb-btn img { height: 140px; }
      .kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .issue-card { padding: 14px; }
      .search-box { width: 100%; min-width: 0; }
    }
    @media (max-width: 420px) {
      .kpi-row { grid-template-columns: 1fr; }
      .topbar-actions { width: 100%; justify-content: flex-start; }
    }
    @media print {
      .topbar, .filter-bar { display: none !important; }
      body { background: #ffffff; color: #000000; }
      .issue-card { break-inside: avoid; box-shadow: none; }
    }
  </style>
</head>
<body>
  <a href="#mainContent" class="skip-link">${isEs ? 'Saltar al contenido principal' : 'Skip to main content'}</a>

  <nav class="topbar" aria-label="${isEs ? 'Navegación del reporte' : 'Report navigation'}">
    <div class="topbar-inner">
      <div class="breadcrumbs">
        <a href="../index.html">${isEs ? 'Centro de Reportes' : 'Report Center'}</a>
        <span class="sep" aria-hidden="true">/</span>
        <a href="index.html">${isEs ? 'Dashboard del Lote' : 'Batch Dashboard'}</a>
        <span class="sep" aria-hidden="true">/</span>
        <span class="current" aria-current="page">${escapeHtml(alias)}</span>
      </div>
      <div class="topbar-actions">
        <a href="${escapeHtml(CompanionFindingsCsvFilename)}" class="btn btn-primary">${isEs ? `Descargar CSV detallado (${issues.length})` : `Download detailed CSV (${issues.length})`}</a>
        <button type="button" id="btnPrintReport" class="btn">${isEs ? 'Imprimir / PDF' : 'Print / PDF'}</button>
        <button type="button" id="btnToggleTheme" class="btn" aria-label="${isEs ? 'Alternar tema claro u oscuro' : 'Toggle light or dark theme'}">${isEs ? 'Tema oscuro' : 'Dark theme'}</button>
      </div>
    </div>
  </nav>

  <main id="mainContent">
    <header class="hero-card">
      <div>
        <div class="hero-eyebrow">
          <span>Pa11y Batch Audit</span>
          <span>&middot;</span>
          <span class="status-pill ${errorsCount > 0 ? 'has-errors' : 'clean'}">
            ${errorsCount > 0
		? (isEs ? `${errorsCount} Errores requieren atención` : `${errorsCount} Errors require attention`)
		: (isEs ? 'Conforme (0 errores)' : 'Conformant (0 errors)')}
          </span>
        </div>
        <h1>${escapeHtml(alias)}</h1>
        <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener" class="hero-url">${escapeHtml(targetUrl)}</a>
        <div class="hero-meta-grid">
          <span><strong>${isEs ? 'Estándar' : 'Standard'}:</strong> ${escapeHtml(standard)}</span>
          <span><strong>${isEs ? 'Motores' : 'Engines'}:</strong> ${escapeHtml(runnersLabel)}</span>
          <span><strong>${isEs ? 'Fecha' : 'Date'}:</strong> ${escapeHtml(nowStr)}</span>
        </div>
      </div>

      ${captureFilename ? `
      <button type="button" id="btnOpenCaptureModal" class="capture-thumb-btn" aria-label="${isEs ? 'Ampliar captura de pantalla de evidencia' : 'Enlarge evidence screenshot'}">
        <img src="${escapeHtml(captureFilename)}" alt="${isEs ? 'Vista previa de ' : 'Preview of '}${escapeHtml(alias)}" loading="lazy" />
        <span class="capture-thumb-label">${isEs ? 'Ampliar evidencia en modal' : 'Open screenshot modal'}</span>
      </button>` : ''}
    </header>

    <section class="kpi-row" aria-label="${isEs ? 'Indicadores clave de la auditoría' : 'Key audit metrics'}">
      <div class="kpi">
        <div class="kpi-label">${isEs ? 'Total hallazgos' : 'Total findings'}</div>
        <div class="kpi-val">${issues.length}</div>
        <div class="kpi-sub">${isEs ? 'Elementos detectados en el DOM' : 'DOM elements flagged'}</div>
      </div>
      <div class="kpi kpi-err">
        <div class="kpi-label">${isEs ? 'Errores WCAG' : 'WCAG Errors'}</div>
        <div class="kpi-val" style="color: var(--err);">${errorsCount}</div>
        <div class="kpi-sub">${errPct}% ${isEs ? 'del total' : 'of total'}</div>
      </div>
      <div class="kpi kpi-warn">
        <div class="kpi-label">${isEs ? 'Advertencias' : 'Warnings'}</div>
        <div class="kpi-val" style="color: var(--warn);">${warningsCount}</div>
        <div class="kpi-sub">${warnPct}% ${isEs ? 'del total' : 'of total'}</div>
      </div>
      <div class="kpi kpi-axe">
        <div class="kpi-label">axe-core</div>
        <div class="kpi-val">${axeCount}</div>
        <div class="kpi-sub">${isEs ? 'Hallazgos de axe' : 'axe findings'}</div>
      </div>
      <div class="kpi kpi-htmlcs">
        <div class="kpi-label">HTML_CodeSniffer</div>
        <div class="kpi-val">${htmlcsCount}</div>
        <div class="kpi-sub">${isEs ? 'Hallazgos de htmlcs' : 'htmlcs findings'}</div>
      </div>
    </section>

    ${issues.length > 0 ? `
    <section class="breakdown-card" aria-label="${isEs ? 'Desglose por Criterio WCAG' : 'Breakdown by WCAG Criterion'}">
      <div class="breakdown-header">
        <span>${isEs ? 'Distribución por Criterio de Conformidad WCAG (clic para filtrar)' : 'Distribution by WCAG Success Criterion (click to filter)'}</span>
        <span>${errorsCount} ${isEs ? 'Errores' : 'Errors'} / ${warningsCount} ${isEs ? 'Advertencias' : 'Warnings'}</span>
      </div>
      <div class="ratio-bar" aria-hidden="true">
        <div class="ratio-seg-err" style="width: ${errPct}%"></div>
        <div class="ratio-seg-warn" style="width: ${warnPct}%"></div>
        <div class="ratio-seg-not" style="width: ${notPct}%"></div>
      </div>
      <div class="wcag-chips-wrap" role="group" aria-label="${isEs ? 'Filtrar por criterio WCAG' : 'Filter by WCAG criterion'}">
        <button type="button" class="wcag-chip" data-wcag="all" aria-pressed="true">
          <span class="wcag-chip-text">${isEs ? 'Todos los criterios' : 'All criteria'}</span>
          <span class="wcag-chip-count">${issues.length}</span>
        </button>
        ${wcagPillsHtml}
      </div>
    </section>` : ''}

    <section class="filter-bar" aria-label="${isEs ? 'Controles de filtrado y búsqueda' : 'Filter and search controls'}">
      <div class="filter-row">
        <div class="filter-group" role="group" aria-label="${isEs ? 'Filtrar por severidad' : 'Filter by severity'}">
          <span class="filter-group-label">${isEs ? 'Severidad:' : 'Severity:'}</span>
          <button type="button" class="filter-btn type-filter-btn" data-filter-type="all" aria-pressed="true">${isEs ? 'Todos' : 'All'} (${issues.length})</button>
          <button type="button" class="filter-btn type-filter-btn" data-filter-type="error" aria-pressed="false">${isEs ? 'Errores' : 'Errors'} (${errorsCount})</button>
          <button type="button" class="filter-btn type-filter-btn" data-filter-type="warning" aria-pressed="false">${isEs ? 'Advertencias' : 'Warnings'} (${warningsCount})</button>
          <button type="button" class="filter-btn type-filter-btn" data-filter-type="notice" aria-pressed="false">${isEs ? 'Avisos' : 'Notices'} (${noticesCount})</button>
        </div>

        <div class="filter-group" role="group" aria-label="${isEs ? 'Filtrar por motor' : 'Filter by engine'}">
          <span class="filter-group-label">${isEs ? 'Motor:' : 'Engine:'}</span>
          <button type="button" class="filter-btn runner-filter-btn" data-filter-runner="all" aria-pressed="true">${isEs ? 'Todos' : 'All'} (${issues.length})</button>
          <button type="button" class="filter-btn runner-filter-btn" data-filter-runner="axe" aria-pressed="false">axe (${axeCount})</button>
          <button type="button" class="filter-btn runner-filter-btn" data-filter-runner="htmlcs" aria-pressed="false">htmlcs (${htmlcsCount})</button>
        </div>
      </div>

      <div class="filter-row">
        <input
          id="searchIssues"
          type="search"
          class="search-box"
          placeholder="${isEs ? 'Buscar por criterio WCAG, regla, mensaje, selector CSS o etiqueta HTML...' : 'Search by WCAG criterion, rule, message, selector or HTML...'}"
          aria-label="${isEs ? 'Buscar en los hallazgos' : 'Search findings'}"
        />
        <span id="visibleCountStatus" class="filter-status" role="status" aria-live="polite">
          ${isEs ? `Mostrando ${issues.length} de ${issues.length} hallazgos` : `Showing ${issues.length} of ${issues.length} findings`}
        </span>
      </div>
    </section>

    <section id="issuesContainer" aria-label="${isEs ? 'Listado detallado de hallazgos' : 'Detailed findings list'}">
      ${cardsHtml}
    </section>
  </main>

  ${captureFilename ? `
  <dialog id="captureModal" class="capture-modal" aria-label="${isEs ? 'Evidencia visual de la página auditada' : 'Audited page visual evidence'}">
    <div class="capture-modal-header">
      <span>${isEs ? 'Evidencia visual' : 'Visual evidence'}: ${escapeHtml(alias)}</span>
      <div style="display:flex;gap:8px;">
        <a href="${escapeHtml(captureFilename)}" download class="btn">${isEs ? 'Descargar PNG' : 'Download PNG'}</a>
        <button type="button" id="btnCloseCaptureModal" class="btn btn-primary">${isEs ? 'Cerrar (Esc)' : 'Close (Esc)'}</button>
      </div>
    </div>
    <div class="capture-modal-body">
      <img src="${escapeHtml(captureFilename)}" alt="${escapeHtml(alias)}" />
    </div>
  </dialog>` : ''}

  <script>
    (function () {
      var htmlEl = document.documentElement;
      var btnToggleTheme = document.getElementById('btnToggleTheme');
      var btnPrintReport = document.getElementById('btnPrintReport');
      var isEs = ${isEs ? 'true' : 'false'};

      function updateThemeBtnLabel (theme) {
        if (!btnToggleTheme) return;
        btnToggleTheme.textContent = theme === 'dark'
          ? (isEs ? 'Tema claro' : 'Light theme')
          : (isEs ? 'Tema oscuro' : 'Dark theme');
      }

      try {
        var savedTheme = localStorage.getItem('pa11y_batch_theme');
        if (savedTheme === 'dark' || savedTheme === 'light') {
          htmlEl.setAttribute('data-theme', savedTheme);
          updateThemeBtnLabel(savedTheme);
        }
      } catch (_e) {}

      if (btnToggleTheme) {
        btnToggleTheme.addEventListener('click', function () {
          var next = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
          htmlEl.setAttribute('data-theme', next);
          updateThemeBtnLabel(next);
          try { localStorage.setItem('pa11y_batch_theme', next); } catch (_e) {}
        });
      }

      if (btnPrintReport) {
        btnPrintReport.addEventListener('click', function () { window.print(); });
      }

      var typeBtns = document.querySelectorAll('.type-filter-btn');
      var runnerBtns = document.querySelectorAll('.runner-filter-btn');
      var wcagBtns = document.querySelectorAll('.wcag-chip');
      var searchInput = document.getElementById('searchIssues');
      var visibleCountStatus = document.getElementById('visibleCountStatus');
      var cards = document.querySelectorAll('.issue-card');
      var activeType = 'all';
      var activeRunner = 'all';
      var activeWcag = 'all';
      var totalCount = cards.length;

      function applyFilter () {
        var q = (searchInput && searchInput.value ? searchInput.value : '').toLowerCase();
        var visible = 0;
        cards.forEach(function (card) {
          var matchesType = activeType === 'all' || card.getAttribute('data-type') === activeType;
          var matchesRunner = activeRunner === 'all' || card.getAttribute('data-runner') === activeRunner;
          var matchesWcag = activeWcag === 'all' || card.getAttribute('data-wcag') === activeWcag;
          var matchesText = !q || card.textContent.toLowerCase().indexOf(q) !== -1;
          var show = matchesType && matchesRunner && matchesWcag && matchesText;
          card.style.display = show ? '' : 'none';
          if (show) visible++;
        });
        if (visibleCountStatus) {
          visibleCountStatus.textContent = isEs
            ? ('Mostrando ' + visible + ' de ' + totalCount + ' hallazgos')
            : ('Showing ' + visible + ' of ' + totalCount + ' findings');
        }
      }

      typeBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeType = btn.getAttribute('data-filter-type');
          typeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
          applyFilter();
        });
      });

      runnerBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeRunner = btn.getAttribute('data-filter-runner');
          runnerBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
          applyFilter();
        });
      });

      wcagBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeWcag = btn.getAttribute('data-wcag');
          wcagBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
          applyFilter();
        });
      });

      if (searchInput) {
        searchInput.addEventListener('input', applyFilter);
      }

      document.querySelectorAll('.copy-mini-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var text = btn.getAttribute('data-copy') || '';
          var orig = btn.textContent;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
          }
          btn.textContent = isEs ? 'Copiado' : 'Copied';
          setTimeout(function () { btn.textContent = orig; }, 1600);
        });
      });

      var captureModal = document.getElementById('captureModal');
      var btnOpenCaptureModal = document.getElementById('btnOpenCaptureModal');
      var btnCloseCaptureModal = document.getElementById('btnCloseCaptureModal');
      if (captureModal && btnOpenCaptureModal) {
        btnOpenCaptureModal.addEventListener('click', function () {
          if (typeof captureModal.showModal === 'function') captureModal.showModal();
        });
      }
      if (captureModal && btnCloseCaptureModal) {
        btnCloseCaptureModal.addEventListener('click', function () {
          captureModal.close();
        });
      }
      if (captureModal) {
        captureModal.addEventListener('click', function (e) {
          if (e.target === captureModal) captureModal.close();
        });
      }
    })();
  </script>
</body>
</html>`;

	fs.writeFileSync(outputPath, htmlDoc + '\n', 'utf8');
}

if (ciJsonlPath) {
	const record = {
		alias,
		url: targetUrl,
		standard,
		runnersLabel,
		status: errorsCount === 0 ? 'passed' : 'issues',
		errorsCount,
		warningsCount,
		noticesCount,
		axeCount,
		htmlcsCount,
		reportFilename: path.basename(outputPath),
		findingsCsvFilename: CompanionFindingsCsvFilename,
		captureFilename,
		issues: issues.map(i => ({
			findingId: i.findingId,
			type: i.type,
			typeLabel: i.typeLabel,
			impactLabel: i.impactLabel || '',
			runner: i.runner,
			code: i.code,
			principleNumber: i.principleNumber,
			principleName: i.principleName,
			guidelineName: i.guidelineName,
			criterionNumber: i.criterionNumber,
			criterionName: i.criterionName,
			wcagCriterion: i.wcagCriterion,
			wcagLevel: i.wcagLevel,
			htmlElementTag: i.htmlElementTag,
			message: i.translatedMessage,
			remediationAdvice: i.remediationAdvice,
			helpUrl: i.helpUrl || '',
			originalMessage: i.originalMessage || '',
			selector: i.selector || '',
			context: i.context || ''
		}))
	};
	fs.appendFileSync(ciJsonlPath, JSON.stringify(record) + '\n', 'utf8');
}

process.stdout.write(`STATS|${issues.length}|${errorsCount}|${warningsCount}|${noticesCount}|${axeCount}|${htmlcsCount}\n`);
