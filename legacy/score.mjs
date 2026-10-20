import { CONFIG } from './config.mjs';
import { clamp } from './lib.mjs';

const HAYSTACK_FIELDS = (repo) => [
  repo.full_name,
  repo.description ?? '',
  (repo.topics ?? []).join(' '),
  repo.language ?? '',
].join(' ').toLowerCase();

const KW_CACHE = new Map();

/**
 * 短关键词必须按词边界匹配，否则 "photocraft" 会命中 "ocr"、"detail" 会命中 "ai"。
 * 长关键词仍用子串匹配，这样 "fine-tun" 这类前缀写法才有意义。
 */
function keywordMatcher(kw) {
  const cached = KW_CACHE.get(kw);
  if (cached) return cached;

  let test;
  if (kw.length <= 4) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
    test = (hay) => re.test(hay);
  } else {
    test = (hay) => hay.includes(kw);
  }
  KW_CACHE.set(kw, test);
  return test;
}

/** 命中兴趣方向，返回 [{id, label, weight, hits}]，主方向取权重最高者 */
export function matchInterests(repo) {
  const hay = HAYSTACK_FIELDS(repo);
  const out = [];
  for (const [id, meta] of Object.entries(CONFIG.interest)) {
    if (id === 'general') continue;
    const hits = CONFIG.keywords[id].filter((kw) => keywordMatcher(kw)(hay));
    if (hits.length) out.push({ id, label: meta.label, weight: meta.weight, hits: hits.slice(0, 4) });
  }
  out.sort((a, b) => b.weight - a.weight || b.hits.length - a.hits.length);
  return out;
}

export function primaryCategory(repo) {
  const matched = matchInterests(repo);
  return matched[0] ?? { id: 'general', label: CONFIG.interest.general.label, weight: CONFIG.interest.general.weight, hits: [] };
}

export function isBlocked(repo) {
  const hay = HAYSTACK_FIELDS(repo);
  return CONFIG.blockPatterns.some((p) => hay.includes(p));
}

export function ageDays(repo, now = Date.now()) {
  return Math.max(0, (now - new Date(repo.created_at).getTime()) / 86400000);
}

/**
 * 硬过滤：返回 null 表示通过，返回字符串表示丢弃原因。
 * 过滤逻辑刻意保守——宁可留下边缘项目，也别把真正有意思的漏掉。
 */
export function filterRepo(repo, now = Date.now()) {
  const stars = repo.stargazers_count ?? 0;
  const age = ageDays(repo, now);
  if (repo.fork) return 'fork';
  if (repo.archived) return 'archived';
  if (stars < CONFIG.minStars) return 'too-few-stars';
  if (age > CONFIG.maxAgeDaysHard) return 'too-old';
  if (isBlocked(repo)) return 'list-or-tutorial';
  if (!repo.description && !(repo.topics ?? []).length) return 'no-description';
  const spd = stars / Math.max(age, 1);
  if (age > 730 && spd < CONFIG.minStarsPerDay) return 'stagnant';
  return null;
}

/**
 * 打分：成长速度为主，24h 增量为强信号，兴趣方向与 HN 热度加分。
 * 结果写进 candidate.factors，日报可以据此解释「为什么值得看」。
 */
export function scoreRepo(repo, { delta = 0, hn = null } = {}) {
  const now = Date.now();
  const age = ageDays(repo, now);
  const stars = repo.stargazers_count ?? 0;
  const spd = stars / Math.max(age, 1);
  const cat = primaryCategory(repo);
  const hnPoints = hn?.points ?? 0;

  const parts = {
    growth: 2.2 * Math.log10(1 + spd),
    scale: 1.0 * Math.log10(1 + stars),
    momentum: 2.6 * Math.log10(1 + Math.max(delta, 0)),
    interest: 0.9 * (cat.weight ?? 0.45),
    hn: 0.8 * Math.log10(1 + hnPoints),
  };

  let recency = 1;
  if (age < 7) recency = 1.25;
  else if (age < 30) recency = 1.12;
  else if (age < 90) recency = 1.04;

  const raw = Object.values(parts).reduce((a, b) => a + b, 0);
  const score = raw * recency;

  return {
    score: Math.round(score * 100) / 100,
    factors: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    recency,
    starsPerDay: Math.round(spd * 10) / 10,
    ageDays: Math.round(age),
    category: cat,
  };
}

/** 生成一句中文推荐理由，纯规则、可复现 */
export function buildReason(candidate) {
  const { factors, stars, delta, hn } = candidate;
  const fmt = (x) => Number(x ?? 0).toLocaleString('en-US');
  const spd = factors.starsPerDay >= 100 ? fmt(Math.round(factors.starsPerDay)) : factors.starsPerDay;
  const bits = [];

  if (factors.ageDays <= 14 && delta > 0) {
    bits.push(`上线才 ${Math.max(factors.ageDays, 1)} 天，24 小时又涨 ${fmt(delta)} star`);
  } else if (factors.ageDays <= 30) {
    bits.push(`${factors.ageDays} 天的新项目，已经攒到 ${fmt(stars)} star，日均 ${spd}`);
  } else if (delta >= 100) {
    bits.push(`一天 +${fmt(delta)} star，正在被快速发现`);
  } else if (factors.starsPerDay >= 20) {
    bits.push(`长期保持日均 ${spd} star 的增速`);
  } else {
    bits.push(`${fmt(stars)} star，日均增长 ${spd}`);
  }

  if (hn?.points >= CONFIG.hnMinPoints) {
    bits.push(`Hacker News 上 ${hn.points} 分、${hn.comments} 条讨论`);
  }

  const hits = candidate.category.hits ?? [];
  if (hits.length) {
    bits.push(`关键词命中：${hits.slice(0, 3).join(' / ')}`);
  }

  return bits.join('；') + '。';
}

/** 附在日报末尾的“值不值得看”判断，避免只堆数据 */
export function buildVerdict(candidate) {
  const { factors, repo } = candidate;
  const spd = factors.starsPerDay;
  const young = factors.ageDays <= 30;

  if (young && spd >= 50) return '早期爆发型，值得立刻读代码，注意可能还在快速迭代期。';
  if (young && spd >= 15) return '上升期的小而美项目，适合放进观察名单。';
  if (!young && spd >= 30) return '成熟项目仍在高速增长，通常意味着刚补上了关键能力。';
  if (!young && spd >= 8) return '稳定增长的实用工具，适合直接拿去解决手头问题。';
  if (repo.language && ['Rust', 'C', 'C++', 'Zig', 'Assembly'].includes(repo.language)) {
    return '底层实现类项目，读源码的信息密度通常比用起来更高。';
  }
  return '热度一般，但值得扫一眼它的设计取舍。';
}

export function normalize(raw, meta) {
  return {
    key: raw.full_name,
    repo: raw,
    name: raw.name,
    fullName: raw.full_name,
    url: raw.html_url,
    description: (raw.description ?? '').trim(),
    language: raw.language ?? '—',
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    issues: raw.open_issues_count ?? 0,
    topics: raw.topics ?? [],
    license: raw.license?.spdx_id ?? null,
    createdAt: raw.created_at,
    pushedAt: raw.pushed_at,
    homepage: raw.homepage || null,
    delta: meta.delta ?? 0,
    hn: meta.hn ?? null,
    sources: meta.sources ?? [],
  };
}
