#!/usr/bin/env node
/**
 * Extractor de Evidencia Visual, Recortes del Elemento (Close-Up Crops),
 * Coordenadas DOM y Colores Computados para Pa11y Batch.
 * Abre la URL evaluada con Puppeteer, toma captura de página completa (fullPage) y
 * enriquece cada hallazgo con `visualMeta`:
 *   { x, y, width, height, docWidth, docHeight, visible, fgHex, bgHex, fontSize, sampleText, cropDataUrl, boxLeftPct, boxTopPct, boxWidthPct, boxHeightPct }
 *
 * Uso:
 *   node scripts/capture_visual_coords.js <url> <raw_json_path> <capture_png_path> <wait_ms>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const [
	,
	,
	targetUrl,
	rawJsonPath,
	capturePngPath = '',
	waitMsStr = '2500'
] = process.argv;

if (!targetUrl || !rawJsonPath || !fs.existsSync(rawJsonPath)) {
	process.exit(0);
}

let issues = [];
try {
	issues = JSON.parse(fs.readFileSync(rawJsonPath, 'utf8'));
} catch {
	process.exit(0);
}

if (!Array.isArray(issues)) {
	process.exit(0);
}

function loadPuppeteer () {
	const candidates = [
		path.join(process.env.HOME || '', '.npm-global/lib/node_modules/pa11y/node_modules/puppeteer'),
		'/usr/local/lib/node_modules/pa11y/node_modules/puppeteer',
		'/usr/lib/node_modules/pa11y/node_modules/puppeteer',
		'puppeteer'
	];
	for (const c of candidates) {
		try {
			return require(c);
		} catch {
			// Siguiente candidato
		}
	}
	return null;
}

const puppeteer = loadPuppeteer();
if (!puppeteer) {
	process.exit(0);
}

(async () => {
	let browser = null;
	try {
		const launchOpts = {
			headless: 'new',
			defaultViewport: { width: 1440, height: 900 },
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
		};
		if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
			launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
		} else if (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) {
			launchOpts.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
		}

		browser = await puppeteer.launch(launchOpts);
		const page = await browser.newPage();
		await page.setViewport({ width: 1440, height: 900 });
		await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

		const waitMs = Math.min(Math.max(parseInt(waitMsStr, 10) || 2000, 500), 10000);
		await new Promise(r => setTimeout(r, waitMs));

		if (capturePngPath) {
			await page.screenshot({ path: capturePngPath, fullPage: true }).catch(() => {});
		}

		const uniqueSelectors = Array.from(new Set(issues.map(i => i.selector).filter(Boolean)));

		const coordsMap = await page.evaluate((selectors) => {
			function rgbToHex (rgbStr) {
				if (!rgbStr) return '';
				const m = rgbStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i);
				if (!m) return '';
				const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
				if (alpha === 0) return 'transparent';
				const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
				const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
				const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
				return `#${r}${g}${b}`.toUpperCase();
			}

			function resolveEffectiveBgHex (el) {
				let cur = el;
				while (cur && cur !== document.documentElement) {
					const bg = window.getComputedStyle(cur).backgroundColor;
					const hex = rgbToHex(bg);
					if (hex && hex !== 'transparent') {
						return hex;
					}
					cur = cur.parentElement;
				}
				return '#FFFFFF';
			}

			const docWidth = Math.max(
				document.documentElement.scrollWidth || 1440,
				document.body ? document.body.scrollWidth : 1440,
				1440
			);
			const docHeight = Math.max(
				document.documentElement.scrollHeight || 900,
				document.body ? document.body.scrollHeight : 900,
				900
			);

			const result = {};
			for (const sel of selectors) {
				try {
					const el = document.querySelector(sel);
					if (!el) continue;
					const r = el.getBoundingClientRect();
					const cs = window.getComputedStyle(el);
					const x = Math.round(r.left + window.scrollX);
					const y = Math.round(r.top + window.scrollY);
					const width = Math.round(r.width);
					const height = Math.round(r.height);
					const visible = width >= 2 && height >= 2 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0 && x >= 0 && y >= 0 && x < docWidth && y < docHeight;
					const fgHex = rgbToHex(cs.color) || '#18181B';
					const bgHex = resolveEffectiveBgHex(el);
					const rawText = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();

					result[sel] = {
						x: Math.max(0, x),
						y: Math.max(0, y),
						width,
						height,
						docWidth,
						docHeight,
						visible,
						fgHex,
						bgHex,
						fontSize: cs.fontSize || '16px',
						sampleText: rawText.slice(0, 80)
					};
				} catch {
					// Selector no encontrado
				}
			}
			return result;
		}, uniqueSelectors);

		// Capturar recorte visual contextual (close-up JPEG) para cada selector visible único
		let cropsCount = 0;
		for (const sel of uniqueSelectors) {
			const meta = coordsMap[sel];
			if (!meta || !meta.visible || cropsCount >= 80) continue;
			try {
				const padX = 48;
				const padY = 32;
				const clipX = Math.max(0, meta.x - padX);
				const clipY = Math.max(0, meta.y - padY);
				const clipW = Math.min(Math.max(meta.width + padX * 2, 180), Math.min(560, meta.docWidth - clipX));
				const clipH = Math.min(Math.max(meta.height + padY * 2, 90), Math.min(220, meta.docHeight - clipY));

				if (clipW > 20 && clipH > 20) {
					const b64 = await page.screenshot({
						encoding: 'base64',
						type: 'jpeg',
						quality: 68,
						clip: { x: clipX, y: clipY, width: clipW, height: clipH }
					});
					meta.cropDataUrl = `data:image/jpeg;base64,${b64}`;
					meta.boxLeftPct = Math.max(0, Math.min(96, Math.round(((meta.x - clipX) / clipW) * 100)));
					meta.boxTopPct = Math.max(0, Math.min(94, Math.round(((meta.y - clipY) / clipH) * 100)));
					meta.boxWidthPct = Math.max(4, Math.min(100 - meta.boxLeftPct, Math.round((meta.width / clipW) * 100)));
					meta.boxHeightPct = Math.max(8, Math.min(100 - meta.boxTopPct, Math.round((meta.height / clipH) * 100)));
					cropsCount += 1;
				}
			} catch {
				// Ignorar recorte fuera de rango
			}
		}

		const enriched = issues.map(issue => {
			if (issue.selector && coordsMap[issue.selector]) {
				return {
					...issue,
					visualMeta: coordsMap[issue.selector]
				};
			}
			return issue;
		});

		fs.writeFileSync(rawJsonPath, JSON.stringify(enriched), 'utf8');
	} catch {
		// Continuar sin bloquear
	} finally {
		if (browser) {
			await browser.close().catch(() => {});
		}
	}
})();
