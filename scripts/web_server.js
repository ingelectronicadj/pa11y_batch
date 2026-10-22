#!/usr/bin/env node
/**
 * Pa11y Batch Web Studio - Servidor interactivo para auditar URLs y descargar reportes WCAG 2.2
 * Sin dependencias externas: usa únicamente módulos nativos de Node.js (http, fs, path, child_process, url).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT_DIR, 'artifacts');
const BATCH_SCRIPT = path.join(ROOT_DIR, 'pa11y_batch.sh');

function parseCliPort () {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      const p = parseInt(args[i + 1], 10);
      if (p > 0 && p < 65536) return p;
    }
  }
  return parseInt(process.env.PORT || '8098', 10);
}

const PORT = parseCliPort();
const jobs = new Map();

function ensureArtifactsDir () {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

function slugifyAlias (rawAlias, fallbackUrl, index) {
  if (rawAlias && String(rawAlias).trim()) {
    const cleaned = String(rawAlias)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    if (cleaned) return cleaned;
  }
  try {
    const u = new URL(fallbackUrl);
    const hostPart = u.hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-');
    const pathPart = u.pathname && u.pathname !== '/'
      ? '-' + u.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24)
      : '';
    const candidate = (hostPart + pathPart).toLowerCase().replace(/^-+|-+$/g, '');
    return candidate || ('sitio-' + (index + 1));
  } catch (_e) {
    return 'sitio-' + (index + 1);
  }
}

function parseAndValidateUrls (urlsText) {
  const lines = String(urlsText || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (lines.length === 0) {
    return { error: 'Debes ingresar al menos una URL válida (con http:// o https://).' };
  }
  if (lines.length > 30) {
    return { error: 'Por seguridad, el máximo por lote desde la interfaz web es de 30 URLs.' };
  }

  const parsed = [];
  const usedAliases = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let rawAlias = '';
    let rawUrl = line;

    if (line.includes('|')) {
      const parts = line.split('|');
      rawAlias = parts[0].trim();
      rawUrl = parts.slice(1).join('|').trim();
    }

    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = 'https://' + rawUrl;
    }

    let validUrl;
    try {
      validUrl = new URL(rawUrl);
      if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
        return { error: `Protocolo no permitido en la línea ${i + 1}: ${rawUrl}` };
      }
    } catch (_e) {
      return { error: `URL inválida en la línea ${i + 1}: "${line}"` };
    }

    let baseAlias = slugifyAlias(rawAlias, validUrl.toString(), i);
    let finalAlias = baseAlias;
    let counter = 2;
    while (usedAliases.has(finalAlias)) {
      finalAlias = `${baseAlias}-${counter}`;
      counter++;
    }
    usedAliases.add(finalAlias);

    parsed.push({
      alias: finalAlias,
      url: validUrl.toString()
    });
  }

  return { entries: parsed };
}

function parseCsvLine (line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function readRunDetails (runId) {
  const safeId = path.basename(String(runId || ''));
  if (!safeId || safeId.startsWith('.')) return null;
  const runDir = path.join(ARTIFACTS_DIR, safeId);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) return null;

  const summaryCsvPath = path.join(runDir, 'summary.csv');
  const items = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalNotices = 0;
  let totalAxe = 0;
  let totalHtmlcs = 0;

  if (fs.existsSync(summaryCsvPath)) {
    const rawCsv = fs.readFileSync(summaryCsvPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = rawCsv.split(/\r?\n/).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 10) continue;

      let alias = '';
      let url = '';
      let status = '';
      let eCount = 0;
      let wCount = 0;
      let nCount = 0;
      let aCount = 0;
      let hCount = 0;

      if (cols.length >= 20) {
        // Nuevo formato enriquecido de 25 columnas generado por generate_ci_reports.js
        alias = cols[2];
        url = cols[3];
        status = cols[6];
        eCount = Number(cols[8] || 0);
        wCount = Number(cols[9] || 0);
        nCount = Number(cols[10] || 0);
        aCount = Number(cols[15] || 0);
        hCount = Number(cols[16] || 0);
      } else {
        // Formato base de 11 columnas
        alias = cols[0];
        url = cols[1];
        status = cols[2];
        eCount = Number(cols[3] || 0);
        wCount = Number(cols[4] || 0);
        nCount = Number(cols[5] || 0);
        aCount = Number(cols[6] || 0);
        hCount = Number(cols[7] || 0);
      }

      totalErrors += eCount;
      totalWarnings += wCount;
      totalNotices += nCount;
      totalAxe += aCount;
      totalHtmlcs += hCount;

      const htmlReportName = `${alias}-report.html`;
      const hasHtml = fs.existsSync(path.join(runDir, htmlReportName));
      const siteCsvName = `${alias}-findings.csv`;
      const hasSiteCsv = fs.existsSync(path.join(runDir, siteCsvName));
      const captureName = `${alias}-capture.png`;
      const hasCapture = fs.existsSync(path.join(runDir, captureName));

      items.push({
        alias,
        url,
        status: status || 'Completado',
        errorsCount: eCount,
        warningsCount: wCount,
        noticesCount: nCount,
        axeCount: aCount,
        htmlcsCount: hCount,
        reportUrl: hasHtml ? `/artifacts/${safeId}/${htmlReportName}` : null,
        downloadHtmlUrl: hasHtml ? `/artifacts/${safeId}/${htmlReportName}?download=1` : null,
        downloadCsvUrl: hasSiteCsv ? `/artifacts/${safeId}/${siteCsvName}?download=1` : null,
        executiveUrl: hasHtml ? `/artifacts/${safeId}/${htmlReportName}?view=executive` : null,
        technicalUrl: hasHtml ? `/artifacts/${safeId}/${htmlReportName}?view=technical` : null,
        captureUrl: hasCapture ? `/artifacts/${safeId}/${captureName}` : null
      });
    }
  }

  const files = fs.readdirSync(runDir);
  return {
    runId: safeId,
    dashboardUrl: files.includes('index.html') ? `/artifacts/${safeId}/index.html` : null,
    findingsCsvUrl: files.includes('findings-consolidated.csv') ? `/artifacts/${safeId}/findings-consolidated.csv?download=1` : null,
    wcagMatrixCsvUrl: files.includes('wcag-matrix.csv') ? `/artifacts/${safeId}/wcag-matrix.csv?download=1` : null,
    summaryCsvUrl: files.includes('summary.csv') ? `/artifacts/${safeId}/summary.csv?download=1` : null,
    junitXmlUrl: files.includes('junit.xml') ? `/artifacts/${safeId}/junit.xml?download=1` : null,
    gitlabJsonUrl: files.includes('gl-code-quality-report.json') ? `/artifacts/${safeId}/gl-code-quality-report.json?download=1` : null,
    summaryMdUrl: files.includes('summary.md') ? `/artifacts/${safeId}/summary.md?download=1` : null,
    zipUrl: `/api/runs/${safeId}/zip`,
    totals: {
      urls: items.length,
      errors: totalErrors,
      warnings: totalWarnings,
      notices: totalNotices,
      axe: totalAxe,
      htmlcs: totalHtmlcs
    },
    items
  };
}

function listRecentRuns () {
  ensureArtifactsDir();
  const entries = fs.readdirSync(ARTIFACTS_DIR, { withFileTypes: true });
  const runs = [];

  for (const d of entries) {
    if (!d.isDirectory() || d.name === 'latest' || d.name.startsWith('.')) continue;
    const details = readRunDetails(d.name);
    if (details && details.items.length > 0) {
      const stat = fs.statSync(path.join(ARTIFACTS_DIR, d.name));
      runs.push({
        runId: d.name,
        mtimeMs: stat.mtimeMs,
        ...details
      });
    }
  }

  runs.sort((a, b) => b.runId.localeCompare(a.runId));
  return runs.slice(0, 25);
}

function broadcastJobEvent (job, eventType, payload) {
  const dataStr = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of job.clients) {
    try {
      res.write(dataStr);
    } catch (_e) {
      // Ignorado
    }
  }
}

function startAuditJob (body) {
  const validation = parseAndValidateUrls(body.urlsText);
  if (validation.error) {
    return { error: validation.error };
  }

  const validStandards = ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'];
  const validRunners = ['ambos', 'axe', 'htmlcs'];
  const validLevels = ['errors', 'warnings', 'notices'];
  const validLangs = ['es', 'en'];

  const standard = validStandards.includes(body.standard) ? body.standard : 'WCAG2AA';
  const runners = validRunners.includes(body.runners) ? body.runners : 'ambos';
  const level = validLevels.includes(body.level) ? body.level : 'warnings';
  const lang = validLangs.includes(body.lang) ? body.lang : 'es';
  const screenshot = body.screenshot === 'no' ? 'no' : 'si';
  const standalone = body.standalone !== false;
  const waitMs = Math.max(0, Math.min(30000, parseInt(body.wait || '2500', 10) || 2500));
  const project = String(body.project || '').replace(/[\r\n"]/g, '').trim().slice(0, 80);
  const auditor = String(body.auditor || '').replace(/[\r\n"]/g, '').trim().slice(0, 80);
  const rootSelector = String(body.root || '').replace(/[\r\n"]/g, '').trim().slice(0, 120);
  const hideSelectors = String(body.hide || '').replace(/[\r\n"]/g, '').trim().slice(0, 200);

  const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const tmpUrlsFile = path.join(os.tmpdir(), `pa11y-web-${jobId}.txt`);
  const fileContent = validation.entries.map(e => `${e.alias}|${e.url}`).join('\n') + '\n';
  fs.writeFileSync(tmpUrlsFile, fileContent, 'utf8');

  const args = [
    BATCH_SCRIPT,
    '--urls', tmpUrlsFile,
    '--format', 'html',
    '--standard', standard,
    '--runners', runners,
    '--level', level,
    '--lang', lang,
    '--wait', String(waitMs),
    '--screenshot', screenshot
  ];

  if (standalone) args.push('--standalone');
  if (project) args.push('--project', project);
  if (auditor) args.push('--auditor', auditor);
  if (rootSelector) args.push('--root', rootSelector);
  if (hideSelectors) args.push('--hide', hideSelectors);

  const job = {
    jobId,
    status: 'running',
    createdAt: Date.now(),
    entries: validation.entries,
    logs: [],
    runId: null,
    result: null,
    clients: new Set()
  };
  jobs.set(jobId, job);

  const child = spawn('bash', args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PATH: `${path.join(os.homedir(), '.npm-global/bin')}:${process.env.PATH || ''}`
    }
  });
  job.child = child;

  function processOutputChunk (chunk) {
    const lines = String(chunk).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      job.logs.push(line);
      const idMatch = line.match(/ID de ejecuci[oó]n\s*:\s*([0-9_-]+)/i);
      if (idMatch && idMatch[1]) {
        job.runId = idMatch[1].trim();
      }
      broadcastJobEvent(job, 'log', { line, runId: job.runId });
    }
  }

  child.stdout.on('data', processOutputChunk);
  child.stderr.on('data', processOutputChunk);

  child.on('close', (code) => {
    try {
      fs.unlinkSync(tmpUrlsFile);
    } catch (_e) {
      // Ignorado
    }

    let details = job.runId ? readRunDetails(job.runId) : null;
    if (!details) {
      const latestRuns = listRecentRuns();
      if (latestRuns.length > 0) {
        details = latestRuns[0];
        job.runId = details.runId;
      }
    }

    const hasValidReports = Boolean(
      details &&
      Array.isArray(details.items) &&
      details.items.some(it => it.reportUrl && !String(it.status || '').toLowerCase().includes('fall'))
    );
    job.status = hasValidReports ? 'completed' : 'failed';
    job.exitCode = code;
    job.result = details;

    broadcastJobEvent(job, 'done', {
      status: job.status,
      runId: job.runId,
      result: details
    });

    for (const res of job.clients) {
      try {
        res.end();
      } catch (_e) {
        // Ignorado
      }
    }
    job.clients.clear();
  });

  return { jobId, entries: validation.entries };
}

function getMimeType (filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.csv': return 'text/csv; charset=utf-8';
    case '.tsv': return 'text/tab-separated-values; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.xml': return 'application/xml; charset=utf-8';
    case '.md': return 'text/markdown; charset=utf-8';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function serveArtifactFile (req, res, relPath, forceDownload) {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(ARTIFACTS_DIR, normalized);
  if (!fullPath.startsWith(ARTIFACTS_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acceso denegado');
    return;
  }

  let targetFile = fullPath;
  if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
    targetFile = path.join(targetFile, 'index.html');
  }

  if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Archivo no encontrado');
    return;
  }

  const headers = {
    'Content-Type': getMimeType(targetFile),
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  };
  if (forceDownload) {
    const filename = path.basename(targetFile);
    headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  }

  res.writeHead(200, headers);
  fs.createReadStream(targetFile).pipe(res);
}

function renderStudioHtml () {
  return `<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pa11y Batch Web Studio - Auditoría WCAG 2.2 y Descarga de Reportes</title>
  <meta name="description" content="Plataforma interactiva para evaluar la accesibilidad web (WCAG 2.2 A/AA/AAA) de cualquier URL o lote de URLs con axe-core y HTML_CodeSniffer, y descargar reportes ejecutivos para Stakeholders, CSV y JUnit." />
  <style>
    :root {
      --bg: #f1f5f9;
      --surface: #ffffff;
      --surface-alt: #f8fafc;
      --text: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
      --primary: #0f52ba;
      --primary-hover: #0a3d8f;
      --primary-fg: #ffffff;
      --accent-soft: #eff6ff;
      --ok-bg: #f0fdf4;
      --ok-text: #166534;
      --ok-border: #86efac;
      --err-bg: #fef2f2;
      --err-text: #991b1b;
      --err-border: #fca5a5;
      --warn-bg: #fffbeb;
      --warn-text: #92400e;
      --warn-border: #fcd34d;
      --focus-ring: #f59e0b;
      --shadow: 0 4px 18px rgba(15, 23, 42, 0.06);
    }
    html[data-theme="dark"] {
      --bg: #0b1120;
      --surface: #111827;
      --surface-alt: #1e293b;
      --text: #f8fafc;
      --muted: #cbd5e1;
      --border: #334155;
      --primary: #38bdf8;
      --primary-hover: #7dd3fc;
      --primary-fg: #082f49;
      --accent-soft: #172554;
      --ok-bg: #052e16;
      --ok-text: #86efac;
      --ok-border: #166534;
      --err-bg: #450a0a;
      --err-text: #fca5a5;
      --err-border: #991b1b;
      --warn-bg: #451a03;
      --warn-text: #fcd34d;
      --warn-border: #92400e;
      --shadow: 0 8px 26px rgba(0, 0, 0, 0.4);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .skip-link {
      position: absolute;
      top: -100px;
      left: 16px;
      background: var(--primary);
      color: var(--primary-fg);
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 700;
      z-index: 1000;
      text-decoration: none;
    }
    .skip-link:focus { top: 12px; outline: 3px solid var(--focus-ring); }
    a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible {
      outline: 3px solid var(--focus-ring);
      outline-offset: 2px;
    }
    .sr-only {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
      background-color: #ffffff !important;
      color: #0f172a !important;
    }
    header.top-nav {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 14px 24px;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .nav-inner {
      max-width: 1360px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .brand-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-badge {
      background: var(--primary);
      color: var(--primary-fg);
      font-weight: 800;
      font-size: 0.78rem;
      padding: 4px 10px;
      border-radius: 6px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .brand-title {
      font-size: 1.15rem;
      font-weight: 800;
      margin: 0;
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .btn {
      background: var(--surface-alt);
      color: var(--text);
      border: 1.5px solid var(--border);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .btn:hover { border-color: var(--primary); }
    .btn-primary {
      background: var(--primary);
      color: var(--primary-fg);
      border-color: var(--primary);
      padding: 11px 22px;
      font-size: 0.96rem;
    }
    .btn-primary:hover {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .btn-success {
      background: var(--ok-bg);
      color: var(--ok-text);
      border-color: var(--ok-border);
    }
    .container {
      max-width: 1360px;
      margin: 24px auto 64px;
      padding: 0 20px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .hero-card, .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
      box-shadow: var(--shadow);
    }
    .hero-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 18px;
    }
    .hero-title {
      font-size: 1.5rem;
      font-weight: 800;
      margin: 0 0 6px;
    }
    .hero-subtitle {
      color: var(--muted);
      margin: 0;
      font-size: 0.95rem;
      max-width: 820px;
    }
    .mode-tabs {
      display: inline-flex;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 4px;
      gap: 4px;
      margin-bottom: 18px;
    }
    .mode-tab {
      background: transparent;
      color: var(--text);
      border: 0;
      border-radius: 7px;
      padding: 8px 16px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
    }
    .mode-tab[aria-selected="true"] {
      background: var(--primary);
      color: var(--primary-fg);
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }
    .col-12 { grid-column: span 12; }
    .col-8 { grid-column: span 8; }
    .col-6 { grid-column: span 6; }
    .col-4 { grid-column: span 4; }
    .col-3 { grid-column: span 3; }
    @media (max-width: 900px) {
      .col-8, .col-6, .col-4, .col-3 { grid-column: span 12; }
    }
    label.field-label {
      display: block;
      font-size: 0.86rem;
      font-weight: 700;
      margin-bottom: 6px;
      color: var(--text);
    }
    .field-hint {
      display: block;
      font-size: 0.78rem;
      color: var(--muted);
      margin-top: 4px;
    }
    input[type="url"], input[type="text"], input[type="number"], select, textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1.5px solid var(--border);
      border-radius: 8px;
      background: var(--surface-alt);
      color: var(--text);
      font-size: 0.94rem;
      font-family: inherit;
    }
    textarea {
      min-height: 115px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.88rem;
    }
    .quick-presets {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .preset-chip {
      background: var(--accent-soft);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }
    .preset-chip:hover { border-color: var(--primary); }
    details.advanced-box {
      margin-top: 16px;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 16px;
      background: var(--surface-alt);
    }
    details.advanced-box summary {
      font-weight: 700;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .submit-bar {
      margin-top: 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .checkbox-label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
    }
    .checkbox-label input { width: 17px; height: 17px; }
    .progress-panel {
      display: none;
      margin-top: 20px;
      border: 2px solid var(--primary);
      border-radius: 14px;
      padding: 20px;
      background: var(--surface);
      box-shadow: 0 10px 30px rgba(15, 82, 186, 0.12);
    }
    .progress-panel.is-visible { display: block; }
    .progress-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 14px;
    }
    .progress-title-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .css-spinner {
      width: 22px;
      height: 22px;
      border: 3px solid var(--border);
      border-top-color: var(--primary);
      border-radius: 50%;
      display: inline-block;
      animation: pa11y-spin 0.85s linear infinite;
      flex-shrink: 0;
    }
    .css-spinner.is-done {
      animation: none;
      border-color: #16a34a;
      background: #16a34a;
      position: relative;
    }
    .css-spinner.is-done::after {
      content: "";
      position: absolute;
      left: 5px;
      top: 2px;
      width: 5px;
      height: 9px;
      border: solid #ffffff;
      border-width: 0 2.2px 2.2px 0;
      transform: rotate(45deg);
    }
    .btn-spinner {
      width: 16px;
      height: 16px;
      border: 2.4px solid rgba(255, 255, 255, 0.35);
      border-top-color: currentColor;
      border-radius: 50%;
      display: none;
      animation: pa11y-spin 0.8s linear infinite;
    }
    .btn-primary.is-loading .btn-spinner {
      display: inline-block;
    }
    @keyframes pa11y-spin {
      to { transform: rotate(360deg); }
    }
    .progress-meta-pills {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .timer-pill {
      background: var(--accent-soft);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .progress-bar-track {
      width: 100%;
      height: 12px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .progress-bar-fill {
      height: 100%;
      width: 8%;
      background: linear-gradient(90deg, var(--primary) 0%, #0284c7 50%, #10b981 100%);
      border-radius: 999px;
      transition: width 0.4s ease;
    }
    .stepper-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }
    @media (max-width: 860px) {
      .stepper-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 520px) {
      .stepper-grid { grid-template-columns: 1fr; }
    }
    .step-item {
      border: 1.5px solid var(--border);
      background: var(--surface-alt);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      opacity: 0.65;
      transition: all 0.2s ease;
    }
    .step-item.is-active {
      opacity: 1;
      border-color: var(--primary);
      background: var(--accent-soft);
      box-shadow: 0 0 0 2px rgba(15, 82, 186, 0.15);
    }
    .step-item.is-done {
      opacity: 1;
      border-color: var(--ok-border);
      background: var(--ok-bg);
    }
    .step-item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;
      color: var(--muted);
    }
    .step-item.is-active .step-item-head { color: var(--primary); }
    .step-item.is-done .step-item-head { color: var(--ok-text); }
    .step-item-title {
      font-size: 0.86rem;
      font-weight: 800;
      color: var(--text);
    }
    .step-item-desc {
      font-size: 0.76rem;
      color: var(--muted);
    }
    .live-activity-hint {
      font-size: 0.84rem;
      color: var(--muted);
      margin: 0 0 10px;
      font-weight: 600;
    }
    @media (prefers-reduced-motion: reduce) {
      .css-spinner, .btn-spinner { animation: none !important; }
      .progress-bar-fill { transition: none !important; }
    }
    .log-console {
      background: #0f172a;
      color: #e2e8f0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      padding: 12px;
      border-radius: 8px;
      max-height: 190px;
      overflow-y: auto;
      white-space: pre-wrap;
      margin: 0;
    }
    .results-section {
      display: none;
      flex-direction: column;
      gap: 18px;
    }
    .results-section.is-visible { display: flex; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
      gap: 14px;
    }
    .kpi-box {
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-top: 4px solid var(--primary);
      border-radius: 10px;
      padding: 14px 16px;
    }
    .kpi-box.err { border-top-color: #dc2626; }
    .kpi-box.warn { border-top-color: #d97706; }
    .kpi-box.ok { border-top-color: #16a34a; }
    .kpi-label {
      font-size: 0.76rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--muted);
    }
    .kpi-val {
      font-size: 1.85rem;
      font-weight: 800;
      margin: 4px 0 2px;
    }
    .downloads-bar {
      background: var(--accent-soft);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .downloads-title {
      font-size: 0.96rem;
      font-weight: 800;
      margin: 0;
    }
    .downloads-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .url-results-table-wrap {
      overflow-x: auto;
    }
    table.audit-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    table.audit-table th, table.audit-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    table.audit-table th {
      background: var(--surface-alt);
      font-weight: 800;
      font-size: 0.8rem;
      text-transform: uppercase;
    }
    .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 0.76rem;
      font-weight: 800;
    }
    .badge-ok { background: var(--ok-bg); color: var(--ok-text); border: 1px solid var(--ok-border); }
    .badge-err { background: var(--err-bg); color: var(--err-text); border: 1px solid var(--err-border); }
    .preview-frame-wrap {
      border: 1.5px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      background: #ffffff;
    }
    .preview-toolbar {
      background: var(--surface-alt);
      border-bottom: 1px solid var(--border);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    iframe.report-preview-iframe {
      width: 100%;
      height: 760px;
      border: 0;
      display: block;
      background: #ffffff;
    }
    .error-banner {
      display: none;
      background: var(--err-bg);
      color: var(--err-text);
      border: 1px solid var(--err-border);
      border-radius: 10px;
      padding: 12px 16px;
      margin-top: 14px;
      font-weight: 700;
    }
    .error-banner.is-visible { display: block; }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Saltar al contenido principal</a>
  <div id="sr-announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>

  <header class="top-nav">
    <div class="nav-inner">
      <div class="brand-group">
        <span class="brand-badge">WCAG 2.2 AA</span>
        <h1 class="brand-title">Pa11y Batch Web Studio</h1>
      </div>
      <nav aria-label="Acciones principales">
        <ul class="nav-actions">
          <li><a href="/artifacts/index.html" class="btn">Centro de Reportes Histórico</a></li>
          <li><a href="#history-section" class="btn">Lotes Recientes</a></li>
          <li>
            <button id="theme-toggle-btn" type="button" class="btn" aria-pressed="false">
              Tema oscuro
            </button>
          </li>
        </ul>
      </nav>
    </div>
  </header>

  <main id="main-content" class="container">
    <section class="hero-card" aria-labelledby="audit-form-heading">
      <div class="hero-header">
        <div>
          <h2 id="audit-form-heading" class="hero-title">Auditar URL y Descargar Reporte de Accesibilidad</h2>
          <p class="hero-subtitle">
            Ingresa cualquier URL pública o local para ejecutar una evaluación automatizada con <strong>axe-core</strong> y <strong>HTML_CodeSniffer</strong> traducida al español, con evidencia visual del DOM, vista ejecutiva para Stakeholders y descarga directa en HTML, CSV (Excel) o paquete ZIP.
          </p>
        </div>
      </div>

      <div class="mode-tabs" role="tablist" aria-label="Modo de entrada de URLs">
        <button id="tab-single" type="button" class="mode-tab" role="tab" aria-selected="true" aria-controls="panel-single">
          URL Única
        </button>
        <button id="tab-batch" type="button" class="mode-tab" role="tab" aria-selected="false" aria-controls="panel-batch">
          Lote de URLs (Múltiples / Archivo .txt)
        </button>
      </div>

      <form id="audit-form" novalidate>
        <div id="panel-single" role="tabpanel" aria-labelledby="tab-single">
          <div class="form-grid">
            <div class="col-8">
              <label for="single-url-input" class="field-label">URL de la página a evaluar *</label>
              <input
                id="single-url-input"
                type="url"
                required
                placeholder="https://ejemplo.com"
                value="https://diegomena.rocks"
              />
              <div class="quick-presets" role="group" aria-label="Ejemplos rápidos">
                <span class="field-hint" style="margin:0;">Probar con:</span>
                <button type="button" class="preset-chip" data-preset-url="https://diegomena.rocks" data-preset-alias="diegomena-rocks">
                  diegomena.rocks
                </button>
                <button type="button" class="preset-chip" data-preset-url="https://www.openbank.es/" data-preset-alias="openbank-es">
                  openbank.es
                </button>
                <button type="button" class="preset-chip" data-preset-url="https://www.w3.org/WAI/" data-preset-alias="w3c-wai">
                  w3.org/WAI
                </button>
              </div>
            </div>
            <div class="col-4">
              <label for="single-alias-input" class="field-label">Alias del reporte (opcional)</label>
              <input
                id="single-alias-input"
                type="text"
                placeholder="ej. portal-inicio"
                value="diegomena-rocks"
              />
              <span class="field-hint">Nombre corto para el archivo descargable (se genera solo si lo dejas vacío).</span>
            </div>
          </div>
        </div>

        <div id="panel-batch" role="tabpanel" aria-labelledby="tab-batch" hidden>
          <div class="form-grid">
            <div class="col-8">
              <label for="batch-urls-textarea" class="field-label">Lista de URLs (una por línea: <code>https://...</code> o <code>alias|https://...</code>) *</label>
              <textarea
                id="batch-urls-textarea"
                placeholder="inicio|https://ejemplo.com&#10;contacto|https://ejemplo.com/contacto"
              >diegomena-home|https://diegomena.rocks
diegomena-blog|https://diegomena.rocks/blog/ia-automatizacion-wcag.html</textarea>
            </div>
            <div class="col-4">
              <label for="batch-file-input" class="field-label">O cargar archivo <code>.txt</code> de URLs</label>
              <input id="batch-file-input" type="file" accept=".txt,.csv" />
              <span class="field-hint">Al seleccionar un archivo <code>.txt</code>, sus líneas se cargarán automáticamente en el cuadro de texto.</span>
            </div>
          </div>
        </div>

        <div class="form-grid" style="margin-top: 16px;">
          <div class="col-3">
            <label for="select-standard" class="field-label">Estándar WCAG</label>
            <select id="select-standard">
              <optgroup label="Niveles de conformidad WCAG">
                <option value="WCAG2AA" selected>WCAG 2.1 / 2.2 Nivel AA (Recomendado)</option>
                <option value="WCAG2A">WCAG Nivel A</option>
                <option value="WCAG2AAA">WCAG Nivel AAA</option>
              </optgroup>
            </select>
          </div>
          <div class="col-3">
            <label for="select-runners" class="field-label">Motores de auditoría</label>
            <select id="select-runners">
              <optgroup label="Motores de evaluación">
                <option value="ambos" selected>Ambos (axe-core + HTML_CodeSniffer)</option>
                <option value="axe">Solo axe-core (Deque)</option>
                <option value="htmlcs">Solo HTML_CodeSniffer</option>
              </optgroup>
            </select>
          </div>
          <div class="col-3">
            <label for="select-level" class="field-label">Nivel de severidad</label>
            <select id="select-level">
              <optgroup label="Alcance de hallazgos">
                <option value="warnings" selected>Errores + Advertencias</option>
                <option value="errors">Solo Errores bloqueantes</option>
                <option value="notices">Errores + Advertencias + Avisos</option>
              </optgroup>
            </select>
          </div>
          <div class="col-3">
            <label for="select-lang" class="field-label">Idioma del reporte</label>
            <select id="select-lang">
              <optgroup label="Idioma de salida">
                <option value="es" selected>Español (Traducción completa)</option>
                <option value="en">Inglés (English)</option>
              </optgroup>
            </select>
          </div>
        </div>

        <details class="advanced-box">
          <summary>Opciones avanzadas de auditoría (Proyecto, Auditor, Espera, Selectores CSS)</summary>
          <div class="form-grid" style="margin-top: 14px;">
            <div class="col-4">
              <label for="input-project" class="field-label">Nombre del Proyecto / Entidad</label>
              <input id="input-project" type="text" placeholder="Ej. Portal Institucional" value="Auditoría Web WCAG 2.2" />
            </div>
            <div class="col-4">
              <label for="input-auditor" class="field-label">Nombre del Auditor / Consultor</label>
              <input id="input-auditor" type="text" placeholder="Ej. Diego Mena" value="Diego Mena" />
            </div>
            <div class="col-4">
              <label for="input-wait" class="field-label">Espera antes de evaluar (ms)</label>
              <input id="input-wait" type="number" min="0" max="20000" step="500" value="2500" />
            </div>
            <div class="col-6">
              <label for="input-root" class="field-label">Selector CSS raíz opcional (<code>--root</code>)</label>
              <input id="input-root" type="text" placeholder="Ej. #main, main" />
            </div>
            <div class="col-6">
              <label for="input-hide" class="field-label">Ocultar selectores CSS (<code>--hide</code>)</label>
              <input id="input-hide" type="text" placeholder="Ej. .cookie-banner, .popup" />
            </div>
          </div>
        </details>

        <div id="form-error-banner" class="error-banner" role="alert"></div>

        <div class="submit-bar">
          <div style="display:flex; gap:18px; flex-wrap:wrap;">
            <label class="checkbox-label">
              <input id="check-screenshot" type="checkbox" checked />
              <span>Capturar evidencia visual del DOM (recortes de elementos)</span>
            </label>
            <label class="checkbox-label">
              <input id="check-standalone" type="checkbox" checked />
              <span>Reporte HTML autocontenido (incrustar capturas en Base64 para descarga en 1 archivo)</span>
            </label>
          </div>

          <button id="submit-audit-btn" type="submit" class="btn btn-primary">
            <span class="btn-spinner" aria-hidden="true"></span>
            <span id="submit-audit-btn-label">Ejecutar Auditoría y Generar Reporte</span>
          </button>
        </div>
      </form>

      <div id="progress-panel" class="progress-panel" aria-live="polite">
        <div class="progress-header">
          <div class="progress-title-wrap">
            <span id="progress-spinner" class="css-spinner" aria-hidden="true"></span>
            <div>
              <strong id="progress-status-text" style="font-size:1.02rem;display:block;">Ejecutando análisis de accesibilidad en vivo...</strong>
              <span id="progress-sub-hint" class="live-activity-hint">Preparando entorno de evaluación WCAG...</span>
            </div>
          </div>
          <div class="progress-meta-pills">
            <span id="progress-url-counter" class="timer-pill">URL 1 de 1</span>
            <span id="progress-timer" class="timer-pill" aria-label="Tiempo transcurrido">00:00 s</span>
            <span id="progress-run-id" class="badge">Iniciando</span>
            <button id="cancel-audit-btn" type="button" class="btn" style="padding:4px 10px;font-size:0.78rem;">
              Cancelar
            </button>
          </div>
        </div>

        <div
          id="progress-bar"
          class="progress-bar-track"
          role="progressbar"
          aria-label="Progreso de la auditoría de accesibilidad"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="8"
        >
          <div id="progress-bar-fill" class="progress-bar-fill"></div>
        </div>

        <div class="stepper-grid" aria-label="Etapas del análisis">
          <div id="step-box-1" class="step-item is-active">
            <div class="step-item-head"><span>Etapa 1</span><span id="step-state-1">En curso</span></div>
            <div class="step-item-title">Navegador y DOM</div>
            <div class="step-item-desc">Carga de la URL en Chromium y espera de renderizado</div>
          </div>
          <div id="step-box-2" class="step-item">
            <div class="step-item-head"><span>Etapa 2</span><span id="step-state-2">Pendiente</span></div>
            <div class="step-item-title">Motores WCAG 2.2</div>
            <div class="step-item-desc">Inspección con axe-core y HTML_CodeSniffer</div>
          </div>
          <div id="step-box-3" class="step-item">
            <div class="step-item-head"><span>Etapa 3</span><span id="step-state-3">Pendiente</span></div>
            <div class="step-item-title">Evidencia Visual</div>
            <div class="step-item-desc">Coordenadas DOM, contraste real y recortes PNG</div>
          </div>
          <div id="step-box-4" class="step-item">
            <div class="step-item-head"><span>Etapa 4</span><span id="step-state-4">Pendiente</span></div>
            <div class="step-item-title">Reportes y CSVs</div>
            <div class="step-item-desc">Vista Stakeholders, Ingeniería, Excel y ZIP</div>
          </div>
        </div>

        <details open>
          <summary style="font-size:0.82rem;font-weight:700;cursor:pointer;margin-bottom:6px;color:var(--muted);">
            Ver registro técnico en tiempo real (Consola Pa11y)
          </summary>
          <div id="progress-console" class="log-console" role="region" tabindex="0" aria-label="Registro de progreso de la auditoría"></div>
        </details>
      </div>
    </section>

    <section id="results-section" class="results-section" aria-labelledby="results-heading">
      <div class="card">
        <div class="hero-header">
          <div>
            <h2 id="results-heading" class="hero-title">Resultado de la Auditoría y Descarga de Entregables</h2>
            <p id="results-subtitle" class="hero-subtitle">Lote completado.</p>
          </div>
        </div>

        <div class="kpi-grid" style="margin-bottom: 18px;">
          <div class="kpi-box">
            <div class="kpi-label">URLs Evaluadas</div>
            <div id="kpi-urls" class="kpi-val">0</div>
          </div>
          <div class="kpi-box err">
            <div class="kpi-label">Errores WCAG</div>
            <div id="kpi-errors" class="kpi-val">0</div>
          </div>
          <div class="kpi-box warn">
            <div class="kpi-label">Advertencias</div>
            <div id="kpi-warnings" class="kpi-val">0</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Motor axe-core</div>
            <div id="kpi-axe" class="kpi-val">0</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Motor HTML_CodeSniffer</div>
            <div id="kpi-htmlcs" class="kpi-val">0</div>
          </div>
        </div>

        <div class="downloads-bar">
          <h3 class="downloads-title">Descargar Entregables del Lote</h3>
          <div id="batch-downloads-container" class="downloads-buttons"></div>
        </div>

        <div class="url-results-table-wrap" style="margin-top: 18px;">
          <table class="audit-table">
            <caption class="sr-only">Resultados detallados por URL evaluada y acciones de descarga</caption>
            <thead>
              <tr>
                <th scope="col">Alias</th>
                <th scope="col">URL Evaluada</th>
                <th scope="col">Errores</th>
                <th scope="col">Advertencias</th>
                <th scope="col">Acciones y Descarga Directa</th>
              </tr>
            </thead>
            <tbody id="results-table-body"></tbody>
          </table>
        </div>
      </div>

      <div class="preview-frame-wrap">
        <div class="preview-toolbar">
          <strong>Vista Previa Interactiva del Reporte Generado</strong>
          <div id="preview-switch-buttons" class="nav-actions"></div>
        </div>
        <iframe
          id="report-preview-iframe"
          class="report-preview-iframe"
          title="Vista previa interactiva del reporte de accesibilidad"
        ></iframe>
      </div>
    </section>

    <section id="history-section" class="card" aria-labelledby="history-heading">
      <div class="hero-header">
        <div>
          <h2 id="history-heading" class="hero-title" style="font-size:1.25rem;">Historial de Reportes Generados</h2>
          <p class="hero-subtitle">Consulta, previsualiza o descarga cualquiera de las auditorías almacenadas en <code>./artifacts/</code>.</p>
        </div>
        <button id="refresh-history-btn" type="button" class="btn">Actualizar historial</button>
      </div>
      <div class="url-results-table-wrap">
        <table class="audit-table">
          <caption class="sr-only">Historial de lotes de auditoría generados</caption>
          <thead>
            <tr>
              <th scope="col">ID del Lote (Fecha y Hora)</th>
              <th scope="col">URLs</th>
              <th scope="col">Errores</th>
              <th scope="col">Advertencias</th>
              <th scope="col">Descargas y Vista Previa</th>
            </tr>
          </thead>
          <tbody id="history-table-body">
            <tr><td colspan="5">Cargando historial de lotes...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
    (function () {
      var mode = 'single';
      var tabSingle = document.getElementById('tab-single');
      var tabBatch = document.getElementById('tab-batch');
      var panelSingle = document.getElementById('panel-single');
      var panelBatch = document.getElementById('panel-batch');
      var singleUrlInput = document.getElementById('single-url-input');
      var singleAliasInput = document.getElementById('single-alias-input');
      var batchTextarea = document.getElementById('batch-urls-textarea');
      var batchFileInput = document.getElementById('batch-file-input');
      var form = document.getElementById('audit-form');
      var errorBanner = document.getElementById('form-error-banner');
      var submitBtn = document.getElementById('submit-audit-btn');
      var submitBtnLabel = document.getElementById('submit-audit-btn-label');
      var progressPanel = document.getElementById('progress-panel');
      var progressSpinner = document.getElementById('progress-spinner');
      var progressStatus = document.getElementById('progress-status-text');
      var progressSubHint = document.getElementById('progress-sub-hint');
      var progressUrlCounter = document.getElementById('progress-url-counter');
      var progressTimer = document.getElementById('progress-timer');
      var progressRunId = document.getElementById('progress-run-id');
      var progressBar = document.getElementById('progress-bar');
      var progressBarFill = document.getElementById('progress-bar-fill');
      var progressConsole = document.getElementById('progress-console');
      var cancelAuditBtn = document.getElementById('cancel-audit-btn');
      var resultsSection = document.getElementById('results-section');
      var srAnnouncer = document.getElementById('sr-announcer');
      var previewIframe = document.getElementById('report-preview-iframe');
      var themeBtn = document.getElementById('theme-toggle-btn');

      var activeJobId = null;
      var activeEventSource = null;
      var elapsedTimerId = null;
      var startTimestamp = 0;
      var currentPct = 8;
      var currentStage = 1;
      var totalBatchUrls = 1;
      var currentUrlIdx = 1;

      var stageHints = {
        1: [
          'Iniciando instancia limpia de Chromium y abriendo la URL solicitada...',
          'Esperando a que la página cargue hojas de estilo, fuentes y nodos dinámicos...'
        ],
        2: [
          'Evaluando reglas WCAG 2.2 con axe-core (contraste, nombres accesibles, ARIA, teclado)...',
          'Ejecutando inspección complementaria con HTML_CodeSniffer sobre la estructura semántica...',
          'Verificando jerarquía de encabezados, etiquetas de formularios e idioma del documento...'
        ],
        3: [
          'Capturando vista completa de la página y calculando coordenadas DOM (x, y, ancho, alto)...',
          'Generando recortes visuales de primer plano sobre cada elemento con hallazgos detectados...'
        ],
        4: [
          'Traduciendo hallazgos al español y aplicando análisis de Pareto 80/20 para Stakeholders...',
          'Empaquetando reporte HTML autocontenido, los 4 archivos CSV para Excel y el paquete ZIP...'
        ]
      };
      var hintTick = 0;

      function updateProgressBar (pct) {
        currentPct = Math.max(currentPct, Math.min(100, Math.round(pct)));
        progressBar.setAttribute('aria-valuenow', String(currentPct));
        progressBarFill.style.width = currentPct + '%';
      }

      function setVisualStage (stageNum, isCompletedAll) {
        currentStage = stageNum;
        for (var s = 1; s <= 4; s++) {
          var box = document.getElementById('step-box-' + s);
          var stLabel = document.getElementById('step-state-' + s);
          if (!box || !stLabel) continue;
          box.classList.remove('is-active', 'is-done');
          if (isCompletedAll || s < stageNum) {
            box.classList.add('is-done');
            stLabel.textContent = 'Listo';
          } else if (s === stageNum) {
            box.classList.add('is-active');
            stLabel.textContent = 'En curso';
          } else {
            stLabel.textContent = 'Pendiente';
          }
        }
      }

      function startLiveTimer (urlCount) {
        totalBatchUrls = Math.max(1, urlCount || 1);
        currentUrlIdx = 1;
        currentPct = 10;
        hintTick = 0;
        startTimestamp = Date.now();
        progressSpinner.classList.remove('is-done');
        cancelAuditBtn.style.display = 'inline-flex';
        progressUrlCounter.textContent = 'URL 1 de ' + totalBatchUrls;
        progressTimer.textContent = '00:00 s';
        updateProgressBar(10);
        setVisualStage(1, false);

        if (elapsedTimerId) clearInterval(elapsedTimerId);
        elapsedTimerId = setInterval(function () {
          var secs = Math.floor((Date.now() - startTimestamp) / 1000);
          var mm = String(Math.floor(secs / 60)).padStart(2, '0');
          var ss = String(secs % 60).padStart(2, '0');
          progressTimer.textContent = mm + ':' + ss + ' s';

          // Incremento suave mientras una etapa pesada está trabajando
          if (currentPct < 92) {
            updateProgressBar(currentPct + 1.5);
          }

          var hints = stageHints[currentStage] || stageHints[2];
          progressSubHint.textContent = hints[hintTick % hints.length];
          hintTick++;
        }, 1000);
      }

      function stopLiveTimer (completedOk) {
        if (elapsedTimerId) {
          clearInterval(elapsedTimerId);
          elapsedTimerId = null;
        }
        cancelAuditBtn.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
        submitBtnLabel.textContent = 'Ejecutar Auditoría y Generar Reporte';
        if (completedOk) {
          progressSpinner.classList.add('is-done');
          updateProgressBar(100);
          setVisualStage(4, true);
          progressSubHint.textContent = 'Todos los entregables HTML, CSV y ZIP han sido generados correctamente.';
        }
      }

      function announce (msg) {
        if (!srAnnouncer) return;
        srAnnouncer.textContent = '';
        setTimeout(function () { srAnnouncer.textContent = msg; }, 40);
      }

      function setMode (nextMode) {
        mode = nextMode;
        var isSingle = mode === 'single';
        tabSingle.setAttribute('aria-selected', String(isSingle));
        tabBatch.setAttribute('aria-selected', String(!isSingle));
        panelSingle.hidden = !isSingle;
        panelBatch.hidden = isSingle;
      }

      tabSingle.addEventListener('click', function () { setMode('single'); });
      tabBatch.addEventListener('click', function () { setMode('batch'); });

      singleUrlInput.addEventListener('input', function () {
        var val = singleUrlInput.value.trim();
        if (!val) return;
        try {
          var u = new URL(/^https?:\\/\\//i.test(val) ? val : 'https://' + val);
          singleAliasInput.value = u.hostname.replace(/^www\\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        } catch (_e) {}
      });

      var presetBtns = document.querySelectorAll('[data-preset-url]');
      for (var i = 0; i < presetBtns.length; i++) {
        presetBtns[i].addEventListener('click', function () {
          singleUrlInput.value = this.getAttribute('data-preset-url');
          singleAliasInput.value = this.getAttribute('data-preset-alias') || '';
        });
      }

      batchFileInput.addEventListener('change', function () {
        var file = batchFileInput.files && batchFileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          batchTextarea.value = String(ev.target.result || '');
          announce('Archivo de URLs cargado en el editor por lotes.');
        };
        reader.readAsText(file);
      });

      themeBtn.addEventListener('click', function () {
        var html = document.documentElement;
        var isDark = html.getAttribute('data-theme') === 'dark';
        var next = isDark ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        themeBtn.setAttribute('aria-pressed', String(!isDark));
        themeBtn.textContent = !isDark ? 'Tema claro' : 'Tema oscuro';
      });

      function renderRunResult (runData) {
        if (!runData) return;
        resultsSection.classList.add('is-visible');
        document.getElementById('results-subtitle').textContent =
          'ID del lote: ' + runData.runId + ' (' + runData.totals.urls + ' URL evaluada(s))';
        document.getElementById('kpi-urls').textContent = runData.totals.urls;
        document.getElementById('kpi-errors').textContent = runData.totals.errors;
        document.getElementById('kpi-warnings').textContent = runData.totals.warnings;
        document.getElementById('kpi-axe').textContent = runData.totals.axe;
        document.getElementById('kpi-htmlcs').textContent = runData.totals.htmlcs;

        var dlContainer = document.getElementById('batch-downloads-container');
        dlContainer.innerHTML = '';

        if (runData.items && runData.items.length === 1 && runData.items[0].downloadHtmlUrl) {
          var mainHtmlBtn = document.createElement('a');
          mainHtmlBtn.href = runData.items[0].downloadHtmlUrl;
          mainHtmlBtn.className = 'btn btn-primary';
          mainHtmlBtn.setAttribute('download', '');
          mainHtmlBtn.textContent = 'Descargar Reporte HTML (' + runData.items[0].alias + ')';
          dlContainer.appendChild(mainHtmlBtn);
        }

        if (runData.zipUrl) {
          var zipBtn = document.createElement('a');
          zipBtn.href = runData.zipUrl;
          zipBtn.className = 'btn btn-success';
          zipBtn.textContent = 'Descargar Paquete Completo (.zip)';
          dlContainer.appendChild(zipBtn);
        }
        if (runData.findingsCsvUrl) {
          var csvBtn = document.createElement('a');
          csvBtn.href = runData.findingsCsvUrl;
          csvBtn.className = 'btn';
          csvBtn.textContent = 'Descargar CSV Maestro (23 col Excel)';
          dlContainer.appendChild(csvBtn);
        }
        if (runData.wcagMatrixCsvUrl) {
          var matBtn = document.createElement('a');
          matBtn.href = runData.wcagMatrixCsvUrl;
          matBtn.className = 'btn';
          matBtn.textContent = 'Descargar Matriz WCAG (.csv)';
          dlContainer.appendChild(matBtn);
        }
        if (runData.summaryCsvUrl) {
          var sumBtn = document.createElement('a');
          sumBtn.href = runData.summaryCsvUrl;
          sumBtn.className = 'btn';
          sumBtn.textContent = 'Descargar Resumen por URL (.csv)';
          dlContainer.appendChild(sumBtn);
        }
        if (runData.junitXmlUrl) {
          var junitBtn = document.createElement('a');
          junitBtn.href = runData.junitXmlUrl;
          junitBtn.className = 'btn';
          junitBtn.textContent = 'Descargar JUnit XML (CI/CD)';
          dlContainer.appendChild(junitBtn);
        }

        var tbody = document.getElementById('results-table-body');
        tbody.innerHTML = '';
        var switchContainer = document.getElementById('preview-switch-buttons');
        switchContainer.innerHTML = '';

        (runData.items || []).forEach(function (item, idx) {
          var tr = document.createElement('tr');
          var errBadge = item.errorsCount > 0
            ? '<span class="badge badge-err">' + item.errorsCount + ' errores</span>'
            : '<span class="badge badge-ok">0 errores</span>';

          var actionsHtml = '';
          if (item.downloadHtmlUrl) {
            actionsHtml += '<a class="btn btn-primary" style="padding:6px 12px;font-size:0.8rem;" href="' + item.downloadHtmlUrl + '" download>Descargar HTML</a> ';
          }
          if (item.executiveUrl) {
            actionsHtml += '<button type="button" class="btn preview-url-btn" style="padding:6px 12px;font-size:0.8rem;" data-preview-src="' + item.executiveUrl + '">Ver Vista Stakeholders</button> ';
          }
          if (item.technicalUrl) {
            actionsHtml += '<button type="button" class="btn preview-url-btn" style="padding:6px 12px;font-size:0.8rem;" data-preview-src="' + item.technicalUrl + '">Ver Vista Ingeniería</button> ';
          }
          if (item.reportUrl) {
            actionsHtml += '<a class="btn" style="padding:6px 12px;font-size:0.8rem;" href="' + item.reportUrl + '" target="_blank" rel="noopener">Abrir en nueva pestaña</a>';
          }

          tr.innerHTML =
            '<td><strong>' + item.alias + '</strong></td>' +
            '<td><a href="' + item.url + '" target="_blank" rel="noopener">' + item.url + '</a></td>' +
            '<td>' + errBadge + '</td>' +
            '<td>' + item.warningsCount + '</td>' +
            '<td style="display:flex;gap:6px;flex-wrap:wrap;">' + actionsHtml + '</td>';
          tbody.appendChild(tr);

          if (idx === 0 && item.executiveUrl) {
            previewIframe.src = item.executiveUrl;
          }
        });

        if (runData.dashboardUrl) {
          var dashBtn = document.createElement('button');
          dashBtn.type = 'button';
          dashBtn.className = 'btn preview-url-btn';
          dashBtn.setAttribute('data-preview-src', runData.dashboardUrl);
          dashBtn.textContent = 'Ver Dashboard Consolidado del Lote';
          switchContainer.appendChild(dashBtn);
        }

        bindPreviewButtons();
        loadHistory();
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      function bindPreviewButtons () {
        var btns = document.querySelectorAll('.preview-url-btn');
        for (var i = 0; i < btns.length; i++) {
          btns[i].onclick = function () {
            var src = this.getAttribute('data-preview-src');
            if (src) {
              previewIframe.src = src;
              previewIframe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          };
        }
      }

      function loadHistory () {
        fetch('/api/runs')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var tbody = document.getElementById('history-table-body');
            tbody.innerHTML = '';
            var runs = (data && data.runs) || [];
            if (runs.length === 0) {
              tbody.innerHTML = '<tr><td colspan="5">Aún no hay lotes registrados. Ejecuta tu primera auditoría arriba.</td></tr>';
              return;
            }
            runs.forEach(function (run) {
              var tr = document.createElement('tr');
              var firstItem = run.items && run.items[0];
              var dlHtml = firstItem && firstItem.downloadHtmlUrl
                ? '<a class="btn" style="padding:5px 10px;font-size:0.78rem;" href="' + firstItem.downloadHtmlUrl + '" download>Descargar HTML</a> '
                : '';
              var zipHtml = '<a class="btn" style="padding:5px 10px;font-size:0.78rem;" href="' + run.zipUrl + '">ZIP Completo</a> ';
              var csvHtml = run.findingsCsvUrl
                ? '<a class="btn" style="padding:5px 10px;font-size:0.78rem;" href="' + run.findingsCsvUrl + '">CSV Hallazgos</a> '
                : '';
              var openDash = run.dashboardUrl
                ? '<a class="btn" style="padding:5px 10px;font-size:0.78rem;" href="' + run.dashboardUrl + '" target="_blank" rel="noopener">Abrir Lote</a>'
                : '';

              tr.innerHTML =
                '<td><strong>' + run.runId + '</strong></td>' +
                '<td>' + run.totals.urls + ' (' + (run.items.map(function (i) { return i.alias; }).join(', ').slice(0, 42)) + ')</td>' +
                '<td><strong>' + run.totals.errors + '</strong></td>' +
                '<td>' + run.totals.warnings + '</td>' +
                '<td style="display:flex;gap:6px;flex-wrap:wrap;">' + dlHtml + zipHtml + csvHtml + openDash + '</td>';
              tbody.appendChild(tr);
            });
          })
          .catch(function () {});
      }

      document.getElementById('refresh-history-btn').addEventListener('click', loadHistory);

      cancelAuditBtn.addEventListener('click', function () {
        if (!activeJobId) return;
        if (activeEventSource) {
          activeEventSource.close();
          activeEventSource = null;
        }
        fetch('/api/audit/' + activeJobId + '/cancel', { method: 'POST' }).catch(function () {});
        stopLiveTimer(false);
        progressStatus.textContent = 'Auditoría cancelada por el usuario.';
        progressSubHint.textContent = 'Puedes modificar la URL o las opciones y volver a ejecutar cuando quieras.';
        progressRunId.textContent = 'Cancelado';
        announce('Auditoría cancelada.');
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorBanner.classList.remove('is-visible');
        errorBanner.textContent = '';

        var urlsText = '';
        var urlLinesCount = 1;
        if (mode === 'single') {
          var u = singleUrlInput.value.trim();
          var a = singleAliasInput.value.trim();
          if (!u) {
            errorBanner.textContent = 'Por favor ingresa la URL que deseas evaluar.';
            errorBanner.classList.add('is-visible');
            singleUrlInput.focus();
            return;
          }
          urlsText = (a ? (a + '|' + u) : u);
          urlLinesCount = 1;
        } else {
          urlsText = batchTextarea.value.trim();
          if (!urlsText) {
            errorBanner.textContent = 'Por favor ingresa al menos una línea en la lista de URLs.';
            errorBanner.classList.add('is-visible');
            batchTextarea.focus();
            return;
          }
          urlLinesCount = urlsText.split(/\\r?\\n/).filter(function (l) {
            return l.trim() && l.trim().indexOf('#') !== 0;
          }).length;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
        submitBtnLabel.textContent = 'Analizando accesibilidad en vivo...';
        resultsSection.classList.remove('is-visible');
        progressPanel.classList.add('is-visible');
        progressConsole.textContent = 'Iniciando lote de evaluación WCAG con Pa11y...\\n';
        progressStatus.textContent = 'Evaluando accesibilidad web en tiempo real...';
        progressRunId.textContent = 'En progreso';
        startLiveTimer(urlLinesCount);
        progressPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        announce('Auditoría de accesibilidad iniciada. Analizando etapa 1 de 4.');

        var payload = {
          urlsText: urlsText,
          standard: document.getElementById('select-standard').value,
          runners: document.getElementById('select-runners').value,
          level: document.getElementById('select-level').value,
          lang: document.getElementById('select-lang').value,
          project: document.getElementById('input-project').value,
          auditor: document.getElementById('input-auditor').value,
          wait: document.getElementById('input-wait').value,
          root: document.getElementById('input-root').value,
          hide: document.getElementById('input-hide').value,
          screenshot: document.getElementById('check-screenshot').checked ? 'si' : 'no',
          standalone: document.getElementById('check-standalone').checked
        };

        fetch('/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(function (r) { return r.json(); })
          .then(function (resp) {
            if (resp.error) {
              errorBanner.textContent = resp.error;
              errorBanner.classList.add('is-visible');
              stopLiveTimer(false);
              progressPanel.classList.remove('is-visible');
              return;
            }

            var jobId = resp.jobId;
            activeJobId = jobId;
            var es = new EventSource('/api/audit/' + jobId + '/stream');
            activeEventSource = es;

            function parseStageFromLogLine (line) {
              var mUrl = line.match(/\\[ETAPA 1\\/4\\] Analizando \\((\\d+)\\):\\s*([^\\s]+)\\s*->\\s*(.+)/);
              if (mUrl) {
                currentUrlIdx = parseInt(mUrl[1], 10) || 1;
                progressUrlCounter.textContent = 'URL ' + currentUrlIdx + ' de ' + totalBatchUrls;
                progressStatus.textContent = 'Abriendo y evaluando: ' + mUrl[2] + ' (' + mUrl[3] + ')';
                setVisualStage(1, false);
                updateProgressBar(22);
              } else if (line.indexOf('[ETAPA 2/4]') !== -1) {
                setVisualStage(2, false);
                progressStatus.textContent = 'Ejecutando motores axe-core y HTML_CodeSniffer sobre el DOM...';
                updateProgressBar(42);
              } else if (line.indexOf('[ETAPA 3/4]') !== -1) {
                setVisualStage(3, false);
                progressStatus.textContent = 'Capturando evidencia visual y coordenadas DOM con Puppeteer...';
                updateProgressBar(72);
              } else if (line.indexOf('[ETAPA 4/4]') !== -1) {
                setVisualStage(4, false);
                progressStatus.textContent = 'Traduciendo hallazgos y generando reportes Stakeholders + CSV...';
                updateProgressBar(90);
              }
            }

            es.addEventListener('log', function (ev) {
              try {
                var data = JSON.parse(ev.data);
                if (data.runId) progressRunId.textContent = data.runId;
                parseStageFromLogLine(data.line || '');
                progressConsole.textContent += data.line + '\\n';
                progressConsole.scrollTop = progressConsole.scrollHeight;
              } catch (_e) {}
            });

            es.addEventListener('done', function (ev) {
              es.close();
              activeEventSource = null;
              try {
                var data = JSON.parse(ev.data);
                var ok = data.status === 'completed';
                stopLiveTimer(ok);
                if (ok) {
                  progressStatus.textContent = 'Auditoría completada con éxito.';
                  progressRunId.textContent = data.runId || 'Listo';
                  if (data.result) {
                    announce('Auditoría completada. El reporte está listo para previsualizar y descargar.');
                    renderRunResult(data.result);
                  }
                } else {
                  progressStatus.textContent = 'La auditoría falló al intentar evaluar la URL.';
                  progressSubHint.textContent = 'Revisa el registro técnico de la consola abajo para ver el detalle del error.';
                  progressRunId.textContent = 'Error';
                  announce('Error técnico al evaluar la URL. Revisa los detalles en pantalla.');
                }
              } catch (_e) {
                stopLiveTimer(false);
              }
            });

            es.onerror = function () {
              es.close();
              activeEventSource = null;
              var poll = setInterval(function () {
                fetch('/api/audit/' + jobId + '/status')
                  .then(function (r) { return r.json(); })
                  .then(function (st) {
                    if (st.status !== 'running') {
                      clearInterval(poll);
                      stopLiveTimer(st.status === 'completed');
                      if (st.result) renderRunResult(st.result);
                    }
                  })
                  .catch(function () { clearInterval(poll); });
              }, 1500);
            };
          })
          .catch(function (err) {
            errorBanner.textContent = 'Error de conexión con el servidor: ' + err.message;
            errorBanner.classList.add('is-visible');
            stopLiveTimer(false);
          });
      });

      loadHistory();
    })();
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const forceDownload = parsedUrl.searchParams.get('download') === '1';

  // 1. Página principal del Web Studio
  if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/studio')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? '' : renderStudioHtml());
    return;
  }

  // 2. API: Listar corridas recientes
  if (req.method === 'GET' && pathname === '/api/runs') {
    const runs = listRecentRuns();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ runs }));
    return;
  }

  // 3. API: Descargar paquete ZIP completo de un lote
  const zipMatch = pathname.match(/^\/api\/runs\/([^/]+)\/zip$/);
  if (req.method === 'GET' && zipMatch) {
    const safeRunId = path.basename(zipMatch[1]);
    const runDir = path.join(ARTIFACTS_DIR, safeRunId);
    if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Lote no encontrado');
      return;
    }
    const tmpZip = path.join(os.tmpdir(), `pa11y-batch-${safeRunId}.zip`);
    try {
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
      execFileSync('zip', ['-r', '-q', tmpZip, safeRunId], { cwd: ARTIFACTS_DIR });
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="pa11y-reporte-${safeRunId}.zip"`
      });
      const stream = fs.createReadStream(tmpZip);
      stream.on('close', () => {
        try { fs.unlinkSync(tmpZip); } catch (_e) {}
      });
      stream.pipe(res);
    } catch (_err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No fue posible generar el archivo ZIP');
    }
    return;
  }

  // 4. API: Iniciar una nueva auditoría
  if (req.method === 'POST' && pathname === '/api/audit') {
    let rawBody = '';
    req.on('data', chunk => {
      rawBody += chunk;
      if (rawBody.length > 512 * 1024) req.destroy();
    });
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(rawBody || '{}');
      } catch (_e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Cuerpo JSON inválido' }));
        return;
      }
      const started = startAuditJob(body);
      if (started.error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: started.error }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(started));
    });
    return;
  }

  // 5. API: Stream SSE de progreso en vivo
  const streamMatch = pathname.match(/^\/api\/audit\/([^/]+)\/stream$/);
  if (req.method === 'GET' && streamMatch) {
    const job = jobs.get(streamMatch[1]);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Trabajo no encontrado' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });

    for (const line of job.logs) {
      res.write(`event: log\ndata: ${JSON.stringify({ line, runId: job.runId })}\n\n`);
    }

    if (job.status !== 'running') {
      res.write(`event: done\ndata: ${JSON.stringify({ status: job.status, runId: job.runId, result: job.result })}\n\n`);
      res.end();
      return;
    }

    job.clients.add(res);
    req.on('close', () => {
      job.clients.delete(res);
    });
    return;
  }

  // 6. API: Estado JSON de un trabajo
  const statusMatch = pathname.match(/^\/api\/audit\/([^/]+)\/status$/);
  if (req.method === 'GET' && statusMatch) {
    const job = jobs.get(statusMatch[1]);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Trabajo no encontrado' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      jobId: job.jobId,
      status: job.status,
      runId: job.runId,
      logs: job.logs,
      result: job.result
    }));
    return;
  }

  // 6b. API: Cancelar un trabajo en ejecución
  const cancelMatch = pathname.match(/^\/api\/audit\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    const job = jobs.get(cancelMatch[1]);
    if (job && job.child && job.status === 'running') {
      try {
        job.child.kill('SIGTERM');
      } catch (_e) {}
      job.status = 'cancelled';
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // 7. Servir artefactos bajo /artifacts/... o directamente /<runId>/...
  if (req.method === 'GET' && pathname.startsWith('/artifacts/')) {
    const rel = pathname.replace(/^\/artifacts\//, '');
    serveArtifactFile(req, res, rel, forceDownload);
    return;
  }

  if (req.method === 'GET') {
    const cleanRel = pathname.replace(/^\/+/, '');
    if (cleanRel && fs.existsSync(path.join(ARTIFACTS_DIR, cleanRel))) {
      serveArtifactFile(req, res, cleanRel, forceDownload);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Ruta no encontrada');
});

server.listen(PORT, () => {
  console.log('==========================================================');
  console.log(' Pa11y Batch Web Studio activo en:');
  console.log(` -> http://localhost:${PORT}/`);
  console.log(` -> Centro de Reportes: http://localhost:${PORT}/artifacts/index.html`);
  console.log('==========================================================');
});
