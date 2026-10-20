#!/usr/bin/env node
import path from 'node:path';
import fsSync from 'node:fs';
import { CONFIG } from './config.mjs';
import {
  PATHS,
  dateKey,
  shiftDays,
  log,
  readJson,
  writeJson,
  writeText,
  sleep,
} from './lib.mjs';
import { searchRepos, getRepo } from './github.mjs';
import { fetchHackerNews } from './hn.mjs';
import {
  normalize,
  filterRepo,
  scoreRepo,
  buildReason,
  buildVerdict,
} from './score.mjs';
import {
  loadState,
  saveState,
  observe,
  isRecentlyRecommended,
  markRecommended,
} from './store.mjs';
import { renderMarkdown } from './report.mjs';

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const OPTS = {
  top: Number(option('top', CONFIG.dailyTop)),
  dry: flag('dry'),
  verbose: flag('verbose'),
  noHn: flag('no-hn'),
  rebuild: flag('rebuild'),
  ifMissing: flag('if-missing'),
  force: flag('force'),
  maxQueries: Number(option('queries', 99)),
};

const today = dateKey();
const now = Date.now();

function shanghaiWeekday(dateStr) {
  return new Date(`${dateStr}T12:00:00+08:00`).getDay();
}

function expandDate(query) {
  return query.replace(/\{(\d+)d\}/g, (_, d) => shiftDays(-Number(d)));
}

function buildQueries() {
  const core = CONFIG.queries.core.map((q) => ({ ...q, q: expandDate(q.q) }));
  const weekday = shanghaiWeekday(today);
  const rotating = (CONFIG.queries.byWeekday[weekday] ?? []).map((q) => ({ ...q, q: expandDate(q.q) }));
  return [...core, ...rotating].slice(0, OPTS.maxQueries);
}

function buildCandidate(raw, meta) {
  const normalized = normalize(raw, meta);
  const scored = scoreRepo(raw, { delta: normalized.delta, hn: normalized.hn });
  const candidate = {
    ...normalized,
    score: scored.score,
    factors: { ...scored.factors, starsPerDay: scored.starsPerDay, ageDays: scored.ageDays },
    category: scored.category,
  };
  candidate.reason = buildReason(candidate);
  candidate.verdict = buildVerdict(candidate);
  return candidate;
}

// ---------- 重建模式：不联网，只用 latest.json 重渲染模板 ----------
async function rebuild() {
  const latest = await readJson(PATHS.latest, null);
  if (!latest) {
    log('no data/latest.json to rebuild from');
    process.exit(1);
  }
  const md = renderMarkdown(latest);
  await writeText(path.join(PATHS.reports, `${latest.date}.md`), md);
  log(`rebuilt reports/${latest.date}.md`);
}

// ---------- 主流程 ----------
async function main() {
  if (OPTS.rebuild) return rebuild();

  // 登录补跑模式：今天的日报已经生成过就直接退出，避免重复采集
  if (OPTS.ifMissing) {
    const existing = path.join(PATHS.reports, `${today}.md`);
    const found = fsSync.existsSync(existing);
    if (found) {
      log(`${today} report already exists, catch-up run skipped`);
      return;
    }
  }

  log(`=== oss-radar ${today} ===`);
  const state = await loadState();
  const queries = buildQueries();
  log(`queries: ${queries.map((q) => q.id).join(', ')}`);

  // 1) GitHub 搜索
  const byKey = new Map();
  const queryStats = [];
  for (const q of queries) {
    const items = await searchRepos(q.q, { sort: q.sort })
      .catch((err) => {
        log(`  ! query ${q.id} failed: ${err.message}`);
        return [];
      })
      .then((items) => items.filter((it) => it && it.full_name));
    log(`  ${q.id}: ${items.length} repos`);
    for (const it of items) {
      const existing = byKey.get(it.full_name);
      if (existing) {
        if (!existing.__sources.includes(q.id)) existing.__sources.push(q.id);
      } else {
        byKey.set(it.full_name, { ...it, __sources: [q.id] });
      }
    }
    queryStats.push({ id: q.id, label: q.label, q: q.q, count: items.length });
  }
  log(`unique repos from search: ${byKey.size}`);

  // 2) Hacker News 信号
  const hnMap = OPTS.noHn ? new Map() : await fetchHackerNews();

  // 3) HN 独家发现，补查元数据（核心接口，额度宽裕）
  let hnEnriched = 0;
  if (!OPTS.noHn) {
    for (const key of hnMap.keys()) {
      if (byKey.has(key)) continue;
      if (hnEnriched >= CONFIG.hnEnrichLimit) break;
      const raw = await getRepo(key);
      hnEnriched++;
      if (!raw || !raw.full_name) continue;
      byKey.set(raw.full_name, { ...raw, __sources: ['hn'] });
      await sleep(400);
    }
    log(`  HN-only repos enriched: ${hnEnriched}`);
  }

  // 4) 过滤 / 记账 / 打分
  const candidates = [];
  const dropped = {};
  const bump = (reason) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };

  for (const [key, raw] of byKey) {
    const reason = filterRepo(raw, now);
    if (reason) {
      bump(reason);
      continue;
    }
    const meta = observe(state, raw, today);
    if (isRecentlyRecommended(state, key, today, CONFIG.dedupeDays) && meta.delta < CONFIG.resurfaceDelta) {
      bump('recently-featured');
      continue;
    }
    candidates.push(buildCandidate(raw, { delta: meta.delta, hn: hnMap.get(key) ?? null }));
  }

  candidates.sort((a, b) => b.score - a.score);
  log(`candidates: ${candidates.length}`);

  const picks = candidates.slice(0, OPTS.top);
  const alternates = candidates.slice(OPTS.top);
  const pickKeys = new Set(picks.map((p) => p.fullName));
  const hnOnly = candidates
    .filter((c) => c.hn && !pickKeys.has(c.fullName))
    .sort((a, b) => (b.hn?.points ?? 0) - (a.hn?.points ?? 0))
    .slice(0, 10)
    .map((c) => ({
      fullName: c.fullName,
      url: c.url,
      points: c.hn.points,
      comments: c.hn.comments,
      title: c.hn.title,
      hnUrl: c.hn.hnUrl,
      stars: c.stars,
      language: c.language,
      description: c.description,
    }));

  const payload = {
    date: today,
    generatedAt: new Date().toISOString(),
    stats: {
      queries: queryStats,
      rawRepos: byKey.size,
      candidates: candidates.length,
      dropped,
      hnStories: hnMap.size,
      hnEnriched,
    },
    picks: picks.map((p) => ({
      fullName: p.fullName,
      url: p.url,
      name: p.name,
      description: p.description,
      language: p.language,
      stars: p.stars,
      forks: p.forks,
      delta: p.delta,
      license: p.license,
      topics: p.topics,
      homepage: p.homepage,
      createdAt: p.createdAt,
      pushedAt: p.pushedAt,
      score: p.score,
      factors: p.factors,
      category: p.category,
      reason: p.reason,
      verdict: p.verdict,
      hn: p.hn,
      sources: p.sources,
    })),
    alternates: alternates.slice(0, 20).map((p) => ({
      fullName: p.fullName,
      url: p.url,
      description: p.description,
      language: p.language,
      stars: p.stars,
      delta: p.delta,
      score: p.score,
      factors: p.factors,
      category: p.category,
      hn: p.hn,
    })),
    hnOnly,
  };

  // 5) 落盘
  const md = renderMarkdown(payload);
  const reportPath = path.join(PATHS.reports, OPTS.dry ? `dry-${today}.md` : `${today}.md`);

  // 同一天重复跑时，如果已经没有新候选，别用空报告覆盖已经生成的好报告
  if (!OPTS.dry && !OPTS.force && picks.length === 0 && fsSync.existsSync(reportPath)) {
    log('no fresh candidates (all already featured today), keeping existing report');
    return;
  }

  await writeText(reportPath, md);
  await writeJson(PATHS.latest, payload);

  if (!OPTS.dry) {
    markRecommended(state, picks.map((p) => p.fullName), today);
    state.runs.push({
      date: today,
      at: new Date().toISOString(),
      queries: queryStats.map((q) => q.id),
      candidates: candidates.length,
      picked: picks.length,
    });
    await saveState(state);
  }

  // 6) 控制台摘要（ASCII，避免代码页问题）
  log(`report -> ${reportPath.replace(PATHS.root, '.')}`);
  picks.slice(0, 5).forEach((p, i) => {
    log(`  #${i + 1} ${p.fullName} (${p.language}, ${p.stars}*, +${p.delta}, score ${p.score})`);
  });
  log('done');
}

main().catch((err) => {
  log(`FATAL: ${err.stack || err.message}`);
  process.exitCode = 1;
});
