#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { generateMap, mapReport, openMap } from '../lib/map.js';

export async function main(args = process.argv.slice(2)) {
  try {
    const options = {};
    let open = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--open') open = true;
      else if (['--out', '--title'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
        const option = args[i].slice(2);
        options[option] = args[++i];
      }
      else throw new Error('用法：dsh-memory-map [--out 文件.html] [--title 标题] [--open]');
    }
    const result = generateMap(new MemoryStore(), options);
    console.log(mapReport(result));
    if (open) await openMap(result.file);
    return 0;
  } catch (error) {
    console.error('生成图谱失败：' + error.message);
    return 1;
  }
}

// 入口判定：必须比较「真实路径」。
// pnpm 把包装在 node_modules/.pnpm 下，再用符号链接指过去；
// import.meta.url 是解析链接后的真实路径，而 process.argv[1] 是链接路径，
// 直接比较会不相等 → main() 不执行 → 静默失败（退出码 0、无输出、不生成文件）。
function isEntryPoint() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return path.resolve(realpathSync(argv1)) === path.resolve(realpathSync(self));
  } catch {
    // 任何一方解析失败（文件已删等）就退回到字面比较
    return path.resolve(argv1) === path.resolve(self);
  }
}

if (isEntryPoint()) process.exitCode = await main();
