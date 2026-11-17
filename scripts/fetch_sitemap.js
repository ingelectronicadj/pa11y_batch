#!/usr/bin/env node
/**
 * Descargador y extractor ligero de URLs desde un sitemap.xml (soporta <urlset> y <sitemapindex>).
 * Uso: node scripts/fetch_sitemap.js <sitemap_url> <out_urls_txt> [max_urls]
 */
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');

const [, , sitemapUrl, outPath, maxUrlsStr = '25'] = process.argv;
const maxUrls = Math.max(1, Math.min(200, parseInt(maxUrlsStr, 10) || 25));

if (!sitemapUrl || !outPath) {
	console.error('Uso: node scripts/fetch_sitemap.js <sitemap_url> <out_urls_txt> [max_urls]');
	process.exit(1);
}

function fetchUrlText (target, redirects = 0) {
	return new Promise((resolve, reject) => {
		if (redirects > 5) return reject(new Error('Demasiadas redirecciones al leer sitemap'));
		const u = new URL(target);
		const client = u.protocol === 'https:' ? https : http;
		const req = client.get(u, { timeout: 15000, headers: { 'User-Agent': 'Pa11yBatchSitemap/0.5' } }, (res) => {
			if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
				const next = new URL(res.headers.location, u).toString();
				res.resume();
				return resolve(fetchUrlText(next, redirects + 1));
			}
			if (res.statusCode < 200 || res.statusCode >= 300) {
				res.resume();
				return reject(new Error(`HTTP ${res.statusCode} al descargar ${target}`));
			}
			let data = '';
			res.setEncoding('utf8');
			res.on('data', c => { data += c; });
			res.on('end', () => resolve(data));
		});
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy(new Error(`Timeout al descargar ${target}`));
		});
	});
}

function slugFromUrl (urlStr, idx) {
	try {
		const u = new URL(urlStr);
		const p = u.pathname.replace(/^\/+|\/+$/g, '');
		if (!p) return u.hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
		const cleaned = p.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 44);
		return cleaned || `pagina-${idx + 1}`;
	} catch {
		return `pagina-${idx + 1}`;
	}
}

function extractLocs (xml) {
	const locs = [];
	const re = /<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi;
	let m;
	while ((m = re.exec(xml)) !== null) {
		const raw = m[1].trim().replace(/&amp;/g, '&');
		if (/^https?:\/\//i.test(raw)) locs.push(raw);
	}
	return locs;
}

(async () => {
	try {
		const rootXml = await fetchUrlText(sitemapUrl);
		let pageUrls = [];

		if (/<sitemapindex/i.test(rootXml)) {
			const childSitemaps = extractLocs(rootXml).slice(0, 5);
			for (const sm of childSitemaps) {
				if (pageUrls.length >= maxUrls) break;
				try {
					const subXml = await fetchUrlText(sm);
					pageUrls.push(...extractLocs(subXml));
				} catch {
					// Continuar con el siguiente sub-sitemap
				}
			}
		} else {
			pageUrls = extractLocs(rootXml);
		}

		const uniqueUrls = Array.from(new Set(pageUrls)).slice(0, maxUrls);
		if (uniqueUrls.length === 0) {
			console.error(`No se encontraron etiquetas <loc> válidas en ${sitemapUrl}`);
			process.exit(1);
		}

		const used = new Set();
		const lines = uniqueUrls.map((u, i) => {
			let base = slugFromUrl(u, i);
			let alias = base;
			let n = 2;
			while (used.has(alias)) {
				alias = `${base}-${n++}`;
			}
			used.add(alias);
			return `${alias}|${u}`;
		});

		fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
		console.log(lines.length);
	} catch (err) {
		console.error(`Error procesando sitemap: ${err.message}`);
		process.exit(1);
	}
})();
