import { scoreMemories } from '../../lib/render/score.mjs';

export function inspectDemoStructure(source, plan) {
  const entries = Object.entries(source).flatMap(([kind, rows]) => rows.map(row => ({ ...row, kind })));
  const count = entries.length;
  const threshold = Math.min(count * 0.3, Math.max(2, count * 0.02));
  const { nodes, links, linkEvidence } = scoreMemories(entries.map((row, index) => ({ ...row,
    id: `draft-${index}`, ts: 0, heat: 2 })), 0);
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(count === plan.count && count >= 440 && count <= 460, '演示库须为 450 条。');
  require(threshold === plan.threshold, 'DF 阈值与团词计划不符。');
  require(plan.days === 60, '演示日期须覆盖 60 天。');
  require(new Set(entries.map(row => row.title)).size === count, '演示记忆标题不能重复。');
  for (const [kind, expected] of Object.entries(plan.kinds)) require(source[kind]?.length === expected, `分类数量不符：${kind}`);
  require(plan.groups.length >= 8 && plan.groups.length <= 10, '主题团须为 8～10 个。');
  const plannedWords = plan.groups.flatMap(group => group.words.map(item => item.word));
  require(new Set(plannedWords).size === plannedWords.length, '团词不能在不同主题团的计划中复用。');
  const groups = plan.groups.map(group => {
    const members = nodes.filter(node => node.cluster === group.name);
    const ids = new Set(members.map(node => node.id));
    const internalLinks = links.filter(([left, right]) => ids.has(left) && ids.has(right));
    const externalLinks = links.filter(([left, right]) => ids.has(left) !== ids.has(right));
    require(members.length === group.size && group.size >= 8 && group.size <= 12, `主题团规模不符：${group.name}`);
    const words = group.words.map(({ word, documents }) => {
      const matching = nodes.filter(node => `${node.title}｜${node.text}`.includes(word));
      const outside = matching.filter(node => node.cluster !== group.name).map(node => node.title);
      const evidence = linkEvidence.filter(link => link.keywords.includes(word));
      require(Array.from(word).length >= 2 && Array.from(word).length <= 5, `团词长度不符：${word}`);
      require(matching.length === documents && matching.length >= 6 && matching.length <= 9 && matching.length <= threshold, `团词 DF 不符：${word}（${matching.length}）`);
      require(outside.length === 0, `团词跨团出现：${word}`);
      require(evidence.length > 0, `原评分器未识别团词：${word}`);
      return { word, planned: documents, actual: matching.length, outside, evidenceEdges: evidence.length };
    });
    for (const node of members) {
      const used = words.filter(({ word }) => `${node.title}｜${node.text}`.includes(word));
      require(used.length >= 1 && used.length <= 2, `每条团内记忆须含 1～2 个团词：${node.title}`);
    }
    const reached = new Set(members.length ? [members[0].id] : []);
    let previousSize;
    do {
      previousSize = reached.size;
      for (const [left, right] of internalLinks) if (reached.has(left) || reached.has(right)) { reached.add(left); reached.add(right); }
    } while (reached.size !== previousSize);
    require(reached.size === members.length, `主题团内部不连通：${group.name}`);
    return { name: group.name, size: members.length, words, internalLinks: internalLinks.length,
      externalLinks: externalLinks.length, connected: reached.size === members.length };
  });
  const coffee = groups.find(group => group.name === '咖啡');
  require(coffee?.externalLinks === 0, '咖啡团不应连接其他主题。');
  const isolated = nodes.filter(node => node.degree === 0);
  const plannedIslands = nodes.filter(node => node.island);
  const maxDegree = Math.max(0, ...nodes.map(node => node.degree));
  require(links.length >= 800 && links.length <= 1500, `连线数超出范围：${links.length}`);
  require(maxDegree >= 15, `最高度数不足：${maxDegree}`);
  require(isolated.length >= 40 && isolated.length <= 80, `孤岛数超出范围：${isolated.length}`);
  require(plannedIslands.length === plan.islands && plannedIslands.every(node => node.degree === 0), '预设的 50 条孤岛必须全部保持孤立。');
  const bridgeWords = ['周四清单', '玄关矮柜'].map(word => ({ word,
    documents: nodes.filter(node => `${node.title}｜${node.text}`.includes(word)).length }));
  const hubs = [...nodes].sort((left, right) => right.degree - left.degree).slice(0, 5).map(node => ({ title: node.title, degree: node.degree }));
  const kinds = Object.fromEntries(Object.keys(plan.kinds).map(kind => [kind, nodes.filter(node => node.kind === kind).length]));
  return { count, threshold, kinds, links: links.length, maxDegree, isolated: isolated.length,
    plannedIslands: plannedIslands.length, groups, bridgeWords, hubs, errors, passed: errors.length === 0 };
}
