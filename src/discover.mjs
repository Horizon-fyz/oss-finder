import { searchRepos, getRepo } from './github.mjs';
import { upsertRepo, watchlist, touchStars, recordSnapshot, stats } from './db.mjs';
import { tagRepo } from './tag.mjs';
import { log, sleep, shiftDays } from './lib.mjs';

const LANGS = ['Rust', 'Go', 'Python', 'TypeScript', 'C++', 'C', 'Zig', 'Kotlin', 'Swift', 'Java'];

/** 配了 GITHUB_TOKEN 就用认证额度，避免匿名 60 次/小时的核心接口被打满 */
const ghToken = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;

/**
 * 发现新项目的查询：不按 topic 过滤，只看「创建得晚 + 涨得快」。
 * 这是抓「冷门项目突然爆火」的主通道——topic 搜索永远只会捞已经成名的。
 */
export function risingQueries(dayOffset = Math.floor(Date.now() / 864e5)) {
  const lang = LANGS[dayOffset % LANGS.length];
  return [
    { id: 'new-3d', label: '三天内新项目', q: `created:>${shiftDays(-3)} stars:>15`, sort: 'stars' },
    { id: 'new-7d', label: '一周内冒头', q: `created:>${shiftDays(-7)} stars:>60`, sort: 'stars' },
    { id: 'new-14d', label: '两周内爆发', q: `created:>${shiftDays(-14)} stars:>200`, sort: 'stars' },
    { id: 'new-30d', label: '一月内爆发', q: `created:>${shiftDays(-30)} stars:>400`, sort: 'stars' },
    { id: 're-accel', label: '老项目突然活跃', q: `pushed:>${shiftDays(-2)} created:<${shiftDays(-60)} stars:>150`, sort: 'updated' },
    { id: `lang-${lang}`, label: `${lang} 新项目`, q: `language:${lang} created:>${shiftDays(-10)} stars:>20`, sort: 'stars' },
  ];
}

const HN_API = 'https://hn.algolia.com/api/v1/search';

/** Hacker News 是「突然有人在讨论」最快的信号源 */
export async function fetchHnSignals({ hours = 36, minPoints = 15 } = {}) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const url =
    `${HN_API}?tags=story&numericFilters=${encodeURIComponent(`created_at_i>${since},points>${minPoints}`)}&hitsPerPage=200`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return [];
    const json = await res.json();
    const out = new Map();
    for (const hit of json.hits ?? []) {
      const name = parseRepoUrl(hit.url);
      if (!name) continue;
      const prev = out.get(name);
      if (prev && prev.points >= hit.points) continue;
      out.set(name, {
        fullName: name,
        points: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
        title: hit.title ?? '',
        url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      });
    }
    return [...out.values()].sort((a, b) => b.points - a.points);
  } catch (err) {
    log(`  ! HN unreachable: ${err.message}`);
    return [];
  }
}

function parseRepoUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length < 2) return null;
    if (['topics', 'trending', 'collections', 'sponsors', 'marketplace', 'features'].includes(seg[0])) return null;
    return `${seg[0]}/${seg[1].replace(/\.git$/, '')}`;
  } catch {
    return null;
  }
}

function ageInDays(iso) {
  if (!iso) return 1;
  return Math.max(1, (Date.now() - new Date(iso).getTime()) / 864e5);
}

/** 入库一个新发现的项目，并立刻记下第一个快照（heat 用「建仓以来日均」起步） */
function ingest(repo, source) {
  const tag = tagRepo(repo);
  const { id, inserted } = upsertRepo(repo, { ...tag, source });
  if (inserted) {
    recordSnapshot(id, repo.stargazers_count ?? 0, { ageDays: ageInDays(repo.created_at) });
  }
  return inserted;
}

/**
 * 每日更新：发现 → 补社区信号 → 刷新 watchlist 的真实星数。
 * 全程约 4–5 分钟，解不了 GitHub 的限制（搜索 10 次/分钟、核心接口 60 次/小时）。
 * onProgress 用于把当前阶段推给界面，避免用户以为卡死了。
 */
export async function dailyUpdate({
  discoveryQueries = 6,
  watchCount = 38,
  hnLimit = 8,
  onProgress = () => {},
} = {}) {
  const before = stats().total;
  const token = ghToken();
  let discovered = 0;

  // 1) 新项目扫荡
  const queries = risingQueries().slice(0, discoveryQueries);
  log(`discovery: ${queries.length} queries`);
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    onProgress({ key: 'discover', label: '发现新项目', i: i + 1, total: queries.length });
    let items = [];
    try {
      items = await searchRepos(q.q, { sort: q.sort, perPage: 50, token });
    } catch (err) {
      log(`  ! ${q.id}: ${err.message}`);
      continue;
    }
    let added = 0;
    for (const repo of items) {
      if (!repo?.full_name) continue;
      if (ingest(repo, `rising:${q.id}`)) added++;
    }
    discovered += added;
    log(`  ${q.id}: ${items.length} repos, +${added} new`);
  }

  // 2) HN 讨论信号（新出现的仓库才补查元数据，省核心接口额度）
  onProgress({ key: 'signal', label: '读取社区信号', i: 1, total: 1 });
  const hn = await fetchHnSignals();
  let hnAdded = 0;
  for (const story of hn.slice(0, hnLimit)) {
    const repo = await getRepo(story.fullName, { token });
    await sleep(300);
    if (!repo?.full_name) continue;
    if (ingest(repo, `hn:${story.points}`)) hnAdded++;
  }
  log(`hn: ${hn.length} github repos discussed, +${hnAdded} new`);

  // 3) 刷新 watchlist：把「新出现的小项目」的真实星数拉回来，算出增速
  const targets = watchlist(watchCount);
  let polled = 0;
  onProgress({ key: 'refresh', label: '刷新热度', i: 0, total: targets.length });
  for (const t of targets) {
    const repo = await getRepo(t.full_name, { token });
    await sleep(250);
    if (!repo?.full_name) continue;
    touchStars(t.id, repo.stargazers_count ?? 0, { ageDays: ageInDays(repo.created_at) });
    polled++;
    if (polled % 5 === 0) {
      onProgress({ key: 'refresh', label: '刷新热度', i: polled, total: targets.length });
    }
  }
  onProgress({ key: 'refresh', label: '刷新热度', i: polled, total: targets.length });
  log(`watchlist: refreshed ${polled}/${targets.length} repos`);

  const after = stats().total;
  log(`daily done: +${after - before} repos (db ${after}), ${polled} refreshed`);
  return { discovered, hnAdded, polled, before, after };
}
