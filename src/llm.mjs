import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './lib.mjs';

const DEFAULT_PROFILE = {
  name: '未命名项目',
  stack: [],
  commercial: false,
  licensePolicy: [],
  timeline: '',
  teamSize: null,
  notes: '',
};

const DEFAULT_LLM = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKeyEnv: 'OSS_LLM_API_KEY',
  apiKey: '',
  timeoutMs: 60000,
};

/**
 * 配置来源：--config 指定的文件 > OSS_CONFIG > 项目根目录 oss.config.json。
 * API Key 优先读环境变量，避免把密钥写进文件。
 */
export function loadConfig(file = process.env.OSS_CONFIG || path.join(PATHS.root, 'oss.config.json')) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    raw = {};
  }

  const profile = { ...DEFAULT_PROFILE, ...(raw.profile ?? {}) };
  const llm = { ...DEFAULT_LLM, ...(raw.llm ?? {}) };
  const envKey = llm.apiKeyEnv ? process.env[llm.apiKeyEnv] : '';
  const apiKey = envKey || process.env.OPENAI_API_KEY || llm.apiKey || '';

  return { profile, llm: { ...llm, apiKey }, file };
}

/** 本地推理服务（Ollama / LM Studio 等）通常不校验 Key，配好端点与模型即可用 */
function isLocalEndpoint(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function llmReady(llm) {
  if (!llm?.baseUrl || !llm?.model) return false;
  return Boolean(llm.apiKey || isLocalEndpoint(llm.baseUrl));
}

/** 从模型输出里抠 JSON：兼容 ```json 围栏和前后夹带的解释文字 */
export function parseJsonLoose(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('模型返回为空');

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error('模型返回不是合法 JSON');
  }
}

async function requestChat(body, llm) {
  const url = String(llm.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (llm.apiKey) headers.Authorization = `Bearer ${llm.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(llm.timeoutMs) || 60000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`LLM ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return parseJsonLoose(text);
}

/** 调一次 JSON 模式的对话；部分兼容服务不支持 response_format，失败时自动去掉重试 */
export async function chatJson({ system, user }, llm) {
  const base = {
    model: llm.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  try {
    return await requestChat({ ...base, response_format: { type: 'json_object' } }, llm);
  } catch (err) {
    if (!/LLM 4\d\d/.test(err.message)) throw err;
    return requestChat(base, llm);
  }
}
