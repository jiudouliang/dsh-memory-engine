import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { scoreMemories, layoutMemories, renderHtml } from './render/index.mjs';
import { readConfig, readPersona } from './config.js';

export function computeMapData(store, { warn } = {}) {
  const items = store.read().map(({ id, text, title: nodeTitle, ts, kind, heat }) => ({ id, text,
    title: nodeTitle || Array.from(text).slice(0, 20).join(''), ts, kind, heat }));
  const now = store.now();
  const config = readConfig(path.dirname(path.dirname(store.file)));
  const persona = readPersona(config, { now, warn });
  const scored = scoreMemories(items, now);
  const core = persona ? { id: 'persona', text: persona.text, title: config.personaTitle, kind: '人格', heat: 1,
    ts: persona.ts, isCore: true, retention: 1, degree: 0, emotion: [], ageDays: 0, boosts: 0,
    pos: { x: 0, y: 0, z: 0 }, radius: 6.5 } : null;
  const nodes = layoutMemories(core ? [core, ...scored.nodes] : scored.nodes);
  const kinds = Object.fromEntries([...new Set(nodes.map(node => node.kind))].map(kind => [kind, nodes.filter(node => node.kind === kind).length]));
  return { generatedAt: now, nodes, links: scored.links, review: scored.review,
    core: core ? { id: core.id, title: core.title, preview: Array.from(core.text).slice(0, 120).join('') + (Array.from(core.text).length > 120 ? '…' : '') } : null,
    spinSpeed: config.spinSpeed,
    stats: { total: nodes.length, byKind: kinds, forgettingSoon: nodes.filter(node => node.retention < 0.3).length } };
}

export function generateMap(store, { out, title = '我的记忆神经网络' } = {}) {
  const started = performance.now();
  if (typeof title !== 'string' || !title.trim()) throw new Error('title 必须是非空字符串');
  if (out !== undefined && (typeof out !== 'string' || !out.trim())) throw new Error('out 必须是 HTML 文件路径');
  const file = path.resolve(out ?? path.join(path.dirname(store.file), 'starmap.html'));
  if (path.extname(file).toLowerCase() !== '.html') throw new Error('输出文件必须以 .html 结尾');
  const home = path.dirname(path.dirname(store.file));
  const bridge = process.env.QQ_BRIDGE_DIR || readConfig(home).bridgeRoot;
  if (bridge) {
    const relative = path.relative(path.resolve(bridge), file);
    if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('桥接目录只读，请把图谱输出到插件数据目录或其他目录');
    }
  }
  const { nodes, ...data } = computeMapData(store);
  const html = renderHtml({ ...data, stars: nodes }, title);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, html, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { file, total: nodes.length, edges: data.links.length, kinds: data.stats.byKind,
    bytes: Buffer.byteLength(html), elapsedMs: performance.now() - started };
}

export function mapReport(result) {
  const kinds = Object.entries(result.kinds).map(([kind, count]) => `${kind} ${count}`).join(' / ');
  return `已生成记忆神经网络图\n- 节点 ${result.total} 个${kinds ? `（${kinds}）` : ''}\n- 关联边 ${result.edges} 条\n`
    + `- 文件：${result.file}（${(result.bytes / 1024 / 1024).toFixed(2)} MB）\n双击打开即可（断网也能看）`;
}

export function openMap(file) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', pathToFileURL(file).href] : [file];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`浏览器启动失败：退出码 ${code}`)));
  });
}
