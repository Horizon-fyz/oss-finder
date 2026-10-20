import { CAPABILITIES } from './taxonomy.mjs';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[_/]/g, ' ');

function haystack(repo) {
  return {
    name: norm(repo.full_name),
    desc: norm(repo.description),
    topics: new Set((repo.topics ?? []).map((t) => String(t).toLowerCase())),
    all: [norm(repo.full_name), norm(repo.description), norm((repo.topics ?? []).join(' '))].join(' '),
  };
}

/**
 * 给一个仓库打能力标签。
 * hintCap 是采集时的来源能力（用 topic 搜到的），权重最高——这是最干净的信号。
 */
export function tagRepo(repo, { hintCap = null } = {}) {
  const hay = haystack(repo);
  const scores = new Map();

  const bump = (id, n) => scores.set(id, (scores.get(id) ?? 0) + n);

  if (hintCap) bump(hintCap, 4);

  for (const cap of CAPABILITIES) {
    // 1) topic 精确命中
    const topicHits = cap.topics.filter((t) => hay.topics.has(String(t).toLowerCase())).length;
    if (topicHits) bump(cap.id, 3 + topicHits);

    // 2) 英文别名命中描述/名称
    let aliasHits = 0;
    for (const a of cap.aliases) {
      const needle = norm(a);
      if (needle.length < 3) continue;
      if (hay.all.includes(needle)) aliasHits++;
    }
    if (aliasHits) bump(cap.id, Math.min(aliasHits, 3));

    // 3) 中文说法命中（中文仓库描述）
    for (const z of cap.zhAliases) {
      if (z.length < 2) continue;
      if (String(repo.description ?? '').includes(z)) {
        bump(cap.id, 2);
        break;
      }
    }
  }

  const ranked = [...scores.entries()]
    .filter(([, s]) => s >= 2)
    .sort((a, b) => b[1] - a[1]);

  // 最多留 5 个标签，第一个是主分类
  // （留 3 个会让 MinerU 这种「pdf/ocr/office/doc-parsing」都沾的项目丢掉关键标签）
  const caps = ranked.slice(0, 5).map(([id]) => id);
  const capScores = Object.fromEntries(ranked.slice(0, 5));

  return {
    caps,
    capScores,
    category: caps[0] ?? 'uncategorized',
    quality: qualityScore(repo),
  };
}

/** 0–100 的粗粒度质量分，用于检索时压制「星多但死了」和「新但没人维护」的项目 */
export function qualityScore(repo) {
  const stars = repo.stargazers_count ?? 0;
  const pushed = repo.pushed_at ? new Date(repo.pushed_at).getTime() : 0;
  const ageDays = pushed ? (Date.now() - pushed) / 864e5 : 9999;

  let q = Math.log10(stars + 1) * 12;           // 星数：1e2→24, 1e3→36, 1e4→48
  if (ageDays < 90) q += 14;
  else if (ageDays < 365) q += 8;
  else if (ageDays < 730) q += 2;
  else q -= 8;
  if (repo.license?.spdx_id) q += 4;
  if (repo.description) q += 3;
  if (repo.archived) q -= 40;
  if (repo.fork) q -= 10;
  return Math.round(Math.max(0, Math.min(100, q)) * 10) / 10;
}
