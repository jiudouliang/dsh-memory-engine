export const DEFAULT_NOISE_PATTERNS = Object.freeze([
  '重复唤醒', '已经回过', '回过了', '先不重复', '继续潜水', '潜水状态',
  '标成已读', '已读水位', '先不发送', '没再发', '等他说下一句',
  '看一眼情况', '没有新消息', '这轮是', '我先不', '对话停在这里',
  '对话就停在这', '等有人 @', '再回来就是', '未读 0',
]);

const REPORT_PREFIX = /^\s*(已回|已回复|已发送|已处理|已确认|已读|已标记|回过了|发过了)\s*[:：]/u;

const INJECTED = Object.freeze([
  /^下面是我和他?刚才的聊天记录/u,
  /每行「谁：说了什么」/u,
  /^Current runtime context\. This snapshot supersedes/im,
  /<message\s+source_id=/u,
  /^【会话令牌】/mu,
  /^\s*##\s*(Runtime|Context)\b/im,
]);

export function isInjected(text) {
  return typeof text === 'string' && INJECTED.some(pattern => pattern.test(text));
}

export const WORK_MARKERS = Object.freeze([
  /memory_(save|recall|forget|dedupe|import|map|stats)/iu,
  /hideButton|showGuideOnEmpty|personaFile|autoImport|autoMemory|spinSpeed/iu,
  /验收|任务书|里程碑|回归测试|测试全绿/u,
  /pnpm|\bnpm\b|commit|git push|构建|编译|部署|重启\s*DSH/iu,
  /版本号|0\.\d+\.\d+|beta\.\d/iu,
  /录屏|截图|演示库|演示服务器/u,
]);

export function normalizeWorkMarkers(value = []) {
  if (!Array.isArray(value) || value.length > 20
    || value.some(pattern => typeof pattern !== 'string' || !pattern.trim() || pattern.length > 300)) throw new Error('workMarkers 必须是最多 20 个非空正则表达式字符串');
  for (const pattern of value) new RegExp(pattern, 'iu');
  return [...value];
}

export function workMatches(text, extra = []) {
  if (typeof text !== 'string') return [];
  const patterns = [...WORK_MARKERS, ...extra.map(pattern => new RegExp(pattern, 'iu'))];
  const seen = new Set();
  return patterns.filter(pattern => {
    if (seen.has(pattern.source)) return false;
    seen.add(pattern.source);
    return pattern.test(text);
  }).map(pattern => pattern.source);
}

export function isWorkRecord(text, extra = []) {
  const matches = workMatches(text, extra);
  const releaseOnly = matches.length === 2 && matches.includes(WORK_MARKERS[3].source) && matches.includes(WORK_MARKERS[4].source);
  return matches.length >= 2 && !releaseOnly;
}

export function isNoise(text, extra = []) {
  if (typeof text !== 'string') return false;
  if (isInjected(text)) return true;
  if (REPORT_PREFIX.test(Array.from(text).slice(0, 12).join(''))) return true;
  const features = text.replace(/(?:他|她|对方|朋友|同事)(?:说|表示|告诉我)[\s“「『"']*(?:已经回过|回过了)/gu, '');
  const patterns = new Set([...DEFAULT_NOISE_PATTERNS, ...extra].filter(pattern => typeof pattern === 'string' && pattern.length > 0));
  let hits = 0;
  for (const pattern of patterns) {
    if (features.includes(pattern) && ++hits >= 2) return true;
  }
  return hits === 1 && Array.from(text).length < 150;
}
