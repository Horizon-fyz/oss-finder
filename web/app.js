/* 选型台前端：无构建、无依赖。hash 路由 + 四页渲染 + 轻量事件委托 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const num = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);
const clampLimit = (v) => {
  const raw = String(v ?? '').trim();
  const n = Math.round(Number(raw));
  return raw === '' || !Number.isFinite(n) ? 5 : Math.min(10, Math.max(1, n));
};
const pct = (n) => `${Math.round(Math.min(1, Math.max(0, Number(n) || 0)) * 100)}%`;
const timeOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
};
const dateTimeOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};

async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

const PAGES = {
  decide: { title: '选型', sub: '拆解需求，逐项比对，给出可执行的结论。' },
  find: { title: '检索', sub: '直接搜库，按能力标签与关键词重排。' },
  caps: { title: '能力库', sub: '能力标签是检索与拆解的坐标系。' },
  settings: { title: '设置', sub: '项目画像影响 license 判断与技术栈匹配。' },
};

const PRIORITY = { must: '必须', should: '应该', could: '可选' };

const EXAMPLES = [
  '做一个视频剪辑 App，支持时间线、字幕和导出',
  '给团队做一个内部 RAG 知识库',
  '把 PDF 里的表格批量提取成 Excel',
  '做一个带权限管理的后台管理系统',
];

// 厂商预设：Base URL、常用模型 UID、Key 申请页与文档页。模型 UID 以各厂商控制台为准。
const PROVIDERS = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    note: '国内直连',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-pro', 'deepseek-flash'],
    keys: 'https://platform.deepseek.com/api_keys',
    docs: 'https://api-docs.deepseek.com/',
  },
  {
    key: 'kimi',
    name: 'Kimi / Moonshot',
    note: '长上下文',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
    keys: 'https://platform.kimi.ai/console/api-keys',
    docs: 'https://platform.moonshot.cn/docs',
  },
  {
    key: 'zhipu',
    name: '智谱 GLM',
    note: '国内直连',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.2', 'glm-4.6v-flash'],
    keys: 'https://bigmodel.cn/usercenter/apikeys',
    docs: 'https://docs.bigmodel.cn/',
  },
  {
    key: 'qwen',
    name: '通义千问',
    note: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.6-plus', 'qwen-plus'],
    keys: 'https://bailian.console.aliyun.com/?apiKey=1',
    docs: 'https://help.aliyun.com/zh/model-studio/',
  },
  {
    key: 'siliconflow',
    name: 'SiliconFlow',
    note: '聚合托管',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3.2'],
    keys: 'https://cloud.siliconflow.cn/account/ak',
    docs: 'https://docs.siliconflow.cn/',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    note: '海外聚合',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-v4-pro', 'deepseek/deepseek-v4-flash-0731'],
    keys: 'https://openrouter.ai/settings/keys',
    docs: 'https://openrouter.ai/docs',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    note: '官方',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.4'],
    keys: 'https://platform.openai.com/api-keys',
    docs: 'https://platform.openai.com/docs/models',
  },
  {
    key: 'volcengine',
    name: '豆包 / 方舟',
    note: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-evolving', 'doubao-seed-2-1-pro-260628'],
    keys: 'https://ark.volcengine.com/region:cn-beijing/apikey',
    docs: 'https://www.volcengine.com/docs/82379',
  },
  {
    key: 'hunyuan',
    name: '腾讯混元',
    note: '腾讯云',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: ['hunyuan-2.0-instruct-20251111', 'hunyuan-2.0-thinking-20251109'],
    keys: 'https://console.cloud.tencent.com/hunyuan/api-key',
    docs: 'https://cloud.tencent.com/document/product/1729',
  },
  {
    key: 'minimax',
    name: 'MiniMax',
    note: '国内直连',
    baseUrl: 'https://api.minimax.cn/v1',
    models: ['MiniMax-M3', 'MiniMax-M2.7'],
    keys: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    docs: 'https://platform.minimaxi.com/docs/guides/text-generation',
  },
  {
    key: 'qianfan',
    name: '文心 / 千帆',
    note: '百度智能云',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: ['ernie-5.1', 'ernie-5.0'],
    keys: 'https://console.bce.baidu.com/qianfan/overview',
    docs: 'https://cloud.baidu.com/doc/qianfan-api/index.html',
  },
  {
    key: 'stepfun',
    name: '阶跃星辰',
    note: 'StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    models: ['step-3.7-flash', 'step-5-preview'],
    keys: 'https://platform.stepfun.com/interface-key',
    docs: 'https://platform.stepfun.com/docs/zh/guides/developer/openai',
  },
  {
    key: 'xai',
    name: 'xAI Grok',
    note: '海外',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4.5'],
    keys: 'https://console.x.ai/team/default/api-keys',
    docs: 'https://docs.x.ai/docs',
  },
  {
    key: 'groq',
    name: 'Groq',
    note: '低延迟',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b'],
    keys: 'https://console.groq.com/keys',
    docs: 'https://console.groq.com/docs',
  },
  {
    key: 'mistral',
    name: 'Mistral',
    note: '欧洲',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest'],
    keys: 'https://console.mistral.ai/api-keys',
    docs: 'https://docs.mistral.ai/',
  },
  {
    key: 'ollama',
    name: 'Ollama',
    note: '本地运行 · 免 Key',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen3:8b', 'gpt-oss:20b'],
    keys: 'https://ollama.com/download',
    docs: 'https://ollama.com/library',
  },
  {
    key: 'custom',
    name: '自定义',
    note: '手填端点与模型',
    custom: true,
    baseUrl: '',
    models: [],
    keys: '',
    docs: '',
  },
];

const normBase = (u) => String(u ?? '').trim().replace(/\/+$/, '');
const providerOf = (baseUrl) => PROVIDERS.find((p) => p.baseUrl && normBase(p.baseUrl) === normBase(baseUrl)) ?? null;

const state = {
  page: 'decide',
  boot: null,
  theme: 'dark',
  busy: false,
  decide: null,
  report: null,
  selected: 0,
  need: '',
  useLlm: false, // 默认离线：能力词表拆解，配了 API 再切 AI
  limit: 5,
  find: null,
  findLoading: false,
  findQuery: '',
  findLang: '',
  findStars: '',
  findLimit: 20,
  capsQuery: '',
  pendingFind: null,
  update: null,
  updateTimer: 0,
  updateHideTimer: 0,
};

/* ── 主题 ─────────────────────────────────────────────────── */

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem('oss.theme', state.theme);
  const label = $('.theme-label');
  if (label) label.textContent = state.theme === 'dark' ? '暗色' : '亮色';
}

/* ── 路由 ─────────────────────────────────────────────────── */

function currentRoute() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0];
  return PAGES[key] ? key : 'decide';
}

function route() {
  state.page = currentRoute();
  for (const a of $$('.nav-item')) a.classList.toggle('active', a.dataset.route === state.page);

  const meta = PAGES[state.page];
  $('#pageTitle').textContent = meta.title;
  $('#pageSub').textContent = meta.sub;

  if (state.page === 'find' && state.pendingFind) state.findLoading = true;
  renderPage();

  if (state.page === 'find' && state.pendingFind) {
    const q = state.pendingFind;
    state.pendingFind = null;
    runFind(q);
  }
}

function openFind(query) {
  state.findQuery = query;
  state.find = null;
  if (currentRoute() === 'find') {
    state.page = 'find';
    runFind(query);
  } else {
    state.pendingFind = query;
    location.hash = '#/find';
  }
}

function renderPage() {
  const c = $('#content');
  if (!state.boot) {
    c.innerHTML = `<div class="page"><div class="empty"><span class="spinner"></span><p>正在连接本地服务…</p></div></div>`;
    return;
  }
  if (state.page === 'find') {
    c.innerHTML = viewFind();
  } else if (state.page === 'caps') {
    c.innerHTML = viewCaps();
    renderCapsGrid();
  } else if (state.page === 'settings') {
    c.innerHTML = viewSettings();
  } else {
    const comps = state.decide?.components ?? [];
    if (state.selected >= comps.length) state.selected = 0;
    c.innerHTML = viewDecide();
  }
  c.scrollTop = 0;
}

/* ── 顶栏 / 侧栏状态 ──────────────────────────────────────── */

function updateChrome() {
  const s = state.boot.stats;
  const db = $('#dbStat');
  db.classList.toggle('is-empty', !s.total);
  $('.db-text', db).textContent = s.total ? `${num(s.total)} 个项目 · ${s.caps} 能力` : '库是空的';

  const chip = $('#llmChip');
  if (state.boot.llmReady) {
    chip.className = 'chip chip-ok';
    chip.textContent = `AI 拆解就绪 · ${state.boot.llm.model}`;
    chip.title = state.boot.llm.baseUrl;
  } else {
    chip.className = 'chip chip-warn';
    chip.textContent = '离线拆解 · 未配置 AI';
    chip.title = '默认用能力词表拆解；在设置里填 API 后可切换 AI 拆解';
  }
}

/* ── 启动更新状态 ─────────────────────────────────────────── */

function phaseText(u) {
  const p = u.phase;
  if (!p) return '准备中…';
  return `${p.label}${p.total > 1 ? ` ${p.i}/${p.total}` : ''}`;
}

function updateSummary(u) {
  const r = u.result;
  if (!r) return '';
  const added = Math.max(0, (r.after ?? 0) - (r.before ?? 0));
  return `+${added} 个项目 · 刷新 ${r.polled ?? 0} 个热度`;
}

function renderUpdateBar() {
  const bar = $('#updateBar');
  if (!bar) return;
  clearTimeout(state.updateHideTimer);
  const u = state.update;
  if (!u || u.status === 'idle') {
    bar.hidden = true;
    return;
  }

  if (u.status === 'running') {
    bar.hidden = false;
    bar.className = 'update-bar';
    bar.innerHTML = `<span class="spinner"></span>
      <span class="update-text">正在后台更新数据库 · <strong>${esc(phaseText(u))}</strong> · 可继续检索，完成后会提示刷新</span>`;
    return;
  }

  if (u.status === 'error') {
    bar.hidden = false;
    bar.className = 'update-bar is-error';
    bar.innerHTML = `<span class="update-text">更新失败：${esc(u.error || '未知错误')} · 检索使用现有库</span>
      <button class="btn btn-sm" type="button" data-action="run-update">重试</button>
      <button class="btn btn-sm" type="button" data-action="dismiss-update">关闭</button>`;
    return;
  }

  if (u.status === 'skipped') {
    bar.hidden = false;
    bar.className = 'update-bar is-warn';
    bar.innerHTML = `<span class="update-text">${esc(u.reason || '刚刚更新过')}，本次跳过；检索直接使用现有库</span>
      <button class="btn btn-sm" type="button" data-action="run-update">强制更新</button>
      <button class="btn btn-sm" type="button" data-action="dismiss-update">关闭</button>`;
    state.updateHideTimer = setTimeout(() => { bar.hidden = true; }, 8000);
    return;
  }

  bar.hidden = false;
  bar.className = 'update-bar is-done';
  bar.innerHTML = `<span class="update-text">数据库已更新：${esc(updateSummary(u))} · ${esc(dateTimeOf(u.finishedAt))}</span>
    <button class="btn btn-sm" type="button" data-action="dismiss-update">关闭</button>`;
  state.updateHideTimer = setTimeout(() => { if (bar.className.includes('is-done')) bar.hidden = true; }, 12000);
}

async function refreshBootstrap() {
  try {
    const b = await api('/api/bootstrap');
    state.boot = b;
    state.update = b.update ?? state.update;
    updateChrome();
    renderPage();
    renderUpdateBar();
  } catch (err) {
    toast(err.message, true);
  }
}

async function handleUpdate(u) {
  const prev = state.update?.status;
  state.update = u;

  if (u.status === 'running') {
    renderUpdateBar();
    pollUpdate(2000);
    return;
  }

  if (prev === 'running') {
    await refreshBootstrap();
    if (u.status === 'done') toast(`数据库已更新：${updateSummary(u)}；重新检索可看到新结果`);
    else if (u.status === 'error') toast('更新失败，检索继续使用现有库', true);
    else toast('已跳过本次更新');
  } else {
    renderUpdateBar();
  }
}

function pollUpdate(delay = 2000) {
  clearTimeout(state.updateTimer);
  state.updateTimer = setTimeout(async () => {
    try {
      await handleUpdate(await api('/api/update'));
    } catch {
      pollUpdate(4000);
    }
  }, delay);
}

async function runUpdate() {
  try {
    await handleUpdate(await api('/api/update', { method: 'POST', body: { force: true } }));
    if (state.page === 'settings') renderPage();
  } catch (err) {
    toast(err.message, true);
  }
}

async function quitApp() {
  if (!confirm('退出 oss-finder？本地服务会停止。')) return;
  try {
    await api('/api/quit', { method: 'POST' });
  } catch {
    // 服务已退出时请求会失败，忽略
  }
  const c = $('#content');
  if (c) {
    c.innerHTML = `<div class="page"><div class="empty">
      <h3>已退出</h3>
      <p>本地服务已停止，可以直接关闭这个标签页。</p>
    </div></div>`;
  }
}

/* ── 选型页 ───────────────────────────────────────────────── */

function viewDecide() {
  return `<div class="page">
    ${composerHtml()}
    ${state.decide ? decideResultHtml(state.decide) : stepsHtml()}
  </div>`;
}

function composerHtml() {
  const dbEmpty = !state.boot.stats.total;
  const llmReady = Boolean(state.boot.llmReady);
  return `<section class="composer card">
    <div class="composer-head">
      <span class="eyebrow">需求</span>
      <span class="composer-hint">
        <span class="kbd">Ctrl</span><span>+</span><span class="kbd">Enter</span>
        <span class="hint-text">开始拆解</span>
      </span>
    </div>
    <form data-form="decide">
      <textarea id="need" class="composer-input" spellcheck="false"
        placeholder="一句话描述你要做的东西，越具体越好。例如：做一个给设计师用的图片批量压缩工具，支持拖拽和导出 WebP">${esc(state.need)}</textarea>
      <div class="composer-foot">
        <div class="composer-actions">
          <label class="switch"
            title="${llmReady ? '用已配置的 API 拆解需求' : '未配置 API：会跳到设置页填 API；不配置时默认用离线能力词表拆解'}">
            <input type="checkbox" id="useLlm" ${state.useLlm && llmReady ? 'checked' : ''} />
            <span class="switch-track"></span>
            <span>AI 拆解</span>
          </label>
          <label class="limit-input" title="每个组件保留的候选数量（1–10）">
            <span>候选</span>
            <input id="decideLimit" type="number" min="1" max="10" step="1" inputmode="numeric"
              value="${state.limit}" aria-label="每个组件的候选数（1–10）" />
          </label>
          <button class="btn btn-primary" id="decideBtn" type="submit" ${dbEmpty ? 'disabled' : ''}>开始拆解</button>
        </div>
      </div>
      <div class="examples">
        <span class="examples-label">试试</span>
        ${EXAMPLES.map((x) => `<button type="button" class="example" data-action="example" data-need="${esc(x)}">${esc(x)}</button>`).join('')}
      </div>
    </form>
    ${dbEmpty ? `<div class="notice mt-12">库里还没有数据。先在终端运行 <span class="mono">oss harvest --full</span> 建库，再回来拆解。</div>` : ''}
    ${!dbEmpty && !llmReady ? `<div class="notice notice-info mt-12">当前为离线拆解：用 ${state.boot.stats.caps} 个能力标签的本地词表识别需求。点「AI 拆解」会跳到设置页填 API，配好后可切到 AI 拆解。</div>` : ''}
  </section>`;
}

function stepsHtml() {
  return `<div class="steps">
    <div class="step">
      <span class="step-no">01</span>
      <h3>拆成能力</h3>
      <p>把一句话需求拆成 3–6 个可检索的组件，区分核心差异化与通用支撑。</p>
    </div>
    <div class="step">
      <span class="step-no">02</span>
      <h3>逐个检索</h3>
      <p>每个组件按能力标签召回候选，算覆盖度和成熟度，不按星数排座次。</p>
    </div>
    <div class="step">
      <span class="step-no">03</span>
      <h3>给出结论</h3>
      <p>规则判定直接使用 / fork / 借鉴 / 自研，附验收标准与下一步动作。</p>
    </div>
  </div>`;
}

function decideResultHtml(r) {
  if (!r.components.length) {
    return `<div class="empty mt-12">
      <div class="empty-icon">${iconAlert()}</div>
      <h3>没能拆出可执行的组件</h3>
      <p>换个更具体的说法，或者在设置里配置 AI（API）后重试。词表兜底只认识能力库里的标签。</p>
    </div>`;
  }

  const counts = { use: 0, fork: 0, borrow: 0, build: 0 };
  for (const c of r.components) counts[c.decision.action] = (counts[c.decision.action] ?? 0) + 1;
  const selected = r.components[state.selected] ?? r.components[0];

  return `<div class="result-head">
    <div class="result-meta">
      <span class="chip chip-accent">${r.source === 'llm' ? 'AI 拆解' : '离线词表'}</span>
      <span class="chip">${r.components.length} 个组件</span>
      <span class="chip">${esc(timeOf(r.generatedAt))}</span>
      ${state.report ? `<a class="btn btn-sm" href="${esc(state.report.url)}" download>下载报告</a>` : ''}
    </div>
    <div class="result-counts">
      <span class="count count-use"><b>${counts.use}</b>直接使用</span>
      <span class="count count-fork"><b>${counts.fork}</b>fork</span>
      <span class="count count-borrow"><b>${counts.borrow}</b>借鉴</span>
      <span class="count count-build"><b>${counts.build}</b>自研</span>
    </div>
  </div>
  ${r.warning ? `<div class="notice mb-12">${esc(r.warning)}</div>` : ''}
  ${r.summary ? `<p class="result-summary">${esc(r.summary)}</p>` : ''}
  <div class="workbench">
    <div class="comp-list card" role="listbox" aria-label="组件列表">
      ${r.components.map((c, i) => compItem(c, i)).join('')}
    </div>
    <div class="detail card" id="detail">${detailHtml(selected)}</div>
  </div>`;
}

function compItem(comp, i) {
  const d = comp.decision;
  const best = comp.candidates.find((c) => c.full_name === d.best);
  return `<button type="button" class="comp-item${i === state.selected ? ' active' : ''}"
      data-action="select" data-i="${i}" role="option" aria-selected="${i === state.selected}">
    <span class="comp-no">${String(i + 1).padStart(2, '0')}</span>
    <span class="comp-main">
      <span class="comp-name">${esc(comp.name)}</span>
      <span class="comp-tags">
        <span class="tag ${comp.core ? 'tag-core' : ''}">${comp.core ? '核心' : '支撑'}</span>
        <span class="tag">${esc(PRIORITY[comp.priority] ?? comp.priority ?? '')}</span>
      </span>
      <span class="comp-best">${best ? esc(best.full_name) : '无候选'}</span>
    </span>
    <span class="comp-side">
      <span class="badge badge-${d.action}">${esc(d.label)}</span>
      <span class="comp-cov">${d.best ? pct(d.bestCoverage) : '—'}</span>
    </span>
  </button>`;
}

function detailHtml(comp) {
  const d = comp.decision;
  const best = comp.candidates.find((c) => c.full_name === d.best);

  const section = (label, body) => `<div class="section"><span class="eyebrow">${label}</span>${body}</div>`;

  const why = d.reasons.length
    ? `<ul class="reasons">${d.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '<p>—</p>';

  const risks = d.risks.length
    ? `<ul class="risks">${d.risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '<p>暂无明显风险。</p>';

  const acceptance = comp.acceptance?.length
    ? `<ul class="checklist">${comp.acceptance.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';

  const caps = (comp.matchedCaps ?? []).map((x) => `<span class="tag">${esc(x)}</span>`).join('');

  return `<div class="detail-head">
    <div>
      <h2>${esc(comp.name)}</h2>
      <div class="detail-sub">
        <span class="tag ${comp.core ? 'tag-core' : ''}">${comp.core ? '核心' : '支撑'}</span>
        <span class="tag">${esc(PRIORITY[comp.priority] ?? comp.priority ?? '')}</span>
        ${comp.query ? `<span class="chip chip-mono">${esc(comp.query)}</span>` : ''}
      </div>
    </div>
    <div class="detail-tags">${caps}</div>
  </div>

  <div class="decision-strip action-${d.action}">
    <span class="decision-label">结论 <strong>${esc(d.label)}</strong></span>
    <span class="decision-best">${
      best
        ? `首选 <a href="${esc(best.url)}" target="_blank" rel="noopener">${esc(best.full_name)}</a>`
        : '没有可直接复用的候选'
    }</span>
    <span class="decision-metrics">
      <span>覆盖 ${d.best ? pct(d.bestCoverage) : '—'}</span>
      <span>成熟 ${d.bestEvidence ?? '—'}</span>
    </span>
  </div>

  ${comp.description ? section('要做什么', `<p>${esc(comp.description)}</p>`) : ''}
  ${acceptance ? section('验收标准', acceptance) : ''}
  ${section('结论理由', why)}
  ${section('风险', risks)}
  ${section('下一步', `<div class="next-step">${esc(d.next)}</div>`)}
  ${section('候选对比', candidateTable(comp.candidates))}`;
}

function candidateTable(candidates) {
  if (!candidates.length) return '<p>库里没有召回到候选项目。</p>';

  const rows = candidates.map((c) => {
    const lic = c.licenseVerdict;
    const flags = [];
    if (!lic.ok) flags.push('license 不可复用');
    if (c.stack === 'mismatch') flags.push('技术栈不匹配');
    if (c.form === 'application') flags.push('完整应用');

    return `<tr>
      <td>
        <a class="repo-link" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.full_name)}</a>
        ${c.description ? `<div class="repo-desc">${esc(c.description)}</div>` : ''}
        ${flags.length ? `<div class="inline-tags">${flags.map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</div>` : ''}
      </td>
      <td class="hide-sm">${esc(c.language || '—')}</td>
      <td><span class="chip ${lic.ok ? '' : 'chip-warn'}" title="${esc(lic.why)}">${lic.ok ? '' : '⚠ '}${esc(c.license || '无')}</span></td>
      <td>
        <div class="cov-cell">
          <div class="bar"><span style="width:${pct(c.coverage)}"></span></div>
          <span>${pct(c.coverage)}</span>
        </div>
      </td>
      <td class="num">${esc(c.evidence)}</td>
      <td class="num">${esc(c.total)}</td>
    </tr>`;
  }).join('');

  return `<div class="table-wrap">
    <table class="table">
      <thead><tr>
        <th>项目</th><th class="hide-sm">语言</th><th>License</th><th>覆盖度</th>
        <th class="num">成熟度</th><th class="num">综合</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ── 检索页 ───────────────────────────────────────────────── */

function viewFind() {
  const langs = state.boot.stats.langs ?? [];
  return `<div class="page">
    <section class="search-card card">
      <form data-form="find">
        <div class="search-row">
          <label class="search-box">
            ${iconSearch()}
            <input id="findQ" name="q" autocomplete="off" spellcheck="false"
              placeholder="关键词或一句话，例如：PDF 表格提取" value="${esc(state.findQuery)}" />
          </label>
          <button class="btn btn-primary" type="submit">检索</button>
        </div>
        <div class="filter-row">
          <label class="select">
            <select id="findLang" aria-label="语言">
              <option value="">全部语言</option>
              ${langs.map((l) => `<option value="${esc(l.language)}" ${state.findLang === l.language ? 'selected' : ''}>${esc(l.language)} · ${l.n}</option>`).join('')}
            </select>
          </label>
          <label class="select">
            <select id="findStars" aria-label="最低星数">
              ${[['', '不限星数'], ['500', '500★ 以上'], ['2000', '2000★ 以上'], ['10000', '10000★ 以上']]
                .map(([v, label]) => `<option value="${v}" ${state.findStars === v ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label class="select">
            <select id="findLimit" aria-label="结果数量">
              ${[10, 20, 30].map((n) => `<option value="${n}" ${state.findLimit === n ? 'selected' : ''}>${n} 条</option>`).join('')}
            </select>
          </label>
          <span class="filter-hint">能力标签 + 检索词重排，不按星数排</span>
        </div>
      </form>
    </section>
    ${state.findLoading
      ? `<div class="empty mt-12"><span class="spinner"></span><p>检索中…</p></div>`
      : state.find
        ? findResultHtml(state.find)
        : risingHtml()}
  </div>`;
}

function findResultHtml(f) {
  const head = `<div class="results-head">
    <span class="results-title">命中 ${f.results.length} 项 <small>${esc(f.need)}</small></span>
    <div class="cap-chips">
      ${f.caps.map((c) => `<span class="chip chip-accent" title="${esc(c.en)}">${esc(c.zh)}</span>`).join('')}
    </div>
  </div>`;

  if (!f.results.length) {
    return `${head}<div class="empty">
      <div class="empty-icon">${iconSearch()}</div>
      <h3>没有命中</h3>
      <p>换个说法，或放宽语言与星数筛选。也可能这个方向还没进库。</p>
    </div>`;
  }

  return `${head}<div class="repo-list">${f.results.map(repoRow).join('')}</div>`;
}

function repoRow(hit, i) {
  const chips = [];
  if (hit.stars) chips.push(`<span class="chip">★ ${num(hit.stars)}</span>`);
  if (hit.language) chips.push(`<span class="chip">${esc(hit.language)}</span>`);
  const lic = String(hit.license ?? '');
  const licMissing = !lic || lic === 'NOASSERTION' || lic === 'null';
  if (licMissing) chips.push(`<span class="chip chip-warn" title="没有明确 license，不能直接复用代码">⚠ 无 license</span>`);
  else chips.push(`<span class="chip">${esc(lic)}</span>`);
  if (hit.heat >= 5) chips.push(`<span class="chip chip-ok">+${Math.round(hit.heat)}/天</span>`);
  if (hit.fresh) chips.push(`<span class="chip chip-ok">近一年活跃</span>`);

  return `<div class="repo-row">
    <span class="repo-rank">${String(i + 1).padStart(2, '0')}</span>
    <div class="repo-body">
      <div class="repo-top">
        <a class="repo-name" href="${esc(hit.url)}" target="_blank" rel="noopener">${esc(hit.full_name)}</a>
        ${chips.join('')}
      </div>
      ${hit.description ? `<p class="repo-desc">${esc(hit.description)}</p>` : ''}
      <div class="repo-why">${esc(hit.why)}</div>
    </div>
  </div>`;
}

function risingHtml() {
  const rows = state.boot.rising ?? [];
  if (!rows.length) {
    return `<div class="empty mt-12">
      <div class="empty-icon">${iconSearch()}</div>
      <h3>还没有热度数据</h3>
      <p>先跑一次 <span class="mono">oss daily</span>，之后这里会显示涨得最快的项目。</p>
    </div>`;
  }

  return `<div class="results-head">
    <span class="results-title">最近在涨 <small>按日均涨星排序</small></span>
  </div>
  <div class="rising-grid">
    ${rows.map((r) => `<a class="rising-card" href="${esc(r.url)}" target="_blank" rel="noopener">
      <span class="rising-top">
        <span class="repo-name">${esc(r.full_name)}</span>
        <span class="heat">+${Math.round(r.heat)}/天</span>
      </span>
      ${r.description ? `<span class="repo-desc">${esc(r.description)}</span>` : ''}
      <span class="inline-tags">
        ${(r.caps ?? []).map((c) => `<span class="tag">${esc(c.zh)}</span>`).join('')}
        ${r.language ? `<span class="tag">${esc(r.language)}</span>` : ''}
      </span>
    </a>`).join('')}
  </div>`;
}

/* ── 能力库 ───────────────────────────────────────────────── */

function filteredCaps() {
  const q = state.capsQuery.trim().toLowerCase();
  return state.boot.caps.filter((c) => !q || `${c.zh} ${c.en} ${c.id}`.toLowerCase().includes(q));
}

function viewCaps() {
  return `<div class="page">
    <div class="caps-head">
      <label class="search-box">
        ${iconSearch()}
        <input id="capsFilter" autocomplete="off" spellcheck="false" placeholder="过滤能力，回车可去检索" value="${esc(state.capsQuery)}" />
      </label>
      <span class="caps-count" id="capsCount"></span>
    </div>
    <div class="caps-grid" id="capsGrid"></div>
  </div>`;
}

function renderCapsGrid() {
  const list = filteredCaps();
  const grid = $('#capsGrid');
  const count = $('#capsCount');
  if (!grid) return;
  if (count) count.textContent = `${list.length} / ${state.boot.caps.length}`;
  grid.innerHTML = list.length
    ? list.map((c) => `<button type="button" class="cap-card" data-action="cap" data-zh="${esc(c.zh)}">
        <span class="cap-top">
          <span class="cap-zh">${esc(c.zh)}</span>
          <span class="cap-n">${num(c.count)}</span>
        </span>
        <span class="cap-en">${esc(c.en)}</span>
        <span class="cap-id">${esc(c.id)}</span>
        ${c.composes?.length ? `<span class="cap-composes">${c.composes.map((k) => `<span class="tag">${esc(k.zh)}</span>`).join('')}</span>` : ''}
      </button>`).join('')
    : '<div class="cap-empty">没有匹配的能力。换个关键词试试。</div>';
}

/* ── 设置页 ───────────────────────────────────────────────── */

function keyHintText(llm, ready) {
  if (!llm.apiKeySet) {
    return ready
      ? '当前端点无需 Key（本地服务），已可启用 AI 拆解'
      : '还没有可用的 Key，拆解会退化成能力词表兜底';
  }
  const src = llm.apiKeySource === 'env'
    ? `来自环境变量 ${llm.apiKeyEnv || 'OPENAI_API_KEY'}，不会写入配置文件`
    : llm.apiKeySource === 'file'
      ? '来自 oss.config.json（明文保存）'
      : '';
  return `已保存 ${llm.apiKeyMasked || ''}${src ? ` · ${src}` : ''}`;
}

function viewSettings() {
  const p = state.boot.profile ?? {};
  const l = state.boot.llm ?? {};
  const s = state.boot.stats;
  const upd = state.update ?? {};
  const last = upd.lastUpdate;
  const updating = upd.status === 'running';
  const prov = providerOf(l.baseUrl);
  const activeKey = prov?.key ?? 'custom';
  const keyHint = keyHintText(l, state.boot.llmReady);

  return `<div class="page">
    <form class="settings" data-form="settings">
      <section class="card form-card">
        <header>
          <h2>项目画像</h2>
          <p>这些信息参与 license 判定、技术栈匹配和决策里对时间压力的判断。</p>
        </header>
        <div class="form-grid">
          <label class="field">
            <span>项目名</span>
            <input name="name" value="${esc(p.name ?? '')}" placeholder="未命名项目" />
          </label>
          <label class="field">
            <span>团队规模</span>
            <input name="teamSize" type="number" min="1" step="1" value="${p.teamSize ?? ''}" placeholder="例如：3" />
          </label>
          <label class="field">
            <span>技术栈（逗号分隔）</span>
            <input name="stack" value="${esc((p.stack ?? []).join(', '))}" placeholder="TypeScript, Node.js" />
          </label>
          <label class="field">
            <span>时间预算</span>
            <input name="timeline" value="${esc(p.timeline ?? '')}" placeholder="例如：6 周 / 本月上线" />
          </label>
          <label class="field span-2">
            <span>license 允许清单（逗号分隔，留空表示不限制）</span>
            <input name="licensePolicy" value="${esc((p.licensePolicy ?? []).join(', '))}" placeholder="MIT, Apache-2.0, BSD-3-Clause" />
          </label>
          <label class="switch-row span-2">
            <input type="checkbox" name="commercial" ${p.commercial ? 'checked' : ''} />
            <span class="switch-track"></span>
            <span class="switch-text">
              <strong>商业 / 闭源项目</strong>
              <small>开启后，强 copyleft 与含商用限制的 license 会被判为不可直接复用。</small>
            </span>
          </label>
          <label class="field span-2">
            <span>补充说明</span>
            <textarea name="notes" rows="3" placeholder="约束、已有系统、必须支持的环境等">${esc(p.notes ?? '')}</textarea>
          </label>
        </div>
      </section>

      <section class="card form-card" id="apiCard">
        <header>
          <h2>模型连接</h2>
          <p>只用 OpenAI 兼容的 /chat/completions 做需求拆解，不参与候选打分。Key 的优先级：环境变量 &gt; OPENAI_API_KEY &gt; 本文件。</p>
        </header>
        <div class="provider-block">
          <div class="provider-head">
            <span class="eyebrow">厂商预设</span>
            <span class="provider-links">
              <a id="providerKeyLink" href="${esc(prov?.keys ?? '#')}" target="_blank" rel="noopener noreferrer" ${prov ? '' : 'hidden'}>获取 API Key ↗</a>
              <a id="providerDocsLink" href="${esc(prov?.docs ?? '#')}" target="_blank" rel="noopener noreferrer" ${prov?.docs ? '' : 'hidden'}>文档 ↗</a>
            </span>
          </div>
          <div class="provider-grid">
            ${PROVIDERS.map((p) => `<button type="button" class="provider${p.key === activeKey ? ' is-active' : ''}"
              data-action="pick-provider" data-key="${p.key}" aria-pressed="${p.key === activeKey}">
              <span class="provider-name">${esc(p.name)}</span>
              <span class="provider-note">${esc(p.note)}</span>
            </button>`).join('')}
          </div>
          <p class="provider-hint">点选厂商会填入 Base URL 与模型 UID；模型可直接输入任意 UID，不限于预设清单。</p>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>Base URL</span>
            <input name="baseUrl" value="${esc(l.baseUrl ?? '')}" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label class="field">
            <span>模型</span>
            <input name="model" list="modelOptions" value="${esc(l.model ?? '')}" placeholder="deepseek-v4-pro" />
            <small class="suffix">可直接输入任意模型 UID</small>
          </label>
          <label class="field">
            <span>Key 所在环境变量</span>
            <input name="apiKeyEnv" value="${esc(l.apiKeyEnv ?? '')}" placeholder="OSS_LLM_API_KEY" />
          </label>
          <label class="field">
            <span>超时（毫秒）</span>
            <input name="timeoutMs" type="number" min="1000" max="600000" step="1000" value="${l.timeoutMs ?? 60000}" />
          </label>
          <div class="field span-2">
            <span>API Key</span>
            <div class="key-row">
              <input name="apiKey" type="password" autocomplete="new-password"
                placeholder="${l.apiKeySet ? '已保存；留空则不修改' : '填在这里会明文写入 oss.config.json'}" />
              <button class="btn btn-sm" type="button" data-action="reveal-key" ${l.apiKeySet ? '' : 'hidden'}>查看已保存</button>
            </div>
            <small class="suffix" id="keyHint">${keyHint}</small>
            <div class="key-preview mono" id="keyPreview" hidden></div>
          </div>
        </div>
        <datalist id="modelOptions">${(prov?.models ?? []).map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
      </section>

      <div class="form-actions">
        <span class="hint">保存后立即生效，下一次拆解就会用新配置。</span>
        <button class="btn btn-primary" type="submit">保存设置</button>
      </div>
    </form>

    <section class="card form-card">
      <header>
        <h2>数据与文件</h2>
        <p>库内快照决定候选范围，报告写入 reports/。</p>
      </header>
      <div class="stat-grid">
        <div class="stat"><b>${num(s.total)}</b><span>项目</span></div>
        <div class="stat"><b>${num(s.fresh)}</b><span>近一年活跃</span></div>
        <div class="stat"><b>${num(s.caps)}</b><span>能力标签</span></div>
        <div class="stat"><b>${num((s.langs ?? []).length)}</b><span>语言</span></div>
      </div>
      <p class="field-note">配置文件：<span class="mono">${esc(state.boot.file)}</span></p>
      <div class="update-row">
        <div class="update-row-main">
          <span class="eyebrow">数据更新</span>
          <p>${
            updating
              ? `正在更新 · ${esc(phaseText(upd))}`
              : last
                ? `上次更新 ${esc(dateTimeOf(last.at))}${last.result ? ` · ${esc(updateSummary({ result: last.result }))}` : ''}`
                : `尚未更新过。启动时会自动更新一次，${upd.minIntervalMin ?? 30} 分钟内重复打开则跳过。`
          }</p>
        </div>
        <button class="btn btn-sm" type="button" data-action="run-update" ${updating ? 'disabled' : ''}>${updating ? '更新中…' : '立即更新'}</button>
      </div>
    </section>

    <section class="card form-card">
      <header>
        <h2>退出程序</h2>
        <p>选型台在后台常驻，关闭浏览器标签不会退出；这里可以停掉本地服务。</p>
      </header>
      <div class="update-row">
        <div class="update-row-main">
          <span class="eyebrow">运行状态</span>
          <p>退出后浏览器标签可以直接关闭，下次双击 exe 会重新启动。</p>
        </div>
        <button class="btn btn-sm btn-danger" type="button" data-action="quit">退出程序</button>
      </div>
    </section>
  </div>`;
}

/* ── 动作 ─────────────────────────────────────────────────── */

function applyProvider(key) {
  const p = PROVIDERS.find((x) => x.key === key);
  const form = $('[data-form="settings"]');
  if (!p || !form) return;

  const base = $('input[name="baseUrl"]', form);
  const model = $('input[name="model"]', form);
  if (base) base.value = p.custom ? '' : p.baseUrl;
  if (model) model.value = p.custom ? '' : (p.models[0] ?? '');

  const list = $('#modelOptions');
  if (list) list.innerHTML = p.models.map((m) => `<option value="${esc(m)}"></option>`).join('');

  $$('.provider', form).forEach((btn) => {
    const on = btn.dataset.key === key;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  const keyLink = $('#providerKeyLink');
  if (keyLink) {
    keyLink.href = p.keys || '#';
    keyLink.hidden = !p.keys;
  }
  const docsLink = $('#providerDocsLink');
  if (docsLink) {
    docsLink.href = p.docs || '#';
    docsLink.hidden = !p.docs;
  }

  if (p.custom) {
    base?.focus();
    toast('自定义模式：填入任意 OpenAI 兼容端点与模型 UID');
  } else {
    toast(`已填入 ${p.name} 的 Base URL 和模型，确认后保存`);
  }
}

async function runDecide() {
  const ta = $('#need');
  if (ta) state.need = ta.value;
  const llmEl = $('#useLlm');
  if (llmEl) state.useLlm = llmEl.checked;
  const limEl = $('#decideLimit');
  if (limEl) {
    state.limit = clampLimit(limEl.value);
    limEl.value = String(state.limit);
  }

  const need = state.need.trim();
  if (!need) {
    toast('先写下你要做的东西', true);
    ta?.focus();
    return;
  }
  if (state.busy) return;

  state.busy = true;
  const btn = $('#decideBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>拆解中…';
  }

  try {
    const data = await api('/api/decide', {
      method: 'POST',
      body: { need, useLlm: state.useLlm, limit: state.limit },
    });
    state.decide = data.result;
    state.report = data.report;
    state.selected = 0;
    state.busy = false;
    renderPage();
    if (data.result.components.length) {
      toast(`拆出 ${data.result.components.length} 个组件，报告已生成`);
    } else {
      toast('没能拆出组件，换个更具体的说法试试', true);
    }
  } catch (err) {
    state.busy = false;
    toast(err.message, true);
    if (btn && document.contains(btn)) {
      btn.disabled = false;
      btn.textContent = '开始拆解';
    }
  }
}

async function runFind(query) {
  const q = String(query ?? state.findQuery).trim();
  if (!q) {
    toast('输入检索词', true);
    $('#findQ')?.focus();
    return;
  }
  if (state.busy) return;

  state.findQuery = q;
  state.busy = true;
  state.findLoading = true;
  renderPage();

  try {
    const params = new URLSearchParams({ q, limit: String(state.findLimit) });
    if (state.findLang) params.set('lang', state.findLang);
    if (state.findStars) params.set('minStars', state.findStars);
    state.find = await api(`/api/find?${params}`);
    if (!state.find.results.length) toast('没有命中，换个说法或放宽筛选', true);
  } catch (err) {
    state.find = null;
    toast(err.message, true);
  } finally {
    state.busy = false;
    state.findLoading = false;
    if (state.page === 'find') renderPage();
  }
}

async function saveSettings(form) {
  const fd = new FormData(form);
  const list = (v) => String(v ?? '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);

  const teamSizeRaw = String(fd.get('teamSize') ?? '').trim();
  const body = {
    profile: {
      name: String(fd.get('name') ?? '').trim(),
      teamSize: teamSizeRaw ? Number(teamSizeRaw) : null,
      stack: list(fd.get('stack')),
      timeline: String(fd.get('timeline') ?? '').trim(),
      licensePolicy: list(fd.get('licensePolicy')),
      commercial: fd.get('commercial') === 'on',
      notes: String(fd.get('notes') ?? '').trim(),
    },
    llm: {
      baseUrl: String(fd.get('baseUrl') ?? '').trim(),
      model: String(fd.get('model') ?? '').trim(),
      apiKeyEnv: String(fd.get('apiKeyEnv') ?? '').trim(),
      timeoutMs: Number(fd.get('timeoutMs')) || 60000,
    },
  };
  const key = String(fd.get('apiKey') ?? '').trim();
  if (key) body.llm.apiKey = key;

  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const saved = await api('/api/config', { method: 'POST', body });
    state.boot = { ...state.boot, profile: saved.profile, llm: saved.llm, llmReady: saved.llmReady, file: saved.file };
    updateChrome();
    const keyInput = form.querySelector('[name="apiKey"]');
    if (keyInput) {
      keyInput.value = '';
      keyInput.placeholder = saved.llm.apiKeySet ? '已保存；留空则不修改' : '填在这里会明文写入 oss.config.json';
    }
    const hint = form.querySelector('#keyHint');
    if (hint) hint.textContent = keyHintText(saved.llm, saved.llmReady);
    const reveal = form.querySelector('[data-action="reveal-key"]');
    if (reveal) {
      reveal.hidden = !saved.llm.apiKeySet;
      reveal.textContent = '查看已保存';
    }
    const preview = form.querySelector('#keyPreview');
    if (preview) {
      preview.hidden = true;
      preview.textContent = '';
    }
    toast('设置已保存');
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** 设置页显式点「查看已保存」时才向本地服务取明文 Key */
async function revealKey() {
  const box = $('#keyPreview');
  const btn = $('[data-action="reveal-key"]');
  if (!box || !btn) return;
  if (!box.hidden) {
    box.hidden = true;
    box.textContent = '';
    btn.textContent = '查看已保存';
    return;
  }
  btn.disabled = true;
  try {
    const { apiKey } = await api('/api/config/key');
    box.textContent = apiKey || '没有保存 Key';
    box.hidden = false;
    btn.textContent = '隐藏';
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function selectComponent(i) {
  const comps = state.decide?.components ?? [];
  const comp = comps[i];
  if (!comp) return;
  state.selected = i;
  for (const el of $$('.comp-item')) {
    const on = Number(el.dataset.i) === i;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', String(on));
  }
  const detail = $('#detail');
  if (detail) detail.innerHTML = detailHtml(comp);
}

/* ── 事件 ─────────────────────────────────────────────────── */

document.addEventListener('click', (e) => {
  const themeBtn = e.target.closest('#themeToggle');
  if (themeBtn) {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'select') {
    selectComponent(Number(el.dataset.i));
  } else if (action === 'example') {
    state.need = el.dataset.need ?? '';
    const ta = $('#need');
    if (ta) ta.value = state.need;
    runDecide();
  } else if (action === 'cap') {
    openFind(el.dataset.zh ?? '');
  } else if (action === 'run-update') {
    runUpdate();
  } else if (action === 'quit') {
    quitApp();
  } else if (action === 'pick-provider') {
    applyProvider(el.dataset.key);
  } else if (action === 'reveal-key') {
    revealKey();
  } else if (action === 'dismiss-update') {
    clearTimeout(state.updateHideTimer);
    const bar = $('#updateBar');
    if (bar) bar.hidden = true;
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.form === 'decide') {
    e.preventDefault();
    runDecide();
  } else if (form.dataset.form === 'find') {
    e.preventDefault();
    runFind();
  } else if (form.dataset.form === 'settings') {
    e.preventDefault();
    saveSettings(form);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.id === 'need') {
    e.preventDefault();
    runDecide();
  }
  if (e.key === 'Enter' && e.target.id === 'capsFilter') {
    e.preventDefault();
    const zh = filteredCaps()[0]?.zh;
    if (zh) openFind(zh);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'need') state.need = t.value;
  else if (t.id === 'findQ') state.findQuery = t.value;
  else if (t.id === 'capsFilter') {
    state.capsQuery = t.value;
    renderCapsGrid();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'useLlm') {
    if (t.checked && !state.boot.llmReady) {
      t.checked = false;
      state.useLlm = false;
      toast('还没配置 AI API：先在设置里填好 API，再回来开启 AI 拆解；当前默认离线词表');
      location.hash = '#/settings';
      setTimeout(() => $('#apiCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      return;
    }
    state.useLlm = t.checked;
  } else if (t.id === 'decideLimit') {
    state.limit = clampLimit(t.value);
    t.value = String(state.limit);
  } else if (t.id === 'findLang') state.findLang = t.value;
  else if (t.id === 'findStars') state.findStars = t.value;
  else if (t.id === 'findLimit') state.findLimit = Number(t.value) || 20;
});

let toastTimer = 0;
function toast(message, isError = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ── 图标 ─────────────────────────────────────────────────── */

function iconSearch() {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
    <circle cx="7.2" cy="7.2" r="4.4" /><path d="m10.6 10.6 3 3" stroke-linecap="round" />
  </svg>`;
}

function iconAlert() {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3">
    <circle cx="8" cy="8" r="6" /><path d="M8 4.8v4.1" stroke-linecap="round" />
    <circle cx="8" cy="11.4" r="0.7" fill="currentColor" stroke="none" />
  </svg>`;
}

/* ── 启动 ─────────────────────────────────────────────────── */

async function boot() {
  applyTheme(localStorage.getItem('oss.theme') || 'dark');
  try {
    state.boot = await api('/api/bootstrap');
    state.update = state.boot.update ?? null;
    updateChrome();
  } catch (err) {
    $('#content').innerHTML = `<div class="page"><div class="empty">
      <div class="empty-icon">${iconAlert()}</div>
      <h3>连不上本地服务</h3>
      <p>${esc(err.message)}。确认终端里的 <span class="mono">oss ui</span> 还在运行。</p>
    </div></div>`;
    return;
  }
  route();
  renderUpdateBar();
  if (state.update?.status === 'running') pollUpdate(1200);
}

window.addEventListener('hashchange', () => {
  if (!state.boot) return;
  route();
});

boot();
