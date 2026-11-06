// Unicode characters (not UTF-16 halves) are used for lengths and LCS.
export const norm = value => String(value)
  .replace(/[\s，。！？、；：""''（）《》【】,.!?;:"'()<>\[\]-]/gu, '').toLowerCase();

export function prepare(text) {
  const normalized = norm(text);
  const all = Array.from(normalized);
  const prefix = all.slice(0, 500);
  const counts = new Map();
  for (const char of prefix) counts.set(char, (counts.get(char) ?? 0) + 1);
  return { normalized, length: all.length, prefix, counts, set: new Set(all) };
}

// Rolling DP uses at most 501 Uint16 values rather than a 500x500 matrix.
export function lcsLength(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  const dp = new Uint16Array(a.length + 1);
  for (const right of b) {
    let previous = 0;
    for (let i = 1; i <= a.length; i++) {
      const above = dp[i];
      dp[i] = a[i - 1] === right ? previous + 1 : Math.max(above, dp[i - 1]);
      previous = above;
    }
  }
  return dp[a.length];
}

export function similarity(a, b, threshold = 0.7) {
  const shorter = Math.min(a.length, b.length);
  if (!shorter) return { duplicate: a.normalized === b.normalized, score: a.normalized === b.normalized ? 1 : 0, rule: 'exact' };
  if (a.normalized === b.normalized) return { duplicate: true, score: 1, rule: 'exact' };
  if (shorter >= 6 && (a.normalized.includes(b.normalized) || b.normalized.includes(a.normalized))) {
    return { duplicate: true, score: 1, rule: 'containment' };
  }
  let intersection = 0;
  const [small, large] = a.set.size <= b.set.size ? [a.set, b.set] : [b.set, a.set];
  for (const char of small) if (large.has(char)) intersection++;
  const jaccard = intersection / (a.set.size + b.set.size - intersection);
  if (shorter >= 10 && jaccard >= Math.max(0.85, threshold)) return { duplicate: true, score: jaccard, rule: 'jaccard' };
  // A multiset intersection bounds LCS from above, allowing an exact early
  // rejection without changing any matching thresholds.
  const prefixShorter = Math.min(a.prefix.length, b.prefix.length);
  let upper = 0;
  const [few, many] = a.counts.size <= b.counts.size ? [a.counts, b.counts] : [b.counts, a.counts];
  for (const [char, count] of few) upper += Math.min(count, many.get(char) ?? 0);
  if (upper < prefixShorter * threshold) return { duplicate: false, score: 0, rule: 'lcs' };
  const score = lcsLength(a.prefix, b.prefix) / prefixShorter;
  return { duplicate: score >= threshold, score, rule: 'lcs' };
}

export function findDuplicate(rows, candidate, prepared = rows.map(row => prepare(row.text)), threshold = 0.7) {
  const text = prepare(candidate.text);
  for (let index = 0; index < rows.length; index++) {
    const match = similarity(prepared[index], text, threshold);
    if (match.duplicate) return { index, ...match };
  }
  return null;
}

export function mergeMemories(old, incoming) {
  const longer = Array.from(incoming.text).length > Array.from(old.text).length;
  const emotion = new Map([...old.emotion, ...incoming.emotion].map(mark => [`${mark.tag}\0${mark.w}`, { ...mark }]));
  return { ...old, text: longer ? incoming.text : old.text,
    ...(longer && incoming.title ? { title: incoming.title } : {}),
    boosts: old.boosts + incoming.boosts, ts: Math.min(old.ts, incoming.ts),
    heat: Math.min(old.heat, incoming.heat), emotion: [...emotion.values()],
    ...(old.who?.trim() ? { who: old.who } : incoming.who?.trim() ? { who: incoming.who } : {}),
    createdAt: Math.min(old.createdAt, incoming.createdAt) };
}

export function duplicateGroups(rows, threshold = 0.7) {
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.95) throw new Error('threshold 必须在 0.5–0.95 之间');
  const texts = rows.map(row => prepare(row.text));
  const parent = rows.map((_, i) => i);
  function root(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = root(i), b = root(j);
      if (a !== b && similarity(texts[i], texts[j], threshold).duplicate) parent[b] = a;
    }
  }
  const groups = new Map();
  for (let i = 0; i < rows.length; i++) {
    const key = root(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  return [...groups.values()].filter(group => group.length > 1).map(indices => {
    // Retain the oldest persisted identity; ties keep the original array order.
    indices.sort((a, b) => rows[a].createdAt - rows[b].createdAt || a - b);
    const memory = indices.slice(1).reduce((merged, index) => mergeMemories(merged, rows[index]), rows[indices[0]]);
    return { indices, memory };
  });
}
