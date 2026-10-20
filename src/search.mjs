import { CAPABILITIES, CAP_BY_ID } from './taxonomy.mjs';
import { ftsCandidates, getRepos, capCounts } from './db.mjs';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'of', 'in', 'on', 'at', 'by', 'from',
  'my', 'i', 'we', 'you', 'it', 'is', 'are', 'be', 'want', 'need', 'build', 'make', 'create',
  'tool', 'project', 'app', 'application', 'system', 'library', 'framework', 'service',
  'using', 'use', 'used', 'can', 'that', 'this', 'how', 'what', 'which', 'some', 'any',
  'fast', 'simple', 'small', 'good', 'best', 'new', 'open', 'source', 'implement', 'support',
]);

const CJK = /[\u4e00-\u9fff]/;

const INTENTS = [
  { zh: ['提取', '抽取', '解析', '结构化'], en: ['extract', 'parse', 'parsing', 'extraction', 'structur'] },
  { zh: ['转换', '转成', '导出', '转 pdf', '转 word'], en: ['convert', 'conversion', 'export'] },
  { zh: ['生成', '产出', '渲染'], en: ['generate', 'generation', 'render'] },
  { zh: ['编辑', '修改'], en: ['editor', 'editing', 'edit '] },
  { zh: ['识别', '检测'], en: ['recognition', 'recognize', 'detect'] },
  { zh: ['爬', '抓取'], en: ['crawl', 'scrap', 'spider'] },
  { zh: ['搜索', '检索'], en: ['search', 'retrieval', 'retriev', 'index'] },
  { zh: ['压缩'], en: ['compress', 'zip', 'archive'] },
  { zh: ['部署', '编排'], en: ['deploy', 'orchestr', 'kubernetes'] },
  { zh: ['播放'], en: ['player', 'playback'] },
  { zh: ['同步', '备份'], en: ['sync', 'backup', 'replicat'] },
];

function detectIntents(lower) {
  const out = [];
  for (const it of INTENTS) {
    if (it.zh.some((z) => lower.includes(z))) out.push(...it.en);
  }
  return [...new Set(out)];
}

/**
 * 把一句中文/英文需求翻译成：命中的能力 + 检索词 + 过滤条件。
 * 这是整个系统最关键的一步——中文需求要能对上英文描述。
 */
export function parseNeed(text) {
  const raw = String(text ?? '').trim();
  const lower = raw.toLowerCase();
  const capHits = new Map();
  const addCap = (id, w) => capHits.set(id, Math.max(capHits.get(id) ?? 0, w));

  for (const cap of CAPABILITIES) {
    // 中文说法（也包含 PDF / Excel / GPU 这类拉丁缩写）
    // 「表格提取」比「表格」更具体，按匹配长度加权，避免泛化词压过精确意图
    for (const z of cap.zhAliases) {
      if (z.length >= 2 && lower.includes(z.toLowerCase())) {
        addCap(cap.id, Math.min(1.3, 0.5 + z.length * 0.1));
      }
    }
    // 能力中文名本身
    if (lower.includes(cap.zh.toLowerCase())) addCap(cap.id, 0.9);
    // 英文别名直接出现在需求里
    for (const a of cap.aliases) {
      if (a.length >= 3 && lower.includes(a.toLowerCase())) addCap(cap.id, 0.8);
    }
  }

  // 英文词 → 能力
  const tokens = lower
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const terms = new Set();
  for (const t of tokens) {
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    terms.add(t);
    for (const cap of CAPABILITIES) {
      if (cap.aliases.some((a) => a.toLowerCase() === t)) addCap(cap.id, 0.6);
    }
  }

  // 中文里的拉丁缩写（PDF / OCR / GPU / K8s…）
  for (const m of raw.match(/[A-Za-z][A-Za-z0-9+#.]{1,12}/g) ?? []) {
    const t = m.toLowerCase();
    if (!STOPWORDS.has(t)) terms.add(t);
  }

  // 没有命中任何能力时，用中文二元片段兜底（对中文描述做子串匹配用）
  const cjkChunks = CJK.test(raw) ? raw.match(/[\u4e00-\u9fff]{2,}/g) ?? [] : [];

  const caps = [...capHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, weight]) => ({ id, weight, cap: CAP_BY_ID.get(id) }))
    .filter((c) => c.cap);

  return { raw, caps, terms: [...terms], cjkChunks, intents: detectIntents(lower) };
}

function escapeFts(term) {
  return String(term).replace(/"/g, ' ').replace(/[()*:^-]/g, ' ').trim();
}

function buildMatch({ terms, caps }) {
  const clauses = new Set();
  for (const t of terms) {
    const clean = escapeFts(t);
    if (clean) clauses.add(`"${clean}"*`);
  }
  // 用能力的关键别名扩展召回：即使描述里没有需求原词也能找到
  for (const { cap } of caps.slice(0, 3)) {
    for (const a of cap.aliases.slice(0, 4)) {
      const clean = escapeFts(a);
      if (clean) clauses.add(`"${clean}"*`);
    }
  }
  return [...clauses].join(' OR ');
}

const FRESH_DAYS = 365;

/** 书/教程/清单类仓库不是「能直接用的轮子」，检索时排除 */
const NOISE = /(^|[\s\-_/])(awesome|curated|tutorial|tutorials|cheatsheet|cheat-sheet|roadmap|interview|handbook|course|courses|books?|study-guide|notes|learning-path|guidebook)([\s\-_/]|$)/i;
const NOISE_ZH = /教程|书籍|面试|学习路线|入门指南|电子书/;

function isNoise(repo) {
  const text = `${repo.full_name} ${repo.description ?? ''}`;
  if (NOISE.test(text) || NOISE_ZH.test(text)) return true;
  // 描述为空或极短的，多半不是正经项目
  if (!repo.description || repo.description.length < 12) return true;
  return false;
}

/**
 * 检索主流程：FTS 召回 → 结构化重排。
 * 排序刻意让「能力匹配」压过「星数」，否则永远只会返回那些巨无霸项目。
 */
export function search(need, { limit = 15, minStars = 0, language = null, candidates = 500 } = {}) {
  const parsed = parseNeed(need);
  const match = buildMatch(parsed);
  if (!match) return { ...parsed, results: [] };

  const rows = ftsCandidates(match, candidates);
  if (!rows.length) return { ...parsed, results: [] };

  const rankById = new Map(rows.map((r, i) => [r.id, { bm25: -r.rank, order: i }]));
  const repos = getRepos(rows.map((r) => r.id));

  // 需求里的每个能力按 IDF 加权：库里只有 7 个项目的「文档解析」，
  // 比几百个项目都有的「Office 文档处理」更能说明用户到底要什么
  const { counts: capN, total: capTotal } = capCounts();
  const wantCaps = new Map(
    parsed.caps.map((c) => {
      const n = capN.get(c.id) ?? 1;
      return [c.id, c.weight * (Math.log((capTotal + 1) / (n + 1)) + 1)];
    })
  );
  const totalWantW = [...wantCaps.values()].reduce((a, b) => a + b, 0) || 1;

  const scored = [];
  for (const repo of repos) {
    if (repo.archived) continue;
    if (isNoise(repo)) continue;
    if (minStars && repo.stars < minStars) continue;
    if (language && String(repo.language).toLowerCase() !== language.toLowerCase()) continue;

    const repoCaps = String(repo.caps || '').split(' ').filter(Boolean);
    const name = String(repo.full_name).toLowerCase();
    const desc = String(repo.description || '').toLowerCase();
    const topics = String(repo.topics || '').toLowerCase();

    // 能力重合度（IDF 加权后的占比，0–1）
    const matchedCaps = repoCaps.filter((c) => wantCaps.has(c));
    const matchedW = matchedCaps.reduce((a, c) => a + wantCaps.get(c), 0);
    const capScore = Math.min(1, matchedW / totalWantW);

    // 动作意图：需求说「提取」，项目描述里得有 extract/parse，否则是无关的同类工具
    const intentHit = parsed.intents.some((t) => desc.includes(t) || topics.includes(t));

    // 文本命中
    let nameHits = 0, descHits = 0, topicHits = 0;
    const matchedTerms = [];
    for (const t of parsed.terms) {
      const hitName = name.includes(t);
      const hitDesc = desc.includes(t);
      const hitTopic = topics.includes(t);
      if (hitName) { nameHits++; matchedTerms.push(t); }
      else if (hitTopic) { topicHits++; matchedTerms.push(t); }
      else if (hitDesc) { descHits++; matchedTerms.push(t); }
    }

    // 中文兜底：描述是中文时按片段匹配
    let cjkHit = 0;
    if (parsed.cjkChunks.length) {
      for (const chunk of parsed.cjkChunks) {
        if (String(repo.description || '').includes(chunk)) cjkHit++;
      }
    }

    const bm = Math.min(12, rankById.get(repo.id)?.bm25 ?? 0);
    const fresh = repo.pushed_at && Date.now() - new Date(repo.pushed_at).getTime() < FRESH_DAYS * 864e5;

    // 热度：日均涨星。让「刚冒头的小项目」能和「几万星的老项目」同台竞争
    const heat = repo.heat ?? 0;
    const heatBoost = Math.min(34, heat * 0.7) + Math.min(10, Math.max(0, repo.burst ?? 0) * 0.3);

    const score =
      capScore * 80 +
      heatBoost +
      (intentHit ? 14 : 0) +
      Math.min(2, nameHits) * 14 +
      Math.min(3, topicHits) * 9 +
      Math.min(3, descHits) * 4 +
      Math.min(2, cjkHit) * 10 +
      (repo.quality ?? 0) * 0.45 +
      Math.log10((repo.stars ?? 0) + 1) * 4 +
      (fresh ? 4 : 0) +
      bm * 1.5;

    const uniqueTerms = [...new Set(matchedTerms)];
    scored.push({
      repo,
      score: Math.round(score * 10) / 10,
      // 供选型决策用：能力重合度与检索词覆盖率，0–1
      capScore,
      termScore: parsed.terms.length ? Math.min(1, uniqueTerms.length / parsed.terms.length) : 0,
      matchedCaps,
      matchedTerms: uniqueTerms.slice(0, 6),
      fresh,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return { ...parsed, results: scored.slice(0, limit) };
}

export function explain(hit) {
  const bits = [];
  if (hit.matchedCaps.length) {
    bits.push('能力：' + hit.matchedCaps.map((c) => CAP_BY_ID.get(c)?.zh ?? c).join(' / '));
  }
  if (hit.matchedTerms.length) bits.push('命中词：' + hit.matchedTerms.join(', '));
  bits.push(`${hit.repo.stars}★`);
  if (hit.repo.heat >= 5) bits.push(`🔥 日均 +${Math.round(hit.repo.heat)}`);
  if (hit.repo.language) bits.push(hit.repo.language);
  if (hit.fresh) bits.push('近一年活跃');
  return bits.join(' · ');
}
