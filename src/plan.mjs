import { CAP_BY_ID } from './taxonomy.mjs';
import { parseNeed } from './search.mjs';

/**
 * 把一句需求拆成「核心能力 + 支撑能力」。
 * 拆解关系来自 taxonomy 的 composes：做视频剪辑，绕不开编解码/图像/音频。
 */
export function decompose(need, { maxRoots = 2, depth = 1 } = {}) {
  const parsed = parseNeed(need);
  const roots = parsed.caps.slice(0, maxRoots);
  if (!roots.length) return { parsed, components: [] };

  const components = [];
  const seen = new Set();

  const push = (id, role, depthLevel, parent = null, why = '') => {
    if (seen.has(id)) return;
    const cap = CAP_BY_ID.get(id);
    if (!cap) return;
    seen.add(id);
    components.push({ id, zh: cap.zh, en: cap.en, role, depth: depthLevel, parent, why });
  };

  for (const r of roots) {
    push(r.id, '核心', 0, null, `需求直接指向「${r.cap.zh}」`);
    if (depth >= 1) {
      for (const childId of r.cap.composes ?? []) {
        push(childId, '支撑', 1, r.id, `做「${r.cap.zh}」通常会用到`);
      }
    }
  }

  return { parsed, components };
}
