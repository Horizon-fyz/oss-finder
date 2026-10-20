import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { search, explain } from './search.mjs';
import { decide, renderReport } from './decide.mjs';
import {
  stats,
  count,
  open,
  topRising,
  capCounts,
  seedSnapshots,
  getMeta,
  setMeta,
  invalidateCapCounts,
} from './db.mjs';
import { dailyUpdate } from './discover.mjs';
import { CAPABILITIES, CAP_BY_ID } from './taxonomy.mjs';
import { loadConfig } from './llm.mjs';
import { PATHS, dateKey, writeText } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(HERE, '..', 'web');
const CONFIG_FILE = path.join(PATHS.root, 'oss.config.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function configView(cfg) {
  const { apiKey, ...rest } = cfg.llm;
  return {
    profile: cfg.profile,
    llm: { ...rest, apiKeySet: Boolean(apiKey) },
    llmReady: Boolean(apiKey && cfg.llm.baseUrl && cfg.llm.model),
    file: cfg.file,
  };
}

function capsView() {
  const { counts } = capCounts();
  return CAPABILITIES.map((c) => ({
    id: c.id,
    zh: c.zh,
    en: c.en,
    count: counts.get(c.id) ?? 0,
    composes: (c.composes ?? []).map((k) => ({ id: k, zh: CAP_BY_ID.get(k)?.zh ?? k })),
  }));
}

function risingView(limit) {
  return topRising({ limit, minHeat: 1 }).map((r) => ({
    full_name: r.full_name,
    url: r.url,
    description: r.description,
    stars: r.stars,
    language: r.language,
    license: r.license,
    heat: Math.round((r.heat ?? 0) * 10) / 10,
    burst: r.burst ?? 0,
    first_seen: r.first_seen,
    caps: String(r.caps || '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 3)
      .map((id) => ({ id, zh: CAP_BY_ID.get(id)?.zh ?? id })),
  }));
}

/* ── 启动更新 ─────────────────────────────────────────────
 * 打开界面后在后台跑一次 dailyUpdate，库更新完才解锁检索。
 * GitHub 匿名额度有限，30 分钟内重启不重复拉取（可手动强制）。 */

const UPDATE_MIN_INTERVAL_MS = 30 * 60 * 1000;

const updateState = {
  status: 'idle', // idle | running | done | skipped | error
  phase: null,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  reason: null,
};

let updatePromise = null;

function lastUpdateInfo() {
  const at = getMeta('last_update_at');
  if (!at) return null;
  let result = null;
  try {
    result = JSON.parse(getMeta('last_update_result') || 'null');
  } catch {
    result = null;
  }
  return { at, result };
}

function updateView() {
  const started = updateState.startedAt ? Date.parse(updateState.startedAt) : 0;
  const finished = updateState.finishedAt ? Date.parse(updateState.finishedAt) : 0;
  return {
    ...updateState,
    updating: updateState.status === 'running',
    durationMs: started && finished ? Math.max(0, finished - started) : null,
    lastUpdate: lastUpdateInfo(),
    minIntervalMin: UPDATE_MIN_INTERVAL_MS / 60000,
  };
}

export function startUpdate({ force = false, discoveryQueries, watchCount, hnLimit } = {}) {
  if (updatePromise) return updatePromise;

  const last = lastUpdateInfo();
  if (!force && last && Date.now() - Date.parse(last.at) < UPDATE_MIN_INTERVAL_MS) {
    Object.assign(updateState, {
      status: 'skipped',
      phase: null,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      result: null,
      error: null,
      reason: `近 ${UPDATE_MIN_INTERVAL_MS / 60000} 分钟内已更新过`,
    });
    return Promise.resolve(updateView());
  }

  Object.assign(updateState, {
    status: 'running',
    phase: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
    reason: null,
  });

  updatePromise = (async () => {
    const seed = seedSnapshots();
    const result = await dailyUpdate({
      discoveryQueries,
      watchCount,
      hnLimit,
      onProgress: (phase) => {
        updateState.phase = phase;
      },
    });
    invalidateCapCounts();
    const at = new Date().toISOString();
    setMeta('last_update_at', at);
    setMeta('last_update_result', JSON.stringify(result));
    Object.assign(updateState, {
      status: 'done',
      phase: null,
      finishedAt: at,
      result: { ...result, seeded: seed.snapshots },
    });
    return updateView();
  })()
    .catch((err) => {
      Object.assign(updateState, {
        status: 'error',
        phase: null,
        finishedAt: new Date().toISOString(),
        error: err.message || '更新失败',
      });
      return updateView();
    })
    .finally(() => {
      updatePromise = null;
    });

  return updatePromise;
}

/** 更新中默认拒绝检索，保证结果基于更新后的库；界面可选择「先用现有库」 */
function updateGate(res, allowStale = false) {
  if (updateState.status === 'running' && !allowStale) {
    json(res, 409, {
      error: '数据库正在更新，完成后自动解锁',
      updating: true,
      update: updateView(),
    });
    return true;
  }
  return false;
}

function bootstrap() {
  const cfg = loadConfig(CONFIG_FILE);
  const s = stats();
  return {
    stats: {
      total: s.total,
      fresh: s.fresh,
      caps: CAPABILITIES.length,
      topCaps: s.topCaps.slice(0, 8).map(([id, n]) => ({ id, n, zh: CAP_BY_ID.get(id)?.zh ?? id })),
      langs: s.langs,
    },
    caps: capsView(),
    rising: risingView(12),
    update: updateView(),
    ...configView(cfg),
  };
}

function saveConfig(body) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    raw = {};
  }

  const inProfile = body?.profile ?? {};
  const profile = { ...(raw.profile ?? {}) };
  for (const key of ['name', 'timeline', 'notes']) {
    if (typeof inProfile[key] === 'string') profile[key] = inProfile[key].trim();
  }
  if (Array.isArray(inProfile.stack)) profile.stack = inProfile.stack.filter(Boolean);
  if (Array.isArray(inProfile.licensePolicy)) profile.licensePolicy = inProfile.licensePolicy.filter(Boolean);
  if (typeof inProfile.commercial === 'boolean') profile.commercial = inProfile.commercial;
  if (inProfile.teamSize === null || inProfile.teamSize === '') profile.teamSize = null;
  else if (Number.isFinite(Number(inProfile.teamSize))) profile.teamSize = Number(inProfile.teamSize);

  const inLlm = body?.llm ?? {};
  const { apiKey, ...llmRest } = inLlm;
  const llm = { ...(raw.llm ?? {}), ...llmRest };
  if (typeof apiKey === 'string' && apiKey.trim()) llm.apiKey = apiKey.trim();
  if (llm.timeoutMs !== undefined) llm.timeoutMs = clamp(Number(llm.timeoutMs) || 60000, 1000, 600000);

  const next = { ...raw, profile, llm };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return loadConfig(CONFIG_FILE);
}

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/bootstrap' && req.method === 'GET') {
    return json(res, 200, bootstrap());
  }

  if (p === '/api/update' && req.method === 'GET') {
    return json(res, 200, updateView());
  }

  if (p === '/api/update' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    // 不 await：更新可能跑几分钟，接口立即返回 running，前端靠 GET 轮询进度
    startUpdate({
      force: body.force !== false,
      discoveryQueries: body.discoveryQueries,
      watchCount: body.watchCount,
      hnLimit: body.hnLimit,
    });
    return json(res, 200, updateView());
  }

  if (p === '/api/find' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') ?? '').trim();
    if (!q) return json(res, 400, { error: '检索词不能为空' });
    if (updateGate(res, url.searchParams.get('stale') === '1')) return;
    const resu = search(q, {
      limit: clamp(Number(url.searchParams.get('limit')) || 20, 1, 60),
      minStars: Number(url.searchParams.get('minStars')) || 0,
      language: url.searchParams.get('lang') || null,
    });
    return json(res, 200, {
      need: q,
      caps: resu.caps.slice(0, 6).map((c) => ({
        id: c.id,
        zh: c.cap?.zh ?? c.id,
        en: c.cap?.en ?? '',
        weight: Math.round(c.weight * 100) / 100,
      })),
      results: resu.results.map((hit) => ({
        ...hit.repo,
        score: hit.score,
        why: explain(hit),
        capScore: Math.round(hit.capScore * 100) / 100,
        matchedCaps: hit.matchedCaps,
        matchedTerms: hit.matchedTerms,
        fresh: hit.fresh,
      })),
    });
  }

  if (p === '/api/caps' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') ?? '').toLowerCase();
    const list = capsView().filter((c) =>
      !q || `${c.zh} ${c.en} ${c.id}`.toLowerCase().includes(q)
    );
    return json(res, 200, { total: list.length, caps: list });
  }

  if (p === '/api/rising' && req.method === 'GET') {
    return json(res, 200, {
      rising: risingView(clamp(Number(url.searchParams.get('limit')) || 12, 1, 50)),
    });
  }

  if (p === '/api/config' && req.method === 'GET') {
    return json(res, 200, configView(loadConfig(CONFIG_FILE)));
  }

  if (p === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = saveConfig(body);
    return json(res, 200, configView(cfg));
  }

  if (p === '/api/decide' && req.method === 'POST') {
    const body = await readBody(req);
    const need = String(body.need ?? '').trim();
    if (!need) return json(res, 400, { error: '需求不能为空' });
    if (count() === 0) return json(res, 400, { error: '库里还没有数据，先运行 node oss.mjs harvest --full' });
    if (updateGate(res, body.allowStale === true)) return;

    const cfg = loadConfig(CONFIG_FILE);
    const result = await decide(need, {
      profile: cfg.profile,
      llm: cfg.llm,
      useLlm: body.useLlm !== false,
      limit: clamp(Number(body.limit) || 5, 1, 10),
    });

    let report = null;
    if (result.components.length) {
      const md = renderReport(result);
      const stamp = `${dateKey()}-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`;
      const name = `decide-${stamp}.md`;
      await writeText(path.join(PATHS.reports, name), md);
      report = { name, url: `/api/report?name=${encodeURIComponent(name)}` };
    }

    return json(res, 200, { result, report });
  }

  if (p === '/api/report' && req.method === 'GET') {
    const name = String(url.searchParams.get('name') ?? '');
    if (!/^decide-[\d-]{10,}\.md$/.test(name)) return json(res, 400, { error: '文件名不合法' });
    const file = path.join(PATHS.reports, name);
    if (!file.startsWith(PATHS.reports) || !fs.existsSync(file)) {
      return json(res, 404, { error: '报告不存在' });
    }
    const text = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': text.length,
    });
    return res.end(text);
  }

  return json(res, 404, { error: '接口不存在' });
}

function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (rel === '/') rel = '/index.html';

  const file = path.normalize(path.join(WEB_ROOT, rel));
  if (!file.startsWith(WEB_ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* 打不开浏览器不影响服务 */
  }
}

export function startServer({
  port = 7788,
  openBrowser = true,
  autoUpdate = true,
  updateOptions = {},
} = {}) {
  open();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((err) => {
        if (!res.headersSent) json(res, 500, { error: err.message || '服务异常' });
        else res.end();
      });
      return;
    }
    serveStatic(req, res, url);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      const url = `http://127.0.0.1:${actual}`;
      if (openBrowser) openInBrowser(url);
      // 先起服务再更新：浏览器不用干等 4–5 分钟，界面里能看到进度
      if (autoUpdate) startUpdate(updateOptions);
      resolve({ url, port: actual, server, close: () => server.close() });
    });
  });
}
