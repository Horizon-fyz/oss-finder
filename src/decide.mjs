import { search } from './search.mjs';
import { decomposeNeed } from './decompose.mjs';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pct = (n) => `${Math.round(clamp(n, 0, 1) * 100)}%`;

const STRONG_COPYLEFT = /^(A?GPL|SSPL|OSL|EUPL)/i;
const WEAK_COPYLEFT = /^(LGPL|MPL|EPL|CDDL)/i;
const RESTRICTED = /^(BUSL|Elastic|Commons-Clause|Commons-Clause)/i;

const ACTION_LABEL = {
  use: '直接使用',
  fork: 'fork 改造',
  borrow: '借鉴重写',
  build: '自研',
};

const APP_HINT = /(^|[\s/_])(app|application|platform|dashboard|studio|suite|workspace|self-hosted|web ui|webui|server)([\s/_]|$)/i;
const LIB_HINT = /(^|[\s/_])(library|lib|sdk|api|parser|toolkit|framework|engine|cli|module|package|binding|plugin)([\s/_]|$)/i;

/**
 * license 能不能直接复用。
 * 有允许清单就按清单走；没有就按商用/闭源场景的默认规则判断。
 */
function licenseVerdict(license, profile = {}) {
  const lic = String(license ?? '').trim();
  if (!lic || lic === 'NOASSERTION' || lic === 'null') {
    return { ok: false, level: 'block', why: '没有明确 license，法律上不能直接复用代码' };
  }

  const policy = (profile.licensePolicy ?? []).map((s) => String(s).toLowerCase());
  if (policy.length) {
    if (!policy.includes(lic.toLowerCase())) {
      return { ok: false, level: 'block', why: `license ${lic} 不在你的允许清单内` };
    }
    if (profile.commercial && STRONG_COPYLEFT.test(lic)) {
      return { ok: true, level: 'warn', why: `${lic} 在允许清单内，但闭源商用需确认分发方式` };
    }
    return { ok: true, level: 'ok', why: `license ${lic}` };
  }

  if (profile.commercial && STRONG_COPYLEFT.test(lic)) {
    return { ok: false, level: 'block', why: `${lic} 是强 copyleft，闭源商用有传染风险` };
  }
  if (profile.commercial && RESTRICTED.test(lic)) {
    return { ok: false, level: 'block', why: `${lic} 含商用限制` };
  }
  if (profile.commercial && WEAK_COPYLEFT.test(lic)) {
    return { ok: true, level: 'warn', why: `${lic} 是弱 copyleft，修改过的文件需要开源` };
  }
  return { ok: true, level: 'ok', why: `license ${lic}` };
}

function daysSince(iso) {
  if (!iso) return 9999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 9999;
  return (Date.now() - t) / 864e5;
}

/** 0–100：质量分 35 + 星数 20 + 活跃度 15 + 增速 10 + license 20 */
function evidenceOf(repo, license) {
  const quality = clamp(Number(repo.quality ?? 0), 0, 100) * 0.35;
  const stars = Math.min(1, Math.log10((Number(repo.stars) || 0) + 1) / 5) * 20;
  const age = daysSince(repo.pushed_at);
  const fresh = age < 90 ? 15 : age < 365 ? 10 : age < 730 ? 4 : 0;
  const heat = Math.min(1, (Number(repo.heat) || 0) / 20) * 10;
  const lic = license.ok ? (license.level === 'warn' ? 12 : 20) : 0;
  return Math.round(clamp(quality + stars + fresh + heat + lic, 0, 100) * 10) / 10;
}

/** 粗判项目形态：库/框架，还是完整应用。完整应用接进组件通常要裁剪 */
function formOf(repo) {
  const text = `${repo.full_name ?? ''} ${repo.description ?? ''} ${repo.topics ?? ''}`;
  const app = APP_HINT.test(text);
  const lib = LIB_HINT.test(text);
  if (app && !lib) return 'application';
  if (lib && !app) return 'library';
  return 'unknown';
}

const STACK_SYNONYMS = {
  typescript: ['node', 'node.js', 'react', 'vue', 'next.js', 'nuxt', 'deno', 'bun'],
  javascript: ['node', 'node.js', 'react', 'vue', 'next.js', 'nuxt', 'deno', 'bun'],
  python: ['fastapi', 'django', 'flask', 'pytorch'],
  go: ['golang'],
  rust: ['cargo'],
  java: ['spring', 'kotlin'],
  'c#': ['.net', 'dotnet'],
};

function stackFit(repo, profile = {}) {
  const lang = String(repo.language ?? '').toLowerCase();
  const stack = (profile.stack ?? []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  if (!lang || !stack.length) return 'unknown';
  if (stack.some((s) => s === lang || s.includes(lang) || lang.includes(s))) return 'match';
  const family = STACK_SYNONYMS[lang] ?? [];
  return family.some((k) => stack.some((s) => s.includes(k))) ? 'match' : 'mismatch';
}

function risksOf(repo, { license, form, stack }) {
  const out = [];
  if (!license.ok) out.push(license.why);
  else if (license.level === 'warn') out.push(license.why);
  if (repo.archived) out.push('仓库已归档');
  const age = daysSince(repo.pushed_at);
  if (age > 365) out.push(`已有 ${Math.round(age / 30)} 个月没有提交`);
  if ((Number(repo.stars) || 0) < 200) out.push('星数偏低，社区验证不足');
  if (form === 'application') out.push('是完整应用而非库，接入前需要裁剪');
  if (stack === 'mismatch') out.push(`语言是 ${repo.language}，与你的技术栈不同`);
  return out;
}

function buildCandidate(hit, res, profile) {
  const repo = hit.repo;
  const license = licenseVerdict(repo.license, profile);
  const form = formOf(repo);
  const stack = stackFit(repo, profile);

  // 有明确能力命中时，以能力重合度为主；否则看检索词覆盖率
  const coverage = res.caps.length
    ? clamp(0.7 * (hit.capScore ?? 0) + 0.3 * (hit.termScore ?? 0), 0, 1)
    : clamp(hit.termScore ?? 0, 0, 1);

  const evidence = evidenceOf(repo, license);
  const total = clamp(
    coverage * 55 + evidence * 0.45 - (stack === 'mismatch' ? 6 : 0) - (form === 'application' ? 5 : 0),
    0,
    100
  );

  return {
    full_name: repo.full_name,
    url: repo.url,
    description: repo.description,
    stars: repo.stars,
    language: repo.language,
    license: repo.license,
    pushed_at: repo.pushed_at,
    quality: repo.quality,
    heat: repo.heat,
    coverage,
    evidence,
    total: Math.round(total * 10) / 10,
    licenseVerdict: license,
    form,
    stack,
    risks: risksOf(repo, { license, form, stack }),
  };
}

function isUrgent(timeline) {
  return /周|紧急|尽快|MVP|本月|1\s*个月|一个月|两周|几天/i.test(String(timeline ?? ''));
}

function nextStep(action, comp, best, blocked) {
  const target = best?.full_name ?? blocked?.full_name ?? null;
  const acceptance = comp.acceptance?.[0] ? `验收标准「${comp.acceptance[0]}」` : '核心功能';

  switch (action) {
    case 'use':
      return `先做半天 spike：按 ${target} 的 README 跑通最小示例，验证${acceptance}；通过后锁版本接入，并确认失败时的退路。`;
    case 'fork':
      return `拉 ${target} 的分支，先确认 license 允许分发修改版，再定位缺口——只改缺口，不要顺手重构。`;
    case 'borrow':
      return target
        ? `不直接引入 ${target}。读它的接口设计和核心模块，按你的约束重写；复用思路，不复制代码。`
        : `参考同类实现，按${acceptance}自己实现。`;
    case 'build':
    default:
      return `先定接口和${acceptance}，再排期实现；实现过程中可参考候选项目的局部做法。`;
  }
}

function decideComponent(comp, candidates, profile) {
  const usable = candidates.filter((c) => c.licenseVerdict.ok).sort((a, b) => b.total - a.total);
  const blocked = candidates
    .filter((c) => !c.licenseVerdict.ok)
    .sort((a, b) => b.coverage - a.coverage)[0] ?? null;

  const best = usable[0] ?? null;
  const coverage = best?.coverage ?? 0;
  const evidence = best?.evidence ?? 0;
  const urgent = isUrgent(profile.timeline);

  const reasons = [];
  let action;

  if (!best) {
    if (blocked && blocked.coverage >= 0.45) {
      action = 'borrow';
      reasons.push(`最接近的 ${blocked.full_name} 覆盖度 ${pct(blocked.coverage)}，但${blocked.licenseVerdict.why}`);
      reasons.push('不能直接复用代码，只能参考接口与实现思路');
    } else {
      action = 'build';
      reasons.push(candidates.length ? '候选覆盖度都太低，改造成本接近重写' : '库里没有召回到覆盖该能力的项目');
    }
  } else if (comp.core) {
    if (coverage >= 0.85 && evidence >= 80) {
      action = 'use';
      reasons.push(`覆盖度 ${pct(coverage)}、成熟度 ${evidence}/100，可以作为底座`);
      reasons.push('核心能力仍要把业务逻辑和数据层握在自己手里，不要把差异化部分交给上游');
    } else if (coverage >= 0.45) {
      action = 'borrow';
      reasons.push('这是核心差异化组件，直接依赖等于把关键路径交给外部维护');
      reasons.push(`候选覆盖度 ${pct(coverage)}，足够参考其架构与实现`);
    } else {
      action = 'build';
      reasons.push('核心组件，且现有项目覆盖度不足，接入省不了多少事');
    }
  } else if (coverage >= (urgent ? 0.62 : 0.7) && evidence >= (urgent ? 42 : 50)) {
    action = 'use';
    reasons.push(`覆盖度 ${pct(coverage)}、成熟度 ${evidence}/100，属于边界清晰的通用能力`);
    if (urgent) reasons.push('时间紧，优先接入而不是重造');
  } else if (coverage >= 0.45) {
    action = 'fork';
    reasons.push(`覆盖度 ${pct(coverage)}，主干可用但有明确缺口`);
    reasons.push(urgent ? '时间有限，fork 后只改缺口部分' : 'fork 后按缺口改造，比从零重写便宜');
  } else {
    action = 'build';
    reasons.push(`候选最高覆盖度只有 ${pct(coverage)}，改造成本接近重写`);
  }

  const risks = best ? [...best.risks] : [];
  if (action === 'fork') risks.push('fork 后需要自己跟上游同步安全修复');
  if (comp.core && action === 'use') risks.push('核心能力依赖外部项目，需持续评估上游变更');

  return {
    action,
    label: ACTION_LABEL[action],
    best: best?.full_name ?? blocked?.full_name ?? null,
    bestCoverage: best?.coverage ?? blocked?.coverage ?? 0,
    bestEvidence: best?.evidence ?? blocked?.evidence ?? null,
    reasons,
    risks: [...new Set(risks)],
    next: nextStep(action, comp, best, blocked),
  };
}

/**
 * 需求 → 拆解 → 逐组件检索 → 决策。
 * 决策是确定性的规则打分，LLM 只负责拆解，避免模型对着候选名单编理由。
 */
export async function decide(need, { profile = {}, llm = null, useLlm = true, limit = 5 } = {}) {
  const raw = Number(limit);
  const take = Number.isFinite(raw) ? clamp(Math.trunc(raw), 1, 10) : 5;
  const decomposed = await decomposeNeed(need, { profile, llm, useLlm });

  const components = decomposed.components.map((comp) => {
    const query = [comp.name, ...(comp.queries ?? [])].filter(Boolean).join(' ');
    const res = search(query, { limit: Math.max(take, 5) });
    const candidates = res.results
      .slice(0, take)
      .map((hit) => buildCandidate(hit, res, profile))
      .sort((a, b) => b.total - a.total);

    return {
      ...comp,
      query,
      matchedCaps: res.caps.slice(0, 4).map((c) => c.cap?.zh ?? c.id),
      candidates,
      decision: decideComponent(comp, candidates, profile),
    };
  });

  return {
    need,
    profile,
    source: decomposed.source,
    warning: decomposed.warning,
    summary: decomposed.summary,
    components,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------- Markdown 报告 ----------------

function fmtTime(iso) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function mdCell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';
}

function candidateTable(candidates) {
  if (!candidates.length) return '_没有召回到候选项目。_';
  const rows = [
    '| 项目 | 星数 | 语言 | License | 最近提交 | 覆盖度 | 成熟度 | 综合 |',
    '| --- | ---: | --- | --- | --- | ---: | ---: | ---: |',
  ];
  for (const c of candidates) {
    const lic = c.licenseVerdict.ok ? (c.license ?? '—') : `⚠ ${c.license ?? '无'}`;
    rows.push(
      `| ${mdCell(c.full_name)} | ${c.stars ?? 0} | ${mdCell(c.language)} | ${mdCell(lic)} | ` +
        `${mdCell(String(c.pushed_at ?? '').slice(0, 10))} | ${pct(c.coverage)} | ${c.evidence} | ${c.total} |`
    );
  }
  return rows.join('\n');
}

export function renderReport(data) {
  const { need, profile, source, warning, summary, components, generatedAt } = data;
  const lines = [];

  lines.push('# 开源选型报告');
  lines.push('');
  lines.push(`- **需求**：${need}`);
  if (summary) lines.push(`- **理解**：${summary}`);
  lines.push(`- **生成时间**：${fmtTime(generatedAt)}`);
  lines.push(`- **拆解方式**：${source === 'llm' ? 'LLM 拆解' : '能力词表兜底'}`);
  lines.push(
    `- **项目画像**：技术栈 ${(profile.stack ?? []).join('、') || '未指定'} · ` +
      `商用 ${profile.commercial ? '是' : '否/未定'} · ` +
      `时间 ${profile.timeline || '未指定'} · ` +
      `license ${(profile.licensePolicy ?? []).join('、') || '未限制'}`
  );
  if (warning) {
    lines.push('');
    lines.push(`> ⚠️ ${warning}。拆解结果可能不完整，配置 LLM 后重跑会更准。`);
  }
  lines.push('');

  lines.push('## 一、结论速览');
  lines.push('');
  lines.push('| # | 组件 | 定位 | 结论 | 首选项目 | 覆盖度 |');
  lines.push('| ---: | --- | --- | --- | --- | ---: |');
  components.forEach((comp, i) => {
    const pos = `${comp.core ? '核心' : '支撑'} · ${comp.priority}`;
    lines.push(
      `| ${i + 1} | ${mdCell(comp.name)} | ${pos} | **${comp.decision.label}** | ` +
        `${mdCell(comp.decision.best ?? '—')} | ${comp.decision.best ? pct(comp.decision.bestCoverage) : '—'} |`
    );
  });
  lines.push('');

  lines.push('## 二、逐项分析');
  lines.push('');
  components.forEach((comp, i) => {
    const d = comp.decision;
    lines.push(`### ${i + 1}. ${comp.name}　\`${comp.core ? '核心' : '支撑'}\`　\`${comp.priority}\``);
    lines.push('');
    if (comp.description) lines.push(`**要做什么**：${comp.description}`);
    if (comp.acceptance?.length) {
      lines.push('');
      lines.push('**验收标准**：');
      for (const a of comp.acceptance) lines.push(`- ${a}`);
    }
    lines.push('');
    lines.push(`**结论：${d.label}**`);
    for (const r of d.reasons) lines.push(`- ${r}`);
    if (d.risks.length) {
      lines.push('');
      lines.push(`**风险**：${d.risks.join('；')}`);
    }
    lines.push('');
    lines.push(`**下一步**：${d.next}`);
    lines.push('');
    lines.push('候选对比：');
    lines.push('');
    lines.push(candidateTable(comp.candidates));
    lines.push('');
  });

  const count = (action) => components.filter((c) => c.decision.action === action).length;
  const mustFirst = components.find((c) => c.priority === 'must' && c.decision.action !== 'build')
    ?? components.find((c) => c.decision.action !== 'build');

  lines.push('## 三、整体建议');
  lines.push('');
  lines.push(
    `共 ${components.length} 个组件：直接使用 ${count('use')} 项、fork 改造 ${count('fork')} 项、` +
      `借鉴重写 ${count('borrow')} 项、自研 ${count('build')} 项。`
  );
  if (mustFirst) {
    lines.push(
      `- 先做 **${mustFirst.name}**：${mustFirst.decision.label}，` +
        `候选 ${mustFirst.decision.best ?? '—'}。验证成本最低，失败也能最早暴露。`
    );
  }
  const builds = components.filter((c) => c.decision.action === 'build');
  if (builds.length) {
    lines.push(`- 自研项集中在：${builds.map((c) => c.name).join('、')}。先把接口定下来，避免边写边改。`);
  }
  const reuse = components.filter((c) => c.decision.action === 'use' || c.decision.action === 'fork');
  if (reuse.length) {
    lines.push(
      `- 可复用项：${reuse.map((c) => `${c.name}（${c.decision.label} ${c.decision.best}）`).join('、')}。` +
        '接入前统一确认 license 与版本锁定策略。'
    );
  }
  lines.push('');
  lines.push('## 附：口径与局限');
  lines.push('');
  lines.push('- **覆盖度**：能力标签重合度（70%）+ 检索词命中率（30%），是粗估，不等于 API 能满足你的验收标准。');
  lines.push('- **成熟度**：质量分 35 + 星数 20 + 活跃度 15 + 增速 10 + license 20，满分 100。');
  lines.push('- 决策由固定规则给出（核心差异化、覆盖度、成熟度、license、技术栈、时间压力），LLM 不参与打分。');
  lines.push('- 数据来自库内快照，未包含 issue 响应速度、release 节奏、真实依赖冲突；接入前仍需做 spike 验证。');
  lines.push('');

  return lines.join('\n');
}
