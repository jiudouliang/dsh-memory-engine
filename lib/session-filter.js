export const CHAT_CWD_HINTS = Object.freeze(['state/agents', 'qq-bridge', 'astrbot', 'nonebot', 'koishi']);
export const sessionFilterDefaults = Object.freeze({ mode: 'include', cwdContains: CHAT_CWD_HINTS, maxToolCalls: 0 });
const workTool = /(?:^|[./:]|__)(pwsh|bash|read|write|edit|grep|glob|subagent|workflow|notebook)$/iu;
const normalizePath = value => String(value ?? '').replaceAll('\\', '/').toLowerCase();
const matchCwd = (cwd, part) => {
  const normalizedCwd = normalizePath(cwd);
  const normalizedPart = normalizePath(part).replace(/^\/+|\/+$/gu, '');
  if (!CHAT_CWD_HINTS.includes(normalizedPart)) return normalizedCwd.includes(normalizedPart);
  return `/${normalizedCwd.replace(/^\/+|\/+$/gu, '')}/`.includes(`/${normalizedPart}/`);
};

export function normalizeSessionFilter(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('sessionFilter 必须是对象');
  for (const key of Object.keys(value)) if (!Object.hasOwn(sessionFilterDefaults, key)) throw new Error(`sessionFilter 不支持 ${key}`);
  const filter = { ...sessionFilterDefaults, ...value };
  if (!['auto', 'include', 'all'].includes(filter.mode)) throw new Error('sessionFilter.mode 必须是 auto、include 或 all');
  if (!Array.isArray(filter.cwdContains) || filter.cwdContains.length > 50
    || filter.cwdContains.some(item => typeof item !== 'string' || !item.trim() || item.length > 1000)) throw new Error('cwdContains 必须是最多 50 个非空路径片段');
  if (!Number.isSafeInteger(filter.maxToolCalls) || filter.maxToolCalls < 0 || filter.maxToolCalls > 10000) throw new Error('maxToolCalls 必须是 0～10000 的整数');
  return { ...filter, cwdContains: filter.cwdContains.map(item => item.trim()) };
}

export function sessionFilterKey(header, filter) {
  return JSON.stringify({ version: 2, filter, cwd: normalizePath(header?.cwd) });
}

export function assessSession(header, events, filter = sessionFilterDefaults) {
  if (filter.mode === 'all') return { accepted: true };
  if (filter.mode === 'include') {
    return filter.cwdContains.some(part => matchCwd(header?.cwd, part)) ? { accepted: true }
      : { accepted: false, reason: 'cwd-excluded', message: 'cwd 未命中包含列表', cacheable: true };
  }
  let userMessages = 0;
  let workToolCalls = 0;
  const tools = new Set();
  for (const event of events) {
    if (event.type === 'user/message' && (!event.data?.role || event.data.role === 'user')) userMessages++;
    if (event.type === 'tool/call' && typeof event.data?.name === 'string' && workTool.test(event.data.name)) {
      workToolCalls++;
      tools.add(event.data.name);
      if (workToolCalls > filter.maxToolCalls) return { accepted: false, reason: 'work-tools',
        message: `用过 ${[...tools].join('/')}`, tools: [...tools], workToolCalls, userMessages, cacheable: true };
    }
  }
  return userMessages >= 2 ? { accepted: true } : { accepted: false, reason: 'too-few-user-messages',
    message: `user 消息不足 2 条（当前 ${userMessages} 条）`, userMessages, cacheable: false };
}
