import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readConfig } from './config.js';
import { onConfigUpdate } from './config-write.js';
import { inferEmotion } from './decay.js';
import { findDuplicate, prepare } from './dedupe.js';
import { parseTime } from './import.js';
import { eventText, usefulText } from './session-text.js';
import { parseSourceFile, readJsonl, sourceFiles, verifySource } from './auto-sources.js';
import { backupForAutomation, readState, service, warningLogger, writeState } from './automation-state.js';
import { isInjected, isNoise, isWorkRecord, workMatches } from './noise.js';
import { classifyImport } from './classify.js';
import { assessSession, normalizeSessionFilter, sessionFilterKey } from './session-filter.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const day = 86400000;

export function importMinChars(value = 12) {
  if (!Number.isSafeInteger(value) || value < 4 || value > 200) throw new Error('autoImport.minChars 必须是 4～200 的整数');
  return value;
}

const longPrefix = text => Array.from(text).length >= 50 ? Array.from(text).slice(0, 50).join('') : null;

export function overlapsPersona(text, persona) {
  if (typeof persona !== 'string' || Array.from(text).length < 100) return false;
  const content = text.replace(/\s+/gu, '');
  const reference = persona.replace(/\s+/gu, '');
  const characters = Array.from(content);
  if (characters.length < 100) return false;
  let matches = 0;
  let checked = 0;
  for (let offset = 0; offset + 50 <= characters.length; offset += 50) {
    checked++;
    if (reference.includes(characters.slice(offset, offset + 50).join(''))) matches++;
  }
  return checked > 0 && matches / checked >= 0.6;
}

export function normalizeLedgerPolicy(settings = {}) {
  const retention = settings.ledgerRetentionDays === undefined ? {} : settings.ledgerRetentionDays;
  if (!retention || typeof retention !== 'object' || Array.isArray(retention)) throw new Error('ledgerRetentionDays 必须是对象');
  for (const key of Object.keys(retention)) if (!['skip', 'session'].includes(key)) throw new Error(`ledgerRetentionDays 不支持 ${key}`);
  const policy = { skip: retention.skip === undefined ? 30 : retention.skip, session: retention.session === undefined ? 120 : retention.session,
    maximum: settings.ledgerMaxEntries === undefined ? 2000 : settings.ledgerMaxEntries };
  for (const [key, minimum, maximum] of [['skip', 30, 36500], ['session', 120, 36500], ['maximum', 1, 100000]]) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < minimum || policy[key] > maximum) throw new Error(`账本 ${key} 必须为 ${minimum}～${maximum} 的整数`);
  }
  return policy;
}

export function cleanupLedger(ledger, settings = {}, now = Date.now()) {
  const policy = normalizeLedgerPolicy(settings);
  const result = { expired: 0, expiredSkipCaches: 0, evicted: 0, before: Object.keys(ledger).length, after: 0, overLimit: false };
  const candidates = [];
  for (const [key, entry] of Object.entries(ledger)) {
    if (!key.startsWith('session:') || !entry || typeof entry !== 'object' || entry.pending || entry.rescan) continue;
    const watermark = Number.isSafeInteger(entry.lastSeq) && entry.lastSeq >= 0;
    const updated = entry.skip && !watermark ? entry.skip.at : entry.importedAt;
    if (!Number.isFinite(updated) || updated < 0) continue;
    const lifetime = entry.skip && !watermark ? policy.skip : policy.session;
    if (now - updated > lifetime * day) {
      delete ledger[key];
      result.expired++;
      continue;
    }
    if (watermark && entry.skip && Number.isFinite(entry.skip.at) && now - entry.skip.at > policy.skip * day) {
      delete entry.skip;
      result.expiredSkipCaches++;
    }
    if (entry.skip && !watermark) candidates.push({ key, updated });
  }
  let remaining = Object.keys(ledger).length;
  if (remaining > policy.maximum) {
    const target = Math.max(1, Math.floor(policy.maximum * 0.75));
    candidates.sort((left, right) => left.updated - right.updated || left.key.localeCompare(right.key));
    for (const entry of candidates) {
      if (remaining <= target) break;
      delete ledger[entry.key];
      remaining--;
      result.evicted++;
    }
  }
  result.after = remaining;
  result.overLimit = remaining > policy.maximum;
  return result;
}

export function createAutoImport({ ctx, store, now = Date.now, warn = () => {}, getConfig,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), startupDelayMs = 8000, schedule = true } = {}) {
  const home = path.dirname(path.dirname(store.file));
  const ledgerFile = path.join(path.dirname(store.file), 'import-ledger.json');
  const warning = warningLogger(warn, now);
  const config = getConfig ?? (() => readConfig(home, { warn: message => warning(message, { once: true }) }));
  let stopped = false;
  let running;
  let timer;
  let consumedRescan;

  async function perform() {
    const settings = config();
    if (stopped || !settings.autoImport.enabled) return { added: 0, skipped: 0, processed: 0 };
    const ledgerPolicy = normalizeLedgerPolicy(settings.autoImport);
    const ledger = readState(ledgerFile, {});
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) throw new Error('import-ledger.json 必须是对象');
    const request = settings.autoImport.rescanAll ? 'all' : settings.autoImport.rescanFrom?.trim();
    const configFile = path.join(path.dirname(store.file), 'config.json');
    const savedConfig = request ? readState(configFile, null) : null;
    const savedRequest = savedConfig?.autoImport?.rescanAll ? 'all' : savedConfig?.autoImport?.rescanFrom?.trim();
    if (!request) consumedRescan = undefined;
    else if (request !== consumedRescan || request === savedRequest) {
      const keys = request === 'all' ? Object.keys(ledger).filter(key => key.startsWith('session:')) : [`session:${request}`];
      for (const key of keys) ledger[key] = { lastSeq: -1, rescan: true };
      writeState(ledgerFile, ledger);
      if (savedConfig?.autoImport) {
        if (settings.autoImport.rescanAll === true && savedConfig.autoImport.rescanAll === true) delete savedConfig.autoImport.rescanAll;
        if (savedConfig.autoImport.rescanFrom === settings.autoImport.rescanFrom) delete savedConfig.autoImport.rescanFrom;
        writeState(configFile, savedConfig);
      }
      consumedRescan = request;
    }
    const totals = { added: 0, skipped: 0, processed: 0, noise: 0, assistant: 0, work: 0,
      sessionsSkipped: 0, workSessions: 0, cachedSessions: 0 };
    const maximum = settings.autoImport.maxPerRun;
    const minimum = importMinChars(settings.autoImport.minChars);
    let persona = null;
    if (settings.personaFile) {
      try { persona = await fs.readFile(settings.personaFile, 'utf8'); }
      catch (error) { warning(`无法读取角色卡 ${settings.personaFile}：${error.message}`, { once: true }); }
    }
    const patterns = settings.autoMemory.excludePatterns;
    const allowAssistant = () => settings.autoImport.importAssistant === true && config().autoImport.importAssistant === true;
    const sessionFilter = normalizeSessionFilter(settings.autoImport.sessionFilter);
    const skippedTools = new Set();

    function commit(entries, key, cursor) {
      if (stopped) return;
      if (entries.length) {
        const rows = store.read();
        const prepared = rows.map(row => prepare(row.text));
        const prefixes = new Set(rows.map(row => longPrefix(row.text)).filter(Boolean));
        let added = 0;
        for (const candidate of entries) {
          if (candidate.origin?.source === 'dsh-sessions' && candidate.origin.role !== 'user' && !allowAssistant()) {
            totals.assistant++; totals.skipped++; continue;
          }
          if (isInjected(candidate.text)) { totals.noise++; totals.skipped++; continue; }
          if (candidate.origin?.source === 'dsh-sessions' && Array.from(candidate.text).length < minimum) { totals.skipped++; continue; }
          if (candidate.origin?.source === 'dsh-sessions' && overlapsPersona(candidate.text, persona)) { totals.skipped++; continue; }
          if (isNoise(candidate.text, settings.autoImport.noisePatterns)) { totals.noise++; totals.skipped++; continue; }
          if (isWorkRecord(candidate.text, settings.autoImport.workMarkers)) { totals.work++; totals.skipped++; continue; }
          const prefix = longPrefix(candidate.text);
          if (prefix && prefixes.has(prefix)) { totals.skipped++; continue; }
          if (findDuplicate(rows, candidate, prepared, 0.85)) { totals.skipped++; continue; }
          const { category: _category, ...fields } = candidate;
          rows.push({ ...fields, id: `m-${now()}-${randomBytes(3).toString('hex')}`, createdAt: now() });
          prepared.push(prepare(candidate.text));
          if (prefix) prefixes.add(prefix);
          added++;
        }
        if (added) {
          backupForAutomation(store, warning);
          store.write(rows);
          totals.added += added;
        }
        totals.processed += entries.length;
      }
      ledger[key] = { ...cursor, importedAt: now() };
      writeState(ledgerFile, ledger);
    }

    async function importSession(query, session) {
      const id = session.header.id;
      const key = `session:${id}`;
      const saved = ledger[key] ?? { lastSeq: -1 };
      if (!Number.isSafeInteger(saved.lastSeq) || saved.lastSeq < -1) throw new Error(`${key} 水位无效`);
      const policy = sessionFilterKey(session.header, sessionFilter);
      function skipped(reason, cached = false) {
        totals.sessionsSkipped++;
        if (cached) totals.cachedSessions++;
        if (reason.reason === 'work-tools') {
          totals.workSessions++;
          for (const name of reason.tools) skippedTools.add(name);
        }
      }
      if (saved.skip?.cacheable && saved.skip.policy === policy && !saved.rescan) { skipped(saved.skip, true); return; }
      const read = await query.readSession(id);
      if (stopped) return;
      if (!Array.isArray(read?.events)) throw new Error('readSession 未返回 events 数组');
      let decision = assessSession({ ...read.session, ...session.header }, read.events, sessionFilter);
      if (decision.accepted && sessionFilter.mode === 'auto') {
        const cwd = session.header.cwd ?? read.session?.cwd;
        if (typeof cwd === 'string' && cwd.trim()) {
          let workingDirectory = /(^|[\\/])default-workspace([\\/]|$)/iu.test(cwd);
          if (!workingDirectory) {
            try { workingDirectory = (await fs.stat(path.join(cwd, 'package.json'))).isFile(); }
            catch {}
          }
          if (workingDirectory && read.events.some(event => event.type === 'user/message'
            && workMatches(eventText(event), settings.autoImport.workMarkers).length >= 2)) {
            decision = { accepted: false, reason: 'work-message', cacheable: true };
          }
        }
      }
      if (!decision.accepted) {
        skipped(decision);
        ledger[key] = { ...saved, skip: { ...decision, sessionId: id, mode: sessionFilter.mode, policy, at: now() } };
        delete ledger[key].rescan;
        writeState(ledgerFile, ledger);
        return;
      }
      let cursor = { ...saved };
      delete cursor.skip;
      let batch = [];
      let processed = 0;
      let dirty = !!saved.skip;
      let scanned = 0;
      async function flush() {
        if (dirty) commit(batch, key, cursor);
        batch = [];
        dirty = false;
        await sleep(20);
      }
      for (const event of read.events) {
        if (stopped) return;
        if (++scanned % 200 === 0) await sleep(20);
        if (!Number.isSafeInteger(event.seq) || event.seq <= cursor.lastSeq) continue;
        const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : null;
        if (!role || role === 'assistant' && !allowAssistant()) {
          cursor.lastSeq = event.seq;
          delete cursor.pending;
          dirty = true;
          if (role === 'assistant') totals.assistant++;
          continue;
        }
        const text = eventText(event);
        const hash = text ? digest(text) : null;
        const timestamp = parseTime(event.time);
        const noise = isNoise(text, settings.autoImport.noisePatterns);
        const work = isWorkRecord(text, settings.autoImport.workMarkers);
        const injected = isInjected(text);
        if (noise) totals.noise++;
        if (work) totals.work++;
        if (!text || injected || Array.from(text).length < minimum || overlapsPersona(text, persona)
          || !usefulText(text) || noise || work || timestamp === null || hash === cursor.lastTextHash || patterns.some(pattern => text.includes(pattern))) {
          cursor.lastSeq = event.seq;
          delete cursor.pending;
          if (hash) cursor.lastTextHash = hash;
          dirty = true;
          continue;
        }
        const characters = Array.from(text);
        let offset = cursor.pending?.seq === event.seq ? cursor.pending.offset : 0;
        while (offset < characters.length) {
          if (processed >= 200 || totals.processed + batch.length >= maximum) { await flush(); return; }
          const part = characters.slice(offset, offset + 2000).join('');
          const inferred = inferEmotion(part);
          batch.push({ text: part, ...classifyImport(text), ts: timestamp, emotion: inferred.emotion, boosts: 0,
            origin: { source: 'dsh-sessions', sessionId: id, seq: event.seq, offset, role } });
          processed++;
          offset += 2000;
          if (offset >= characters.length) {
            cursor.lastSeq = event.seq;
            cursor.lastTextHash = hash;
            delete cursor.pending;
          } else cursor.pending = { seq: event.seq, offset };
          dirty = true;
          if (batch.length >= 20) await flush();
          if (stopped) return;
        }
      }
      if (cursor.rescan) { delete cursor.rescan; dirty = true; }
      await flush();
    }

    async function importFile(source, root, file) {
      await verifySource(root, file);
      const info = await fs.stat(file);
      const saved = ledger[file];
      const unchanged = saved?.size === info.size && saved?.mtime === info.mtimeMs;
      const jsonl = source.type === 'bridge' && file.endsWith('.jsonl');
      if (unchanged && !saved.pending && (!jsonl || saved.bytes >= info.size)) return;
      const increment = jsonl ? await readJsonl(file, saved, info) : undefined;
      const entries = await parseSourceFile(source, root, file, info, increment?.content, now());
      for (const entry of entries) {
        const classification = classifyImport(entry.text, file);
        if (classification.kind === '日记' || !entry.kind || entry.kind === '记忆') Object.assign(entry, classification);
      }
      let offset = increment?.offset ?? (unchanged ? saved?.pending?.offset ?? 0 : 0);
      while (!stopped) {
        const room = maximum - totals.processed;
        if (room <= 0) return;
        const batch = entries.slice(offset, offset + Math.min(room, 20));
        offset += batch.length;
        const complete = offset >= entries.length;
        const cursor = { size: info.size, mtime: info.mtimeMs };
        if (increment) {
          Object.assign(cursor, complete ? { bytes: increment.bytes, lines: increment.lines } : increment.base);
          if (!complete) cursor.pending = { bytes: increment.bytes, lines: increment.lines, offset };
        } else if (!complete) cursor.pending = { offset };
        commit(batch, file, cursor);
        await sleep(20);
        if (complete) return;
      }
    }

    for (const source of settings.autoImport.sources) {
      if (stopped || totals.processed >= maximum) break;
      try {
        if (source.type === 'dsh-sessions') {
          const query = service(ctx, 'sessionQuery');
          if (typeof query?.listSessions !== 'function' || typeof query?.readSession !== 'function') {
            warning('sessionQuery 服务不可用，跳过 dsh-sessions；自定义路径源仍正常导入', { once: true });
            continue;
          }
          const sessions = await query.listSessions();
          if (!Array.isArray(sessions)) throw new Error('listSessions 未返回数组');
          const prioritized = [...sessions].sort((left, right) => Number(ledger[`session:${right.header?.id}`]?.rescan === true)
            - Number(ledger[`session:${left.header?.id}`]?.rescan === true));
          for (const session of prioritized) {
            if (stopped || totals.processed >= maximum) break;
            if (typeof session.header?.id !== 'string') continue;
            try { await importSession(query, session); }
            catch (error) { warning(`导入会话 ${session.header.id} 失败：${error.message}`); }
          }
        } else {
          const { root, files } = await sourceFiles(source, warning);
          for (const file of files) {
            if (stopped || totals.processed >= maximum) break;
            try { await importFile(source, root, file); }
            catch (error) { warning(`导入 ${file} 失败：${error.message}`, { once: true }); }
          }
        }
      } catch (error) { warning(`略过来源 ${source.path ?? source.type}：${error.message}`, { once: true }); }
    }
    if (totals.workSessions) {
      try { warn(`跳过 ${totals.workSessions} 个工作会话（原因：用过 ${[...skippedTools].join('/')}；账本跳过 ${totals.cachedSessions} 个会话）`); } catch {}
    }
    if (!stopped) {
      const cleaned = cleanupLedger(ledger, settings.autoImport, now());
      if (cleaned.expired || cleaned.expiredSkipCaches || cleaned.evicted) {
        writeState(ledgerFile, ledger);
        try { warn(`清理账本：删除 ${cleaned.expired} 条过期记录（skip ${ledgerPolicy.skip} 天 / session ${ledgerPolicy.session} 天），清除 ${cleaned.expiredSkipCaches} 条过期 skip 缓存，超限淘汰 ${cleaned.evicted} 条无水位缓存（${cleaned.before} → ${cleaned.after}）`); } catch {}
      }
      if (cleaned.overLimit) {
        try { warn(`账本仍有 ${cleaned.after} 条，超过上限 ${ledgerPolicy.maximum}；保留近期水位、文件进度和未完成任务，未强制删除`); } catch {}
      }
      totals.ledgerCleanup = cleaned;
    }
    return totals;
  }

  function runNow() {
    if (running) return running;
    running = perform().catch(error => { warning(`自动导入失败：${error.message}`); return { error: error.message }; })
      .finally(() => { running = undefined; });
    return running;
  }

  function next(delay) {
    if (stopped) return;
    timer = setTimeout(() => {
      void runNow().finally(() => {
        if (!stopped) {
          let minutes = 60;
          try { minutes = config().autoImport.intervalMinutes; } catch (error) { warning(error.message); }
          next(minutes * 60000);
        }
      });
    }, delay);
    timer.unref?.();
  }
  const removeConfigListener = onConfigUpdate(home, changes => {
    if (changes.autoImport?.sessionFilter?.mode) void (running ? running.finally(() => runNow()) : runNow());
  });
  if (schedule) next(startupDelayMs);
  return { runNow, dispose() { stopped = true; clearTimeout(timer); removeConfigListener(); } };
}
