import { MemoryStore } from './store.js';
import { chars, titleOf } from './decay.js';
import { generateMap, mapReport, openMap } from './map.js';
import { registerMemoryRoutes } from './routes.js';
import { createAutoMemory } from './auto-memory.js';
import { createAutoImport } from './auto-import.js';

export const name = 'memory-engine';
export const inject = ['tools', 'webServer'];

function report(ctx, error) {
  try {
    const logger = typeof ctx?.logger === 'function' ? ctx.logger(name) : ctx?.logger;
    logger?.error?.(`memory-engine: ${error?.message ?? String(error)}`);
  } catch { /* Error reporting must not take down the host. */ }
}

function warn(ctx, message) {
  try {
    const logger = typeof ctx?.logger === 'function' ? ctx.logger(name) : ctx?.logger;
    if (logger?.warn) logger.warn(message);
    else console.warn(`[dsh-memory-engine] ${message}`);
  } catch { /* Preview failures must not affect the memory tools. */ }
}

export function createTools(defineTool, store = new MemoryStore(), { map = generateMap, warning = message => warn(null, message) } = {}) {
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
  return [
    defineTool({
      name: 'memory_save',
      description: '把值得记住的事保存到跨会话的本地记忆。与 QQ 桥接记忆独立。重复正文自动合并。'
        + '该存：对方的称呼/偏好/忌讳/习惯、答应过的事、情绪特别重的瞬间、新学到的知识、当天小结。'
        + '不该存：寒暄、重复内容、纯事务性对话。一天三五条足够，存前可先用 memory_recall 查重。',
      parameters: {
        text: { type: 'string', required: true, description: '记忆正文，最多 2000 字' },
        kind: { type: 'string', description: '分类，默认对话；可用知识/印象/日记/对话/事件或自定义' },
        heat: { type: 'number', description: '1=热，2=温，3=冷；省略按情绪推断' },
        who: { type: 'string', description: '跟谁有关' },
        ts: { type: 'number', description: '事情发生的毫秒时间戳，默认现在' },
      }, output,
      async execute(args) {
        const memory = store.save(args);
        if (memory.merged) return `已合并到既有记忆（第 ${memory.merged.index} 条，相似度 ${memory.merged.similarity.toFixed(2)}）：${chars(memory.text, 40)}`;
        return `已记住：${chars(memory.text, 40)}（重要度 ${['', '热', '温', '冷'][memory.heat]}）`;
      },
    }),
    defineTool({
      name: 'memory_recall',
      description: '按话题查跨会话的本地记忆，并联想相关条目。q 使用具体关键词，如「手冲」「阅读 书签」。与 QQ 桥接记忆独立。',
      parameters: {
        q: { type: 'string', required: true, description: '要查的话题或关键词' },
        limit: { type: 'number', description: '默认 8，最大 20' },
        hops: { type: 'number', description: '联想跳数，默认 1；0 只查直接命中，最大 2' },
        kind: { type: 'string', description: '只看某一分类' },
      }, output,
      async execute(args) {
        const hits = store.recall(args);
        if (!hits.length) return `【没有找到】「${args.q}」在记忆库里没有相关内容。`;
        const quote = words => words.map(word => `「${word}」`).join('');
        let index = 0;
        const describe = hit => `${++index}. [${hit.kind}] ${titleOf(hit)}（留存 ${hit.retention.toFixed(2)}；id=${hit.id}）`;
        const sections = [];
        for (const via of ['direct', 'partial']) {
          const group = hits.filter(hit => hit.via === via);
          if (!group.length) continue;
          const terms = group[0].terms;
          const matched = terms.filter(term => group.some(hit => hit.matched.includes(term)));
          const missed = terms.filter(term => !matched.includes(term));
          const label = via === 'direct' ? '直接命中' : '部分命中';
          const summary = `【${label} ${group.length} 条】` + (via === 'partial' ? '（覆盖不足 50%，不是直接命中）' : '')
            + `命中${quote(matched)}` + (missed.length ? `；未命中${quote(missed)}` : '；全部查询词均命中');
          sections.push([summary, ...group.map(hit => `${describe(hit)}\n`
            + `   覆盖 ${hit.matched.length}/${hit.terms.length}；命中${quote(hit.matched)}`
            + (hit.missed.length ? `；未命中${quote(hit.missed)}` : '') + `\n   ${hit.snippet}`)].join('\n\n'));
        }
        const spread = hits.filter(hit => hit.via === 'spread');
        if (spread.length) sections.push(['【联想到的（不是直接命中）】', ...spread.map(hit => `${describe(hit)}\n`
          + `   从「${hit.from.title}」（id=${hit.from.id}）联想：完整标题「${hit.from.term}」出现在关联正文中。\n   ${hit.snippet}`)].join('\n\n'));
        return sections.join('\n\n');
      },
    }),
    defineTool({
      name: 'memory_forget',
      description: '删除本地记忆。id/q/older_than_days 三选一。q 批量删除先报告数量，用户确认后带 confirm=true 再调用。',
      parameters: {
        id: { type: 'string', description: '精确删除的记忆 id' },
        q: { type: 'string', description: '按关键词批量删除，必须二次确认' },
        older_than_days: { type: 'number', description: '仅删除超过此天数且留存低于 0.15 的条目' },
        confirm: { type: 'boolean', description: '收到用户对本次关键词批删的确认后才设为 true' },
      }, output,
      async execute(args) {
        const result = store.forget(args);
        return result.needsConfirmation ? `匹配到 ${result.count} 条，确认请带 confirm=true 再调一次。`
          : `已删除 ${result.count} 条记忆。`;
      },
    }),
    defineTool({
      name: 'memory_dedupe', description: '检测全库相似重复记忆。默认只预览；用户确认后显式 dry_run=false 才备份并合并。',
      parameters: {
        threshold: { type: 'number', description: 'LCS 相似度阈值，默认 0.7，范围 0.5–0.95' },
        dry_run: { type: 'boolean', description: '默认 true，只报告；false 备份后执行合并' },
      }, output,
      async execute(args) {
        const result = store.dedupe(args);
        if (!result.dryRun) return `已合并 ${result.groups.length} 组，删除 ${result.removed} 条。备份：${result.backup}（耗时 ${result.elapsedMs.toFixed(0)}ms）`;
        const involved = result.groups.reduce((sum, group) => sum + group.texts.length, 0);
        return [`发现 ${result.groups.length} 组重复（共 ${involved} 条 → 可合并为 ${result.groups.length} 条）`,
          ...result.groups.map((group, index) => `组 ${index + 1}：${group.texts.length} 条 → 保留「${chars(group.memory.text, 80)}」（boosts 合计 ${group.memory.boosts}）\n`
            + group.texts.map(text => `  - ${chars(text, 80)}`).join('\n')),
          '确认执行请带 dry_run=false', `耗时 ${result.elapsedMs.toFixed(0)}ms`].join('\n');
      },
    }),
    defineTool({
      name: 'memory_import', description: '从 JSON、Markdown 目录、逐行纯文本或 qq-bridge 导入本地记忆。默认只预览，显式 dry_run=false 才备份并导入；不会修改来源。新增后自动生成图谱。',
      parameters: {
        source: { type: 'string', required: true, description: 'qq-bridge / json / markdown / text' },
        path: { type: 'string', description: 'json/text 的本地文件绝对路径，或 markdown 的目录绝对路径；qq-bridge 无需此参数' },
        dry_run: { type: 'boolean', description: '默认 true，只报告；false 先备份本插件记忆再导入' },
      }, output,
      async execute(args) {
        const result = args.source === 'qq-bridge' ? store.importBridge(args) : await store.importFile(args);
        if (result.missing) return '找不到桥接目录，可用 QQ_BRIDGE_DIR 环境变量指定';
        let mapLine;
        if (!result.dryRun && result.imported > 0) {
          try { mapLine = `已同步生成神经网络图：${map(store).file}`; }
          catch (error) { warning(`图谱生成失败，记忆已成功导入：${error.message}`); }
        }
        return [result.dryRun ? `将从 ${args.source} 导入：` : `已从 ${args.source} 导入：`,
          ...Object.entries(result.counts).map(([kind, count]) => `- ${kind} ${count} 条（${result.dryRun ? '可新增' : '新增'} ${result.added[kind]} 条）`),
          `合计 ${result.candidates} 条；其中 ${result.skipped} 条与现有或本批重复会被跳过。`,
          `${result.dryRun ? '预计导入后' : '导入后'}总数：${result.total} 条（新增 ${result.imported} 条）`,
          ...(result.dryRun ? ['确认执行请带 dry_run=false'] : [`备份：${result.backup}`]),
          ...(result.warnings.length ? ['来源提示：', ...result.warnings] : []),
          `耗时 ${(result.elapsedMs / 1000).toFixed(2)} 秒`, ...(mapLine ? [mapLine] : [])].join('\n');
      },
    }),
    defineTool({
      name: 'memory_map', description: '把当前本地记忆生成可离线打开的神经网络 HTML 图谱，返回文件路径、节点和关联边数量。',
      parameters: {
        out: { type: 'string', description: '输出 HTML 路径，默认 DSH_HOME/memory-engine/starmap.html' },
        title: { type: 'string', description: '页面标题，默认“我的记忆神经网络”' },
        open: { type: 'boolean', description: '默认 false；true 时用系统默认浏览器打开' },
      }, output,
      async execute(args) {
        const result = map(store, args);
        if (args.open === true) await openMap(result.file);
        return mapReport(result);
      },
    }),
    defineTool({
      name: 'memory_stats', description: '查看本地记忆总数、分类、衰减状态、最老日期和存储路径及体积。',
      parameters: {}, output,
      async execute() {
        const stats = store.stats();
        const kinds = Object.entries(stats.kinds).map(([kind, count]) => `${kind} ${count}`).join(' / ');
        const body = `记忆引擎状态\n- 总条数：${stats.total}${kinds ? `（${kinds}）` : ''}\n`
          + `- 快忘了的（留存<0.3）：${stats.fading} 条\n`
          + `- 最老：${stats.oldest === null ? '暂无' : `${new Date(stats.oldest).toISOString().slice(0, 10)}（${stats.ageDays} 天前）`}\n`
          + `- 存储：${stats.file}（${(stats.bytes / 1024).toFixed(1)} KB）`;
        // 库是空的时，替 agent 把「接下来该做什么」说出来（见 README「装完是空库」）。
        if (stats.total === 0) {
          return body + '\n\n记忆库还是空的。插件不会自己读聊天记录，记忆要靠两件事之一进来：\n'
            + '① 在提示词里告诉 agent 该记什么，聊天时就调 memory_save（推荐）\n'
            + '② 用 memory_import 把旧记忆导进来（支持 json / markdown / text）\n'
            + '建议主动把这两条简短告诉主人，并提醒他点开图谱可以看到上手引导页。';
        }
        return body;
      },
    }),
  ];
}

// 宿主 SDK 的 defineTool 在不同 DSH 版本间签名一致（实测 0.1.0-rc.8 ~ 0.2.2-alpha.2 都是
// defineTool(options)），但**包不一定能解析到**——比如插件被装在宿主 node_modules 之外。
// 解析失败时退回一个直通实现：工具照常注册，只是少了宿主的返回值包装。
async function resolveDefineTool(warning) {
  try {
    const sdk = await import('@deepseek-ai/dsh-tools');
    if (typeof sdk.defineTool === 'function') {
      const version = sdk.version ?? '';
      if (version) warning(`宿主 dsh-tools 版本 ${version}`);
      return sdk.defineTool;
    }
    warning('@deepseek-ai/dsh-tools 没有导出 defineTool，改用内置直通实现');
  } catch (error) {
    warning(`解析 @deepseek-ai/dsh-tools 失败（${error.message}），改用内置直通实现`);
  }
  return options => options;
}

export function apply(ctx) {
  try {
    if (typeof ctx?.tools?.register !== 'function') throw new Error('tools 服务不可用');
    // ctx.effect 是较新宿主才有的生命周期钩子。没有它就直接注册——
    // 否则老版本 DSH 上插件会「装上了但一个工具都没有」，这是最糟的失败方式。
    const setup = async () => {
      const disposers = [];
      try {
        const defineTool = await resolveDefineTool(message => warn(ctx, message));
        const store = new MemoryStore();
        for (const tool of createTools(defineTool, store, { warning: message => warn(ctx, message) })) disposers.push(ctx.tools.register(tool));
        try {
          disposers.push(registerMemoryRoutes(ctx.webServer, { store, warn: message => warn(ctx, message),
            listSessions: () => ctx.get('sessionQuery')?.listSessions() }));
        } catch (error) {
          warn(ctx, `图谱路由注册失败，记忆工具仍可用：${error.message}`);
        }
        for (const create of [createAutoMemory, createAutoImport]) {
          try {
            const automation = create({ ctx, store, warn: message => warn(ctx, message) });
            disposers.push(() => automation.dispose());
          } catch (error) { warn(ctx, `自动任务初始化失败，记忆工具仍可用：${error.message}`); }
        }
        const timer = setTimeout(() => {
          try { if (store.read().length > 0) generateMap(store); }
          catch (error) { warn(ctx, `启动时图谱生成失败：${error.message}`); }
        }, 3000);
        timer.unref();
        disposers.push(() => clearTimeout(timer));
        return () => { for (const dispose of disposers.reverse()) dispose(); };
      } catch (error) {
        for (const dispose of disposers.reverse()) { try { dispose(); } catch { /* keep unwinding */ } }
        report(ctx, error);
      }
    };

    if (typeof ctx.effect === 'function') {
      const registration = ctx.effect(setup, 'memory-engine.tools');
      // Await setup without returning its disposer as a second plugin teardown.
      return Promise.resolve(registration).then(() => undefined, error => { report(ctx, error); });
    }
    warn(ctx, '宿主没有 ctx.effect，直接用注册式初始化（功能不减少）');
    return Promise.resolve(setup()).then(() => undefined, error => { report(ctx, error); });
  } catch (error) { report(ctx, error); }
}
