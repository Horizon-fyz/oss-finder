import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { PATHS, dateKey, shiftDays } from './lib.mjs';

let db = null;

export function open(file = path.join(PATHS.data, 'oss.db')) {
  if (db) return db;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS repos (
      id          INTEGER PRIMARY KEY,
      full_name   TEXT UNIQUE NOT NULL,
      url         TEXT,
      description TEXT DEFAULT '',
      language    TEXT DEFAULT '',
      topics      TEXT DEFAULT '',
      topics_json TEXT DEFAULT '[]',
      stars       INTEGER DEFAULT 0,
      forks       INTEGER DEFAULT 0,
      license     TEXT,
      created_at  TEXT,
      pushed_at   TEXT,
      archived    INTEGER DEFAULT 0,
      fork        INTEGER DEFAULT 0,
      homepage    TEXT,
      caps        TEXT DEFAULT '',
      cap_scores  TEXT DEFAULT '{}',
      quality     REAL DEFAULT 0,
      source      TEXT,
      first_seen  TEXT,
      last_seen   TEXT,
      prev_stars  INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_repos_lang ON repos(language);
    CREATE INDEX IF NOT EXISTS idx_repos_stars ON repos(stars DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS repo_fts USING fts5(
      full_name, description, topics, caps,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- 每天记一次 star 快照，用来算「涨得多快」。这是抓突然爆火项目的关键数据。
    CREATE TABLE IF NOT EXISTS snapshots (
      repo_id INTEGER NOT NULL,
      day     TEXT    NOT NULL,
      stars   INTEGER NOT NULL,
      PRIMARY KEY (repo_id, day)
    );

    -- 杂项状态：上次更新时间等
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // 老库补列
  for (const [col, type] of [
    ['heat', 'REAL DEFAULT 0'],
    ['burst', 'INTEGER DEFAULT 0'],
    ['heat_at', 'TEXT'],
    ['fork', 'INTEGER DEFAULT 0'],
  ]) {
    if (!db.prepare('PRAGMA table_info(repos)').all().some((c) => c.name === col)) {
      db.exec(`ALTER TABLE repos ADD COLUMN ${col} ${type}`);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_repos_heat ON repos(heat DESC)');
  return db;
}

const nowIso = () => new Date().toISOString();

/** 写入 / 更新一个仓库，同时同步全文索引 */
export function upsertRepo(repo, { caps = [], capScores = {}, quality = 0, source = '' } = {}) {
  const d = open();
  const capText = caps.join(' ');
  const topicsJson = JSON.stringify(repo.topics ?? []);
  const topicsText = (repo.topics ?? []).join(' ').replace(/_/g, ' ');

  const existing = d.prepare('SELECT id, stars FROM repos WHERE full_name = ?').get(repo.full_name);

  if (existing) {
    d.prepare(`
      UPDATE repos SET
        url=?, description=?, language=?, topics=?, topics_json=?, stars=?, forks=?,
        license=?, created_at=?, pushed_at=?, archived=?, fork=?, homepage=?, caps=?, cap_scores=?,
        quality=?, last_seen=?, prev_stars=?
      WHERE id = ?
    `).run(
      repo.html_url ?? '', repo.description ?? '', repo.language ?? '', topicsText, topicsJson,
      repo.stargazers_count ?? 0, repo.forks_count ?? 0, repo.license?.spdx_id ?? null,
      repo.created_at ?? null, repo.pushed_at ?? null, repo.archived ? 1 : 0, repo.fork ? 1 : 0,
      repo.homepage ?? null, capText, JSON.stringify(capScores), quality, nowIso(),
      existing.stars ?? 0, existing.id
    );
    d.prepare('DELETE FROM repo_fts WHERE rowid = ?').run(existing.id);
    d.prepare('INSERT INTO repo_fts(rowid, full_name, description, topics, caps) VALUES (?,?,?,?,?)')
      .run(existing.id, withSpaces(repo.full_name), repo.description ?? '', topicsText, capText);
    return { id: existing.id, inserted: false };
  }

  const info = d.prepare(`
    INSERT INTO repos (full_name, url, description, language, topics, topics_json, stars, forks,
                       license, created_at, pushed_at, archived, fork, homepage, caps, cap_scores,
                       quality, source, first_seen, last_seen, prev_stars)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    repo.full_name, repo.html_url ?? '', repo.description ?? '', repo.language ?? '',
    topicsText, topicsJson, repo.stargazers_count ?? 0, repo.forks_count ?? 0,
    repo.license?.spdx_id ?? null, repo.created_at ?? null, repo.pushed_at ?? null,
    repo.archived ? 1 : 0, repo.fork ? 1 : 0, repo.homepage ?? null, capText, JSON.stringify(capScores),
    quality, source, nowIso(), nowIso(), repo.stargazers_count ?? 0
  );
  const id = Number(info.lastInsertRowid);
  d.prepare('INSERT INTO repo_fts(rowid, full_name, description, topics, caps) VALUES (?,?,?,?,?)')
    .run(id, withSpaces(repo.full_name), repo.description ?? '', topicsText, capText);
  return { id, inserted: true };
}

/** owner/repo 在 FTS 里会被拆成两个词，加个空格版本让命中更自然 */
function withSpaces(fullName) {
  return String(fullName ?? '').replace(/[\/_-]/g, ' ');
}

export function count() {
  return open().prepare('SELECT COUNT(*) n FROM repos').get().n;
}

/** FTS 候选：只做召回，真正的排序在 search.mjs 里按结构化特征重排 */
export function ftsCandidates(matchExpr, limit = 400) {
  if (!matchExpr) return [];
  const sql = `
    SELECT rowid AS id, bm25(repo_fts, 4.0, 2.0, 3.0, 3.0) AS rank
    FROM repo_fts
    WHERE repo_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `;
  try {
    return open().prepare(sql).all(matchExpr, limit);
  } catch (err) {
    return [];
  }
}

export function getRepos(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return open().prepare(`SELECT * FROM repos WHERE id IN (${placeholders})`).all(...ids);
}

export function allRepos() {
  return open().prepare('SELECT * FROM repos').all();
}

/** 每个能力在库里的出现次数——检索时用来做 IDF：越稀缺的能力，命中越值钱 */
let capCountCache = null;
export function capCounts() {
  if (capCountCache) return capCountCache;
  const d = open();
  const total = d.prepare('SELECT COUNT(*) n FROM repos').get().n;
  const counts = new Map();
  for (const row of d.prepare('SELECT caps FROM repos').all()) {
    for (const c of String(row.caps || '').split(' ').filter(Boolean)) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  capCountCache = { counts, total };
  return capCountCache;
}

export function stats() {
  const d = open();
  const total = d.prepare('SELECT COUNT(*) n FROM repos').get().n;
  const langs = d.prepare(`
    SELECT language, COUNT(*) n FROM repos
    WHERE language IS NOT NULL AND language != ''
    GROUP BY language ORDER BY n DESC LIMIT 12
  `).all();
  const byCap = new Map();
  for (const row of d.prepare('SELECT caps FROM repos').all()) {
    for (const c of String(row.caps || '').split(' ').filter(Boolean)) {
      byCap.set(c, (byCap.get(c) ?? 0) + 1);
    }
  }
  const topCaps = [...byCap.entries()].sort((a, b) => b[1] - a[1]);
  const fresh = d.prepare(`SELECT COUNT(*) n FROM repos WHERE pushed_at > ?`).get(
    new Date(Date.now() - 365 * 864e5).toISOString()
  ).n;
  return { total, langs, topCaps, fresh };
}

export function close() {
  if (db) {
    db.close();
    db = null;
  }
}

/** 键值状态（上次更新时间等） */
export function setMeta(key, value) {
  open()
    .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function getMeta(key) {
  return open().prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

/** 库内容变化后清掉能力计数缓存，否则检索 IDF 和前端能力数字会停在旧值 */
export function invalidateCapCounts() {
  capCountCache = null;
}

// ---------------- 热度追踪 ----------------

const WINDOW_DAYS = 14;

/**
 * 记一次 star 快照并重算热度。
 * heat = 近 14 天日均涨星；burst = 最近两次观测之间的单日增量。
 * 这是发现「突然爆火」的唯一可靠办法——绝对星数看不出变化，增量才看得出来。
 */
export function recordSnapshot(repoId, stars, { day = dateKey(), ageDays = null } = {}) {
  const d = open();
  d.prepare('INSERT OR REPLACE INTO snapshots(repo_id, day, stars) VALUES (?,?,?)').run(repoId, day, stars);

  const rows = d
    .prepare('SELECT day, stars FROM snapshots WHERE repo_id = ? AND day >= ? ORDER BY day')
    .all(repoId, shiftDays(-WINDOW_DAYS));

  let heat = 0;
  let burst = 0;
  if (rows.length >= 2) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const spanDays = Math.max(1, (new Date(last.day) - new Date(first.day)) / 864e5);
    heat = (last.stars - first.stars) / spanDays;
    const prev = rows[rows.length - 2];
    const gap = Math.max(1, (new Date(last.day) - new Date(prev.day)) / 864e5);
    burst = Math.round((last.stars - prev.stars) / gap);
  } else if (ageDays && ageDays > 0) {
    // 只有一次观测时，用「建仓以来的日均」当先验
    heat = stars / ageDays;
  }

  heat = Math.round(heat * 10) / 10;
  d.prepare('UPDATE repos SET heat = ?, burst = ?, heat_at = ? WHERE id = ?').run(heat, burst, day, repoId);
  return { heat, burst };
}

/** 只更新星数（watchlist 轮询用），顺带记快照 */
export function touchStars(repoId, stars, { day = dateKey(), ageDays = null } = {}) {
  const d = open();
  const row = d.prepare('SELECT stars FROM repos WHERE id = ?').get(repoId);
  if (!row) return null;
  d.prepare('UPDATE repos SET prev_stars = ?, stars = ?, last_seen = ? WHERE id = ?').run(
    row.stars,
    stars,
    nowIso(),
    repoId
  );
  return recordSnapshot(repoId, stars, { day, ageDays });
}

/** 给所有现有仓库补一个今天的快照（只在没有当天快照时插入） */
export function seedSnapshots(day = dateKey()) {
  const d = open();
  const info = d.prepare(`
    INSERT OR IGNORE INTO snapshots(repo_id, day, stars)
    SELECT id, ?, stars FROM repos
  `).run(day);

  // 新项目（30 天内）的「建仓以来日均」约等于近期增速，可以先拿来当热度
  const fresh = d.prepare(`
    SELECT id, stars, created_at FROM repos
    WHERE heat = 0 AND created_at >= ?
  `).all(shiftDays(-30));
  const upd = d.prepare('UPDATE repos SET heat = ?, heat_at = ? WHERE id = ?');
  for (const r of fresh) {
    const age = Math.max(1, (Date.now() - new Date(r.created_at).getTime()) / 864e5);
    upd.run(Math.round((r.stars / age) * 10) / 10, day, r.id);
  }
  return { snapshots: info.changes, heatSeeded: fresh.length };
}

/**
 * 每天要重新查真实星数的仓库。
 * 预算约 40 个（GitHub 核心接口匿名 60 次/小时），优先给「新出现的小项目」——
 * 突然爆火的基本都在这里，而不是那些几万星的老项目。
 */
export function watchlist(limit = 40) {
  const d = open();
  const fresh = d.prepare(`
    SELECT id, full_name, stars FROM repos
    WHERE first_seen >= ? AND (heat_at IS NULL OR heat_at < ?)
    ORDER BY stars DESC LIMIT ?
  `).all(shiftDays(-30), dateKey(), Math.ceil(limit * 0.6));

  const rotating = d.prepare(`
    SELECT id, full_name, stars FROM repos
    WHERE (heat_at IS NULL OR heat_at < ?)
    ORDER BY heat DESC, stars DESC LIMIT ? OFFSET ?
  `).all(dateKey(), limit - fresh.length, (Number(dateKey().replace(/-/g, '')) % 97) * 3);

  const seen = new Set();
  return [...fresh, ...rotating].filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
}

/** 涨得最快的项目 */
export function topRising({ limit = 20, minHeat = 1 } = {}) {
  return open()
    .prepare(`
      SELECT * FROM repos
      WHERE heat >= ? AND archived = 0 AND description != ''
      ORDER BY heat DESC
      LIMIT ?
    `)
    .all(minHeat, limit);
}
