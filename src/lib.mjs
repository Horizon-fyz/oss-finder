import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = {
  root: ROOT,
  data: path.join(ROOT, 'data'),
  reports: path.join(ROOT, 'reports'),
  logs: path.join(ROOT, 'logs'),
  state: path.join(ROOT, 'data', 'state.json'),
  latest: path.join(ROOT, 'data', 'latest.json'),
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 以 Asia/Shanghai 为准的 YYYY-MM-DD */
export function dateKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shiftDays(days, from = new Date()) {
  return dateKey(new Date(from.getTime() + days * 86400000));
}

export function daysBetween(aIso, bIso) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return Math.abs(b - a) / 86400000;
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
}

export async function writeJson(file, data) {
  await writeText(file, JSON.stringify(data, null, 2));
}

/** 控制台输出保持纯 ASCII，避免 Windows 代码页把中文打成乱码；同时落一份日志，便于排查定时任务 */
export function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`;
  process.stdout.write(line);
  try {
    const file = path.join(PATHS.logs, 'run.log');
    fsSync.mkdirSync(PATHS.logs, { recursive: true });
    const st = fsSync.statSync(file, { throwIfNoEntry: false });
    if (st && st.size > 4 * 1024 * 1024) fsSync.writeFileSync(file, '');
    fsSync.appendFileSync(file, line, 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
