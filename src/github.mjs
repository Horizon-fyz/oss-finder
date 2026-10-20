import { sleep, log } from './lib.mjs';

const API = 'https://api.github.com';

const BASE_HEADERS = {
  'User-Agent': 'oss-finder/2.0 (+https://github.com/Horizon-fyz/oss-finder)',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

let lastSearchAt = 0;

/** 显式传入的 token 优先，其次读取环境变量，保证建库与检索都能用上配额 */
function tokenOf(token) {
  return token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

function authHeaders(token) {
  const headers = { ...BASE_HEADERS };
  const t = tokenOf(token);
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

/** 403 不一定是限流（也可能是权限/滥用检测），只有配额耗尽或响应体提示才算 */
async function isRateLimited(res) {
  if (res.status === 429) return true;
  if (res.headers.get('x-ratelimit-remaining') === '0') return true;
  const body = await res.text().catch(() => '');
  return /rate limit/i.test(body);
}

/** 搜索接口：匿名 10 次/分钟，顺序调用 + 硬性间隔，并尊重 reset 头 */
export async function searchRepos(query, { sort = 'stars', order = 'desc', perPage = 40, token } = {}) {
  const headers = authHeaders(token);

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
      if (!(await isRateLimited(res))) {
        log(`  ! search ${res.status} for ${query}（非限流，放弃）`);
        return [];
      }
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
  const headers = authHeaders(token);
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
