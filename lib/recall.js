import { chars, retention, titleOf } from './decay.js';

export function queryTerms(query) {
  return [...new Set(query.trim().toLocaleLowerCase().split(/[\s\p{P}\p{S}]+/u)
    .filter(term => Array.from(term).length >= 2))];
}

export function relevance(memory, query) {
  const normalized = query.trim().toLocaleLowerCase();
  const title = titleOf(memory).toLocaleLowerCase();
  const text = memory.text.toLocaleLowerCase();
  const terms = queryTerms(query);
  const matched = terms.filter(term => title.includes(term) || text.includes(term));
  const missed = terms.filter(term => !matched.includes(term));
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 3;
    if (text.includes(term)) score += 2;
    if (title.startsWith(term)) score += 2;
  }
  if (normalized && title.includes(normalized)) score += 4;
  if (normalized && text.includes(normalized)) score += 2;
  return Object.defineProperty({ score, coverage: terms.length ? matched.length / terms.length : 0, terms, matched, missed },
    Symbol.toPrimitive, { value: () => score });
}

function snippet(text, terms) {
  const characters = Array.from(text);
  const positions = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of text.matchAll(new RegExp(escaped, 'giu'))) {
      const start = Array.from(text.slice(0, match.index)).length;
      positions.push({ start, end: start + Array.from(match[0]).length });
    }
  }
  positions.sort((first, second) => first.start - second.start);
  let selected = chars(text, 120), bestCoverage = 0;
  for (const position of positions) {
    const start = Math.max(0, position.start - 45);
    const end = Math.min(characters.length, position.end + 45);
    const context = characters.slice(start, end).join('');
    const coverage = terms.filter(term => context.toLocaleLowerCase().includes(term)).length;
    if (coverage <= bestCoverage) continue;
    bestCoverage = coverage;
    selected = (start > 0 ? '…' : '') + context + (end < characters.length ? '…' : '');
  }
  return selected;
}

function related(first, second) {
  return (Array.from(first.title).length >= 4 && second.text.includes(first.title))
    || (Array.from(second.title).length >= 4 && first.text.includes(second.title));
}

export function recall(memories, { q, limit = 8, hops = 1, kind }, now = Date.now()) {
  if (typeof q !== 'string' || !q.trim()) throw new Error('q 必须是非空字符串');
  limit = Math.max(1, Math.min(20, Math.trunc(Number.isFinite(limit) ? limit : 8)));
  hops = Math.max(0, Math.min(2, Math.trunc(Number.isFinite(hops) ? hops : 1)));
  const pool = memories.filter(memory => kind === undefined || memory.kind === kind)
    .map(memory => ({ memory, retention: retention(memory, now),
      title: titleOf(memory).toLocaleLowerCase(), text: memory.text.toLocaleLowerCase(), ...relevance(memory, q) }));
  const sorted = rows => rows.sort((a, b) => b.score - a.score || b.memory.ts - a.memory.ts);
  const matches = sorted(pool.filter(row => row.matched.length > 0)
    .map(row => ({ ...row, via: row.coverage >= 0.5 ? 'direct' : 'partial', score: row.score * (0.35 + 0.65 * row.retention) })));
  const direct = matches.filter(row => row.via === 'direct').slice(0, limit);
  const partial = matches.filter(row => row.via === 'partial').slice(0, limit - direct.length);
  if (!direct.length && !partial.length) return [];
  const spreadLimit = Math.min(limit - direct.length - partial.length, Math.floor(direct.length / 2));
  const matchedIds = new Set(matches.map(row => row.memory.id));
  const threshold = direct.length ? direct[0].score * 0.35 : Infinity;
  const best = new Map();
  let frontier = direct;
  for (let hop = 0; hop < hops && spreadLimit > 0; hop++) {
    const next = new Map();
    for (const source of frontier) {
      const score = source.score * 0.45;
      if (score < threshold) continue;
      for (const neighbor of pool) {
        if (matchedIds.has(neighbor.memory.id) || neighbor.memory.id === source.memory.id || neighbor.retention <= 0.4
          || !related(source, neighbor)) continue;
        if (score <= (best.get(neighbor.memory.id)?.score ?? 0)) continue;
        const sharedTitle = Array.from(source.title).length >= 4 && neighbor.text.includes(source.title)
          ? titleOf(source.memory) : titleOf(neighbor.memory);
        const hit = { ...neighbor, score, via: 'spread', from: { id: source.memory.id, title: titleOf(source.memory), term: sharedTitle } };
        best.set(neighbor.memory.id, hit);
        next.set(neighbor.memory.id, hit);
      }
    }
    frontier = [...next.values()];
  }
  return [...direct, ...partial, ...sorted([...best.values()]).slice(0, spreadLimit)]
    .map(({ memory, score, retention: value, via, coverage, terms, matched, missed, from }) => ({
      ...memory, score, retention: value, via, coverage, terms, matched, missed,
      snippet: snippet(memory.text, via === 'spread' ? [from.term.toLocaleLowerCase()] : matched),
      ...(from ? { from } : {}),
    }));
}
