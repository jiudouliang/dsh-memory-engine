import path from 'node:path';
import { computeMapData } from './map.js';
import { renderHtml } from './render/render.mjs';
import { ONBOARD_PROMPT, ONBOARD_STEPS } from './onboard.js';
import { readConfig, readUiConfig } from './config.js';
import { updateConfig } from './config-write.js';
import { sessionImportHint } from './automation-config.js';
import { chars, retention, titleOf } from './decay.js';
import { scoreMemories } from './render/score.mjs';

const base = '/memory-engine';
const paths = new Set([base, `${base}/`, `${base}/api/map`, `${base}/api/stats`, `${base}/api/onboard`, `${base}/api/config`,
  `${base}/api/list`, `${base}/api/export`, `${base}/api/clear`]);
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const escapeBridge = '<script>window.addEventListener("keydown",function(event){if(event.key==="Escape")parent.postMessage({type:"dsh-memory-engine-close"},"*")});</script>';

function readBody(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let chunks = [];
    const finish = (error, value) => {
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.removeListener('aborted', onAborted);
      chunks = [];
      if (error) reject(error); else resolve(value);
    };
    const onError = error => finish(error);
    const onAborted = () => finish(Object.assign(new Error('请求已中断'), { status: 400 }));
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        finish(Object.assign(new Error('请求体不能超过 1MB'), { status: 413 }));
        request.resume();
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return finish(Object.assign(new Error('请求体必须是有效 JSON'), { status: 400 })); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return finish(Object.assign(new Error('请求体必须是 JSON 对象'), { status: 400 }));
      finish(null, value);
    };
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
  });
}

function describeMemories(rows, now) {
  const items = rows.map(row => ({ ...row, title: titleOf(row) }));
  const degrees = new Map(scoreMemories(items, now).nodes.map(node => [node.id, node.degree]));
  return items.map(row => ({ ...row, retention: retention(row, now), degree: degrees.get(row.id) }));
}

function listMemories(store, query) {
  const sort = query.get('sort') || 'recent';
  const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!['recent', 'oldest', 'fading', 'degree'].includes(sort)) invalid('sort 必须是 recent、oldest、fading 或 degree');
  const limit = Number(query.get('limit') ?? 50);
  const offset = Number(query.get('offset') ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1) invalid('limit 必须是正整数');
  if (!Number.isSafeInteger(offset) || offset < 0) invalid('offset 必须是非负整数');
  const rows = store.read();
  const search = (query.get('q') || '').toLowerCase();
  const kind = query.get('kind') || '';
  const items = describeMemories(rows, store.now()).filter(row => (!kind || row.kind === kind)
    && (!search || row.text.toLowerCase().includes(search) || row.title.toLowerCase().includes(search)));
  const ordering = { recent: (left, right) => right.ts - left.ts, oldest: (left, right) => left.ts - right.ts,
    fading: (left, right) => left.retention - right.retention, degree: (left, right) => right.degree - left.degree };
  items.sort(ordering[sort]);
  const size = Math.min(200, limit);
  return { total: items.length, allTotal: rows.length, limit: size, offset,
    items: items.slice(offset, offset + size).map(row => ({ ...row, preview: chars(row.text, 60) + (Array.from(row.text).length > 60 ? '…' : '') })) };
}

export function createMemoryHandler({ store, warn = () => {}, beforeConfigUpdate = () => {}, listSessions }) {
  const home = path.dirname(path.dirname(store.file));
  async function withSessionHint(data) {
    if (typeof listSessions !== 'function') return data;
    try {
      const sessions = await listSessions();
      const hint = sessionImportHint(readConfig(home).autoImport, sessions);
      return hint ? { ...data, autoImport: { ...data.autoImport, ...hint } } : data;
    } catch (error) {
      warn(`读取会话来源提示失败：${error.message}`);
      return data;
    }
  }
  return async (request, response) => {
    let methods = ['GET'];
    const reply = (status, payload, html = false) => {
      response.writeHead(status, {
        'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...(status === 405 ? { Allow: methods.join(', ') } : {}),
        ...(html ? { 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" } : {}),
      });
      response.end(html ? payload : JSON.stringify(payload));
    };
    const fail = (status, error) => reply(status, { ok: false, error });
    try {
      const host = String(request.headers.host ?? '');
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) return fail(403, '只允许本机访问记忆图谱');
      const rawPath = (request.url ?? '/').split('?')[0];
      let pathname;
      try { pathname = decodeURIComponent(rawPath); }
      catch { return fail(404, '找不到这个记忆接口'); }
      const item = /^\/memory-engine\/api\/item\/([^/%\\]+)$/u.exec(pathname);
      if (pathname.includes('..') || pathname.includes('\\') || (!paths.has(pathname) && !item)) return fail(404, '找不到这个记忆接口');
      methods = item ? ['GET', 'PUT', 'DELETE'] : pathname === `${base}/api/clear` ? ['POST'] : pathname === `${base}/api/config` ? ['GET', 'PUT'] : ['GET'];
      if (!allowedMethods.has(request.method) || !methods.includes(request.method)) return fail(405, `此接口仅支持 ${methods.join('、')}`);
      if (Number(request.headers['content-length']) > 1024 * 1024) return fail(413, '请求体不能超过 1MB');
      if (request.method === 'PUT' || request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return fail(400, '请求体必须使用 application/json');
        const body = await readBody(request);
        if (pathname === `${base}/api/config`) {
          beforeConfigUpdate(body);
          const data = updateConfig(home, body, { warn });
          return reply(200, { ok: true, data: await withSessionHint(data) });
        }
        return reply(200, { ok: true, data: item ? store.updateItem(item[1], body) : store.clear(body) });
      }
      if (request.headers['transfer-encoding'] || Number(request.headers['content-length']) > 0) return fail(400, request.method === 'GET' ? '此只读接口不接受请求体' : '此接口不接受请求体');
      if (item) {
        if (request.method === 'DELETE') return reply(200, { ok: true, data: store.deleteItem(item[1]) });
        const rows = store.read();
        if (!rows.some(row => row.id === item[1])) return fail(404, '没有这条记忆');
        return reply(200, { ok: true, data: describeMemories(rows, store.now()).find(row => row.id === item[1]) });
      }
      if (pathname === `${base}/api/list`) return reply(200, { ok: true, data: listMemories(store, new URLSearchParams(request.url.includes('?') ? request.url.slice(request.url.indexOf('?') + 1) : '')) });
      if (pathname === `${base}/api/export`) {
        const items = store.read();
        return reply(200, { ok: true, data: { total: items.length, items } });
      }
      if (pathname === `${base}/api/map`) return reply(200, { ok: true, data: computeMapData(store, { warn }) });
      if (pathname === `${base}/api/stats`) return reply(200, { ok: true, data: store.stats() });
      if (pathname === `${base}/api/config`) return reply(200, { ok: true, data: await withSessionHint(readUiConfig(home, { warn })) });
      if (pathname === `${base}/api/onboard`) return reply(200, { ok: true, data: {
        empty: store.read().length === 0, prompt: ONBOARD_PROMPT, steps: ONBOARD_STEPS, dataDir: path.dirname(store.file),
      } });
      const { nodes, ...data } = computeMapData(store, { warn });
      const html = renderHtml({ ...data, stars: nodes }, '我的记忆神经网络');
      return reply(200, html.replace('</body>', escapeBridge + '</body>'), true);
    } catch (error) {
      if ([400, 404, 413].includes(error.status)) return fail(error.status, error.message);
      warn(`图谱请求失败：${error.message}`);
      return fail(500, request.method === 'PUT' && (request.url ?? '').split('?')[0] === `${base}/api/config`
        ? '配置保存失败，请检查数据目录权限或本地插件日志' : '读取记忆失败，请检查本地插件日志');
    }
  };
}

export function registerMemoryRoutes(webServer, options) {
  if (typeof webServer?.register !== 'function') throw new Error('宿主 webServer 服务不可用');
  return webServer.register({ kind: 'prefix', path: base, handler: createMemoryHandler(options) });
}
