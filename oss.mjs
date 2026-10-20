#!/usr/bin/env node
/**
 * oss — 开源能力库 CLI
 *
 *   oss find "把 PDF 里的表格提取成 Excel"     直接找现成项目
 *   oss plan "做一个视频剪辑 App"              拆成子能力，每个给候选
 *   oss harvest --full                        建库 / 增量更新
 *   oss stats                                 库里有什么
 *   oss caps                                  能力清单
 *   oss show owner/repo                       看单个项目
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isSea } from 'node:sea';
import { search, explain } from './src/search.mjs';
import { harvest, retagAll } from './src/collect.mjs';
import { stats, count, open, allRepos, topRising, seedSnapshots } from './src/db.mjs';
import { dailyUpdate } from './src/discover.mjs';
import { CAPABILITIES, CAP_BY_ID } from './src/taxonomy.mjs';
import { loadConfig } from './src/llm.mjs';
import { decomposeNeed } from './src/decompose.mjs';
import { decide, renderReport } from './src/decide.mjs';
import { PATHS, dateKey, writeText } from './src/lib.mjs';

const argv = process.argv.slice(2);

// 管道被 head / Select-Object 截断时不要报 EPIPE
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
});

const cmd = argv[0];
const flags = new Map();
const words = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags.set(k, v);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { flags.set(k, argv[++i]); }
    else flags.set(k, true);
  } else words.push(a);
}
const need = words.join(' ');
const opt = (k, d = null) => (flags.has(k) ? flags.get(k) : d);

/** 数字参数：缺失或非法时回退默认值，并按上下限收敛，避免 NaN / 负数传到下游 */
function num(key, def, { min = -Infinity, max = Infinity } = {}) {
  const raw = opt(key);
  if (raw === null || raw === '' || typeof raw === 'boolean') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
const asJson = flags.has('json');
const BIN = isSea() ? path.basename(process.execPath, '.exe') : 'node oss.mjs';

const dim = (s) => `\x1b[90m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

function truncate(s, n) {
  const str = String(s ?? '').replace(/\s+/g, ' ').trim();
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function printHit(hit, idx) {
  const r = hit.repo;
  console.log(
    `${String(idx).padStart(2)}. ${bold(r.full_name)} ${dim(`${r.stars}★`)} ` +
      `${r.language ? cyan(r.language) : ''} ${dim(`score ${hit.score}`)}`
  );
  if (r.description) console.log(`    ${truncate(r.description, 96)}`);
  console.log(`    ${dim(explain(hit))}  ${dim(r.url)}`);
}

function requireDb() {
  const n = count();
  if (n === 0) {
    console.log(`库里还没有数据。先跑一次全量建库：\n  ${BIN} harvest --full`);
    process.exit(1);
  }
  return n;
}

// ---------------- find ----------------
function cmdFind() {
  if (!need) {
    console.log(`用法: ${BIN} find "你的需求，中文英文都行"`);
    process.exit(1);
  }
  requireDb();
  const res = search(need, {
    limit: num('limit', 12, { min: 1, max: 200 }),
    minStars: num('min-stars', 0, { min: 0 }),
    language: opt('lang'),
  });

  if (asJson) {
    console.log(JSON.stringify({ need, caps: res.caps.map((c) => c.id), results: res.results.map((h) => ({ ...h.repo, score: h.score, why: explain(h) })) }, null, 2));
    return;
  }

  console.log(bold(`需求：${need}`));
  if (res.caps.length) {
    console.log(dim('识别到能力：' + res.caps.slice(0, 4).map((c) => `${c.cap.zh}(${c.weight})`).join('  ')));
  } else {
    console.log(dim('没识别到明确能力，按关键词检索'));
  }
  console.log('');
  if (!res.results.length) {
    console.log('没找到匹配的项目。可能是库里还没有覆盖这个方向——试试换个说法，或扩充能力表。');
    return;
  }
  res.results.forEach((hit, i) => printHit(hit, i + 1));
  console.log('');
  console.log(dim(`共 ${res.results.length} 条。加 --json 可拿结构化结果。`));
}

// ---------------- plan ----------------
async function cmdPlan() {
  if (!need) {
    console.log(`用法: ${BIN} plan "你要做的功能"`);
    process.exit(1);
  }
  requireDb();
  const cfg = loadConfig(opt('config') || undefined);
  const result = await decomposeNeed(need, {
    profile: cfg.profile,
    llm: cfg.llm,
    useLlm: !flags.has('no-llm'),
  });
  const components = result.components;
  if (!components.length) {
    console.log('没识别出能力，换个更具体的说法试试（例如「做一个视频剪辑工具」「做一个 RAG 知识库」）。');
    return;
  }

  console.log(bold(`需求：${need}`));
  console.log(dim(`拆成 ${components.length} 个子能力，拆解方式：${result.source === 'llm' ? 'LLM' : '能力词表兜底'}。每个给 3 个候选，够用就走，不够再往下钻。`));
  if (result.warning) console.log(dim(`提示：${result.warning}`));
  console.log('');

  for (const comp of components) {
    const indent = comp.core ? '' : '  ';
    const label = comp.core ? green('核心') : dim('支撑');
    console.log(`${indent}${label} ${bold(comp.name)} ${dim((comp.queries ?? []).slice(0, 3).join(' / '))}`);
    const res = search([comp.name, ...(comp.queries ?? [])].join(' '), { limit: 3 });
    if (!res.results.length) {
      console.log(`${indent}  ${dim('（库里暂无，可 harvest 后重试）')}`);
    }
    for (const h of res.results) {
      const r = h.repo;
      console.log(`${indent}  · ${r.full_name} ${dim(`${r.stars}★`)} ${r.language ? cyan(r.language) : ''}`);
      console.log(`${indent}    ${dim(truncate(r.description, 84))}`);
    }
    console.log('');
  }
  console.log(dim('提示：想深入某个子能力，直接 `oss find "子能力" --limit 20`；要看选型结论用 `oss decide "需求"`。'));
}

// ---------------- decide ----------------
async function cmdDecide() {
  if (!need) {
    console.log(`用法: ${BIN} decide "你的需求" [--limit 5] [--out 报告.md] [--no-llm]`);
    process.exit(1);
  }
  requireDb();
  const cfg = loadConfig(opt('config') || undefined);
  const result = await decide(need, {
    profile: cfg.profile,
    llm: cfg.llm,
    useLlm: !flags.has('no-llm'),
    limit: num('limit', 5, { min: 1, max: 10 }),
  });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.components.length) {
    console.log('没识别出可拆解的组件。换个更具体的说法，或在 oss.config.json 里配好 LLM 后重试。');
    process.exit(1);
  }

  console.log(bold(`需求：${need}`));
  console.log(dim(`拆解：${result.source === 'llm' ? 'LLM' : '能力词表兜底'} · ${result.components.length} 个组件`));
  if (result.warning) console.log(dim(`提示：${result.warning}`));
  console.log('');

  result.components.forEach((comp, i) => {
    const d = comp.decision;
    console.log(`${String(i + 1).padStart(2)}. ${bold(comp.name)} ${dim(comp.core ? '核心' : '支撑')} → ${green(d.label)}`);
    if (d.best) {
      console.log(`    ${dim('首选')} ${d.best}${d.reasons[0] ? dim(' · ' + d.reasons[0]) : ''}`);
    } else if (d.reasons[0]) {
      console.log(`    ${dim(d.reasons[0])}`);
    }
    if (d.risks.length) console.log(`    ${dim('风险：' + d.risks.slice(0, 2).join('；'))}`);
  });

  const md = renderReport(result);
  const stamp = `${dateKey()}-${new Date().toTimeString().slice(0, 5).replace(':', '')}`;
  const file = opt('out') || path.join(PATHS.reports, `decide-${stamp}.md`);
  await writeText(file, md);
  console.log('');
  console.log(dim(`报告已写入 ${path.relative(process.cwd(), file)}`));
}

// ---------------- harvest ----------------
async function cmdHarvest() {
  const full = flags.has('full');
  await harvest({ full, perDay: num('per-day', 10, { min: 1, max: 100 }) });
}

// ---------------- stats ----------------
function cmdStats() {
  const n = requireDb();
  const s = stats();
  if (asJson) return console.log(JSON.stringify({ ...s, total: n }, null, 2));
  console.log(bold(`库内项目：${s.total}`));
  console.log(dim(`近一年有更新的：${s.fresh}`));
  console.log('');
  console.log(bold('语言分布'));
  for (const l of s.langs) console.log(`  ${String(l.n).padStart(5)}  ${l.language}`);
  console.log('');
  console.log(bold('覆盖最多的能力'));
  for (const [id, c] of s.topCaps.slice(0, 20)) {
    const cap = CAP_BY_ID.get(id);
    console.log(`  ${String(c).padStart(5)}  ${cap?.zh ?? id}${cap ? dim(' / ' + cap.en) : ''}`);
  }
}

// ---------------- caps ----------------
function cmdCaps() {
  const q = need.toLowerCase();
  const list = q ? CAPABILITIES.filter((c) => (c.zh + c.en + c.id).toLowerCase().includes(q)) : CAPABILITIES;
  console.log(bold(`${list.length} 个能力`));
  for (const c of list) {
    const kids = (c.composes ?? []).map((k) => CAP_BY_ID.get(k)?.zh ?? k);
    console.log(`  ${c.id.padEnd(18)} ${c.zh}${kids.length ? dim('  → ' + kids.join(' / ')) : ''}`);
  }
}

// ---------------- rising ----------------
function cmdRising() {
  requireDb();
  const limit = num('limit', 20, { min: 1, max: 300 });
  const days = flags.has('days') ? num('days', 0, { min: 1 }) : null;
  const rows = topRising({ limit: 300, minHeat: num('min-heat', 2, { min: 0 }) });
  const now = Date.now();
  const list = (days ? rows.filter((r) => (now - new Date(r.first_seen).getTime()) / 864e5 <= days) : rows).slice(0, limit);

  if (asJson) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  if (!list.length) {
    console.log(`还没有足够的热度数据。先跑一次 \`${BIN} daily\`，明天开始就会积累增速。`);
    return;
  }

  console.log(bold('🔥 最近在涨的项目'));
  console.log(dim('按日均涨星排序。🆕 = 最近 3 天刚入库'));
  console.log('');
  list.forEach((r, i) => {
    const ageDays = Math.round((now - new Date(r.first_seen).getTime()) / 864e5);
    const isNew = ageDays <= 3;
    const caps = String(r.caps).split(' ').filter(Boolean).map((c) => CAP_BY_ID.get(c)?.zh ?? c);
    console.log(
      `${String(i + 1).padStart(2)}. ${bold(r.full_name)} ${green(`+${Math.round(r.heat)}/天`)} ` +
        `${r.stars}★ ${isNew ? green('🆕') : dim(`${ageDays}天前入库`)} ${r.language ? cyan(r.language) : ''}`
    );
    console.log(`    ${dim(truncate(r.description, 88))}`);
    if (caps.length) console.log(`    ${dim('能力：' + caps.slice(0, 3).join(' / '))}  ${dim(r.url)}`);
    else console.log(`    ${dim(r.url)}`);
  });
  console.log('');
  console.log(dim('看到感兴趣的可以直接 `oss show 名字` 看详情。'));
}

// ---------------- daily ----------------
async function cmdDaily() {
  const seed = seedSnapshots();
  console.log(dim(`基线快照：+${seed.snapshots} 条，预热热度 ${seed.heatSeeded} 个项目`));
  await dailyUpdate({
    discoveryQueries: num('queries', 6, { min: 1, max: 6 }),
    watchCount: num('watch', 38, { min: 0, max: 100 }),
    hnLimit: num('hn', 8, { min: 0, max: 50 }),
  });
}

// ---------------- show ----------------
function cmdShow() {
  const target = need.toLowerCase();
  const rows = allRepos().filter((r) => String(r.full_name).toLowerCase().includes(target));
  if (!rows.length) { console.log('没找到：' + need); return; }
  for (const r of rows.slice(0, 5)) {
    console.log(bold(r.full_name), dim(r.url));
    console.log(`  ${r.description || '（无描述）'}`);
    console.log(`  ${r.stars}★ · ${r.forks} fork · ${r.language || '—'} · ${r.license || '无协议'} · 质量分 ${r.quality}`);
    console.log(`  能力：${String(r.caps).split(' ').map((c) => CAP_BY_ID.get(c)?.zh ?? c).join(' / ')}`);
    console.log(`  最近更新：${r.pushed_at} · 建库来源：${r.source}`);
    console.log('');
  }
}

// ---------------- ui ----------------
/** 端口被占用时，判断占用者是不是已经跑起来的选型台 */
async function isRunningInstance(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.stats);
  } catch {
    return false;
  }
}

async function cmdUi() {
  requireDb();
  const { startServer, openInBrowser } = await import('./src/server.mjs');
  const noUpdate = flags.has('no-update');
  const port = num('port', 7788, { min: 1, max: 65535 });
  try {
    const { url } = await startServer({
      port,
      openBrowser: !flags.has('no-open'),
      autoUpdate: !noUpdate,
      updateOptions: {
        discoveryQueries: num('queries', 6, { min: 1, max: 6 }),
        watchCount: num('watch', 38, { min: 0, max: 100 }),
        hnLimit: num('hn', 8, { min: 0, max: 50 }),
      },
    });
    console.log(`选型台已启动：${url}`);
    if (noUpdate) {
      console.log(dim('已跳过启动更新（--no-update），检索直接使用现有库。'));
    } else {
      console.log(dim('正在后台更新数据库（发现新项目 + 刷新热度）；30 分钟内更新过会自动跳过，更新期间可正常检索。'));
    }
    console.log('按 Ctrl+C 停止。');
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') throw err;
    // 端口已被占用：如果占用的就是本程序，直接打开已有窗口，不重复起服务
    if (await isRunningInstance(port)) {
      const url = `http://127.0.0.1:${port}`;
      console.log(`选型台已经在运行：${url}`);
      if (!flags.has('no-open')) {
        openInBrowser(url);
        console.log(dim('已打开浏览器，本窗口可以关闭。'));
      } else {
        console.log(dim('本窗口可以关闭。'));
      }
      return;
    }
    console.error(`端口 ${port} 被其他程序占用。换一个端口再试，例如：\n  ${BIN} ui --port ${port + 1}`);
    process.exitCode = 1;
  }
}

// ---------------- main ----------------
let fatalError = null;
(async () => {
  try {
    open();
    switch (cmd) {
      case 'find': cmdFind(); break;
      case 'plan': await cmdPlan(); break;
      case 'decide': await cmdDecide(); break;
      case 'rising': cmdRising(); break;
      case 'daily': await cmdDaily(); break;
      case 'harvest': await cmdHarvest(); break;
      case 'retag': retagAll(); break;
      case 'stats': cmdStats(); break;
      case 'caps': cmdCaps(); break;
      case 'show': cmdShow(); break;
      case 'ui': await cmdUi(); break;
      case undefined:
        // 双击 exe（无参数）直接进图形界面；源码运行仍显示帮助
        if (isSea()) { await cmdUi(); break; }
      case '-h':
      case '--help':
        console.log(`oss — 开源能力库

  oss find "把 PDF 表格提取成 Excel"    找现成项目
  oss plan "做一个视频剪辑 App"         拆成子能力再找
  oss decide "做一个视频剪辑 App"       拆解 + 选型结论 + Markdown 报告
  oss ui                                打开图形化选型台（启动即更新库）
  oss ui --no-update                    打开界面但不更新，直接用现有库
  oss rising                            最近在涨的项目（突然爆火的）
  oss daily                             每日更新：发现新项目 + 刷新热度
  oss harvest --full                    按能力 topic 建库（首次）
  oss retag                             改完 taxonomy 后重新打标
  oss stats                             库状态
  oss caps [关键词]                     能力清单
  oss show owner/repo                   项目详情

参数：--limit N  --lang Rust  --min-stars 500  --days 7  --json
      --config oss.config.json  --out 报告路径  --no-llm（不调用大模型）`);
        break;
      default:
        console.log(`未知命令：${cmd}。用 ${BIN} --help 看用法。`);
        process.exitCode = 1;
    }
  } catch (err) {
    if (err?.code === 'EPIPE') return;
    console.error(err?.stack || String(err));
    fatalError = err?.message || String(err);
    process.exitCode = 1;
  }
  // 双击 exe 时没有控制台，出错改用系统弹窗，否则用户只会看到程序一闪而过
  if (isSea() && cmd === undefined && fatalError) {
    spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($env:OSS_FINDER_ERR, 'oss-finder', 'OK', 'Error')",
      ],
      { env: { ...process.env, OSS_FINDER_ERR: fatalError }, windowsHide: true }
    );
  }
})();
