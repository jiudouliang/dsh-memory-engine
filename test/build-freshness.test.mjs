import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripRendererExport } from '../scripts/lib/strip-export.mjs';

const root = new URL('../', import.meta.url);
const marker = '/* __CANVAS_RENDERER__ */';

test('client bundle matches canvas.js and client.src.js byte for byte', () => {
  const renderer = fs.readFileSync(new URL('lib/render/canvas.js', root), 'utf8');
  const template = fs.readFileSync(new URL('lib/client.src.js', root), 'utf8');
  assert.equal(template.split(marker).length, 2);
  const expected = '// 由 scripts/build-client.mjs 生成，别直接改这个文件\n'
    + template.replace(marker, () => stripRendererExport(renderer));
  assert.equal(fs.readFileSync(new URL('lib/client.js', root), 'utf8'), expected, 'lib/client.js 已过期，请跑 pnpm build');
});

function isolatedBuild(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-client-build-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of ['lib/render/canvas.js', 'lib/client.src.js', 'lib/client.js',
    'scripts/build-client.mjs', 'scripts/lib/strip-export.mjs', 'test/build-freshness.test.mjs']) {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(new URL(file, root), target);
  }
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return { directory, run(args = ['scripts/build-client.mjs']) {
    return spawnSync(process.execPath, args, { cwd: directory, env: environment, encoding: 'utf8', windowsHide: true });
  } };
}

test('build is deterministic and freshness catches even an unbuilt whitespace change', context => {
  const isolated = isolatedBuild(context);
  const target = path.join(isolated.directory, 'lib/client.js');
  assert.equal(isolated.run().status, 0);
  const first = fs.readFileSync(target);
  assert.equal(isolated.run().status, 0);
  assert.deepEqual(fs.readFileSync(target), first);
  fs.appendFileSync(path.join(isolated.directory, 'lib/render/canvas.js'), ' ');
  const stale = isolated.run(['--test', '--test-name-pattern=^client bundle matches', 'test/build-freshness.test.mjs']);
  assert.equal(stale.status, 1, stale.stdout + stale.stderr);
  assert.match(stale.stdout + stale.stderr, /跑 pnpm build/);
  assert.equal(isolated.run(['scripts/build-client.mjs', '--check']).status, 1);
  assert.deepEqual(fs.readFileSync(target), first);
  assert.equal(isolated.run().status, 0);
  const fresh = isolated.run(['--test', '--test-name-pattern=^client bundle matches', 'test/build-freshness.test.mjs']);
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
});

test('failed builds preserve the old artifact and remove temporary files', context => {
  const isolated = isolatedBuild(context);
  const target = path.join(isolated.directory, 'lib/client.js');
  const template = path.join(isolated.directory, 'lib/client.src.js');
  const before = fs.readFileSync(target);
  const source = fs.readFileSync(template, 'utf8');
  fs.writeFileSync(template, source.replace(marker, ''));
  assert.notEqual(isolated.run().status, 0);
  assert.deepEqual(fs.readFileSync(target), before);
  fs.writeFileSync(template, source);
  fs.unlinkSync(target);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sentinel'), 'keep');
  assert.notEqual(isolated.run().status, 0);
  assert.equal(fs.readFileSync(path.join(target, 'sentinel'), 'utf8'), 'keep');
  assert.deepEqual(fs.readdirSync(path.dirname(target)).filter(name => name.endsWith('.tmp')), []);
});

test('renderer export stripping preserves its body and rejects module dependencies', () => {
  const source = fs.readFileSync(new URL('lib/render/canvas.js', root), 'utf8');
  const stripped = stripRendererExport(source);
  assert.equal('export ' + stripped, source);
  assert.doesNotMatch(source, /\bimport\s*(?:\(|[{'*])|\b(?:require|__ModuleLoader__)\b/);
  assert.throws(() => stripRendererExport('function createRenderer() {}'), /Missing/);
  assert.throws(() => stripRendererExport(source + '\nexport const other = 1;'), /standalone/);
  assert.throws(() => stripRendererExport("import fs from 'node:fs';\n" + source), /standalone/);
});
