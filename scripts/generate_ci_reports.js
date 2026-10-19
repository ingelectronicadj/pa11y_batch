#!/usr/bin/env node
/**
 * Generador de artefactos de CI/CD, CSVs Ejecutivos/Detallados, Dashboard de Lote y Centro de Reportes:
 *   1. findings-consolidated.csv  (CSV Maestro con 23 columnas detalladas de todos los hallazgos + BOM UTF-8)
 *   2. wcag-matrix.csv            (Matriz de cumplimiento por Criterio WCAG + BOM UTF-8)
 *   3. summary.csv                (Resumen ejecutivo enriquecido por URL con 25 columnas + BOM UTF-8)
 *   4. junit.xml                  (Azure DevOps PublishTestResults, GitLab JUnit, GitHub Actions)
 *   5. gl-code-quality-report.json (GitLab CI Code Quality widget en Merge Requests)
 *   6. summary.md                 (GitHub Step Summary $GITHUB_STEP_SUMMARY / Azure DevOps uploadsummary)
 *   7. <run_dir>/index.html       (Dashboard Ejecutivo del Lote con modal de evidencia, enlaces ejecutivos y compartición URL)
 *   8. artifacts/index.html       (Centro de Reportes Raíz con indicador de tendencia Delta vs. lote anterior)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [
	,
	,
	runDir,
	runId = '',
	fecha = '',
	standard = 'WCAG2AA',
	runnersLabel = 'axe + htmlcs',
	level = 'errors',
	format = 'html',
	thresholdStr = '0',
	artifactsRoot = './artifacts',
	projectName = '',
	auditorName = ''
] = process.argv;

if (!runDir) {
	process.exit(1);
}

const threshold = parseInt(thresholdStr, 10) || 0;
const jsonlPath = path.join(runDir, '.ci-items.jsonl');

let records = [];
if (fs.existsSync(jsonlPath)) {
	records = fs.readFileSync(jsonlPath, 'utf8')
		.split('\n')
		.map(l => l.trim())
		.filter(Boolean)
		.map(l => JSON.parse(l));
}

function escapeXml (str) {
	return String(str == null ? '' : str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function escapeHtml (str) {
	return String(str == null ? '' : str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeCsv (val) {
	const s = String(val == null ? '' : val).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
	return `"${s.replace(/"/g, '""')}"`;
}

function md5 (str) {
	return crypto.createHash('md5').update(String(str)).digest('hex');
}

let totalUrls = records.length;
let totalErrors = 0;
let totalWarnings = 0;
let totalNotices = 0;
let totalAxe = 0;
let totalHtmlcs = 0;
let cleanUrls = 0;
let issuesUrls = 0;
let failedExecutions = 0;

records.forEach(r => {
	totalErrors += r.errorsCount || 0;
	totalWarnings += r.warningsCount || 0;
	totalNotices += r.noticesCount || 0;
	totalAxe += r.axeCount || 0;
	totalHtmlcs += r.htmlcsCount || 0;
	if (r.status === 'failed') {
		failedExecutions += 1;
	} else if ((r.errorsCount || 0) === 0 && (r.warningsCount || 0) === 0 && (r.noticesCount || 0) === 0) {
		cleanUrls += 1;
	} else {
		issuesUrls += 1;
	}
});

// ---------------------------------------------------------
// 1. Generar CSV Maestro de Hallazgos Consolidados (findings-consolidated.csv) — 23 columnas
// ---------------------------------------------------------
const consolidatedHeaders = [
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
];

const consolidatedLines = [consolidatedHeaders.map(escapeCsv).join(',')];
let globalIdx = 0;

records.forEach(rec => {
	(rec.issues || []).forEach(iss => {
		globalIdx += 1;
		const globalId = `A11Y-${String(globalIdx).padStart(4, '0')}`;
		consolidatedLines.push([
			globalId,
			runId,
			fecha,
			rec.alias,
			rec.url,
			rec.standard || standard,
			iss.typeLabel || iss.type,
			iss.impactLabel || '-',
			iss.principleName || '-',
			iss.guidelineName || '-',
			iss.criterionNumber || '-',
			iss.criterionName || '-',
			iss.wcagLevel || '-',
			iss.runner || '-',
			iss.code || '-',
			iss.htmlElementTag || '-',
			iss.message || '-',
			iss.remediationAdvice || '-',
			iss.helpUrl || '-',
			iss.selector || '-',
			iss.context || '-',
			iss.originalMessage || '-',
			rec.captureFilename || '-'
		].map(escapeCsv).join(','));
	});
});

fs.writeFileSync(
	path.join(runDir, 'findings-consolidated.csv'),
	'\uFEFF' + consolidatedLines.join('\n') + '\n',
	'utf8'
);

// ---------------------------------------------------------
// 2. Generar Matriz de Cumplimiento por Criterio WCAG (wcag-matrix.csv)
// ---------------------------------------------------------
const wcagMatrixMap = new Map();

records.forEach(rec => {
	(rec.issues || []).forEach(iss => {
		const key = iss.criterionNumber && iss.criterionNumber !== '-' ? iss.criterionNumber : iss.wcagCriterion;
		if (!wcagMatrixMap.has(key)) {
			wcagMatrixMap.set(key, {
				principleName: iss.principleName || '-',
				guidelineName: iss.guidelineName || '-',
				criterionNumber: iss.criterionNumber || '-',
				criterionName: iss.criterionName || iss.wcagCriterion || '-',
				wcagLevel: iss.wcagLevel || '-',
				total: 0,
				errors: 0,
				warnings: 0,
				notices: 0,
				axe: 0,
				htmlcs: 0,
				rules: new Set(),
				sites: new Set()
			});
		}
		const entry = wcagMatrixMap.get(key);
		entry.total += 1;
		if (iss.type === 'error') entry.errors += 1;
		else if (iss.type === 'warning') entry.warnings += 1;
		else entry.notices += 1;
		if (iss.runner === 'axe') entry.axe += 1;
		if (iss.runner === 'htmlcs') entry.htmlcs += 1;
		if (iss.code) entry.rules.add(iss.code);
		if (rec.alias) entry.sites.add(rec.alias);
	});
});

const matrixHeaders = [
	'Principio_WCAG',
	'Pauta_WCAG',
	'Criterio_WCAG',
	'Nombre_Criterio',
	'Nivel_WCAG',
	'Estado_Criterio',
	'Total_Hallazgos',
	'Errores_WCAG',
	'Advertencias',
	'Avisos',
	'Hallazgos_Axe',
	'Hallazgos_HTMLCS',
	'Reglas_Implicadas',
	'Sitios_Afectados'
];

const matrixEntries = Array.from(wcagMatrixMap.values()).sort((a, b) => b.errors - a.errors || b.total - a.total);
const matrixLines = [matrixHeaders.map(escapeCsv).join(',')];

matrixEntries.forEach(m => {
	const estadoCrit = m.errors > 0 ? 'No conforme (Con errores)' : 'En observación (Advertencias)';
	matrixLines.push([
		m.principleName,
		m.guidelineName,
		m.criterionNumber,
		m.criterionName,
		m.wcagLevel,
		estadoCrit,
		m.total,
		m.errors,
		m.warnings,
		m.notices,
		m.axe,
		m.htmlcs,
		Array.from(m.rules).join(' | '),
		Array.from(m.sites).join(' | ')
	].map(escapeCsv).join(','));
});

fs.writeFileSync(
	path.join(runDir, 'wcag-matrix.csv'),
	'\uFEFF' + matrixLines.join('\n') + '\n',
	'utf8'
);

// ---------------------------------------------------------
// 3. Generar Resumen Ejecutivo por URL Enriquecido (summary.csv) — 25 columnas
// ---------------------------------------------------------
const summaryHeaders = [
	'Lote_ID',
	'Fecha_Hora',
	'Alias_Sitio',
	'URL_Evaluada',
	'Estandar_Objetivo',
	'Motores_Activos',
	'Estado_Conformidad',
	'Total_Hallazgos',
	'Errores_WCAG',
	'Advertencias',
	'Avisos',
	'Impacto_Critico',
	'Impacto_Serio',
	'Impacto_Moderado',
	'Impacto_Menor',
	'Hallazgos_Axe',
	'Hallazgos_HTMLCS',
	'Principio_1_Perceptible',
	'Principio_2_Operable',
	'Principio_3_Comprensible',
	'Principio_4_Robusto',
	'Top_3_Criterios_Afectados',
	'Archivo_Reporte_HTML',
	'Archivo_CSV_Detallado',
	'Archivo_Evidencia'
];

const summaryLines = [summaryHeaders.map(escapeCsv).join(',')];

records.forEach(rec => {
	const issues = rec.issues || [];
	const critCount = issues.filter(i => i.impactLabel === 'Crítico' || i.impactLabel === 'Critical').length;
	const serCount = issues.filter(i => i.impactLabel === 'Serio' || i.impactLabel === 'Serious').length;
	const modCount = issues.filter(i => i.impactLabel === 'Moderado' || i.impactLabel === 'Moderate').length;
	const minCount = issues.filter(i => i.impactLabel === 'Menor' || i.impactLabel === 'Minor').length;

	const p1 = issues.filter(i => i.principleNumber === '1').length;
	const p2 = issues.filter(i => i.principleNumber === '2').length;
	const p3 = issues.filter(i => i.principleNumber === '3').length;
	const p4 = issues.filter(i => i.principleNumber === '4').length;

	const critMap = new Map();
	issues.forEach(i => {
		const c = i.wcagCriterion || '-';
		critMap.set(c, (critMap.get(c) || 0) + 1);
	});
	const top3Criteria = Array.from(critMap.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([k, v]) => `${k} (${v})`)
		.join(' | ') || '-';

	let estadoConf = 'Conforme (0 errores)';
	if (rec.status === 'failed') estadoConf = 'Fallo técnico';
	else if ((rec.errorsCount || 0) > 0) estadoConf = 'No conforme (Con errores WCAG)';
	else if ((rec.warningsCount || 0) > 0) estadoConf = 'Conforme con advertencias';

	const totalUrlIssues = (rec.errorsCount || 0) + (rec.warningsCount || 0) + (rec.noticesCount || 0);

	summaryLines.push([
		runId,
		fecha,
		rec.alias,
		rec.url,
		rec.standard || standard,
		rec.runnersLabel || runnersLabel,
		estadoConf,
		totalUrlIssues,
		rec.errorsCount || 0,
		rec.warningsCount || 0,
		rec.noticesCount || 0,
		critCount,
		serCount,
		modCount,
		minCount,
		rec.axeCount || 0,
		rec.htmlcsCount || 0,
		p1,
		p2,
		p3,
		p4,
		top3Criteria,
		rec.reportFilename || '-',
		rec.findingsCsvFilename || `${rec.alias}-findings.csv`,
		rec.captureFilename || '-'
	].map(escapeCsv).join(','));
});

fs.writeFileSync(
	path.join(runDir, 'summary.csv'),
	'\uFEFF' + summaryLines.join('\n') + '\n',
	'utf8'
);

// ---------------------------------------------------------
// 4. Generar JUnit XML (junit.xml)
// ---------------------------------------------------------
const suitesXml = records.map(rec => {
	if (rec.status === 'failed') {
		return `  <testsuite name="${escapeXml(rec.alias)} (${escapeXml(rec.url)})" tests="1" failures="0" errors="1">
    <testcase classname="Pa11yBatch.Execution" name="[${escapeXml(rec.alias)}] Evaluacion de ${escapeXml(rec.url)}">
      <error message="Fallo tecnico al analizar la URL (codigo de salida ${escapeXml(rec.exitCode || 1)})" type="ExecutionError" />
    </testcase>
  </testsuite>`;
	}

	const errorIssues = (rec.issues || []).filter(i => i.type === 'error');
	if (errorIssues.length === 0) {
		return `  <testsuite name="${escapeXml(rec.alias)} (${escapeXml(rec.url)})" tests="1" failures="0" errors="0">
    <testcase classname="${escapeXml(standard)}" name="[${escapeXml(rec.alias)}] Cumplimiento ${escapeXml(standard)} (${escapeXml(rec.url)})" />
  </testsuite>`;
	}

	const casesXml = errorIssues.map((iss, idx) => {
		const className = iss.wcagCriterion && iss.wcagCriterion !== '-'
			? iss.wcagCriterion
			: `${iss.runner}.${iss.code}`;
		const tcName = `[${rec.alias} #${idx + 1}] ${iss.code} - ${iss.selector || rec.url}`;
		const details = [
			`URL: ${rec.url}`,
			`Motor: ${iss.runner}`,
			`Principio: ${iss.principleName}`,
			`Criterio WCAG: ${iss.wcagCriterion} (Nivel ${iss.wcagLevel})`,
			iss.impactLabel ? `Impacto: ${iss.impactLabel}` : '',
			`Regla: ${iss.code}`,
			`Mensaje: ${iss.message}`,
			iss.selector ? `Selector CSS: ${iss.selector}` : '',
			iss.context ? `HTML: ${iss.context}` : ''
		].filter(Boolean).join('\n');

		return `    <testcase classname="${escapeXml(className)}" name="${escapeXml(tcName)}">
      <failure message="${escapeXml(iss.message)}" type="${escapeXml(iss.code)}">${escapeXml(details)}</failure>
    </testcase>`;
	}).join('\n');

	return `  <testsuite name="${escapeXml(rec.alias)} (${escapeXml(rec.url)})" tests="${errorIssues.length}" failures="${errorIssues.length}" errors="0">
${casesXml}
  </testsuite>`;
}).join('\n');

const totalTestCases = records.reduce((acc, r) => {
	if (r.status === 'failed') return acc + 1;
	const errs = (r.issues || []).filter(i => i.type === 'error').length;
	return acc + (errs > 0 ? errs : 1);
}, 0);

const junitXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Pa11y Batch (${escapeXml(standard)} - ${escapeXml(runnersLabel)})" tests="${totalTestCases}" failures="${totalErrors}" errors="${failedExecutions}">
${suitesXml}
</testsuites>
`;

fs.writeFileSync(path.join(runDir, 'junit.xml'), junitXml, 'utf8');

// ---------------------------------------------------------
// 5. Generar GitLab Code Quality JSON (gl-code-quality-report.json)
// ---------------------------------------------------------
const codeQualityIssues = [];
records.forEach(rec => {
	(rec.issues || []).forEach(iss => {
		let severity = 'minor';
		if (iss.type === 'error') {
			severity = (iss.impactLabel === 'Crítico' || iss.impactLabel === 'Critical') ? 'critical' : 'major';
		} else if (iss.type === 'notice') {
			severity = 'info';
		}
		const fingerprint = md5(`${rec.url}|${iss.runner}|${iss.code}|${iss.selector}|${iss.context}`);
		codeQualityIssues.push({
			description: `[${rec.alias}] (${iss.wcagCriterion}) ${iss.message}`,
			check_name: `${iss.runner}:${iss.code}`,
			fingerprint,
			severity,
			location: {
				path: rec.url,
				lines: {
					begin: 1
				}
			}
		});
	});
});

fs.writeFileSync(
	path.join(runDir, 'gl-code-quality-report.json'),
	JSON.stringify(codeQualityIssues, null, 2) + '\n',
	'utf8'
);

// ---------------------------------------------------------
// 6. Generar Resumen Markdown para CI (summary.md)
// ---------------------------------------------------------
const gatePassed = failedExecutions === 0 && totalErrors <= threshold;
const statusText = gatePassed ? 'APROBADO (Cumple umbral)' : 'FALLIDO (Supera umbral de errores)';

const mdLines = [
	`# Resumen de Auditoría de Accesibilidad (Pa11y Batch)`,
	``,
	projectName ? `- **Proyecto:** ${projectName}` : '',
	auditorName ? `- **Auditor:** ${auditorName}` : '',
	`- **Estado del Quality Gate:** **${statusText}** (Umbral permitido: \`${threshold}\` errores)`,
	`- **ID de Ejecución:** \`${runId}\` (${fecha})`,
	`- **Estándar WCAG:** \`${standard}\` · **Motores:** \`${runnersLabel}\` · **Severidad:** \`${level}\``,
	`- **Totales del Lote:** **${totalUrls}** URLs evaluadas · **${totalErrors}** Errores · **${totalWarnings}** Advertencias · **${totalNotices}** Avisos`,
	``,
	`| Alias | URL | Estado | Errores | Advertencias | Avisos | axe | htmlcs | CSV Detallado |`,
	`| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |`
].filter(l => l !== '');

records.forEach(rec => {
	const est = rec.status === 'failed'
		? 'Fallido (Error técnico)'
		: (rec.errorsCount === 0 ? 'Sin errores' : 'Con errores');
	mdLines.push(
		`| **${rec.alias}** | ${rec.url} | ${est} | **${rec.errorsCount}** | ${rec.warningsCount} | ${rec.noticesCount} | ${rec.axeCount} | ${rec.htmlcsCount} | \`${rec.findingsCsvFilename || '-'}\` |`
	);
});

mdLines.push('');
fs.writeFileSync(path.join(runDir, 'summary.md'), mdLines.join('\n'), 'utf8');

// ---------------------------------------------------------
// 7. Actualizar historial y calcular Tendencia (Delta de errores vs lote previo)
// ---------------------------------------------------------
const historyCsvPath = path.join(artifactsRoot, 'runs-history.csv');
if (!fs.existsSync(historyCsvPath)) {
	fs.writeFileSync(
		historyCsvPath,
		'\uFEFF"Run_ID","Fecha","Estandar","Motores","Nivel","Formato","Total_URLs","Errores","Advertencias","Avisos"\n',
		'utf8'
	);
}
fs.appendFileSync(
	historyCsvPath,
	`"${runId}","${fecha}","${standard}","${runnersLabel}","${level}","${format}","${totalUrls}","${totalErrors}","${totalWarnings}","${totalNotices}"\n`,
	'utf8'
);

const historyLines = fs.readFileSync(historyCsvPath, 'utf8')
	.replace(/^\uFEFF/, '')
	.split('\n')
	.map(l => l.trim())
	.filter(l => l && !l.startsWith('"Run_ID"'))
	.reverse();

let deltaBadgeHtml = '<span class="kpi-sub">Primera ejecución registrada</span>';
if (historyLines.length >= 2) {
	const prevCols = historyLines[1].split(',').map(c => c.replace(/^"|"$/g, ''));
	const prevErr = parseInt(prevCols[7], 10);
	if (!Number.isNaN(prevErr)) {
		const diff = totalErrors - prevErr;
		if (diff < 0) {
			deltaBadgeHtml = `<span class="kpi-sub" style="color:var(--ok);font-weight:700;">${diff} errores vs. lote anterior (Mejora)</span>`;
		} else if (diff > 0) {
			deltaBadgeHtml = `<span class="kpi-sub" style="color:var(--err);font-weight:700;">+${diff} errores vs. lote anterior</span>`;
		} else {
			deltaBadgeHtml = `<span class="kpi-sub">Sin variación vs. lote anterior (${prevErr})</span>`;
		}
	}
}

// ---------------------------------------------------------
// 8. Estilos y Script Responsivo + Visor Modal + Compartición de URL
// ---------------------------------------------------------
const SHARED_STYLES = `
    :root {
      --bg-page: #f4f4f5;
      --bg-surface: #ffffff;
      --bg-subtle: #fafafa;
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
      --ok: #16a34a;
      --ok-bg: #f0fdf4;
      --ok-border: #bbf7d0;
      --ok-text: #166534;
      --focus: #2563eb;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
    }
    html[data-theme="dark"] {
      --bg-page: #09090b;
      --bg-surface: #18181b;
      --bg-subtle: #121215;
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
      --ok-bg: rgba(22, 163, 74, 0.14);
      --ok-border: rgba(22, 163, 74, 0.35);
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
      font-size: 0.85rem;
      font-weight: 600;
    }
    .breadcrumbs a {
      color: var(--text-secondary);
      text-decoration: none;
      padding: 4px 8px;
      border-radius: 6px;
    }
    .breadcrumbs a:hover { background: var(--bg-subtle); color: var(--text-main); }
    .breadcrumbs .sep { color: var(--text-muted); }
    .breadcrumbs .current { color: var(--text-main); font-weight: 700; padding: 4px 8px; }
    .topbar-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .btn {
      background: var(--bg-surface);
      color: var(--text-main);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 6px 12px;
      min-height: 36px;
      font-size: 0.8rem;
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
    .btn:focus-visible, a:focus-visible, .thumb-modal-btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    main { max-width: 1180px; margin: 20px auto 48px; padding: 0 20px; }
    .hero-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 22px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
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
    h1 { margin: 0 0 6px; font-size: clamp(1.25rem, 2.5vw, 1.5rem); font-weight: 800; letter-spacing: -0.02em; }
    h2.section-title { margin: 24px 0 12px; font-size: 1.08rem; font-weight: 800; letter-spacing: -0.01em; }
    .meta { color: var(--text-secondary); font-size: 0.84rem; overflow-wrap: anywhere; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .kpi-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 15px 16px;
      box-shadow: var(--shadow-sm);
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--border-strong);
    }
    .kpi-card.kpi-ok::before { background: var(--ok); }
    .kpi-card.kpi-err::before { background: var(--err); }
    .kpi-card.kpi-warn::before { background: var(--warn); }
    .kpi-card.kpi-axe::before { background: #6366f1; }
    .kpi-card.kpi-htmlcs::before { background: #0d9488; }
    .kpi-label { font-size: 0.78rem; color: var(--text-secondary); font-weight: 600; }
    .kpi-value {
      font-size: clamp(1.45rem, 2.2vw, 1.8rem);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      margin-top: 4px;
      line-height: 1.1;
    }
    .kpi-sub { font-size: 0.73rem; color: var(--text-muted); margin-top: 4px; display: block; }
    .table-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: var(--shadow-sm);
      overflow: hidden;
      margin-bottom: 24px;
    }
    .table-toolbar {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .table-toolbar-title { font-size: 0.94rem; font-weight: 700; }
    .table-search {
      padding: 7px 12px;
      min-height: 36px;
      background: var(--bg-subtle);
      color: var(--text-main);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font-size: 0.84rem;
      min-width: 220px;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      font-size: 0.86rem;
      vertical-align: middle;
    }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:hover { background: var(--bg-subtle); }
    th {
      background: var(--bg-subtle);
      color: var(--text-secondary);
      font-size: 0.74rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .site-alias { font-weight: 700; font-size: 0.92rem; display: block; }
    .site-url {
      font-size: 0.8rem;
      color: var(--accent);
      text-decoration: none;
      overflow-wrap: anywhere;
      word-break: break-word;
      display: inline-block;
      margin-top: 2px;
    }
    .site-url:hover { text-decoration: underline; }
    .num { font-variant-numeric: tabular-nums; font-weight: 700; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 0.74rem;
      font-weight: 700;
    }
    .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .status-ok { background: var(--ok-bg); color: var(--ok-text); border: 1px solid var(--ok-border); }
    .status-ok .dot { background: var(--ok); }
    .status-warn { background: var(--warn-bg); color: var(--warn-text); border: 1px solid var(--warn-border); }
    .status-warn .dot { background: var(--warn); }
    .status-err { background: var(--err-bg); color: var(--err-text); border: 1px solid var(--err-border); }
    .status-err .dot { background: var(--err); }
    .mini-bar {
      width: 96px;
      height: 6px;
      background: var(--bg-subtle);
      border-radius: 999px;
      overflow: hidden;
      display: flex;
      margin-top: 5px;
    }
    .mini-bar-err { background: var(--err); height: 100%; }
    .mini-bar-warn { background: var(--warn); height: 100%; }
    .engines-split {
      display: inline-flex;
      gap: 6px;
      flex-wrap: wrap;
      font-size: 0.76rem;
      font-weight: 600;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .engines-split span {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      padding: 2px 7px;
      border-radius: 6px;
    }
    .thumb-modal-btn {
      background: var(--bg-subtle);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 4px;
      cursor: pointer;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .thumb-modal-btn:hover {
      transform: translateY(-1px);
      border-color: var(--accent);
    }
    .thumb-preview {
      width: 76px;
      height: 44px;
      object-fit: cover;
      object-position: top;
      border-radius: 5px;
      display: block;
    }
    .thumb-caption {
      font-size: 0.68rem;
      font-weight: 600;
      color: var(--text-secondary);
    }
    code {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8em;
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
    @media (max-width: 860px) {
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
      .hero-card { padding: 16px; }
      .table-search { width: 100%; min-width: 0; }
      table, thead, tbody, th, td, tr { display: block; width: 100%; }
      thead {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }
      tbody tr {
        padding: 14px 16px;
        border-bottom: 2px solid var(--border);
      }
      tbody td {
        border: 0;
        padding: 6px 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        text-align: right;
      }
      tbody td::before {
        content: attr(data-label);
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--text-secondary);
        text-align: left;
        flex-shrink: 0;
      }
      tbody td.cell-site {
        flex-direction: column;
        align-items: flex-start;
        text-align: left;
        padding-bottom: 10px;
        margin-bottom: 4px;
        border-bottom: 1px solid var(--border);
      }
      tbody td.cell-site::before { display: none; }
    }
    @media (max-width: 480px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
`;

const MODAL_AND_SCRIPT = `
  <dialog id="captureModal" class="capture-modal" aria-label="Evidencia visual de la página auditada">
    <div class="capture-modal-header">
      <span id="captureModalTitle">Evidencia visual</span>
      <div style="display:flex;gap:8px;">
        <a id="captureModalDownload" href="#" download class="btn">Descargar PNG</a>
        <button type="button" id="btnCloseCaptureModal" class="btn btn-primary">Cerrar (Esc)</button>
      </div>
    </div>
    <div class="capture-modal-body">
      <img id="captureModalImg" src="" alt="" />
    </div>
  </dialog>

  <script>
    (function () {
      var htmlEl = document.documentElement;
      var btnToggleTheme = document.getElementById('btnToggleTheme');
      var btnSharePageUrl = document.getElementById('btnSharePageUrl');
      function updateLabel (t) {
        if (btnToggleTheme) btnToggleTheme.textContent = t === 'dark' ? 'Tema claro' : 'Tema oscuro';
      }
      try {
        var saved = localStorage.getItem('pa11y_batch_theme');
        if (saved === 'dark' || saved === 'light') {
          htmlEl.setAttribute('data-theme', saved);
          updateLabel(saved);
        }
      } catch (_e) {}
      if (btnToggleTheme) {
        btnToggleTheme.addEventListener('click', function () {
          var next = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
          htmlEl.setAttribute('data-theme', next);
          updateLabel(next);
          try { localStorage.setItem('pa11y_batch_theme', next); } catch (_e) {}
        });
      }
      if (btnSharePageUrl) {
        btnSharePageUrl.addEventListener('click', function () {
          var orig = btnSharePageUrl.textContent;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(window.location.href).catch(function () {});
          }
          btnSharePageUrl.textContent = 'URL copiada';
          setTimeout(function () { btnSharePageUrl.textContent = orig; }, 1800);
        });
      }
      var searchUrlInput = document.getElementById('searchUrlInput');
      if (searchUrlInput) {
        searchUrlInput.addEventListener('input', function () {
          var q = (searchUrlInput.value || '').toLowerCase();
          document.querySelectorAll('.url-row').forEach(function (row) {
            row.style.display = (!q || row.textContent.toLowerCase().indexOf(q) !== -1) ? '' : 'none';
          });
        });
      }
      var captureModal = document.getElementById('captureModal');
      var captureModalImg = document.getElementById('captureModalImg');
      var captureModalTitle = document.getElementById('captureModalTitle');
      var captureModalDownload = document.getElementById('captureModalDownload');
      var btnCloseCaptureModal = document.getElementById('btnCloseCaptureModal');

      document.querySelectorAll('.thumb-modal-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var src = btn.getAttribute('data-capture-src') || '';
          var title = btn.getAttribute('data-capture-title') || 'Evidencia visual';
          if (captureModal && captureModalImg && src) {
            captureModalImg.src = src;
            captureModalImg.alt = title;
            if (captureModalTitle) captureModalTitle.textContent = 'Evidencia visual: ' + title;
            if (captureModalDownload) captureModalDownload.href = src;
            if (typeof captureModal.showModal === 'function') captureModal.showModal();
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
`;

function buildUrlRows (prefix) {
	return records.map(rec => {
		const tot = (rec.errorsCount || 0) + (rec.warningsCount || 0) + (rec.noticesCount || 0);
		const errW = tot > 0 ? Math.round(((rec.errorsCount || 0) / tot) * 100) : 0;
		const warnW = tot > 0 ? Math.round(((rec.warningsCount || 0) / tot) * 100) : 0;

		let badgeClass = 'status-ok';
		let badgeText = 'Conforme';
		if (rec.status === 'failed') {
			badgeClass = 'status-err';
			badgeText = 'Error técnico';
		} else if ((rec.errorsCount || 0) > 0) {
			badgeClass = 'status-err';
			badgeText = 'Con errores WCAG';
		} else if ((rec.warningsCount || 0) > 0) {
			badgeClass = 'status-warn';
			badgeText = 'Solo advertencias';
		}

		const reportHref = rec.reportFilename ? `${prefix}${rec.reportFilename}` : '';
		const execReportHref = reportHref ? `${reportHref}?view=executive` : '';
		const csvHref = rec.findingsCsvFilename ? `${prefix}${rec.findingsCsvFilename}` : '';
		const captureHref = rec.captureFilename ? `${prefix}${rec.captureFilename}` : '';

		const actionsCell = reportHref
			? `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                 <a href="${escapeHtml(execReportHref)}" class="btn" title="Abrir en Vista Ejecutiva para Stakeholders">Stakeholders</a>
                 <a href="${escapeHtml(reportHref)}" class="btn btn-primary">Ingeniería &rarr;</a>
                 ${csvHref ? `<a href="${escapeHtml(csvHref)}" class="btn" title="Descargar CSV detallado de ${escapeHtml(rec.alias)}">CSV (${tot})</a>` : ''}
               </div>`
			: '-';
		const captureCell = captureHref
			? `<button type="button" class="thumb-modal-btn" data-capture-src="${escapeHtml(captureHref)}" data-capture-title="${escapeHtml(rec.alias)}" aria-label="Ampliar evidencia visual de ${escapeHtml(rec.alias)} en ventana modal">
                 <img src="${escapeHtml(captureHref)}" alt="Miniatura de ${escapeHtml(rec.alias)}" class="thumb-preview" loading="lazy" />
                 <span class="thumb-caption">Ampliar</span>
               </button>`
			: '-';

		return `
            <tr class="url-row">
              <td class="cell-site" data-label="Sitio Auditado">
                <span class="site-alias">${escapeHtml(rec.alias)}</span>
                <a href="${escapeHtml(rec.url)}" target="_blank" rel="noopener" class="site-url">${escapeHtml(rec.url)}</a>
              </td>
              <td data-label="Estado">
                <div>
                  <span class="badge ${badgeClass}"><span class="dot" aria-hidden="true"></span>${badgeText}</span>
                  <div class="mini-bar" aria-hidden="true">
                    <div class="mini-bar-err" style="width:${errW}%"></div>
                    <div class="mini-bar-warn" style="width:${warnW}%"></div>
                  </div>
                </div>
              </td>
              <td data-label="Errores WCAG" class="num" style="color: var(--err);">${rec.errorsCount || 0}</td>
              <td data-label="Advertencias" class="num" style="color: var(--warn);">${rec.warningsCount || 0}</td>
              <td data-label="Motores">
                <div class="engines-split">
                  <span>axe: ${rec.axeCount || 0}</span>
                  <span>htmlcs: ${rec.htmlcsCount || 0}</span>
                </div>
              </td>
              <td data-label="Evidencia">${captureCell}</td>
              <td data-label="Acciones">${actionsCell}</td>
            </tr>`;
	}).join('');
}

const batchTitle = `${projectName ? `${projectName} · ` : ''}Dashboard del Lote ${runId}`;
const batchOgDesc = `${totalUrls} URLs auditadas (${standard}): ${totalErrors} Errores WCAG, ${totalWarnings} Advertencias`;

// ---------------------------------------------------------
// 9. Generar Dashboard del Lote (<run_dir>/index.html)
// ---------------------------------------------------------
const batchDashboardHtml = `<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(batchTitle)}</title>
  <meta name="description" content="${escapeHtml(batchOgDesc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(batchTitle)}" />
  <meta property="og:description" content="${escapeHtml(batchOgDesc)}" />
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <a href="#mainContent" class="skip-link">Saltar al contenido principal</a>

  <nav class="topbar" aria-label="Navegación de lotes">
    <div class="topbar-inner">
      <div class="breadcrumbs">
        <a href="../index.html">Centro de Reportes</a>
        <span class="sep" aria-hidden="true">/</span>
        <span class="current" aria-current="page">Lote ${escapeHtml(runId)}</span>
      </div>
      <div class="topbar-actions">
        <button type="button" id="btnSharePageUrl" class="btn">Compartir URL</button>
        <a href="findings-consolidated.csv" class="btn btn-primary">CSV Maestro Hallazgos (${globalIdx})</a>
        <a href="wcag-matrix.csv" class="btn">Matriz WCAG (CSV)</a>
        <a href="summary.csv" class="btn">Resumen URLs (CSV)</a>
        <a href="junit.xml" class="btn">JUnit XML</a>
        <button type="button" id="btnToggleTheme" class="btn" aria-label="Alternar tema claro u oscuro">Tema oscuro</button>
      </div>
    </div>
  </nav>

  <main id="mainContent">
    <header class="hero-card">
      <div>
        <div class="hero-eyebrow">
          <span>${escapeHtml(projectName || 'Pa11y Batch Audit')}</span>
          <span>&middot;</span>
          <span class="badge ${gatePassed ? 'status-ok' : 'status-err'}">
            <span class="dot" aria-hidden="true"></span>
            ${gatePassed ? 'Quality Gate Aprobado' : 'Requiere Remediación WCAG'}
          </span>
        </div>
        <h1>Dashboard Ejecutivo del Lote · ${escapeHtml(fecha)}</h1>
        <div class="meta">
          ID: <code>${escapeHtml(runId)}</code> &middot; Estándar: <strong>${escapeHtml(standard)}</strong> &middot;
          Motores: <strong>${escapeHtml(runnersLabel)}</strong> &middot; Severidad: <strong>${escapeHtml(level)}</strong>
          ${auditorName ? ` &middot; Auditor: <strong>${escapeHtml(auditorName)}</strong>` : ''}
        </div>
      </div>
    </header>

    <section class="kpi-grid" aria-label="Indicadores resumen del lote">
      <div class="kpi-card">
        <div class="kpi-label">URLs Evaluadas</div>
        <div class="kpi-value">${totalUrls}</div>
        <span class="kpi-sub">${cleanUrls} sin hallazgos · ${issuesUrls} con hallazgos</span>
      </div>
      <div class="kpi-card kpi-err">
        <div class="kpi-label">Total Errores WCAG</div>
        <div class="kpi-value" style="color: var(--err);">${totalErrors}</div>
        ${deltaBadgeHtml}
      </div>
      <div class="kpi-card kpi-warn">
        <div class="kpi-label">Total Advertencias</div>
        <div class="kpi-value" style="color: var(--warn);">${totalWarnings}</div>
        <span class="kpi-sub">Revisiones manuales sugeridas</span>
      </div>
      <div class="kpi-card kpi-axe">
        <div class="kpi-label">Hallazgos axe-core</div>
        <div class="kpi-value">${totalAxe}</div>
        <span class="kpi-sub">Motor Deque axe-core</span>
      </div>
      <div class="kpi-card kpi-htmlcs">
        <div class="kpi-label">Hallazgos HTML_CodeSniffer</div>
        <div class="kpi-value">${totalHtmlcs}</div>
        <span class="kpi-sub">Motor Squiz HTMLCS</span>
      </div>
    </section>

    <section class="table-card" aria-label="Resultados detallados por URL">
      <div class="table-toolbar">
        <span class="table-toolbar-title">Resultados por URL evaluada (${totalUrls})</span>
        <input id="searchUrlInput" type="search" class="table-search" placeholder="Filtrar por alias o URL..." aria-label="Filtrar tabla por alias o URL" />
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Sitio Auditado</th>
            <th scope="col">Estado y Proporción</th>
            <th scope="col">Errores</th>
            <th scope="col">Advertencias</th>
            <th scope="col">Motores</th>
            <th scope="col">Evidencia</th>
            <th scope="col">Vistas del Reporte</th>
          </tr>
        </thead>
        <tbody>${buildUrlRows('')}
        </tbody>
      </table>
    </section>
  </main>
  ${MODAL_AND_SCRIPT}
</body>
</html>`;

fs.writeFileSync(path.join(runDir, 'index.html'), batchDashboardHtml + '\n', 'utf8');

// ---------------------------------------------------------
// 10. Generar Centro de Reportes Raíz (artifacts/index.html)
// ---------------------------------------------------------
const historyRowsHtml = historyLines.map((line, idx) => {
	const cols = line.split(',').map(c => c.replace(/^"|"$/g, ''));
	const [hRun, hDate, hStd, hRunn, , , hUrls, hErr, hWarn] = cols;
	const errNum = parseInt(hErr, 10) || 0;
	const badge = errNum === 0
		? `<span class="badge status-ok"><span class="dot" aria-hidden="true"></span>0 errores</span>`
		: `<span class="badge status-err"><span class="dot" aria-hidden="true"></span>${errNum} errores</span>`;
	const latestTag = idx === 0
		? ` <span class="badge status-warn" style="margin-left:6px;">Último</span>`
		: '';
	return `
            <tr>
              <td class="cell-site" data-label="Fecha y Lote">
                <strong>${escapeHtml(hDate)}</strong>${latestTag}
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;"><code>${escapeHtml(hRun)}</code></div>
              </td>
              <td data-label="Estándar"><code>${escapeHtml(hStd)}</code></td>
              <td data-label="Motores">${escapeHtml(hRunn)}</td>
              <td data-label="URLs" class="num">${escapeHtml(hUrls)}</td>
              <td data-label="Errores WCAG">${badge}</td>
              <td data-label="Advertencias" class="num" style="color: var(--warn);">${escapeHtml(hWarn)}</td>
              <td data-label="Artefactos">
                <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                  <a href="${escapeHtml(hRun)}/index.html" class="btn">Dashboard</a>
                  <a href="${escapeHtml(hRun)}/findings-consolidated.csv" class="btn">CSV Hallazgos</a>
                  <a href="${escapeHtml(hRun)}/wcag-matrix.csv" class="btn">Matriz WCAG</a>
                  <a href="${escapeHtml(hRun)}/junit.xml" class="btn">JUnit</a>
                </div>
              </td>
            </tr>`;
}).join('');

const portalTitle = `${projectName ? `${projectName} · ` : ''}Centro de Reportes de Accesibilidad`;

const rootPortalHtml = `<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(portalTitle)}</title>
  <meta name="description" content="${escapeHtml(batchOgDesc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(portalTitle)}" />
  <meta property="og:description" content="${escapeHtml(batchOgDesc)}" />
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <a href="#mainContent" class="skip-link">Saltar al contenido principal</a>

  <nav class="topbar" aria-label="Navegación principal">
    <div class="topbar-inner">
      <div class="breadcrumbs">
        <span class="current" aria-current="page">${escapeHtml(portalTitle)}</span>
      </div>
      <div class="topbar-actions">
        <button type="button" id="btnSharePageUrl" class="btn">Compartir URL</button>
        <a href="latest/findings-consolidated.csv" class="btn btn-primary">Último CSV Maestro Hallazgos (${globalIdx})</a>
        <a href="latest/wcag-matrix.csv" class="btn">Última Matriz WCAG (CSV)</a>
        <a href="latest/summary.csv" class="btn">Último Resumen URLs (CSV)</a>
        <a href="latest/junit.xml" class="btn">Último JUnit XML</a>
        <button type="button" id="btnToggleTheme" class="btn" aria-label="Alternar tema claro u oscuro">Tema oscuro</button>
      </div>
    </div>
  </nav>

  <main id="mainContent">
    <header class="hero-card">
      <div>
        <div class="hero-eyebrow">
          <span>${escapeHtml(projectName || 'A11Y Audit Hub')}</span>
          <span>&middot;</span>
          <span>WCAG 2.2 Automation</span>
        </div>
        <h1>Centro de Reportes de Accesibilidad Web</h1>
        <div class="meta">
          Última ejecución registrada: <strong>${escapeHtml(fecha)}</strong> (Lote <code>${escapeHtml(runId)}</code> &middot; ${escapeHtml(standard)} &middot; ${escapeHtml(runnersLabel)}${auditorName ? ` &middot; Auditor: <strong>${escapeHtml(auditorName)}</strong>` : ''})
        </div>
      </div>
      <a href="${escapeHtml(runId)}/index.html" class="btn btn-primary">Abrir Dashboard del último lote &rarr;</a>
    </header>

    <section class="kpi-grid" aria-label="Resumen de la última ejecución">
      <div class="kpi-card">
        <div class="kpi-label">URLs en Último Lote</div>
        <div class="kpi-value">${totalUrls}</div>
        <span class="kpi-sub">Ejecución ${escapeHtml(runId)}</span>
      </div>
      <div class="kpi-card kpi-err">
        <div class="kpi-label">Errores WCAG</div>
        <div class="kpi-value" style="color: var(--err);">${totalErrors}</div>
        ${deltaBadgeHtml}
      </div>
      <div class="kpi-card kpi-warn">
        <div class="kpi-label">Advertencias</div>
        <div class="kpi-value" style="color: var(--warn);">${totalWarnings}</div>
        <span class="kpi-sub">Puntos de revisión manual</span>
      </div>
      <div class="kpi-card kpi-axe">
        <div class="kpi-label">axe-core</div>
        <div class="kpi-value">${totalAxe}</div>
        <span class="kpi-sub">Reglas Deque axe-core</span>
      </div>
      <div class="kpi-card kpi-htmlcs">
        <div class="kpi-label">HTML_CodeSniffer</div>
        <div class="kpi-value">${totalHtmlcs}</div>
        <span class="kpi-sub">Técnicas W3C HTMLCS</span>
      </div>
    </section>

    <section class="table-card" aria-label="Resultados de la última ejecución">
      <div class="table-toolbar">
        <span class="table-toolbar-title">Último lote ejecutado (${escapeHtml(fecha)})</span>
        <input id="searchUrlInput" type="search" class="table-search" placeholder="Filtrar URLs del último lote..." aria-label="Filtrar URLs del último lote" />
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Sitio Auditado</th>
            <th scope="col">Estado y Proporción</th>
            <th scope="col">Errores</th>
            <th scope="col">Advertencias</th>
            <th scope="col">Motores</th>
            <th scope="col">Evidencia</th>
            <th scope="col">Vistas del Reporte</th>
          </tr>
        </thead>
        <tbody>${buildUrlRows(`${runId}/`)}
        </tbody>
      </table>
    </section>

    <h2 class="section-title">Historial de lotes ejecutados (${historyLines.length})</h2>
    <section class="table-card" aria-label="Historial cronológico de ejecuciones">
      <table>
        <thead>
          <tr>
            <th scope="col">Fecha y Lote</th>
            <th scope="col">Estándar</th>
            <th scope="col">Motores</th>
            <th scope="col">URLs</th>
            <th scope="col">Errores WCAG</th>
            <th scope="col">Advertencias</th>
            <th scope="col">Artefactos</th>
          </tr>
        </thead>
        <tbody>${historyRowsHtml}
        </tbody>
      </table>
    </section>
  </main>
  ${MODAL_AND_SCRIPT}
</body>
</html>`;

fs.writeFileSync(path.join(artifactsRoot, 'index.html'), rootPortalHtml + '\n', 'utf8');

if (fs.existsSync(jsonlPath)) {
	fs.unlinkSync(jsonlPath);
}
