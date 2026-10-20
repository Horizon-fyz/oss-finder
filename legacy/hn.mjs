import { CONFIG } from './config.mjs';
import { log } from './lib.mjs';

const HN_API = 'https://hn.algolia.com/api/v1/search';

/**
 * Hacker News 信号：最近 48 小时、分数达标的 story 里，挑出指向 GitHub 仓库的。
 * 这是「有意思」这件事上最好的外部信号——star 数只能说明体量，HN 讨论说明它真的让人兴奋。
 */
export async function fetchHackerNews({ hours = CONFIG.hnLookbackHours, minPoints = CONFIG.hnMinPoints } = {}) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const url =
    `${HN_API}?tags=story` +
    `&numericFilters=${encodeURIComponent(`created_at_i>${since},points>${minPoints}`)}` +
    `&hitsPerPage=200`;

  let hits = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      log(`  ! HN responded ${res.status}`);
      return new Map();
    }
    const json = await res.json();
    hits = json.hits ?? [];
  } catch (err) {
    log(`  ! HN unreachable: ${err.message}`);
    return new Map();
  }

  const map = new Map();
  for (const hit of hits) {
    const fullName = parseRepoFromUrl(hit.url);
    if (!fullName) continue;
    const prev = map.get(fullName);
    if (prev && prev.points >= (hit.points ?? 0)) continue;
    map.set(fullName, {
      key: fullName,
      points: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      title: hit.title ?? '',
      hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      postedAt: hit.created_at,
    });
  }
  log(`  HN: ${hits.length} stories scanned, ${map.size} github repos`);
  return map;
}

export function parseRepoFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length < 2) return null;
    const [owner, repo] = seg;
    if (!owner || !repo) return null;
    if (['topics', 'trending', 'collections', 'sponsors', 'features', 'marketplace'].includes(owner)) return null;
    return `${owner}/${repo.replace(/\.git$/, '')}`;
  } catch {
    return null;
  }
}
