// This module only reads source files. All writes belong to MemoryStore's
// independent memory-engine directory, never to the bridge or diary paths.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { chars, inferEmotion } from './decay.js';
import { norm } from './dedupe.js';
import { readConfig, resolveDiaryDir } from './config.js';

export const DEFAULT_BRIDGE_ROOT = process.env.QQ_BRIDGE_DIR || '';
export const DEFAULT_DIARY_DIR = process.env.QQ_DIARY_DIR || '';
const WORDS = [
  [/心疼|舍不得|怕你|别走|留不住|告别|最后一次|再也/u, 3],
  [/开心|高兴|喜欢|谢谢|谢谢你我|记住了|暖|舒坦/u, 2],
  [/难过|难受|烦|闷|累|孤独|空了一秒|想哭|委屈/u, 2],
  [/别忘|记住|记着|答应|承诺|一定|绝对/u, 2],
  [/朋友|当朋友|不是替身|不是复印件|自由|浪漫/u, 3],
];
export const emotionStrength = text => Math.max(0, ...WORDS.filter(([re]) => re.test(text)).map(([, w]) => w));
const textValue = value => typeof value === 'string' ? value.trim() : '';

export function parseTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const time = typeof value === 'number' ? value : /^\d+(?:\.\d+)?$/u.test(String(value)) ? Number(value) : Date.parse(value);
  return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? time : null;
}

export function resolveBridgeRoot({ defaultRoot = DEFAULT_BRIDGE_ROOT, envRoot = process.env.QQ_BRIDGE_DIR, home } = {}) {
  for (const candidate of [() => envRoot, () => defaultRoot, () => readConfig(home).bridgeRoot]) {
    const root = candidate();
    if (!root) continue;
    try { if (statSync(path.join(root, 'state')).isDirectory()) return path.resolve(root); } catch { /* try the next path */ }
  }
  return null;
}

export function collectBridge(options = {}) {
  const root = options.root ?? resolveBridgeRoot(options);
  if (!root) return { missing: true, entries: [], warnings: [], counts: {} };
  const readSource = options.io?.readFileSync ?? readFileSync;
  const listSource = options.io?.readdirSync ?? readdirSync;
  const statSource = options.io?.statSync ?? statSync;
  const warnings = [];
  const readJson = (file, fallback) => {
    try { return JSON.parse(readSource(file, 'utf8').replace(/^\uFEFF/u, '')); }
    catch (error) { warnings.push(`${file}：${error.code === 'ENOENT' ? '未找到，已略过' : '无法读取或 JSON 损坏，已略过'}`); return fallback; }
  };
  const files = directory => {
    try { return listSource(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name).sort(); }
    catch { warnings.push(`${directory}：无法读取目录，已略过`); return []; }
  };
  const state = path.join(root, 'state');
  const snapshot = readJson(path.join(state, 'starmap/stars.json'), {});
  const stars = Array.isArray(snapshot?.stars) ? snapshot.stars : [];
  const counters = readJson(path.join(state, 'starmap/retrieval-boosts.json'), {});
  const boostCount = id => Number.isSafeInteger(counters?.[id]) && counters[id] >= 0 ? counters[id] : 0;
  const textBoosts = new Map();
  for (const star of stars) {
    if (!textValue(star?.text)) continue;
    const count = boostCount(star.id);
    const key = norm(star.text);
    textBoosts.set(key, Math.max(textBoosts.get(key) ?? 0, count));
  }
  const entries = [];
  const counts = { 知识: 0, 印象: 0, 日记: 0, 对话: 0, 重大情绪: 0, 俚语: 0 };
  let invalid = 0;
  function add(category, raw, sourceFile, bridgeIds = []) {
    const text = chars(textValue(raw.text), 2000);
    const ts = parseTime(raw.ts);
    if (!text || ts === null) { invalid++; return; }
    const inferred = inferEmotion(text);
    const emotion = Array.isArray(raw.emotion) ? raw.emotion.filter(mark => mark && typeof mark.tag === 'string' && Number.isFinite(mark.w)) : inferred.emotion;
    // Diary/event stars may store shortened bodies. Match their exact source
    // text prefix as well as the full normalized body; never use topic alone.
    let boosts = Math.max(0, ...bridgeIds.map(boostCount), textBoosts.get(norm(text)) ?? 0);
    for (const star of stars) {
      const sourceText = textValue(star?.text);
      if (!sourceText || sourceText.length < 12) continue;
      const key = norm(sourceText);
      if (norm(text).startsWith(key)) boosts = Math.max(boosts, boostCount(star.id));
    }
    entries.push({ text, kind: raw.kind, ts, heat: raw.heat ?? inferred.heat, emotion,
      ...(textValue(raw.who) ? { who: textValue(raw.who) } : {}),
      ...(textValue(raw.title) ? { title: textValue(raw.title) } : {}), boosts,
      origin: { source: 'qq-bridge', file: sourceFile }, category });
    counts[category]++;
  }

  const knowledge = readJson(path.join(state, 'knowledge.json'), []);
  if (!Array.isArray(knowledge)) warnings.push('knowledge.json：应为数组，已略过');
  for (const item of Array.isArray(knowledge) ? knowledge : []) {
    if (!textValue(item?.topic) || !textValue(item?.fact)) { invalid++; continue; }
    add('知识', { text: `${item.topic}：${item.fact}`, kind: '知识', ts: item.at, title: item.topic },
      'state/knowledge.json', [`know-${item.topic}-${item.at}`]);
  }

  const social = readJson(path.join(state, 'social-v2.json'), {});
  for (const [conversationId, conversation] of Object.entries(social?.conversations ?? {})) {
    for (const [memberKey, member] of Object.entries(conversation?.memberImpressions ?? {})) {
      if (!Array.isArray(member?.traits)) continue;
      const who = textValue(member.name) || memberKey;
      member.traits.forEach((trait, index) => {
        if (typeof trait !== 'string') { invalid++; return; }
        add('印象', { text: trait, kind: '印象', ts: member.lastSeenAt, who }, 'state/social-v2.json',
          [`imp-${conversationId}-${memberKey}-${index}`, `imp-${conversationId}-${who}-${index}`, `imp-${memberKey}-${index}`, `imp-${who}-${index}`]);
      });
    }
  }

  // Preserve major-emotion event records before importing the overlapping
  // daily conversation excerpts, so the event's heat/emotion are retained.
  for (const star of stars.filter(star => star?.layer === 'emotion')) {
    const emotion = Array.isArray(star.emotion) ? star.emotion.filter(mark => mark && typeof mark.tag === 'string' && Number.isFinite(mark.w)) : [];
    if (!emotion.some(mark => mark.w >= 3)) emotion.push({ tag: '重大情绪', w: 3 });
    add('重大情绪', { text: star.text, kind: '事件', ts: star.ts, heat: 1, emotion, title: star.title, who: star.who },
      'state/starmap/stars.json', [star.id]);
  }

  const diaryDir = options.diaryDir ?? resolveDiaryDir(options);
  if (!diaryDir) warnings.push('未配置日记目录，跳过日记导入');
  for (const file of (diaryDir ? files(diaryDir) : []).filter(name => !name.startsWith('_') && name.toLowerCase().endsWith('.md'))) {
    const full = path.join(diaryDir, file);
    try {
      add('日记', { text: readSource(full, 'utf8'), kind: '日记', ts: statSource(full).mtimeMs, title: path.basename(file, path.extname(file)) },
        full, [`diary-${file}`]);
    } catch { warnings.push(`${file}：日记无法读取，已略过`); }
  }

  const days = new Map();
  const seen = new Set();
  const localDate = value => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const today = localDate(Date.now());
  const todayMessages = [];
  for (const file of files(path.join(state, 'history')).filter(name => name.endsWith('.jsonl'))) {
    let lines;
    try { lines = readSource(path.join(state, 'history', file), 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u); }
    catch { warnings.push(`${file}：历史文件无法读取，已略过`); continue; }
    let broken = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      let item;
      try { item = JSON.parse(line); } catch { broken++; continue; }
      const text = textValue(item?.text);
      const ts = parseTime(item?.t);
      if (ts === null) continue;
      // Shards reflect write time (UTC), not the message's local calendar day.
      const day = localDate(ts);
      const isToday = day === today;
      if (Array.from(text).length < (isToday ? 8 : 12) || (isToday && item.self !== false)) continue;
      const strength = emotionStrength(text);
      if (!isToday && strength < 2) continue;
      const key = `${ts}\0${norm(text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isToday) {
        todayMessages.push({ text, ts, who: item.who, file });
        todayMessages.sort((a, b) => b.ts - a.ts);
        if (todayMessages.length > 60) todayMessages.pop();
        continue;
      }
      if (!days.has(day)) days.set(day, []);
      const bucket = days.get(day);
      bucket.push({ text, ts, strength, who: item.who, file });
      bucket.sort((a, b) => b.strength - a.strength || a.ts - b.ts);
      if (bucket.length > 6) bucket.pop();
    }
    if (broken) warnings.push(`${file}：略过 ${broken} 行不完整 JSON`);
  }
  for (const day of [...days.keys()].sort()) for (const item of days.get(day)) {
    add('对话', { text: item.text, kind: '对话', ts: item.ts, who: item.who }, `state/history/${item.file}`);
  }
  for (const item of todayMessages.reverse()) {
    const inferred = inferEmotion(item.text);
    add('对话', { text: item.text, kind: '对话', ts: item.ts, who: item.who,
      heat: inferred.emotion.length ? inferred.heat : 3 }, `state/history/${item.file}`);
  }

  const slang = readJson(path.join(state, 'slang.json'), []);
  // Live bridge schema uses content/meaning/createdAt. Also accept the
  // task's word/definition/at form when that shape is present.
  const words = Array.isArray(slang) ? slang : Array.isArray(slang?.entries) ? slang.entries
    : slang && typeof slang === 'object' ? Object.entries(slang).map(([word, item]) => typeof item === 'string' ? { word, definition: item } : { word, ...item }) : [];
  for (const item of words) {
    const word = textValue(item?.word ?? item?.term ?? item?.content);
    const meaning = textValue(item?.definition ?? item?.meaning);
    if (!word || !meaning) continue;
    add('俚语', { text: `${word}：${meaning}`, kind: '知识', title: word,
      ts: item.at ?? item.createdAt ?? item.updatedAt }, 'state/slang.json', item.id ? [item.id] : []);
  }
  if (invalid) warnings.push(`略过 ${invalid} 条正文或原始时间无效的记录（未用今天代替）`);
  return { missing: false, root, entries, counts, warnings };
}
