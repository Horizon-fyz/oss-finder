import { CAPABILITIES, CAP_BY_ID } from './taxonomy.mjs';
import { decompose as taxonomyDecompose } from './plan.mjs';
import { chatJson, llmReady } from './llm.mjs';

const MAX_COMPONENTS = 8;

const SYSTEM = `你是一个资深技术选型顾问。你的任务是把一句产品需求拆成若干个"可以独立选型"的能力组件。

规则：
1. 组件是能力，不是页面、不是开发阶段、不是任务。例如"文档解析""向量检索""权限管理"。
2. 3–6 个组件，最多 8 个。宁可少而准，不要把一个功能拆成碎块。
3. core=true 表示这是产品的核心差异化能力，是"别人为什么用你"的原因；通用支撑能力填 false。
4. priority 取 must / should / could，表示这个组件对第一版是否必需。
5. queries 是 2–5 个英文检索词，用来在 GitHub 项目库里检索。用开源项目描述里常见的说法，不要写整句。
6. acceptance 是可验证的验收标准，最多 3 条，每条一句话。
7. 只输出 JSON，不要输出 markdown 或解释。`;

function profileText(profile = {}) {
  const stack = (profile.stack ?? []).filter(Boolean).join('、') || '未指定';
  const licenses = (profile.licensePolicy ?? []).filter(Boolean).join('、') || '未限制';
  return [
    `- 项目：${profile.name || '未命名'}`,
    `- 技术栈：${stack}`,
    `- 是否商用：${profile.commercial ? '是，闭源商用' : '否 / 未定'}`,
    `- 时间预期：${profile.timeline || '未指定'}`,
    `- 团队规模：${profile.teamSize ?? '未指定'}`,
    `- 允许的 license：${licenses}`,
    `- 其他约束：${profile.notes || '无'}`,
  ].join('\n');
}

const capHints = CAPABILITIES.map((c) => `${c.zh}｜${c.en}`).join('；');

function buildPrompt(need, profile) {
  return `需求：${need}

项目画像：
${profileText(profile)}

可用能力标签（仅作检索提示，不必照搬，也不要把需求硬塞进这些标签）：
${capHints}

请拆解上面的需求，只输出这个 JSON 结构：
{"summary":"一句话复述需求","components":[{"name":"中文组件名","description":"这个组件要做什么","core":false,"priority":"must","queries":["english query"],"acceptance":["可验证的验收标准"]}]}`;
}

function normalize(raw) {
  const list = Array.isArray(raw?.components) ? raw.components : [];
  const seen = new Set();
  const out = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name ?? item.zh ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const queries = [...new Set(
      (Array.isArray(item.queries) ? item.queries : [])
        .map((q) => String(q ?? '').trim())
        .filter(Boolean)
    )].slice(0, 6);

    out.push({
      id: `c${out.length + 1}`,
      name,
      description: String(item.description ?? '').trim(),
      core: Boolean(item.core),
      priority: ['must', 'should', 'could'].includes(item.priority) ? item.priority : 'must',
      queries,
      acceptance: (Array.isArray(item.acceptance) ? item.acceptance : [])
        .map((a) => String(a ?? '').trim())
        .filter(Boolean)
        .slice(0, 3),
    });

    if (out.length >= MAX_COMPONENTS) break;
  }

  return out;
}

/** 没配 LLM 或调用失败时的兜底：用能力词表做拆解，并明确标注来源 */
function taxonomyFallback(need, reason) {
  const { components } = taxonomyDecompose(need);
  return {
    source: 'taxonomy',
    warning: reason,
    summary: '',
    components: components.map((c, i) => {
      const cap = CAP_BY_ID.get(c.id);
      return {
        id: c.id,
        name: c.zh,
        description: c.why || cap?.en || '',
        // 词表拆解分不清「差异化」和「必需」，只把最强命中的根能力当核心
        core: c.role === '核心' && i === 0,
        priority: c.depth === 0 ? 'must' : 'should',
        queries: [...new Set([cap?.en ?? '', ...(cap?.aliases ?? []).slice(0, 4)])].filter(Boolean),
        acceptance: [],
        depth: c.depth,
      };
    }),
  };
}

/**
 * 把一句需求拆成组件清单。
 * LLM 可用就用 LLM（能处理词表没覆盖的说法）；否则退回能力词表，并带上 warning。
 */
export async function decomposeNeed(need, { profile = {}, llm = null, useLlm = true } = {}) {
  if (!useLlm) return taxonomyFallback(need, '已关闭 AI 拆解（界面开关或 --no-llm），拆解来自能力词表');

  if (!llmReady(llm)) {
    return taxonomyFallback(
      need,
      '未配置 AI（需要在 llm.baseUrl 与 llm.model 中填入端点与模型；远程服务还需 API Key），拆解来自能力词表',
    );
  }

  try {
    const raw = await chatJson({ system: SYSTEM, user: buildPrompt(need, profile) }, llm);
    const components = normalize(raw);
    if (!components.length) throw new Error('模型没有返回有效组件');
    return {
      source: 'llm',
      warning: '',
      summary: String(raw.summary ?? '').trim(),
      components,
    };
  } catch (err) {
    return taxonomyFallback(need, `LLM 调用失败（${err.message}），已退回能力词表`);
  }
}
