#!/usr/bin/env node
/**
 * 构建 Windows 单文件 oss-finder.exe
 *
 *   npm run build:exe
 *
 * 流程：esbuild 打成单个 CJS → 内嵌前端资源与示例库 → Node SEA 生成 blob
 *      → 复制当前 node.exe → postject 注入 blob。
 *
 * 产物：dist/oss-finder.exe（双击即开图形界面，data/reports/logs 与 exe 同级）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { inject } from 'postject';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const CJS = path.join(BUILD, 'oss-finder.cjs');
const BLOB = path.join(BUILD, 'oss-finder.blob');
const SEA_CONFIG = path.join(BUILD, 'sea-config.json');
const OUT = path.join(DIST, 'oss-finder.exe');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const step = (msg) => console.log(`\n▸ ${msg}`);

/** 把 PE 子系统改成 Windows GUI：双击时不再弹出黑色命令行窗口 */
function setGuiSubsystem(file) {
  const buf = fs.readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x00004550) throw new Error(`不是有效的 PE 文件：${file}`);
  // PE32 / PE32+ 的 Subsystem 都在可选头偏移 68
  buf.writeUInt16LE(2, pe + 24 + 68);
  fs.writeFileSync(file, buf);
}

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. 打包成单文件 CommonJS：Node SEA 的主脚本只支持 CJS
step('打包源码（esbuild → CJS）');
await build({
  entryPoints: [path.join(ROOT, 'oss.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: CJS,
  // CJS 里没有 import.meta.url，用 __filename 折算成 file URL 顶替
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: {
    js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
  logLevel: 'warning',
});

// 2. 示例库：先 checkpoint 把 WAL 合并进主文件，再复制
step('准备示例库');
const seedSrc = path.join(ROOT, 'data', 'oss.db');
const seedDst = path.join(BUILD, 'seed.db');
let hasSeed = false;
if (fs.existsSync(seedSrc)) {
  const db = new DatabaseSync(seedSrc);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  fs.copyFileSync(seedSrc, seedDst);
  hasSeed = true;
  console.log(`  已内置示例库 ${(fs.statSync(seedDst).size / 1048576).toFixed(1)} MB`);
} else {
  console.warn('  未找到 data/oss.db，exe 将不含示例库（首次检索前需要 harvest --full）');
}

// 3. SEA 配置：前端三件套 + 种子库一起塞进可执行文件
step('生成 SEA 配置');
const assets = {
  'web/index.html': path.join(ROOT, 'web', 'index.html'),
  'web/app.js': path.join(ROOT, 'web', 'app.js'),
  'web/styles.css': path.join(ROOT, 'web', 'styles.css'),
};
if (hasSeed) assets['seed/oss.db'] = seedDst;
for (const file of Object.values(assets)) {
  if (!fs.existsSync(file)) throw new Error(`缺少资源文件：${file}`);
}
fs.writeFileSync(
  SEA_CONFIG,
  JSON.stringify(
    {
      main: CJS,
      output: BLOB,
      disableExperimentalSEAWarning: true,
      useCodeCache: true,
      useSnapshot: false,
      assets,
    },
    null,
    2
  )
);
execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], {
  stdio: 'inherit',
});

// 4. 以当前 node.exe 为壳，注入 blob 得到单文件 exe
step('注入 Node 运行时');
if (fs.existsSync(OUT)) fs.rmSync(OUT, { force: true });
fs.copyFileSync(process.execPath, OUT);
await inject(OUT, 'NODE_SEA_BLOB', fs.readFileSync(BLOB), { sentinelFuse: SEA_FUSE });

// 5. 去掉控制台窗口：双击直接进浏览器界面，不留命令行黑框
step('切换为图形界面模式');
setGuiSubsystem(OUT);

step('完成');
console.log(`  ${OUT}  (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
console.log('  双击即可打开选型台；首次运行会在 exe 旁生成 data/ 并释放内置示例库。');
