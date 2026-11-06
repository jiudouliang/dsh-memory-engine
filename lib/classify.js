export function classifyImport(text, sourceHint = '') {
  const file = typeof sourceHint === 'string' ? sourceHint : sourceHint?.file ?? sourceHint?.path ?? '';
  const value = typeof text === 'string' ? text.trim() : '';
  if (/(?:^|[/\\])\d{4}-\d{2}-\d{2}\.md$/iu.test(file)) return { kind: '日记', heat: 2 };
  if (/价格|多少钱|几块|块一杯|元/u.test(value)) return { kind: '知识', heat: 2 };
  if (/^(?:是什么|怎么|为什么|意思是)/u.test(value)) return { kind: '知识', heat: 2 };
  if (/过敏|不吃|不喜欢|怕|讨厌|最爱/u.test(value)) return { kind: '印象', heat: 1 };
  if (/答应|约好|下次|明天|说好/u.test(value)) return { kind: '事件', heat: 2 };
  if (value.startsWith('#') && /\d{4}(?:[-/.]\d{1,2}[-/.]\d{1,2}|年\d{1,2}月\d{1,2}日)/u.test(value)) return { kind: '日记', heat: 2 };
  return { kind: '对话', heat: 2 };
}
