import { sleep, log } from './lib.mjs';

const API = 'https://api.github.com';

const BASE_HEADERS = {
  'User-Agent': 'oss-radar/1.0 (+https://github.com)',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

let lastSearchAt = 0;

/** 搜索接口：匿名 10 次/分钟，顺序调用 + 硬性间隔，并尊重 reset 头 */
export async function searchRepos(query, { sort = 'stars', order = 'desc', perPage = 40, token } = {}) {
  const headers = { ...BASE_HEADERS };
  if (token) headers.Authorization = `Bearer ${token}`;

  const wait = Math.max(0, lastSearchAt + 6500 - Date.now());
  if (wait > 0) await sleep(wait);

  const url =
    `${API}/search/repositories?q=${encodeURIComponent(query)}` +
    `&sort=${sort}&order=${order}&per_page=${perPage}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    lastSearchAt = Date.now();
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    } catch (err) {
      log(`  ! network error (${query}): ${err.message}, retry ${attempt}`);
      await sleep(5000 * attempt);
      continue;
    }

    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const waitMs = reset > Date.now() ? reset - Date.now() + 2000 : 30000;
      log(`  ! rate limited on search, sleeping ${Math.round(waitMs / 1000)}s`);
      await sleep(Math.min(waitMs, 120000));
      continue;
    }
    if (!res.ok) {
      log(`  ! search ${res.status} for ${query}, retry ${attempt}`);
      await sleep(3000 * attempt);
      continue;
    }
    const json = await res.json();
    return json.items ?? [];
  }
  log(`  ! search failed permanently: ${query}`);
  return [];
}

/** 单仓库元数据（核心接口 60 次/小时，只用于少量 HN 独家发现） */
export async function getRepo(fullName, { token } = {}) {
  const headers = { ...BASE_HEADERS };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${API}/repos/${fullName}`, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
