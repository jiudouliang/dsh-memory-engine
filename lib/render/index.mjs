import { loadMemories } from './load.mjs';
import { scoreMemories } from './score.mjs';
import { layoutMemories } from './layout.mjs';
import { renderHtml } from './render.mjs';

export { loadMemories, scoreMemories, layoutMemories, renderHtml };

export async function generate(input, { title = '记忆神经网络', now = Date.now() } = {}) {
  const items = await loadMemories(input, now);
  const { nodes, links, review } = scoreMemories(items, now);
  const stars = layoutMemories(nodes);
  const payload = {
    generatedAt: now,
    stats: {
      total: stars.length,
      byKind: stars.reduce((counts, star) => ({ ...counts, [star.kind]: (counts[star.kind] || 0) + 1 }), {}),
      forgettingSoon: stars.filter((star) => star.retention < 0.3).length,
    },
    stars, links, review,
  };
  return { payload, html: renderHtml(payload, title) };
}
