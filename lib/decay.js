export const DAY = 86400000;
export const HALF_LIFE = Object.freeze({ 1: 30, 2: 12, 3: 6 });
export const EVENT_HALF_LIFE = 3;
export const EMOTION_HALF_LIFE = 90;

const EMOTIONS = [
  { tag: '离别', w: 3, words: ['心疼', '舍不得', '告别', '再也', '留不住'] },
  { tag: '身份', w: 3, words: ['朋友', '不是替身', '自由', '浪漫', '身份'] },
  { tag: '正向', w: 2, words: ['高兴', '喜欢', '谢谢', '记住了', '暖'] },
  { tag: '负向', w: 2, words: ['难过', '难受', '烦', '累', '孤独', '委屈'] },
  { tag: '承诺', w: 2, words: ['别忘', '记住', '答应', '承诺', '绝对'] },
];

export const chars = (text, count) => Array.from(text).slice(0, count).join('');
export const titleOf = memory => memory.title || chars(memory.text, 20);

export function inferEmotion(text) {
  const emotion = EMOTIONS.filter(group => group.words.some(word => text.includes(word)))
    .map(({ tag, w }) => ({ tag, w }));
  return { emotion, heat: emotion.length ? 1 : 2 };
}

export function retention(memory, now = Date.now()) {
  const halfLife = memory.emotion?.some(mark => mark.w >= 3) ? EMOTION_HALF_LIFE
    : memory.kind === '事件' ? EVENT_HALF_LIFE : HALF_LIFE[memory.heat] ?? HALF_LIFE[2];
  const ageDays = (now - memory.ts) / DAY;
  const boost = 0.5 * (1 - Math.exp(-(memory.boosts ?? 0) / 4));
  return Math.min(1.15, Math.exp(-ageDays / halfLife) + boost);
}
