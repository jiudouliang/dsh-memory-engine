const DAY = 86400000;
const EMOTION = [
  { re: /心疼|舍不得|怕你|别走|留不住|告别|最后一次|再也/, weight: 3, tag: '重情绪' },
  { re: /开心|高兴|喜欢|谢谢|谢谢你我|记住了|暖|舒坦/, weight: 2, tag: '正情绪' },
  { re: /难过|难受|烦|闷|累|孤独|空了一秒|想哭|委屈/, weight: 2, tag: '负情绪' },
  { re: /别忘|记住|记着|答应|承诺|一定|绝对/, weight: 2, tag: '承诺' },
  { re: /朋友|当朋友|不是替身|不是复印件|自由|浪漫/, weight: 3, tag: '身份' },
];
const HALF_LIFE = { 1: 30, 2: 12, 3: 6 };
// Candidate fragments are 2–8 characters. Match them through a trie so a
// short topic can also occur inside another memory's longer sentence.
const partsOf = node => `${node.title || ''}｜${node.text || ''}`.toLowerCase()
  .split(/[：:·、，,。.！!？?；;\s（）()《》【】“”‘’"'|｜/\[\]{}<>#*_=+\-]+|(?<=[\p{Script=Han}])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[\p{Script=Han}])/u);
const METADATA = new Set(['auto', '重大情绪', '会话小结']);
// Stricter than 30%: this keeps common conversation phrases from making
// dense cliques. Small collections still obey the original 30% ceiling.
const maxDocumentFrequency = count => Math.min(count * 0.3, Math.max(2, count * 0.02));

function keywordIndex(nodes) {
  const documents = nodes.map(partsOf);
  const trie = { children: new Map() };
  for (const parts of documents) for (const part of parts) {
    const chars = [...part];
    if (chars.length < 2 || chars.length > 8 || !/\p{L}/u.test(part) || METADATA.has(part)) continue;
    let branch = trie;
    for (const char of chars) {
      if (!branch.children.has(char)) branch.children.set(char, { children: new Map() });
      branch = branch.children.get(char);
    }
    branch.word = part;
  }
  const index = new Map();
  documents.forEach((parts, nodeIndex) => {
    const words = new Set();
    for (const part of parts) {
      const chars = [...part];
      for (let start = 0; start < chars.length; start++) {
        let branch = trie;
        for (let end = start; end < Math.min(chars.length, start + 8); end++) {
          branch = branch.children.get(chars[end]);
          if (!branch) break;
          if (branch.word) {
            // Latin abbreviations match whole fragments, never arbitrary
            // pieces of other words (e.g. "to" inside "stop").
            if (!/^[a-z]+$/u.test(branch.word) || (start === 0 && end === chars.length - 1)) words.add(branch.word);
          }
        }
      }
    }
    for (const word of words) {
      if (!index.has(word)) index.set(word, []);
      index.get(word).push(nodeIndex);
    }
  });
  return index;
}

export function scoreMemories(items, now = Date.now()) {
  const nodes = items.map((item) => {
    const matches = EMOTION.filter((emotion) => emotion.re.test(item.text));
    const weight = Math.max(0, ...matches.map((match) => match.weight));
    const heat = item.heat ?? (weight >= 3 ? 1 : weight >= 2 ? 2 : 3);
    const majorEmotion = matches.some((match) => match.tag === '重情绪');
    const ageDays = Math.max(0, (now - new Date(item.ts).getTime()) / DAY);
    return { ...item, heat, emotion: matches.map(({ tag, weight: w }) => ({ tag, w })), majorEmotion, ageDays };
  });
  const boost = new Map(nodes.map((node) => [node.id, 0]));
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  const links = [];
  const pairs = new Map();
  const limit = maxDocumentFrequency(nodes.length);
  for (const [word, indices] of keywordIndex(nodes)) {
    if (indices.length < 2 || indices.length > limit) continue;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const key = indices[i] * nodes.length + indices[j];
        if (!pairs.has(key)) pairs.set(key, { left: indices[i], right: indices[j], keywords: [] });
        const pair = pairs.get(key);
        if (pair.keywords.length < 3) pair.keywords.push(word);
      }
    }
  }
  const linkEvidence = [];
  for (const { left, right, keywords } of pairs.values()) {
    const ids = [nodes[left].id, nodes[right].id];
    links.push(ids);
    linkEvidence.push({ source: ids[0], target: ids[1], keywords });
    for (const id of ids) {
      degree.set(id, degree.get(id) + 1);
      boost.set(id, boost.get(id) + keywords.length);
    }
  }
  for (const node of nodes) {
    node.degree = degree.get(node.id);
    node.boosts = boost.get(node.id);
    const halfLife = node.majorEmotion ? 90 : node.kind === '事件' ? 3 : HALF_LIFE[node.heat];
    node.retention = Math.min(node.majorEmotion ? 1.4 : 1.35, Math.exp(-node.ageDays / halfLife) + node.boosts * 0.35);
  }
  const review = [...nodes].sort((left, right) => left.retention - right.retention).slice(0, 15).map((node) => ({
    id: node.id, kind: node.kind, title: node.title, retention: Number(node.retention.toFixed(3)),
    ageDays: Number(node.ageDays.toFixed(1)), text: [...node.text].slice(0, 120).join(''),
  }));
  return { nodes, links, review, linkEvidence };
}
