import { searchRepos } from './github.mjs';
import { upsertRepo, count, open } from './db.mjs';
import { tagRepo } from './tag.mjs';
import { collectQueries } from './taxonomy.mjs';
import { log } from './lib.mjs';

function dayOfYear(d = new Date()) {
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
}

function rotate(list, n) {
  if (n >= list.length) return list;
  const start = (dayOfYear() * n) % list.length;
  return Array.from({ length: n }, (_, i) => list[(start + i) % list.length]);
}

/**
 * 采集：按能力 topic 搜索，给每条结果打上能力标签后入库。
 * full=true 跑全量（首次建库），否则按天轮换一小批做增量。
 */
export async function harvest({ full = false, perDay = 10, perPage = 50 } = {}) {
  const all = collectQueries({ topicsPerCap: 1 });
  const queries = full ? all : rotate(all, perDay);
  const before = count();

  log(`harvest: ${queries.length}/${all.length} queries, db has ${before} repos`);

  let fetched = 0;
  let failed = 0;

  for (const [i, q] of queries.entries()) {
    let items = [];
    try {
      items = await searchRepos(q.q, { sort: 'stars', perPage });
    } catch (err) {
      failed++;
      log(`  ! ${q.topic}: ${err.message}`);
      continue;
    }

    for (const repo of items) {
      if (!repo?.full_name) continue;
      const tag = tagRepo(repo, { hintCap: q.cap });
      upsertRepo(repo, { ...tag, source: `topic:${q.topic}` });
      fetched++;
    }
    log(`  [${i + 1}/${queries.length}] ${q.cap}/${q.topic}: ${items.length} repos (total seen ${fetched})`);
  }

  const after = count();
  log(`harvest done: +${after - before} new repos (db ${after}), ${fetched} records touched, ${failed} failed queries`);
  return { before, after, fetched, failed };
}

/** 重建标签（改了 taxonomy 之后用）：把已有仓库重新打标 */
export function retagAll() {
  const d = open();
  const rows = d.prepare('SELECT * FROM repos').all();
  let n = 0;
  for (const row of rows) {
    const topics = JSON.parse(row.topics_json || '[]');
    const repo = {
      full_name: row.full_name,
      html_url: row.url,
      description: row.description,
      language: row.language,
      topics,
      stargazers_count: row.stars,
      forks_count: row.forks,
      license: row.license ? { spdx_id: row.license } : null,
      created_at: row.created_at,
      pushed_at: row.pushed_at,
      archived: !!row.archived,
      homepage: row.homepage,
    };
    const tag = tagRepo(repo, { hintCap: String(row.caps || '').split(' ')[0] || null });
    upsertRepo(repo, { ...tag, source: row.source ?? '' });
    n++;
  }
  log(`retagged ${n} repos`);
  return n;
}
