export function eventText(event) {
  let content;
  if (event?.type === 'user/message' && (!event.data?.role || event.data.role === 'user')) content = event.data?.content;
  if (event?.type === 'assistant/message' && (!event.data?.message?.role || event.data.message.role === 'assistant')) content = event.data?.message?.content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').trim();
}

export function usefulText(text) {
  return Array.from(text).length > 1 && !/^(?:嗯|哦|噢|啊|好|好的|好呀|好哒|行|哈哈|呵呵|嘿嘿|谢谢|收到|ok|[\s，。！!~～])+$/iu.test(text)
    && text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, '').trim().length > 0;
}

export function createTurnCollector(onTurn) {
  const sessions = new Map();
  return {
    accept(session, event) {
      const id = session?.id;
      if (typeof id !== 'string' || !event) return;
      if (!['turn/start', 'turn/end', 'user/message', 'assistant/message'].includes(event.type)) return;
      let state = sessions.get(id);
      if (event.type === 'turn/start' && state?.turn !== undefined && state.turn !== event.data?.turn) state = undefined;
      if (!state) {
        state = { text: '', userText: '', turn: undefined };
        sessions.set(id, state);
        if (sessions.size > 256) sessions.delete(sessions.keys().next().value);
      }
      if (event.type === 'turn/start') state.turn = event.data?.turn;
      if (event.type === 'assistant/message' && state.turn !== undefined && event.data?.turn !== state.turn) return;
      const text = eventText(event);
      if (text) {
        const role = event.type === 'user/message' ? 'user' : 'assistant';
        state.text = Array.from(`${state.text}\n${role}: ${text}`).slice(-4000).join('');
        if (role === 'user') state.userText = Array.from(`${state.userText}\n${text}`).slice(-4000).join('');
      }
      if (event.type === 'turn/end') {
        if (state.turn !== undefined && event.data?.turn !== state.turn) return;
        sessions.delete(id);
        if (state.userText.trim()) onTurn({ sessionId: id, text: state.text, userText: state.userText, time: event.time });
      }
    },
    clear() { sessions.clear(); },
  };
}
