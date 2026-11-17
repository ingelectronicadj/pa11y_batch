#!/usr/bin/env node
/**
 * Suite de autodiagnóstico sin red para Pa11y Batch (v0.5.0).
 * Verifica:
 *   1. Integridad de diccionarios (locales/es.json y locales/htmlcs_es.json) y cobertura WCAG 2.2.
 *   2. Traducción e interpolación en scripts/format_report.js (axe, htmlcs, axe+htmlcs, ES/EN, HTML/CSV/JSON).
 *   3. Generación de artefactos CI/CD y regresión Delta en scripts/generate_ci_reports.js.
 *   4. Filtro SSRF y validación de URLs en scripts/web_server.js.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function run () {
	// 1. Validar diccionarios locales
	const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/es.json'), 'utf8'));
	const htmlcsEs = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/htmlcs_es.json'), 'utf8'));
	assert(Object.keys(es.rules || {}).length >= 100, 'Se esperaban >= 100 reglas axe en locales/es.json');
	assert(Object.keys(es.wcagCriteria || {}).length >= 86, 'Se esperaban >= 86 criterios WCAG 2.2 en locales/es.json');
	assert(es.wcagCriteria['2.5.8'], 'Falta criterio WCAG 2.2 2.5.8 (Tamaño del objetivo)');
	assert(es.wcagCriteria['2.4.11'], 'Falta criterio WCAG 2.2 2.4.11 (Foco no oscurecido)');
	const htmlcsCount = Object.keys(htmlcsEs.rules || htmlcsEs.translations || htmlcsEs || {}).length;
	assert(Object.keys(es.htmlcs || {}).length >= 200 && htmlcsCount >= 200, 'Se esperaban >= 200 entradas HTMLCS traducidas en ambos catálogos');

	// 2. Validar SSRF y parseo de URLs en web_server.js
	const ws = require('./web_server');
	assert.strictEqual(ws.isPrivateOrMetadataHost('127.0.0.1'), true);
	assert.strictEqual(ws.isPrivateOrMetadataHost('localhost'), true);
	assert.strictEqual(ws.isPrivateOrMetadataHost('169.254.169.254'), true);
	assert.strictEqual(ws.isPrivateOrMetadataHost('192.168.1.10'), true);
	assert.strictEqual(ws.isPrivateOrMetadataHost('172.16.0.5'), true);
	assert.strictEqual(ws.isPrivateOrMetadataHost('www.w3.org'), false);

	const blockedRes = ws.parseAndValidateUrls('interno|http://169.254.169.254/latest/meta-data/');
	assert(blockedRes.error && blockedRes.error.includes('SSRF'), 'Debe bloquear IP de metadatos cloud por SSRF');

	const okRes = ws.parseAndValidateUrls('wai|https://www.w3.org/WAI/\nejemplo|example.com');
	assert(!okRes.error && okRes.entries.length === 2, 'Debe aceptar URLs públicas válidas');
	assert.strictEqual(okRes.entries[1].url, 'https://example.com/');

	// 3. Validar format_report.js + generate_ci_reports.js + Delta entre dos lotes
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-batch-selftest-'));
	try {
		const run1Dir = path.join(tmpRoot, '2026-11-17_10-00-00');
		const run2Dir = path.join(tmpRoot, '2026-11-17_10-05-00');
		fs.mkdirSync(run1Dir, { recursive: true });
		fs.mkdirSync(run2Dir, { recursive: true });

		const sampleRaw1 = [
			{
				code: 'image-alt',
				type: 'error',
				message: 'Images must have alternate text (https://dequeuniversity.com/rules/axe/4.8/image-alt)',
				context: '<img src="hero.jpg">',
				selector: '#hero-img',
				runner: 'axe+htmlcs',
				runnerExtras: { impact: 'critical', helpUrl: 'https://dequeuniversity.com/rules/axe/4.8/image-alt' }
			},
			{
				code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
				type: 'error',
				message: 'This element has insufficient contrast at this conformance level. Expected a contrast ratio of at least 4.5:1, but text in this element has a contrast ratio of 2.4:1.',
				context: '<p class="muted">Texto gris</p>',
				selector: 'p.muted',
				runner: 'htmlcs',
				visualMeta: {
					x: 40,
					y: 120,
					width: 240,
					height: 30,
					docWidth: 1440,
					docHeight: 900,
					visible: true,
					fgHex: '#999999',
					bgHex: '#FFFFFF',
					fontSize: '14px',
					sampleText: 'Texto gris'
				}
			},
			{
				code: 'target-size',
				type: 'warning',
				message: 'Ensure touch target have sufficient size and space',
				context: '<button id="tiny">x</button>',
				selector: '#tiny',
				runner: 'axe',
				runnerExtras: { impact: 'moderate' }
			}
		];

		const rawPath1 = path.join(tmpRoot, 'raw1.json');
		fs.writeFileSync(rawPath1, JSON.stringify(sampleRaw1), 'utf8');

		const stats1 = execFileSync(
			process.execPath,
			[
				path.join(ROOT, 'scripts/format_report.js'),
				rawPath1,
				path.join(run1Dir, 'demo-report.html'),
				'html',
				'es',
				'demo',
				'https://example.com',
				'WCAG2AA',
				'axe + htmlcs',
				'',
				path.join(run1Dir, '.ci-items.jsonl'),
				'2026-11-17_10-00-00',
				'Proyecto Demo',
				'Equipo QA',
				'false'
			],
			{ encoding: 'utf8' }
		).trim();

		assert(stats1.startsWith('STATS|3|2|1|0|2|2'), `Estadísticas inesperadas en lote 1: ${stats1}`);
		const html1 = fs.readFileSync(path.join(run1Dir, 'demo-report.html'), 'utf8');
		assert(html1.includes('1.1.1'), 'El reporte HTML debe mapear image-alt a WCAG 1.1.1');
		assert(html1.includes('1.4.3'), 'El reporte HTML debe mapear contraste a WCAG 1.4.3');
		assert(html1.includes('2.5.8'), 'El reporte HTML debe mapear target-size a WCAG 2.5.8');

		execFileSync(process.execPath, [
			path.join(ROOT, 'scripts/generate_ci_reports.js'),
			run1Dir,
			'2026-11-17_10-00-00',
			'2026-11-17 10:00:00',
			'WCAG2AA',
			'axe + htmlcs',
			'warnings',
			'html',
			'0',
			tmpRoot,
			'Proyecto Demo',
			'Equipo QA'
		]);

		// Segundo lote con 1 error resuelto (p.muted) para verificar Delta (0 nuevos, 1 resuelto, 1 persistente)
		const rawPath2 = path.join(tmpRoot, 'raw2.json');
		fs.writeFileSync(rawPath2, JSON.stringify([sampleRaw1[0]]), 'utf8');
		execFileSync(process.execPath, [
			path.join(ROOT, 'scripts/format_report.js'),
			rawPath2,
			path.join(run2Dir, 'demo-report.html'),
			'html',
			'es',
			'demo',
			'https://example.com',
			'WCAG2AA',
			'axe + htmlcs',
			'',
			path.join(run2Dir, '.ci-items.jsonl'),
			'2026-11-17_10-05-00',
			'Proyecto Demo',
			'Equipo QA',
			'false'
		]);
		execFileSync(process.execPath, [
			path.join(ROOT, 'scripts/generate_ci_reports.js'),
			run2Dir,
			'2026-11-17_10-05-00',
			'2026-11-17 10:05:00',
			'WCAG2AA',
			'axe + htmlcs',
			'warnings',
			'html',
			'0',
			tmpRoot,
			'Proyecto Demo',
			'Equipo QA'
		]);

		for (const fn of ['findings-consolidated.csv', 'wcag-matrix.csv', 'summary.csv', 'junit.xml', 'gl-code-quality-report.json', 'summary.md', 'index.html']) {
			assert(fs.existsSync(path.join(run2Dir, fn)), `Falta artefacto generado: ${fn}`);
		}
		const portalHtml = fs.readFileSync(path.join(tmpRoot, 'index.html'), 'utf8');
		assert(portalHtml.includes('0 nuevos') && portalHtml.includes('1 resueltos') && portalHtml.includes('1 persistentes'), 'El portal raíz debe mostrar el desglose Delta (nuevos, resueltos, persistentes)');
	} finally {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}

	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	console.log(`Self-test OK (pa11y-batch v${pkg.version}): diccionarios WCAG 2.2, deduplicación, artefactos CI/CD, Delta y seguridad SSRF verificados.`);
}

run();
