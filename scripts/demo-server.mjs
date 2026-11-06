import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createMemoryHandler } from '../lib/routes.js';
import { DemoStore, pluginRoot, publicPaths, safeFile, safeRoot } from './demo/common.mjs';
import { demoPage } from './demo/page.mjs';

export function createDemoServer({ root = safeRoot() } = {}) {
  root = safeRoot(root);
  const store = new DemoStore(root);
  store.read();
  const memory = createMemoryHandler({ store, beforeConfigUpdate(changes) {
    store.guard();
    if (changes.autoMemory?.enabled === true || changes.autoImport?.enabled === true) {
      throw Object.assign(new Error('演示环境不启动自动记忆或自动导入。'), { status: 400 });
    }
  } });
  const assets = new Map([
    ['/demo/react.js', () => safeFile(root, 'vendor/react.js')],
    ['/demo/react-dom.js', () => safeFile(root, 'vendor/react-dom.js')],
    ['/demo/bootstrap.js', () => path.join(pluginRoot, 'scripts/demo/bootstrap.js')],
    ['/demo/client.js', () => path.join(pluginRoot, 'lib/client.js')],
  ]);
  return createServer(async (request, response) => {
    const reply = (status, body, type = 'application/json; charset=utf-8', extra = {}) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', ...extra });
      response.end(body);
    };
    try {
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(String(request.headers.host ?? ''))) return reply(403, '{"ok":false,"error":"只允许本机访问演示页面"}');
      const pathname = (request.url ?? '/').split('?')[0];
      if (pathname === '/') {
        if (request.method !== 'GET') return reply(405, '{"ok":false,"error":"此接口仅支持 GET"}', undefined, { Allow: 'GET' });
        response.writeHead(302, { Location: '/memory-engine/', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (assets.has(pathname)) {
        if (request.method !== 'GET') return reply(405, '{"ok":false,"error":"此接口仅支持 GET"}', undefined, { Allow: 'GET' });
        return reply(200, fs.readFileSync(assets.get(pathname)()), 'text/javascript; charset=utf-8');
      }
      if (!pathname.startsWith('/memory-engine')) return reply(404, '{"ok":false,"error":"没有这个演示资源"}');
      let status, headers;
      await memory(request, {
        writeHead(code, values) { status = code; headers = values; },
        end(body) {
          if (headers['Content-Type'].startsWith('text/html')) {
            headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
            response.writeHead(status, headers);
            response.end(demoPage());
          } else {
            response.writeHead(status, headers);
            response.end(JSON.stringify(publicPaths(JSON.parse(body), root)));
          }
        },
      });
    } catch {
      if (!response.headersSent) reply(500, '{"ok":false,"error":"演示数据读取失败，请重新生成演示库。"}');
      else response.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('用法：node scripts/demo-server.mjs [--port 8899]');
    const port = args.length ? Number(args[1]) : 8899;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口须为 0～65535 的整数。');
    const server = createDemoServer();
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '演示端口已占用，请用 --port 指定其他端口。' : '演示服务器启动失败。'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`演示页面：http://127.0.0.1:${server.address().port}/memory-engine/`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
