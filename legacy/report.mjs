import { CONFIG } from './config.mjs';

const n = (x) => Number(x ?? 0).toLocaleString('en-US');

const fmtSpd = (x) => (x >= 100 ? n(Math.round(x)) : Number(x).toFixed(1));

function esc(text = '') {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function truncate(text, max) {
  const s = esc(text);
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
}

function ageText(days) {
  if (days <= 1) return '今天刚发布';
  if (days < 30) return `${days} 天前创建`;
  if (days < 365) return `${Math.round(days / 30)} 个月前创建`;
  return `${(days / 365).toFixed(1)} 年前创建`;
}

function hms(iso) {
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function renderMarkdown(payload) {
  const { date, generatedAt, stats, picks, alternates, hnOnly } = payload;
  const L = [];

  L.push(`# 开源雷达 · ${date}`, '');
  const head = picks[0];
  if (head) {
    L.push(
      `> 今日头号：**${head.fullName}** —— ${head.language} 项目，${n(head.stars)} star` +
        (head.delta > 0 ? `（24 小时 +${n(head.delta)}）` : '') +
        '。',
      ''
    );
  }
  L.push(
    `扫描了 ${stats.queries.length} 组查询、${n(stats.rawRepos)} 个候选，` +
      `过滤后剩 ${n(stats.candidates)} 个，精选 ${picks.length} 个。` +
      `生成于 ${hms(generatedAt)}。`,
    ''
  );

  L.push('## 今日精选', '');
  picks.forEach((p, i) => {
    L.push(`### ${i + 1}. [${p.fullName}](${p.url})`, '');
    const badges = [
      `\`${p.language}\``,
      `⭐ ${n(p.stars)}`,
      p.delta > 0 ? `📈 +${n(p.delta)} / 24h` : null,
      p.factors.starsPerDay ? `日均 ${fmtSpd(p.factors.starsPerDay)} star` : null,
      p.license && p.license !== 'NOASSERTION' ? p.license : null,
    ].filter(Boolean);
    L.push(badges.join(' · '), '');
    if (p.description) L.push(`> ${truncate(p.description, 220)}`, '');
    L.push(`- **为什么值得看**：${p.reason}`);
    L.push(`- **值不值得看**：${p.verdict}`);
    if (p.hn) L.push(`- **HN 讨论**：[${p.hn.points} 分 / ${p.hn.comments} 评论](${p.hn.hnUrl})`);
    const meta = [ageText(p.factors.ageDays), `方向：${p.category.label}`, `${n(p.forks)} fork`];
    if (p.topics?.length) meta.push(`话题：${p.topics.slice(0, 5).join(', ')}`);
    L.push(`- **项目信息**：${meta.join(' · ')}`);
    if (p.homepage) L.push(`- **主页**：${p.homepage}`);
    L.push('');
  });

  if (hnOnly?.length) {
    L.push('## Hacker News 上被讨论、但榜单还没反映出来的', '');
    L.push('| 项目 | 分数 | 评论 | 说明 |');
    L.push('| --- | ---: | ---: | --- |');
    for (const h of hnOnly.slice(0, 10)) {
      L.push(`| [${h.fullName}](${h.url}) | ${h.points} | ${h.comments} | ${esc(h.title)} |`);
    }
    L.push('');
  }

  if (alternates?.length) {
    L.push('## 备选池', '');
    L.push('| # | 项目 | 语言 | ⭐ | +24h | 日均 | 方向 | 一句话 |');
    L.push('| ---: | --- | --- | ---: | ---: | ---: | --- | --- |');
    alternates.slice(0, 20).forEach((p, i) => {
      L.push(
        `| ${i + 1} | [${p.fullName}](${p.url}) | ${p.language} | ${n(p.stars)} | ${
          p.delta > 0 ? '+' + n(p.delta) : '—'
        } | ${fmtSpd(p.factors.starsPerDay)} | ${p.category.label} | ${truncate(p.description, 64)} |`
      );
    });
    L.push('');
  }

  L.push('## 本次扫描', '');
  L.push('| 查询 | 结果 |', '| --- | ---: |');
  for (const q of stats.queries) L.push(`| ${q.label} (\`${q.id}\`) | ${q.count} |`);
  L.push('');
  if (stats.dropped && Object.keys(stats.dropped).length) {
    L.push(
      `过滤统计：${Object.entries(stats.dropped)
        .map(([k, v]) => `${k} × ${v}`)
        .join('，')}`,
      ''
    );
  }
  L.push(
    '---',
    '',
    `_由 oss-radar 自动生成。数据源：GitHub Search API、Hacker News Algolia API。_`,
    `_同一项目 ${CONFIG.dedupeDays} 天内不会重复推荐（除非单日涨星超过 ${CONFIG.resurfaceDelta}）。_`
  );

  return L.join('\n');
}
