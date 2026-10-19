#!/usr/bin/env node
/**
 * Traductor y generador de reportes de accesibilidad para Pa11y Batch (ES / EN).
 * Orientado tanto a Stakeholders (Vista Ejecutiva: Pareto 80/20, Principios POUR,
 * Grupos de Usuarios Impactados) como a Ingeniería (Vista Técnica: Selectores CSS
 * tokenizados y Snippets HTML con resaltado de sintaxis), con soporte de Deep-Linking
 * por URL (?view=executive&type=error&wcag=...#A11Y-0001) y modo --standalone.
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
	runId = '',
	projectName = '',
	auditorName = '',
	standaloneFlag = 'false'
] = process.argv;

if (!rawJsonPath || !outputPath) {
	process.exit(1);
}

const isStandalone = standaloneFlag === 'true' || standaloneFlag === '1';

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

/**
 * Determina el grupo principal de personas usuarias afectadas por un criterio WCAG
 * para explicar el impacto real a Stakeholders.
 */
function resolveUserImpactProfile (critNum, targetLang) {
	const isEsLang = targetLang === 'es';
	if (!critNum || critNum === '-') {
		return isEsLang ? 'Tecnologías de apoyo y lectores de pantalla' : 'Assistive technologies & screen readers';
	}
	if (critNum.startsWith('1.1') || critNum.startsWith('1.3') || critNum.startsWith('4.1')) {
		return isEsLang ? 'Personas ciegas / Lector de pantalla (VoiceOver, NVDA, JAWS)' : 'Blind users / Screen readers (VoiceOver, NVDA, JAWS)';
	}
	if (critNum.startsWith('1.4')) {
		return isEsLang ? 'Baja visión, daltonismo y fatiga visual' : 'Low vision & color blindness';
	}
	if (critNum.startsWith('2.1') || critNum.startsWith('2.4') || critNum.startsWith('2.5')) {
		return isEsLang ? 'Discapacidad motriz / Navegación por teclado y conmutadores' : 'Motor disability / Keyboard & switch navigation';
	}
	if (critNum.startsWith('1.2')) {
		return isEsLang ? 'Personas sordas o con hipoacusia / Ceguera' : 'Deaf or hard-of-hearing / Blind users';
	}
	return isEsLang ? 'Comprensión cognitiva, lectura y aprendizaje' : 'Cognitive, reading & learning accessibility';
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
			guidelineName: '-',
			userImpactProfile: resolveUserImpactProfile('-', targetLang)
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
		guidelineName,
		userImpactProfile: resolveUserImpactProfile(crit, targetLang)
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

const W3C_TECH_FOLDER_MAP = {
	H: 'html',
	G: 'general',
	F: 'failures',
	C: 'css',
	SCR: 'client-side-script',
	ARIA: 'aria',
	SVR: 'server-side-script',
	PDF: 'pdf',
	SM: 'smil',
	T: 'text'
};

function extractW3CTechniqueUrl (code, helpUrl) {
	if (helpUrl && !helpUrl.includes('/WAI/WCAG22/Techniques/')) {
		return helpUrl;
	}
	const m = String(code || '').match(/\b(H|G|F|C|SCR|ARIA|SVR|PDF|SM|T)(\d+)\b/);
	if (m) {
		const prefix = m[1];
		const num = m[2];
		const folder = W3C_TECH_FOLDER_MAP[prefix] || 'general';
		return `https://www.w3.org/WAI/WCAG22/Techniques/${folder}/${prefix}${num}`;
	}
	return helpUrl || '';
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

function formatAndHighlightHtml (rawHtml) {
	if (!rawHtml) return '';
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

/**
 * Construye el panel de Apreciación Visual del Hallazgo (visible tanto para Stakeholders
 * como para Ingeniería): Recorte real de la página con recuadro resaltador + Simulador
 * visual de contraste o de Lector de Pantalla.
 */
function buildVisualAppreciationBlock (item, isEs, hasFullCapture) {
	const vm = item.visualMeta || null;
	const typeClass = item.type === 'error' ? 'type-error' : (item.type === 'warning' ? 'type-warning' : 'type-notice');

	// 1. Columna izquierda: Evidencia gráfica de ubicación en la página
	let leftVisualHtml = '';
	if (vm && vm.visible && vm.cropDataUrl) {
		const locateBtn = hasFullCapture
			? `<button
                type="button"
                class="btn locate-on-page-btn"
                data-pin-id="${escapeHtml(item.findingId)}"
                data-pin-x="${vm.x}"
                data-pin-y="${vm.y}"
                data-pin-w="${vm.width}"
                data-pin-h="${vm.height}"
                data-pin-docw="${vm.docWidth || 1440}"
                data-pin-doch="${vm.docHeight || 900}"
              >
                <span>${isEs ? 'Ver señalado en página completa' : 'Highlight on full page'}</span>
                <span class="coord-tag">(${vm.x}, ${vm.y} px)</span>
              </button>`
			: '';

		leftVisualHtml = `
          <div class="visual-col-crop">
            <div class="visual-box-label">
              <span>${isEs ? 'Ubicación visual en la interfaz' : 'Visual location on UI'}</span>
              <span class="coord-tag">${vm.width}&times;${vm.height} px</span>
            </div>
            <div class="crop-stage" role="img" aria-label="${isEs ? 'Recorte visual del elemento afectado en la página' : 'Visual crop of affected element'}">
              <img src="${vm.cropDataUrl}" alt="${escapeHtml(item.findingId)}" loading="lazy" />
              <div
                class="crop-highlight-box ${typeClass}"
                style="left:${vm.boxLeftPct}%;top:${vm.boxTopPct}%;width:${vm.boxWidthPct}%;height:${vm.boxHeightPct}%;"
              >
                <span class="crop-pin-tag">${escapeHtml(item.findingId)}</span>
              </div>
            </div>
            ${locateBtn}
          </div>`;
	} else {
		leftVisualHtml = `
          <div class="visual-col-crop is-non-visual">
            <div class="visual-box-label">
              <span>${isEs ? 'Estado visual en pantalla' : 'On-screen visual state'}</span>
            </div>
            <div class="non-visual-placeholder">
              <strong>${isEs ? 'Elemento sin representación visual directa o fuera del viewport visible' : 'Element without direct visual representation or off-screen'}</strong>
              <span>${isEs
		? `El nodo ${escapeHtml(item.htmlElementTag)} existe en el código DOM (ej. metadatos, iframes técnicos o contenedores colapsados) y es procesado por tecnologías de apoyo aunque no sea visible a simple vista.`
		: `The ${escapeHtml(item.htmlElementTag)} node exists in the DOM and is parsed by assistive technologies even when not visually rendered.`}</span>
            </div>
          </div>`;
	}

	// 2. Columna derecha: Simulador visual del fallo (Contraste en vivo o Experiencia Lector de Pantalla)
	let rightSimulatorHtml = '';
	const crit = item.criterionNumber || '';

	if (crit === '1.4.3' || crit === '1.4.6' || item.code === 'color-contrast') {
		const fgHex = (vm && vm.fgHex) ? vm.fgHex : '#767676';
		const bgHex = (vm && vm.bgHex) ? vm.bgHex : '#FFFFFF';
		const sampleText = (vm && vm.sampleText) ? vm.sampleText : (isEs ? 'Texto de muestra en la interfaz Aa 123' : 'Sample interface text Aa 123');
		const recMatch = String(item.translatedMessage || '').match(/#( [0-9a-fA-F]{6}|[0-9a-fA-F]{6})/);
		const recHex = recMatch ? recMatch[0].replace(/\s+/g, '').toUpperCase() : '';

		rightSimulatorHtml = `
          <div class="visual-col-sim">
            <div class="visual-box-label">
              <span>${isEs ? 'Simulador Visual de Contraste (Criterio 1.4.3)' : 'Visual Contrast Simulator (Criterion 1.4.3)'}</span>
            </div>
            <div class="contrast-preview-grid">
              <div class="contrast-sample-card">
                <span class="sim-chip sim-chip-bad">${isEs ? 'Cómo se ve actualmente' : 'Current appearance'}</span>
                <div class="contrast-swatch-box" style="background:${escapeHtml(bgHex)};color:${escapeHtml(fgHex)};">
                  ${escapeHtml(sampleText)}
                </div>
                <div class="swatch-meta">
                  <span><i class="color-dot" style="background:${escapeHtml(fgHex)}"></i> ${isEs ? 'Texto' : 'Text'}: <code>${escapeHtml(fgHex)}</code></span>
                  <span><i class="color-dot" style="background:${escapeHtml(bgHex)}"></i> ${isEs ? 'Fondo' : 'Bg'}: <code>${escapeHtml(bgHex)}</code></span>
                </div>
              </div>
              <div class="contrast-sample-card">
                <span class="sim-chip sim-chip-good">${isEs ? 'Referencia accesible (>= 4.5:1)' : 'Accessible reference (>= 4.5:1)'}</span>
                <div class="contrast-swatch-box" style="background:${escapeHtml(recHex && item.translatedMessage.includes('fondo') ? recHex : bgHex)};color:${escapeHtml(recHex && !item.translatedMessage.includes('fondo') ? recHex : '#111827')};">
                  ${escapeHtml(sampleText)}
                </div>
                <div class="swatch-meta">
                  <span>${recHex ? `${isEs ? 'Sugerido' : 'Suggested'}: <code>${escapeHtml(recHex)}</code>` : (isEs ? 'Contraste nítido para baja visión' : 'Crisp contrast for low vision')}</span>
                </div>
              </div>
            </div>
          </div>`;
	} else {
		let srAnnouncement = '';
		let expectedAnnouncement = '';

		if (crit === '4.1.2' || item.code.includes('button-name') || item.code.includes('Button.Name')) {
			srAnnouncement = isEs
				? '"botón" (Vacío: el lector de pantalla no anuncia qué acción realiza este control)'
				: '"button" (Empty: screen reader cannot announce what this control does)';
			expectedAnnouncement = isEs
				? '"Abrir menú / Cerrar panel, botón" (Con aria-label o texto visible)'
				: '"Open menu / Close panel, button" (With aria-label or visible text)';
		} else if (crit === '1.1.1') {
			srAnnouncement = isEs
				? 'Imagen omitida o sin descripción contextual verificada'
				: 'Image skipped or missing verified contextual description';
			expectedAnnouncement = isEs
				? 'Atributo alt="" si es decorativa, o descripción clara si transmite información'
				: 'alt="" if decorative, or clear description if informative';
		} else if (crit === '2.4.1') {
			srAnnouncement = isEs
				? '"marco" (El usuario no sabe si es publicidad, chat o contenido principal)'
				: '"frame" (User cannot tell the purpose of the iframe)';
			expectedAnnouncement = isEs
				? 'Marco con atributo title="..." que describa su función'
				: 'Iframe with descriptive title="..." attribute';
		} else if (crit === '1.3.1') {
			srAnnouncement = isEs
				? 'Contenido huérfano fuera de regiones semánticas o jerarquía de encabezados rota'
				: 'Orphaned content outside landmarks or broken heading hierarchy';
			expectedAnnouncement = isEs
				? 'Estructura navegable por regiones (<main>, <nav>, <header>) y encabezados h1-h6'
				: 'Navigable structure via landmarks (<main>, <nav>) and h1-h6 headings';
		} else {
			srAnnouncement = isEs
				? `Barrera detectada en ${item.htmlElementTag !== '-' ? item.htmlElementTag : 'el elemento'}: afecta a ${item.userImpactProfile}`
				: `Barrier detected on ${item.htmlElementTag}: impacts ${item.userImpactProfile}`;
			expectedAnnouncement = item.remediationAdvice || '';
		}

		rightSimulatorHtml = `
          <div class="visual-col-sim">
            <div class="visual-box-label">
              <span>${isEs ? 'Impacto en la Experiencia de Usuario (Tecnologías de Apoyo)' : 'User Experience Impact (Assistive Technologies)'}</span>
            </div>
            <div class="sr-comparison-stack">
              <div class="sr-box sr-box-bad">
                <span class="sim-chip sim-chip-bad">${isEs ? 'Experiencia actual (VoiceOver / NVDA / Teclado)' : 'Current assistive experience'}</span>
                <div class="sr-quote">${escapeHtml(srAnnouncement)}</div>
              </div>
              <div class="sr-box sr-box-good">
                <span class="sim-chip sim-chip-good">${isEs ? 'Comportamiento esperado (Conforme WCAG)' : 'Expected accessible behavior'}</span>
                <div class="sr-quote">${escapeHtml(expectedAnnouncement)}</div>
              </div>
            </div>
          </div>`;
	}

	return `
        <div class="visual-appreciation-panel">
          ${leftVisualHtml}
          ${rightSimulatorHtml}
        </div>`;
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
	// Si está activo --standalone, incrustar la imagen PNG en Base64 para poder compartir el .html como archivo único
	let resolvedCaptureSrc = captureFilename;
	if (isStandalone && captureFilename) {
		const capFullPath = path.join(path.dirname(outputPath), captureFilename);
		if (fs.existsSync(capFullPath)) {
			try {
				const b64 = fs.readFileSync(capFullPath).toString('base64');
				resolvedCaptureSrc = `data:image/png;base64,${b64}`;
			} catch {
				resolvedCaptureSrc = captureFilename;
			}
		}
	}

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

	// Análisis de Pareto (Top 5 patrones/reglas para priorización de Sprint con Stakeholders)
	const ruleGroupMap = new Map();
	issues.forEach(item => {
		const k = item.code || '-';
		if (!ruleGroupMap.has(k)) {
			ruleGroupMap.set(k, {
				code: k,
				runner: item.runner,
				wcagCriterion: item.wcagCriterion,
				userImpactProfile: item.userImpactProfile,
				message: item.translatedMessage,
				type: item.type,
				typeLabel: item.typeLabel,
				count: 0
			});
		}
		ruleGroupMap.get(k).count += 1;
	});
	// Ordenar priorizando Errores primero y luego frecuencia
	const topRuleGroups = Array.from(ruleGroupMap.values())
		.sort((a, b) => {
			if (a.type === 'error' && b.type !== 'error') return -1;
			if (a.type !== 'error' && b.type === 'error') return 1;
			return b.count - a.count;
		})
		.slice(0, 5);
	const topByVolume = Array.from(ruleGroupMap.values()).sort((a, b) => b.count - a.count);
	const top3Sum = topByVolume.slice(0, 3).reduce((acc, r) => acc + r.count, 0);
	const totalIssues = issues.length || 1;
	const paretoPct = issues.length > 0 ? Math.round((top3Sum / totalIssues) * 100) : 0;

	const paretoRowsHtml = topRuleGroups.map((rg, idx) => {
		const pct = Math.round((rg.count / totalIssues) * 100);
		const badgeCls = rg.type === 'error' ? 'type-error' : (rg.type === 'warning' ? 'type-warning' : 'type-notice');
		return `
          <div class="pareto-item">
            <div class="pareto-item-main">
              <div class="badges">
                <span class="pareto-rank">#${idx + 1}</span>
                <span class="badge ${badgeCls}">${escapeHtml(rg.typeLabel)}</span>
                <span class="badge badge-wcag">${escapeHtml(rg.wcagCriterion)}</span>
                <span class="badge badge-impact">${escapeHtml(rg.userImpactProfile)}</span>
              </div>
              <div class="pareto-msg">${escapeHtml(rg.message)}</div>
            </div>
            <button type="button" class="btn pareto-filter-btn" data-filter-q="${escapeHtml(rg.code)}">
              <span>${rg.count} ${isEs ? 'casos' : 'cases'} (${pct}%)</span>
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>`;
	}).join('');

	// Conteo por los 4 Principios WCAG (POUR), por Nivel de Impacto y por Perfil de Usuario
	const p1Count = issues.filter(i => i.principleNumber === '1').length;
	const p2Count = issues.filter(i => i.principleNumber === '2').length;
	const p3Count = issues.filter(i => i.principleNumber === '3').length;
	const p4Count = issues.filter(i => i.principleNumber === '4').length;

	const critImpactCount = issues.filter(i => i.impactLabel === 'Crítico' || i.impactLabel === 'Critical').length;
	const serImpactCount = issues.filter(i => i.impactLabel === 'Serio' || i.impactLabel === 'Serious').length;
	const modImpactCount = issues.filter(i => i.impactLabel === 'Moderado' || i.impactLabel === 'Moderate').length;
	const minImpactCount = issues.filter(i => i.impactLabel === 'Menor' || i.impactLabel === 'Minor').length;

	const userProfileMap = new Map();
	issues.forEach(item => {
		const prof = item.userImpactProfile || '-';
		userProfileMap.set(prof, (userProfileMap.get(prof) || 0) + 1);
	});
	const userProfilesHtml = Array.from(userProfileMap.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([prof, cnt]) => {
			const pct = Math.round((cnt / totalIssues) * 100);
			return `
            <div class="pour-row">
              <div class="pour-row-top"><span>${escapeHtml(prof)}</span><span class="pour-stat">${cnt} (${pct}%)</span></div>
              <div class="pour-track"><div class="pour-fill pour-fill-user" style="width:${pct}%"></div></div>
            </div>`;
		}).join('');

	const errPct = Math.round((errorsCount / totalIssues) * 100);
	const warnPct = Math.round((warningsCount / totalIssues) * 100);
	const notPct = Math.max(0, 100 - errPct - warnPct);

	const cardsHtml = issues.length === 0
		? `<div class="empty-box">${isEs ? 'No se encontraron hallazgos de accesibilidad para los criterios seleccionados.' : 'No accessibility issues were found for the selected criteria.'}</div>`
		: issues.map((item, idx) => {
			const typeClass = item.type === 'error' ? 'type-error' : (item.type === 'warning' ? 'type-warning' : 'type-notice');
			const helpLink = item.helpUrl
				? `<a href="${escapeHtml(item.helpUrl)}" target="_blank" rel="noopener" class="help-link"><span>${isEs ? 'Guía oficial de remediación' : 'Official remediation guide'}</span><svg class="ico-ext" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5L7.5 8.5"/><path d="M7 3.5H3.8A1.3 1.3 0 0 0 2.5 4.8v7.4a1.3 1.3 0 0 0 1.3 1.3h7.4a1.3 1.3 0 0 0 1.3-1.3V9"/></svg></a>`
				: '';
			const impactBadge = item.impactLabel
				? `<span class="badge badge-impact">${isEs ? 'Impacto' : 'Impact'}: ${escapeHtml(item.impactLabel)}</span>`
				: '';
			const levelBadge = item.wcagLevel && item.wcagLevel !== '-'
				? `<span class="badge badge-impact">Nivel ${escapeHtml(item.wcagLevel)}</span>`
				: '';
			return `
      <article
        id="${escapeHtml(item.findingId)}"
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
          <div class="issue-id-actions">
            <span class="issue-index">${escapeHtml(item.findingId)} (#${idx + 1})</span>
            <button type="button" class="copy-mini-btn share-anchor-btn" data-anchor="${escapeHtml(item.findingId)}" aria-label="${isEs ? 'Copiar enlace directo al hallazgo ' : 'Copy direct link to finding '}${escapeHtml(item.findingId)}">${isEs ? 'Enlace #' : 'Link #'}</button>
          </div>
        </div>

        <h2 class="issue-message">${escapeHtml(item.translatedMessage)}</h2>

        ${buildVisualAppreciationBlock(item, isEs, Boolean(resolvedCaptureSrc))}

        <div class="meta-boxes">
          <div class="meta-pill-box">
            <span class="detail-label">${isEs ? 'Usuarios afectados' : 'Affected users'}</span>
            <span class="meta-val">${escapeHtml(item.userImpactProfile)}</span>
          </div>
          <div class="meta-pill-box">
            <span class="detail-label">${isEs ? 'Principio y Pauta' : 'Principle & Guideline'}</span>
            <span class="meta-val">${escapeHtml(item.principleName)} &middot; ${escapeHtml(item.guidelineName)}</span>
          </div>
          <div class="meta-pill-box tech-only-block">
            <span class="detail-label">${isEs ? 'Regla / Elemento' : 'Rule / Element'}</span>
            <span class="meta-val"><code class="rule-code">${escapeHtml(item.code)}</code> ${item.htmlElementTag !== '-' ? `<code class="el-tag-badge">${escapeHtml(item.htmlElementTag)}</code>` : ''}</span>
          </div>
        </div>

        ${item.selector ? `
        <div class="snippet-panel selector-panel tech-only-block">
          <div class="snippet-bar">
            <span class="snippet-title">${isEs ? 'Ruta del Selector CSS en el DOM' : 'DOM CSS Selector Path'}</span>
            <button type="button" class="copy-mini-btn" data-copy="${escapeHtml(item.selector)}" aria-label="${isEs ? 'Copiar selector CSS' : 'Copy CSS selector'}">${isEs ? 'Copiar selector' : 'Copy selector'}</button>
          </div>
          <div class="selector-flow" aria-label="${escapeHtml(item.selector)}">
            ${formatCssSelectorTokens(item.selector)}
          </div>
        </div>` : ''}

        ${item.context ? `
        <div class="snippet-panel html-panel tech-only-block">
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

	const ogTitle = `${isEs ? 'Auditoría de Accesibilidad' : 'Accessibility Audit'}: ${alias} (${standard})`;
	const ogDesc = `${errorsCount} ${isEs ? 'Errores WCAG' : 'WCAG Errors'}, ${warningsCount} ${isEs ? 'Advertencias' : 'Warnings'} (${runnersLabel}) — ${targetUrl}`;

	const htmlDoc = `<!DOCTYPE html>
<html lang="${isEs ? 'es' : 'en'}" data-theme="light" data-view-mode="technical">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(ogTitle)}</title>
  <meta name="description" content="${escapeHtml(ogDesc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(ogTitle)}" />
  <meta property="og:description" content="${escapeHtml(ogDesc)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDesc)}" />
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
    /* En Vista Ejecutiva (Stakeholders) se ocultan los detalles crudos del DOM */
    html[data-view-mode="executive"] .tech-only-block {
      display: none !important;
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
    .view-switcher {
      display: inline-flex;
      background: var(--bg-subtle);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 2px;
    }
    .view-mode-btn {
      background: transparent;
      color: var(--text-secondary);
      border: 0;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }
    .view-mode-btn[aria-pressed="true"] {
      background: var(--text-main);
      color: var(--bg-surface);
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
    .btn:focus-visible, .view-mode-btn:focus-visible, .filter-btn:focus-visible, .wcag-chip:focus-visible, .search-box:focus-visible, .copy-mini-btn:focus-visible, .capture-thumb-btn:focus-visible {
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
    /* Bloque Ejecutivo para Stakeholders (Columna izquierda apilada + Pareto 80/20 equilibrado) */
    .stakeholder-grid {
      display: grid;
      grid-template-columns: 1fr 1.25fr;
      gap: 14px;
      margin-bottom: 16px;
      align-items: stretch;
    }
    .stakeholder-left-stack {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .exec-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 20px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      flex: 1;
    }
    .exec-card-title {
      font-size: 0.92rem;
      font-weight: 800;
      margin: 0 0 3px;
    }
    .exec-card-sub {
      font-size: 0.78rem;
      color: var(--text-secondary);
      margin: 0 0 12px;
    }
    .pour-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pour-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .pour-row-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .pour-stat {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      white-space: nowrap;
    }
    .pour-track {
      height: 7px;
      background: var(--bg-subtle);
      border-radius: 999px;
      overflow: hidden;
    }
    .pour-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 999px;
    }
    .pour-fill-user {
      background: #0d9488;
    }
    .impact-pills-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .impact-mini-card {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      text-align: center;
    }
    .impact-mini-val {
      font-size: 1.15rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }
    .impact-mini-lbl {
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .pareto-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      justify-content: space-between;
    }
    .pareto-item {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
    }
    .pareto-item-main {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .pareto-rank {
      font-size: 0.76rem;
      font-weight: 800;
      color: var(--text-secondary);
      margin-right: 2px;
    }
    .pareto-filter-btn {
      min-height: 32px;
      padding: 4px 11px;
      font-size: 0.76rem;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      align-self: center;
    }
    .pareto-msg {
      font-size: 0.8rem;
      color: var(--text-secondary);
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
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
      scroll-margin-top: 76px;
    }
    .issue-card.is-deep-linked {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
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
    .issue-id-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
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
    /* Panel de Apreciación Visual del Hallazgo (Visible para Stakeholders e Ingeniería) */
    .visual-appreciation-panel {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
      gap: 12px;
      margin-bottom: 12px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      max-width: 100%;
    }
    .visual-col-crop, .visual-col-sim {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      max-width: 100%;
    }
    .visual-box-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 0.74rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--text-secondary);
    }
    .coord-tag {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.71rem;
      color: var(--text-muted);
      font-weight: 600;
    }
    .crop-stage {
      position: relative;
      background: #18181b;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      overflow: hidden;
      height: 126px;
      display: flex;
      align-items: center;
      justify-content: center;
      max-width: 100%;
    }
    .crop-stage img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .crop-highlight-box {
      position: absolute;
      border: 2.5px solid #dc2626;
      background: rgba(220, 38, 38, 0.16);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.85), 0 4px 12px rgba(220,38,38,0.4);
      border-radius: 4px;
      pointer-events: none;
    }
    .crop-highlight-box.type-warning {
      border-color: #d97706;
      background: rgba(217, 119, 6, 0.16);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.85), 0 4px 12px rgba(217,119,6,0.4);
    }
    .crop-pin-tag {
      position: absolute;
      top: -18px;
      left: -2px;
      background: #dc2626;
      color: #ffffff;
      font-size: 0.65rem;
      font-weight: 800;
      padding: 1px 5px;
      border-radius: 3px;
      white-space: nowrap;
    }
    .crop-highlight-box.type-warning .crop-pin-tag { background: #d97706; }
    .locate-on-page-btn {
      width: 100%;
      min-height: 32px;
      padding: 4px 10px;
      font-size: 0.76rem;
      flex-wrap: wrap;
    }
    .non-visual-placeholder {
      background: var(--bg-surface);
      border: 1px dashed var(--border-strong);
      border-radius: 8px;
      padding: 12px;
      font-size: 0.78rem;
      color: var(--text-secondary);
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      justify-content: center;
      overflow-wrap: anywhere;
    }
    .contrast-preview-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .contrast-sample-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
      max-width: 100%;
    }
    .sim-chip {
      display: inline-block;
      font-size: 0.69rem;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      align-self: flex-start;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .sim-chip-bad { background: var(--err-bg); color: var(--err-text); }
    .sim-chip-good { background: var(--ok-bg); color: var(--ok-text); }
    .contrast-swatch-box {
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(0,0,0,0.12);
      font-size: 0.84rem;
      font-weight: 700;
      text-align: center;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .swatch-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 0.71rem;
      color: var(--text-secondary);
      overflow-wrap: anywhere;
    }
    .color-dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 1px solid rgba(0,0,0,0.25);
      vertical-align: middle;
    }
    .sr-comparison-stack {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      justify-content: space-between;
    }
    .sr-box {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sr-quote {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.35;
    }
    .capture-stage-wrap {
      position: relative;
      display: inline-block;
      width: 100%;
    }
    .modal-pin-overlay {
      position: absolute;
      border: 3px solid #dc2626;
      background: rgba(220, 38, 38, 0.22);
      box-shadow: 0 0 0 3px #ffffff, 0 0 24px rgba(220, 38, 38, 0.65);
      border-radius: 6px;
      pointer-events: none;
      display: none;
      z-index: 10;
    }
    .modal-pin-label {
      position: absolute;
      top: -24px;
      left: -3px;
      background: #dc2626;
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
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
      width: 13px;
      height: 13px;
      flex-shrink: 0;
      vertical-align: -2px;
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
    @media (max-width: 960px) {
      .stakeholder-grid { grid-template-columns: 1fr; }
      .visual-appreciation-panel { grid-template-columns: 1fr; }
    }
    @media (max-width: 768px) {
      .topbar {
        position: relative;
        padding: 10px 14px;
      }
      .topbar-actions {
        width: 100%;
        flex-wrap: nowrap;
        overflow-x: auto;
        padding-bottom: 2px;
        -webkit-overflow-scrolling: touch;
      }
      .topbar-actions > * { flex-shrink: 0; }
      main { padding: 0 12px; margin-top: 14px; }
      .hero-card { grid-template-columns: 1fr; padding: 16px; }
      .capture-thumb-btn { width: 100%; }
      .capture-thumb-btn img { height: 140px; }
      .kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .exec-card { padding: 14px; }
      .pareto-item { grid-template-columns: 1fr; }
      .pareto-filter-btn { width: 100%; }
      .impact-pills-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .contrast-preview-grid { grid-template-columns: 1fr; }
      .issue-card { padding: 14px; }
      .search-box { width: 100%; min-width: 0; }
      .filter-group { width: 100%; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 2px; }
      .filter-btn { flex-shrink: 0; }
    }
    @media (max-width: 420px) {
      .kpi-row { grid-template-columns: 1fr 1fr; }
      .kpi { padding: 12px; }
      .kpi-val { font-size: 1.35rem; }
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
        <div class="view-switcher" role="group" aria-label="${isEs ? 'Modo de visualización del reporte' : 'Report view mode'}">
          <button type="button" class="view-mode-btn" data-view="executive" aria-pressed="false">${isEs ? 'Vista Stakeholders' : 'Stakeholder View'}</button>
          <button type="button" class="view-mode-btn" data-view="technical" aria-pressed="true">${isEs ? 'Vista Ingeniería' : 'Engineering View'}</button>
        </div>
        <button type="button" id="btnShareUrl" class="btn">${isEs ? 'Compartir vista (URL)' : 'Share view (URL)'}</button>
        <a href="${escapeHtml(CompanionFindingsCsvFilename)}" class="btn btn-primary">${isEs ? `CSV (${issues.length})` : `CSV (${issues.length})`}</a>
        <button type="button" id="btnPrintReport" class="btn">${isEs ? 'PDF' : 'PDF'}</button>
        <button type="button" id="btnToggleTheme" class="btn" aria-label="${isEs ? 'Alternar tema claro u oscuro' : 'Toggle light or dark theme'}">${isEs ? 'Tema oscuro' : 'Dark theme'}</button>
      </div>
    </div>
  </nav>

  <main id="mainContent">
    <header class="hero-card">
      <div>
        <div class="hero-eyebrow">
          <span>${escapeHtml(projectName || 'Pa11y Batch Audit')}</span>
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
          ${auditorName ? `<span><strong>${isEs ? 'Auditor' : 'Auditor'}:</strong> ${escapeHtml(auditorName)}</span>` : ''}
        </div>
      </div>

      ${resolvedCaptureSrc ? `
      <button type="button" id="btnOpenCaptureModal" class="capture-thumb-btn" aria-label="${isEs ? 'Ampliar captura de pantalla de evidencia' : 'Enlarge evidence screenshot'}">
        <img src="${escapeHtml(resolvedCaptureSrc)}" alt="${isEs ? 'Vista previa de ' : 'Preview of '}${escapeHtml(alias)}" loading="lazy" />
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
    <section class="stakeholder-grid" aria-label="${isEs ? 'Resumen ejecutivo para Stakeholders' : 'Stakeholder executive summary'}">
      <div class="stakeholder-left-stack">
        <div class="exec-card">
          <div>
            <h2 class="exec-card-title">${isEs ? 'Distribución por los 4 Principios WCAG (POUR)' : 'Distribution by 4 WCAG Principles (POUR)'}</h2>
            <p class="exec-card-sub">${isEs ? 'Impacto funcional según las pautas internacionales W3C' : 'Functional impact across W3C guidelines'}</p>
          </div>
          <div class="pour-list">
            <div class="pour-row">
              <div class="pour-row-top"><span>1. ${isEs ? 'Perceptible (Contraste, Alt, Estructura)' : 'Perceivable'}</span><span class="pour-stat">${p1Count} (${Math.round((p1Count / totalIssues) * 100)}%)</span></div>
              <div class="pour-track"><div class="pour-fill" style="width:${Math.round((p1Count / totalIssues) * 100)}%"></div></div>
            </div>
            <div class="pour-row">
              <div class="pour-row-top"><span>2. ${isEs ? 'Operable (Teclado, Foco, Navegación)' : 'Operable'}</span><span class="pour-stat">${p2Count} (${Math.round((p2Count / totalIssues) * 100)}%)</span></div>
              <div class="pour-track"><div class="pour-fill" style="width:${Math.round((p2Count / totalIssues) * 100)}%"></div></div>
            </div>
            <div class="pour-row">
              <div class="pour-row-top"><span>3. ${isEs ? 'Comprensible (Idioma, Etiquetas, Errores)' : 'Understandable'}</span><span class="pour-stat">${p3Count} (${Math.round((p3Count / totalIssues) * 100)}%)</span></div>
              <div class="pour-track"><div class="pour-fill" style="width:${Math.round((p3Count / totalIssues) * 100)}%"></div></div>
            </div>
            <div class="pour-row">
              <div class="pour-row-top"><span>4. ${isEs ? 'Robusto (Nombre/Rol ARIA, IDs únicos)' : 'Robust'}</span><span class="pour-stat">${p4Count} (${Math.round((p4Count / totalIssues) * 100)}%)</span></div>
              <div class="pour-track"><div class="pour-fill" style="width:${Math.round((p4Count / totalIssues) * 100)}%"></div></div>
            </div>
          </div>
        </div>

        <div class="exec-card">
          <div>
            <h2 class="exec-card-title">${isEs ? 'Impacto en Personas Usuarias y Criticidad' : 'User Impact & Criticality'}</h2>
            <p class="exec-card-sub">${isEs ? 'Perfiles de discapacidad afectados y severidad del bloqueo' : 'Affected disability profiles and barrier severity'}</p>
            <div class="pour-list">
              ${userProfilesHtml}
            </div>
          </div>
          <div class="impact-pills-row" aria-label="${isEs ? 'Conteo por nivel de impacto' : 'Count by impact level'}">
            <div class="impact-mini-card">
              <div class="impact-mini-val" style="color:var(--err);">${critImpactCount}</div>
              <div class="impact-mini-lbl">${isEs ? 'Crítico' : 'Critical'}</div>
            </div>
            <div class="impact-mini-card">
              <div class="impact-mini-val" style="color:#ea580c;">${serImpactCount}</div>
              <div class="impact-mini-lbl">${isEs ? 'Serio' : 'Serious'}</div>
            </div>
            <div class="impact-mini-card">
              <div class="impact-mini-val" style="color:var(--warn);">${modImpactCount}</div>
              <div class="impact-mini-lbl">${isEs ? 'Moderado' : 'Moderate'}</div>
            </div>
            <div class="impact-mini-card">
              <div class="impact-mini-val">${minImpactCount}</div>
              <div class="impact-mini-lbl">${isEs ? 'Menor' : 'Minor'}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="exec-card">
        <div>
          <h2 class="exec-card-title">${isEs ? 'Priorización de Sprint (Análisis de Pareto 80/20)' : 'Sprint Prioritization (Pareto 80/20 Analysis)'}</h2>
          <p class="exec-card-sub">
            ${isEs
		? `Priorizando los <strong>Errores WCAG bloqueantes</strong> y los patrones más frecuentes (los 3 mayores concentran el <strong>${paretoPct}%</strong> del volumen total).`
		: `Prioritizing <strong>blocking WCAG Errors</strong> and top recurring patterns (top 3 account for <strong>${paretoPct}%</strong> of total volume).`}
          </p>
        </div>
        <div class="pareto-list">
          ${paretoRowsHtml}
        </div>
      </div>
    </section>

    <section class="breakdown-card" aria-label="${isEs ? 'Desglose por Criterio WCAG' : 'Breakdown by WCAG Criterion'}">
      <div class="breakdown-header">
        <span>${isEs ? 'Filtrado rápido por Criterio de Conformidad WCAG' : 'Quick filter by WCAG Success Criterion'}</span>
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
          placeholder="${isEs ? 'Buscar por criterio WCAG, regla, usuario afectado, selector CSS o HTML...' : 'Search by WCAG criterion, rule, affected user, selector or HTML...'}"
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

  ${resolvedCaptureSrc ? `
  <dialog id="captureModal" class="capture-modal" aria-label="${isEs ? 'Evidencia visual de la página auditada' : 'Audited page visual evidence'}">
    <div class="capture-modal-header">
      <span id="captureModalHeaderTitle">${isEs ? 'Evidencia visual' : 'Visual evidence'}: ${escapeHtml(alias)}</span>
      <div style="display:flex;gap:8px;">
        <a href="${escapeHtml(resolvedCaptureSrc)}" download="${escapeHtml(alias)}-capture.png" class="btn">${isEs ? 'Descargar PNG' : 'Download PNG'}</a>
        <button type="button" id="btnCloseCaptureModal" class="btn btn-primary">${isEs ? 'Cerrar (Esc)' : 'Close (Esc)'}</button>
      </div>
    </div>
    <div id="captureModalBody" class="capture-modal-body">
      <div class="capture-stage-wrap">
        <img id="captureModalImg" src="${escapeHtml(resolvedCaptureSrc)}" alt="${escapeHtml(alias)}" />
        <div id="modalPinOverlay" class="modal-pin-overlay">
          <span id="modalPinLabel" class="modal-pin-label"></span>
        </div>
      </div>
    </div>
  </dialog>` : ''}

  <script>
    (function () {
      var htmlEl = document.documentElement;
      var btnToggleTheme = document.getElementById('btnToggleTheme');
      var btnPrintReport = document.getElementById('btnPrintReport');
      var btnShareUrl = document.getElementById('btnShareUrl');
      var viewModeBtns = document.querySelectorAll('.view-mode-btn');
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
      var activeView = 'technical';
      var activeType = 'all';
      var activeRunner = 'all';
      var activeWcag = 'all';
      var totalCount = cards.length;

      function syncUrlState () {
        if (!window.history || !window.history.replaceState) return;
        var params = new URLSearchParams(window.location.search);
        if (activeView !== 'technical') params.set('view', activeView); else params.delete('view');
        if (activeType !== 'all') params.set('type', activeType); else params.delete('type');
        if (activeRunner !== 'all') params.set('runner', activeRunner); else params.delete('runner');
        if (activeWcag !== 'all') params.set('wcag', activeWcag); else params.delete('wcag');
        var qVal = (searchInput && searchInput.value ? searchInput.value : '').trim();
        if (qVal) params.set('q', qVal); else params.delete('q');
        var qs = params.toString();
        var nextUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
        window.history.replaceState(null, '', nextUrl);
      }

      function setViewMode (mode) {
        activeView = mode === 'executive' ? 'executive' : 'technical';
        htmlEl.setAttribute('data-view-mode', activeView);
        viewModeBtns.forEach(function (b) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === activeView));
        });
        syncUrlState();
      }

      viewModeBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          setViewMode(btn.getAttribute('data-view'));
        });
      });

      function applyFilter (skipUrlSync) {
        var q = (searchInput && searchInput.value ? searchInput.value : '').toLowerCase();
        var visible = 0;
        cards.forEach(function (card) {
          var matchesType = activeType === 'all' || card.getAttribute('data-type') === activeType;
          var matchesRunner = activeRunner === 'all' || card.getAttribute('data-runner') === activeRunner;
          var matchesWcag = activeWcag === 'all' || (card.getAttribute('data-wcag') || '').indexOf(activeWcag) !== -1;
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
        if (!skipUrlSync) syncUrlState();
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

      document.querySelectorAll('.pareto-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var codeQ = btn.getAttribute('data-filter-q') || '';
          if (searchInput) {
            searchInput.value = codeQ;
            applyFilter();
            searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      });

      if (searchInput) {
        searchInput.addEventListener('input', function () { applyFilter(); });
      }

      // Restaurar estado desde Query Params y Hash (#A11Y-XXXX) al abrir una URL compartida
      try {
        var initParams = new URLSearchParams(window.location.search);
        if (initParams.get('view') === 'executive') setViewMode('executive');
        if (initParams.get('type')) {
          activeType = initParams.get('type');
          typeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter-type') === activeType)); });
        }
        if (initParams.get('runner')) {
          activeRunner = initParams.get('runner');
          runnerBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter-runner') === activeRunner)); });
        }
        if (initParams.get('wcag')) {
          activeWcag = initParams.get('wcag');
          wcagBtns.forEach(function (b) {
            var val = b.getAttribute('data-wcag') || '';
            b.setAttribute('aria-pressed', String(val === activeWcag || (activeWcag !== 'all' && val.indexOf(activeWcag) === 0)));
          });
        }
        if (initParams.get('q') && searchInput) {
          searchInput.value = initParams.get('q');
        }
        applyFilter(true);

        if (window.location.hash) {
          var targetId = window.location.hash.replace(/^#/, '');
          var targetCard = document.getElementById(targetId);
          if (targetCard) {
            targetCard.style.display = '';
            targetCard.classList.add('is-deep-linked');
            setTimeout(function () {
              targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
          }
        }
      } catch (_e) {}

      if (btnShareUrl) {
        btnShareUrl.addEventListener('click', function () {
          var urlToCopy = window.location.href;
          var orig = btnShareUrl.textContent;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(urlToCopy).catch(function () {});
          }
          btnShareUrl.textContent = isEs ? 'URL copiada' : 'URL copied';
          setTimeout(function () { btnShareUrl.textContent = orig; }, 1800);
        });
      }

      document.querySelectorAll('.share-anchor-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var anchor = btn.getAttribute('data-anchor') || '';
          var base = window.location.href.split('#')[0];
          var fullLink = base + '#' + anchor;
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', '#' + anchor);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullLink).catch(function () {});
          }
          var orig = btn.textContent;
          btn.textContent = isEs ? 'Enlace copiado' : 'Link copied';
          setTimeout(function () { btn.textContent = orig; }, 1600);
        });
      });

      document.querySelectorAll('.copy-mini-btn:not(.share-anchor-btn)').forEach(function (btn) {
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
      var modalPinOverlay = document.getElementById('modalPinOverlay');
      var modalPinLabel = document.getElementById('modalPinLabel');
      var captureModalHeaderTitle = document.getElementById('captureModalHeaderTitle');

      if (captureModal && btnOpenCaptureModal) {
        btnOpenCaptureModal.addEventListener('click', function () {
          if (modalPinOverlay) modalPinOverlay.style.display = 'none';
          if (typeof captureModal.showModal === 'function') captureModal.showModal();
        });
      }
      document.querySelectorAll('.locate-on-page-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!captureModal) return;
          var x = parseFloat(btn.getAttribute('data-pin-x') || '0');
          var y = parseFloat(btn.getAttribute('data-pin-y') || '0');
          var w = parseFloat(btn.getAttribute('data-pin-w') || '40');
          var h = parseFloat(btn.getAttribute('data-pin-h') || '30');
          var docW = parseFloat(btn.getAttribute('data-pin-docw') || '1440');
          var docH = parseFloat(btn.getAttribute('data-pin-doch') || '900');
          var pinId = btn.getAttribute('data-pin-id') || '';

          if (modalPinOverlay) {
            modalPinOverlay.style.left = Math.max(0, (x / docW) * 100) + '%';
            modalPinOverlay.style.top = Math.max(0, (y / docH) * 100) + '%';
            modalPinOverlay.style.width = Math.max(1.5, (w / docW) * 100) + '%';
            modalPinOverlay.style.height = Math.max(1, (h / docH) * 100) + '%';
            modalPinOverlay.style.display = 'block';
          }
          if (modalPinLabel) {
            modalPinLabel.textContent = pinId + ' (' + Math.round(x) + ', ' + Math.round(y) + ' px)';
          }
          if (captureModalHeaderTitle) {
            captureModalHeaderTitle.textContent = (isEs ? 'Ubicación en página: ' : 'Page location: ') + pinId;
          }
          if (typeof captureModal.showModal === 'function') {
            captureModal.showModal();
            setTimeout(function () {
              if (modalPinOverlay) {
                modalPinOverlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 120);
          }
        });
      });
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
			userImpactProfile: i.userImpactProfile,
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
