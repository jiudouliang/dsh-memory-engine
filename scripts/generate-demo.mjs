import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeState } from '../lib/automation-state.js';
import { computeMapData } from '../lib/map.js';
import { renderHtml } from '../lib/render/render.mjs';
import { DemoStore, assertClean, publicNumbers, safeFile, safeRoot } from './demo/common.mjs';
import { demoPage } from './demo/page.mjs';
import { inspectDemoStructure } from './demo/structure.mjs';

function shuffled(values, seed = 137) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const other = seed % (index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function generateDemo({ root = safeRoot(), now = Date.now() } = {}) {
  root = safeRoot(root);
  const source = JSON.parse(fs.readFileSync(safeFile(root, 'source.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(safeFile(root, 'cluster-plan.json'), 'utf8'));
  const persona = fs.readFileSync(safeFile(root, 'roles/小夏.md'), 'utf8');
  assertClean(source);
  assertClean(persona);
  const personaLength = Array.from(persona).length;
  if (personaLength < 600 || personaLength > 900) throw new Error('演示角色卡须为 600～900 字。');
  const structure = inspectDemoStructure(source, plan);
  if (!structure.passed) throw new Error(structure.errors.join('\n'));
  const entries = shuffled(Object.entries(source).flatMap(([kind, items]) => items.map(item => ({ ...item, kind }))));
  const kinds = plan.kinds;
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const today = Date.parse(localDate + 'T00:00:00+08:00');
  const heats = shuffled([...Array(90).fill(1), ...Array(248).fill(2), ...Array(112).fill(3)], 71);
  const boosts = shuffled([...Array(45).fill(4), ...Array.from({ length: 405 }, (_, index) => index % 4)], 97);
  const rows = entries.map((entry, index) => {
    const dayIndex = Math.floor(index * plan.days / entries.length);
    const daysAgo = plan.days - 1 - dayIndex;
    const day = today - daysAgo * 86400000;
    const firstOfDay = Math.ceil(dayIndex * entries.length / plan.days);
    const perDay = Math.ceil((dayIndex + 1) * entries.length / plan.days) - firstOfDay;
    const progress = (index - firstOfDay + 1) / (perDay + 1);
    const ts = day + Math.floor(daysAgo > 0 ? 9 * 3600000 + progress * 10 * 3600000 : (now - today) * progress);
    const date = new Date(day + 8 * 3600000).toISOString().slice(0, 10);
    const text = entry.text.replaceAll('{date}', date);
    if (entry.kind === '日记' && (Array.from(text).length < 120 || Array.from(text).length > 200)) throw new Error(`日记长度不符：${entry.title}`);
    return { id: `m-${ts}-${index.toString(16).padStart(6, '0')}`, text, kind: entry.kind,
      ts, heat: heats[index], emotion: entry.emotion ?? [], title: entry.title.replaceAll('{date}', date),
      who: '阿远', boosts: boosts[index], origin: { source: 'demo' }, createdAt: Math.min(now, ts + 300000) };
  });
  assertClean(rows);
  const configFile = safeFile(root, 'home/.dsh/memory-engine/config.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  writeState(configFile, { personaFile: 'roles/小夏.md', personaText: persona, personaTitle: '小夏', spinSpeed: 0.35,
    hideButton: false, showGuideOnEmpty: true, autoMemory: { enabled: false }, autoImport: { enabled: false, sources: [] } });
  const store = new DemoStore(root);
  store.now = () => now;
  if (fs.existsSync(store.file)) store.backup();
  store.write(rows);
  store.read();
  const { nodes, ...data } = publicNumbers(computeMapData(store));
  const memoryNodes = nodes.filter(node => !node.isCore);
  const actual = { memories: memoryNodes.length, nodes: nodes.length, links: data.links.length,
    maxDegree: Math.max(...memoryNodes.map(node => node.degree)), isolated: memoryNodes.filter(node => node.degree === 0).length };
  if (actual.links !== structure.links || actual.maxDegree !== structure.maxDegree || actual.isolated !== structure.isolated) {
    throw new Error('生成后的图谱结构与源数据审计不一致。');
  }
  const html = renderHtml({ ...data, stars: nodes }, '小夏的记忆神经网络');
  assertClean(html);
  const htmlFile = safeFile(root, 'generated/starmap.html');
  fs.mkdirSync(path.dirname(htmlFile), { recursive: true });
  fs.writeFileSync(htmlFile, html);
  fs.writeFileSync(safeFile(root, 'generated/index.html'), demoPage());
  writeState(safeFile(root, 'generated/structure.json'), { ...structure, actualMap: actual });
  const table = structure.groups.map(group => `| ${group.name} | ${group.size} | ${group.words.map(word => `${word.word} ${word.actual}/${word.planned}`).join('、')} | ${group.internalLinks} | ${group.externalLinks} |`).join('\n');
  const audit = `# 演示主题团核对\n\nDF 阈值：min(450 × 0.3, max(2, 450 × 0.02)) = 9。原评分器保留 DF ≤ 9 的有效词。\n\n`
    + `共 ${actual.memories} 条记忆，${actual.nodes} 个显示节点（包含角色卡）；${actual.links} 条连线，最高度数 ${actual.maxDegree}，记忆孤岛 ${actual.isolated} 个。角色核心不参与 DF 或记忆孤岛计数。\n\n`
    + '| 主题团 | 条数 | 团词实际 DF / 计划 DF | 团内连线 | 对外连线 |\n| --- | ---: | --- | ---: | ---: |\n' + table
    + '\n\n每条团内记忆含 1～2 个团词，所有团词均已被原评分器识别，没有跨团使用。团内全部连通；咖啡团的对外连线为 0。\n\n'
    + '其余内容为 300 条日常关联记忆和 50 条独立记忆。日常细节通常出现 6 次；周四清单、玄关矮柜各出现 8 次，为不同日常事项保留少量自然联系。\n';
  assertClean(audit);
  fs.writeFileSync(safeFile(root, 'generated/cluster-audit.md'), audit);
  return { ...actual, kinds, heat: { 1: 90, 2: 248, 3: 112 }, emotional: rows.filter(row => row.emotion.length).length,
    highestBoost: rows.filter(row => row.boosts === 4).length, date: localDate, days: plan.days, threshold: structure.threshold,
    personaCharacters: personaLength };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error('用法：node scripts/generate-demo.mjs');
    console.log(JSON.stringify(generateDemo(), null, 2));
    console.log('演示库已生成。启动页面：node scripts/demo-server.mjs');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
