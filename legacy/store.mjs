import { readJson, writeJson, PATHS, daysBetween } from './lib.mjs';

const STATE_VERSION = 1;

export async function loadState() {
  const state = await readJson(PATHS.state, null);
  if (!state || state.version !== STATE_VERSION) {
    return { version: STATE_VERSION, repos: {}, runs: [], createdAt: new Date().toISOString() };
  }
  if (!state.runs) state.runs = [];
  if (!state.repos) state.repos = {};
  return state;
}

export async function saveState(state) {
  // 顺手清理：>180 天没再出现的仓库不再跟踪
  const today = new Date();
  for (const [key, entry] of Object.entries(state.repos)) {
    if (daysBetween(entry.lastSeen, today.toISOString()) > 180 && !entry.recommendedOn?.length) {
      delete state.repos[key];
    }
  }
  // 运行记录只留最近 200 条
  state.runs = state.runs.slice(-200);
  await writeJson(PATHS.state, state);
}

/**
 * 记录一次观测，返回与上次相比的 star 增量。
 * 同一天内多次观测不会互相覆盖 delta（否则一天内跑两次会把增量算成 0）。
 */
export function observe(state, repo, today) {
  const key = repo.full_name;
  const stars = repo.stargazers_count ?? 0;
  let entry = state.repos[key];

  if (!entry) {
    entry = {
      firstSeen: today,
      lastSeen: today,
      stars,
      prevStars: stars,
      delta: 0,
      snapshots: [[today, stars]],
      recommendedOn: [],
    };
    state.repos[key] = entry;
    return { key, delta: 0, firstSeen: today, daysTracked: 0, isNew: true };
  }

  const sameDay = entry.lastSeen === today;
  if (!sameDay) {
    entry.prevStars = entry.stars;
    entry.delta = stars - entry.stars;
  }
  entry.stars = stars;
  entry.lastSeen = today;

  const lastSnap = entry.snapshots?.[entry.snapshots.length - 1];
  if (lastSnap && lastSnap[0] === today) lastSnap[1] = stars;
  else {
    entry.snapshots = entry.snapshots ?? [];
    entry.snapshots.push([today, stars]);
    if (entry.snapshots.length > 60) entry.snapshots = entry.snapshots.slice(-60);
  }

  return {
    key,
    delta: sameDay ? (entry.delta ?? 0) : entry.delta,
    firstSeen: entry.firstSeen,
    daysTracked: daysBetween(entry.firstSeen, today),
    isNew: false,
  };
}

export function isRecentlyRecommended(state, key, today, dedupeDays) {
  const entry = state.repos[key];
  const dates = entry?.recommendedOn ?? [];
  if (!dates.length) return false;
  const last = dates[dates.length - 1];
  return daysBetween(last, today) < dedupeDays;
}

export function markRecommended(state, keys, today) {
  for (const key of keys) {
    const entry = state.repos[key];
    if (!entry) continue;
    entry.recommendedOn = entry.recommendedOn ?? [];
    if (!entry.recommendedOn.includes(today)) entry.recommendedOn.push(today);
    if (entry.recommendedOn.length > 20) entry.recommendedOn = entry.recommendedOn.slice(-20);
  }
}

export function recommendedCount(state) {
  return Object.values(state.repos).filter((e) => e.recommendedOn?.length).length;
}
