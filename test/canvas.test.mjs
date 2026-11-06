import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRenderer } from '../lib/render/canvas.js';
import { renderHtml } from '../lib/render/render.mjs';

function fixture() {
  return {
    nodes: Array.from({ length: 12 }, (_, index) => ({
      id: String(index), kind: ['人格', '印象', '知识', '日记', '对话', '情绪', '未知'][index % 7],
      pos: { x: (index % 4 - 1.5) * 28, y: (Math.floor(index / 4) - 1) * 24, z: index * 3 },
      radius: 1 + index / 2, retention: index / 12, degree: index % 4, title: 'node-' + index, emotion: [],
    })),
    links: [['0', '1'], ['1', '2'], ['2', '3'], ['3', '4']], review: [], stats: { total: 12 },
  };
}

function environment() {
  const pending = new Map(), listeners = new Map(), trace = [], observers = new Set();
  let nextId = 0, canvasId = 0, now = 0;
  function target() {
    const handlers = new Map();
    listeners.set(handlers, handlers);
    return {
      addEventListener(name, callback) { handlers.set(name, callback); },
      removeEventListener(name, callback) { if (handlers.get(name) === callback) handlers.delete(name); },
      emit(name, event = {}) { handlers.get(name)?.({ pointerId: 1, preventDefault() {}, ...event }); },
    };
  }
  function makeCanvas() {
    const id = canvasId++;
    const context = new Proxy({}, {
      get(_, key) {
        if (key === 'createRadialGradient') return (...args) => {
          const gradient = { gradient: args, stops: [], addColorStop(...stop) { this.stops.push(stop); } };
          return gradient;
        };
        return (...args) => trace.push([id, key, ...args.map(value => value?.canvasId !== undefined ? { canvasId: value.canvasId } : value)]);
      },
      set(_, key, value) { trace.push([id, key, value]); return true; },
    });
    let capture = false;
    return { ...target(), canvasId: id, style: {}, width: 0, height: 0,
      bounds: { left: 0, top: 0, width: 900, height: 600 },
      getBoundingClientRect() { return this.bounds; }, getContext() { return context; },
      setPointerCapture() { capture = true; }, hasPointerCapture() { return capture; }, releasePointerCapture() { capture = false; },
    };
  }
  const canvas = makeCanvas();
  const elements = new Map();
  const element = () => ({ style: {}, append() {} });
  const document = {
    getElementById(id) {
      if (id === 'map') return canvas;
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement(name) { return name === 'canvas' ? makeCanvas() : element(); },
  };
  const math = Object.create(Math);
  math.random = () => 0.25;
  const window = { ...target(), document, Math: math, console,
    innerWidth: 900, innerHeight: 600, devicePixelRatio: 1.25,
    performance: { now: () => now },
    requestAnimationFrame(callback) { pending.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { pending.delete(id); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
  };
  document.defaultView = window; canvas.ownerDocument = document;
  return { canvas, window, trace, pending, observers,
    listenerCount: () => [...listeners.keys()].reduce((total, handlers) => total + handlers.size, 0),
    step(time) {
      now = time;
      const callbacks = [...pending.values()]; pending.clear();
      for (const callback of callbacks) callback(time);
    },
    create(data = fixture()) { return vm.runInNewContext('(' + createRenderer.toString() + ')', window)(canvas, data); },
  };
}

test('standalone HTML and native canvas draw identical animation frames', () => {
  const legacy = environment(), native = environment();
  const data = fixture();
  const html = renderHtml({ ...data, stars: data.nodes });
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], legacy.window);
  const renderer = native.create(fixture()); renderer.start();
  for (const time of [16.7, 33.4, 500, 1400, 2400]) {
    legacy.trace.length = 0; native.trace.length = 0;
    legacy.step(time); native.step(time);
    assert.equal(JSON.stringify(native.trace), JSON.stringify(legacy.trace), 'frame ' + time);
  }
  renderer.destroy();
});

test('start is idempotent; stop cancels RAF, observers and listeners; stale callbacks cannot restart it', () => {
  const env = environment(), renderer = env.create();
  renderer.start(); renderer.start();
  assert.equal(env.pending.size, 1); assert.equal(env.observers.size, 1);
  assert.equal(env.listenerCount(), 6);
  const stale = [...env.pending.values()][0];
  env.step(20); renderer.stop();
  assert.equal(env.pending.size, 0); assert.equal(env.observers.size, 0); assert.equal(env.listenerCount(), 0);
  const count = env.trace.length;
  stale(10000); env.step(10000);
  assert.equal(env.trace.length, count);
  renderer.start(); stale(10010);
  assert.equal(env.pending.size, 1);
  renderer.destroy(); renderer.destroy(); renderer.start(); renderer.resize();
  assert.equal(env.pending.size, 0); assert.equal(env.observers.size, 0); assert.equal(env.listenerCount(), 0);
});

test('renderer instances do not mutate input or share camera, pulses and caches', () => {
  const data = fixture(), before = JSON.stringify(data);
  const first = environment(), second = environment();
  const left = first.create(data), right = second.create(data);
  left.start(); right.start(); first.step(20); second.step(20);
  assert.equal(JSON.stringify(first.trace), JSON.stringify(second.trace));
  first.canvas.emit('pointerdown', { clientX: 100, clientY: 100 });
  first.canvas.emit('pointermove', { clientX: 150, clientY: 120 });
  left.fireNeuron('1'); first.trace.length = 0; second.trace.length = 0;
  first.step(40); second.step(40);
  assert.notEqual(JSON.stringify(first.trace), JSON.stringify(second.trace));
  assert.equal(JSON.stringify(data), before);
  left.destroy(); assert.equal(second.pending.size, 1); right.destroy();
});

test('selection chooses nearest node with 14px minimum tolerance and canvas-relative coordinates', () => {
  const env = environment();
  const data = fixture(); data.nodes = data.nodes.slice(0, 2).map((node, index) => ({ ...node, pos: { x: index, y: 0, z: 0 }, radius: 0.1, degree: 0 }));
  data.links = [];
  env.canvas.bounds.left = 40; env.canvas.bounds.top = 60;
  const renderer = env.create(data), selected = [];
  const unsubscribe = renderer.onSelect(node => selected.push(node.id));
  renderer.start(); env.step(0);
  function click(x, y) {
    env.canvas.emit('pointerdown', { clientX: x + 40, clientY: y + 60 });
    env.canvas.emit('pointerup', { clientX: x + 40, clientY: y + 60 });
  }
  click(455, 300); assert.deepEqual(selected, ['1']);
  renderer.setData({ ...data, nodes: [data.nodes[0]] }); env.step(20);
  click(463, 300); assert.deepEqual(selected, ['1', '0']);
  click(465, 300); assert.equal(selected.length, 2);
  unsubscribe(); click(450, 300); assert.equal(selected.length, 2);
  renderer.destroy();
});

test('resize follows element bounds and caps DPR at 1.5; setData removes stale nodes and pulses', () => {
  const env = environment(), renderer = env.create(); renderer.start(); env.step(20);
  env.window.devicePixelRatio = 3;
  env.canvas.bounds.width = 640; env.canvas.bounds.height = 360;
  [...env.observers][0].callback();
  assert.equal(env.canvas.width, 960); assert.equal(env.canvas.height, 540);
  renderer.fireNeuron('1'); renderer.setData({ nodes: [], links: [], review: [], stats: { total: 0 } });
  renderer.fireNeuron('missing'); env.trace.length = 0; env.step(40);
  assert.equal(env.trace.filter(entry => entry[1] === 'arc').length, 0);
  renderer.destroy();
});

test('wheel zoom clamps to 0.3 and 4.5 and drag suppresses click selection', () => {
  const env = environment(), data = fixture();
  data.nodes = [{ ...data.nodes[0], pos: { x: 0, y: 0, z: 0 }, radius: 10, degree: 0, retention: 1 }]; data.links = [];
  const renderer = env.create(data); renderer.start();
  const selected = []; renderer.onSelect(node => selected.push(node));
  env.canvas.emit('pointerdown', { clientX: 450, clientY: 300 });
  env.canvas.emit('pointermove', { clientX: 460, clientY: 300 });
  env.canvas.emit('pointerup', { clientX: 460, clientY: 300 });
  assert.equal(selected.length, 0);
  for (const [deltaY, zoom] of [[1, 0.3], [-1, 4.5]]) {
    for (let index = 0; index < 100; index++) env.canvas.emit('wheel', { deltaY });
    env.trace.length = 0; env.step(0);
    const arc = env.trace.find(entry => entry[0] === 0 && entry[1] === 'arc');
    // 半径现在带呼吸项（每颗星独立相位/频率，幅度 ≤8%），按比例校验而不是逐位相等
    const base = 10 * 760 / 250 * zoom * 0.55;
    assert.ok(Math.abs(arc[4] - base) / base <= 0.1, `radius ${arc[4]} vs base ${base}`);
  }
  renderer.destroy();
});

test('client bundle is reproducible and needs no runtime imports', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-client.mjs', import.meta.url)), '--check']);
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.match(source, /window\.__ModuleLoader__\.load/);
  assert.doesNotMatch(source, /iframe|\bimport\s*(?:\(|[{'*])/);
});

test('closing while map fetch is pending aborts it and prevents canvas initialization', async () => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  let definition, Button, resolveMap, mapSignal;
  let stateIndex = 0;
  const effects = [], updates = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment',
    useState: initial => [stateIndex++ === 0 ? 123 : initial, value => updates.push(value)],
    useRef: () => ({ current: null }), useEffect: effect => effects.push(effect),
  };
  const context = { window: { __ModuleLoader__: { load(value) { definition = value; } } },
    document: { body: {} }, AbortController, setTimeout, clearTimeout, console,
    fetch(url, options) {
      if (url.endsWith('/config')) return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { hideButton: false, showGuideOnEmpty: true } }) });
      if (url.endsWith('/map')) {
        mapSignal = options.signal;
        return new Promise(resolve => { resolveMap = resolve; });
      }
      throw new Error(url);
    },
  };
  vm.runInNewContext(source, context);
  definition.factory(name => name === 'react' ? react : { createPortal: element => element }).apply({ slots: {
    has: () => true, inject(name, setup) { setup(); }, register(entry, component) { Button = component; },
  } });
  await new Promise(resolve => setImmediate(resolve));
  const button = Button(), tree = button.type(button.props);
  const component = tree.children[1].children.find(child => typeof child?.type === 'function');
  effects.length = 0; component.type(component.props);
  const cleanup = effects[0](); cleanup();
  assert.equal(mapSignal.aborted, true);
  const count = updates.length;
  resolveMap({ ok: true, json: async () => ({ ok: true, data: fixture() }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, count);
});

test('spin uses configured speed and resumes only two seconds after pointer release or cancellation', () => {
  const env = environment(), data = fixture();
  data.nodes = [{ ...data.nodes[0], pos: { x: 30, y: 10, z: 20 }, degree: 0 }]; data.links = []; data.spinSpeed = 0.35;
  const renderer = env.create(data); renderer.start();
  const position = time => {
    env.trace.length = 0; env.step(time);
    const arc = env.trace.find(entry => entry[0] === 0 && entry[1] === 'arc');
    return arc.slice(2, 4);
  };
  const first = position(16.7), second = position(33.4);
  assert.notDeepEqual(first, second);
  env.canvas.emit('pointerdown', { clientX: 100, clientY: 100 });
  env.canvas.emit('pointermove', { clientX: 140, clientY: 120 });
  const dragged = position(1000); assert.deepEqual(position(1500), dragged);
  env.canvas.emit('pointerup', { clientX: 140, clientY: 120 });
  assert.deepEqual(position(3499), dragged);
  assert.notDeepEqual(position(3500), dragged);
  env.canvas.emit('pointerdown'); const held = position(4000); env.canvas.emit('pointercancel');
  assert.deepEqual(position(5999), held); assert.notDeepEqual(position(6000), held);
  renderer.stop(); assert.equal(env.pending.size, 0); assert.equal(env.listenerCount(), 0);
  renderer.start(); const restarted = position(6017); assert.notDeepEqual(position(6034), restarted);
  renderer.destroy();
});

test('spin defaults to 0.35 and setData changes speed without moving the stationary core', () => {
  const env = environment(), data = fixture();
  data.nodes = [{ ...data.nodes[0], pos: { x: 30, y: 10, z: 20 }, degree: 0 }]; data.links = [];
  const renderer = env.create(data); renderer.start();
  let angle = 0.15;
  for (const [time, speed] of [[16.7, 0.35], [33.4, 0.05], [50.1, 1.5]]) {
    if (time > 16.7) renderer.setData({ ...data, spinSpeed: speed });
    env.trace.length = 0; env.step(time); angle += 0.0011 * speed * 3;
    const horizontal = 30 * Math.cos(angle) - 20 * Math.sin(angle);
    const depthAxis = 30 * Math.sin(angle) + 20 * Math.cos(angle);
    const vertical = 10 * Math.cos(0.3) - depthAxis * Math.sin(0.3);
    const scale = 760 / (10 * Math.sin(0.3) + depthAxis * Math.cos(0.3) + 250) * 1.6;
    const arc = env.trace.find(entry => entry[0] === 0 && entry[1] === 'arc');
    assert.ok(Math.abs(arc[2] - (450 + horizontal * scale)) < 1e-8);
    assert.ok(Math.abs(arc[3] - (300 + vertical * scale)) < 1e-8);
    assert.ok(!env.trace.some(entry => entry[1] === 'lineDashOffset'));
  }
  const core = { ...data.nodes[0], id: 'persona', kind: '人格', text: '角色卡全文', isCore: true, retention: 1, radius: 8, pos: { x: 0, y: 0, z: 0 } };
  const withCore = { ...data, nodes: [core, ...data.nodes], spinSpeed: 1.5 };
  const before = JSON.stringify(withCore); renderer.setData(withCore);
  for (const time of [66.8, 1000, 2000]) {
    env.trace.length = 0; env.step(time);
    const arcs = env.trace.filter(entry => entry[0] === 0 && entry[1] === 'arc' && entry[2] === 450 && entry[3] === 300);
    assert.equal(arcs.length, 4);
    assert.ok(Math.abs(arcs[0][4] / arcs[2][4] - 2.2) < 1e-8);
    assert.ok(Math.abs(arcs[1][4] / arcs[2][4] - 1.6) < 1e-8);
    assert.ok(env.trace.some(entry => entry[1] === 'lineDashOffset' && entry[2] === -time * 0.008));
  }
  const selected = []; renderer.onSelect(node => selected.push(node));
  env.canvas.emit('pointerdown', { clientX: 450, clientY: 300 }); env.canvas.emit('pointerup', { clientX: 450, clientY: 300 });
  assert.equal(selected[0], core); assert.equal(selected[0].text, '角色卡全文');
  assert.equal(JSON.stringify(withCore), before); renderer.destroy();
});

test('offline and native persona renders use the same core halo and configured rotation', () => {
  const offline = environment(), native = environment(), data = fixture();
  data.nodes.unshift({ ...data.nodes[0], id: 'persona', isCore: true, radius: 8, degree: 0, retention: 1, pos: { x: 0, y: 0, z: 0 } });
  data.spinSpeed = 0.7;
  vm.runInNewContext(renderHtml({ ...data, stars: data.nodes }).match(/<script>([\s\S]*?)<\/script>/)[1], offline.window);
  const renderer = native.create(data); renderer.start();
  for (const time of [16.7, 33.4, 500, 1400]) {
    offline.trace.length = 0; native.trace.length = 0; offline.step(time); native.step(time);
    assert.equal(JSON.stringify(native.trace), JSON.stringify(offline.trace));
  }
  renderer.destroy();
});

test('offline persona selection shows and copies full text, handles denied clipboard and restores ordinary details', async () => {
  const env = environment(), data = fixture(), document = env.window.document;
  const core = { ...data.nodes[0], id: 'persona', kind: '人格', title: '小雅', text: '🐳'.repeat(4001), isCore: true,
    radius: 8, degree: 0, retention: 1, pos: { x: 0, y: 0, z: 0 } };
  data.nodes = [core]; data.links = [];
  const copied = [];
  env.window.navigator = { clipboard: { writeText: async text => copied.push(text) } };
  const context = vm.createContext(env.window);
  vm.runInContext(renderHtml({ ...data, stars: data.nodes }).match(/<script>([\s\S]*?)<\/script>/)[1], context);
  env.step(16.7);
  const clickCenter = () => {
    env.canvas.emit('pointerdown', { clientX: 450, clientY: 300 }); env.canvas.emit('pointerup', { clientX: 450, clientY: 300 });
  };
  clickCenter();
  assert.equal(document.getElementById('title').textContent, '小雅');
  assert.equal(document.getElementById('body').textContent, '🐳'.repeat(4000));
  assert.equal(document.getElementById('meta').hidden, true);
  assert.equal(document.getElementById('copy').hidden, false);
  await document.getElementById('copy').onclick();
  assert.deepEqual(copied, ['🐳'.repeat(4000)]);
  let fallbackText, removed = false;
  const createElement = document.createElement;
  document.createElement = name => name === 'textarea' ? { style: {}, select() { fallbackText = this.value; }, remove() { removed = true; } } : createElement(name);
  document.body = { append() {} }; document.execCommand = command => command === 'copy';
  env.window.navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
  await document.getElementById('copy').onclick();
  assert.equal(fallbackText, '🐳'.repeat(4000)); assert.equal(removed, true);
  vm.runInContext("renderer.setData({nodes:[{...DATA.stars[0],id:'ordinary',isCore:false,kind:'知识',text:'普通正文'}],links:[]})", context);
  env.step(33.4); clickCenter();
  assert.equal(document.getElementById('body').textContent, '普通正文');
  assert.equal(document.getElementById('meta').hidden, false);
  assert.equal(document.getElementById('copy').hidden, true);
  vm.runInContext('renderer.destroy()', context);
});
