import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { stripRendererExport } from './lib/strip-export.mjs';

const template = fs.readFileSync(new URL('../lib/client.src.js', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../lib/render/canvas.js', import.meta.url), 'utf8');
const marker = '/* __CANVAS_RENDERER__ */';
if (template.split(marker).length !== 2) throw new Error('Expected exactly one renderer marker');
const bundled = '// 由 scripts/build-client.mjs 生成，别直接改这个文件\n'
  + template.replace(marker, () => stripRendererExport(renderer));
const target = new URL('../lib/client.js', import.meta.url);
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== bundled) throw new Error('lib/client.js 已过期，请跑 pnpm build');
} else {
  const temporary = new URL(`../lib/.client-${randomUUID()}.tmp`, import.meta.url);
  try {
    fs.writeFileSync(temporary, bundled, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
