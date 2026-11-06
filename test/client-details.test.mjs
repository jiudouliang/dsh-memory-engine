import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const sample = (overrides = {}) => ({ id: 'first', kind: '知识', title: '古茗价格', heat: 2, retention: 1.14,
  degree: 12, ts: new Date(2026, 9, 20, 12).getTime(), emotion: [], text: '一杯茶的价格。', ...overrides });

function fixture(clipboard = async () => {}) {
  let definition, active;
  let nextTimer = 0;
  const timers = new Map(), listeners = new Map();
  const React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const runner = active, index = runner.index++;
      if (!runner.hooks[index]) {
        const hook = { value: initial };
        hook.set = value => { runner.updates++; hook.value = typeof value === 'function' ? value(hook.value) : value; };
        runner.hooks[index] = hook;
      }
      return [runner.hooks[index].value, runner.hooks[index].set];
    },
    useRef(initial) {
      const index = active.index++;
      if (!active.hooks[index]) active.hooks[index] = { current: initial };
      return active.hooks[index];
    },
    useEffect(effect, dependencies) {
      const runner = active, index = runner.index++;
      const previous = runner.hooks[index];
      if (previous && dependencies.every((value, position) => Object.is(value, previous.dependencies[position]))) return;
      runner.effects.push(() => {
        previous?.cleanup?.();
        runner.hooks[index] = { dependencies, cleanup: effect() };
      });
    },
  };
  const sandbox = { console, AbortController, document: { body: {} }, navigator: { clipboard: { writeText: clipboard } },
    window: { __ModuleLoader__: { load(value) { definition = value; } },
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    },
    setTimeout(callback, milliseconds) { timers.set(++nextTimer, { callback, milliseconds }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, data: {
      empty: false, prompt: 'guide', dataDir: 'local', steps: [1, 2, 3].map(index => ({ title: String(index), body: 'step' })),
    } }) }),
  };
  vm.runInNewContext(source.replace('exports.apply = apply;', 'exports.testComponents = { MemoryDetails, MemoryButton, MemoryCanvas, GuideCard }; exports.apply = apply;'), sandbox);
  const components = definition.factory(name => name === 'react' ? React : { createPortal: value => value }).testComponents;
  function mount(component, initialProps) {
    const runner = { hooks: [], effects: [], index: 0, updates: 0, props: initialProps, tree: null,
      render(props = runner.props) {
        runner.props = props; runner.index = 0; runner.effects = []; active = runner;
        runner.tree = component(props); active = null;
        for (const effect of runner.effects) effect();
        return runner.tree;
      },
      unmount() { for (const hook of runner.hooks) hook?.cleanup?.(); },
    };
    runner.render(); return runner;
  }
  return { components, mount, timers, listeners,
    escape() { listeners.get('keydown')?.({ key: 'Escape', repeat: false, preventDefault() {}, stopPropagation() {} }); },
  };
}

function all(tree) {
  if (Array.isArray(tree)) return tree.flatMap(all);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...all(tree.children)];
}
const find = (tree, predicate) => all(tree).find(predicate);
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join('') : tree && typeof tree === 'object' ? textOf(tree.children) : tree == null ? '' : String(tree);
const byAttribute = (tree, name, value = 'true') => find(tree, element => element.props[name] === value);

test('detail fields use node data, local date and Unicode title fallback; empty emotions have no row', () => {
  const env = fixture();
  const body = '🐳'.repeat(22) + '\n<literal text>';
  const props = { node: sample({ title: '', text: body }), onClose() {}, onHighlight() {} };
  const card = env.mount(env.components.MemoryDetails, props);
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-detail-title')), '🐳'.repeat(20));
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-detail-text')), body);
  assert.match(textOf(card.tree), /知识.*重要度温（2）留存1\.14连接数12时间2026-10-20/);
  assert.ok(!all(card.tree).some(element => element.type === 'dt' && textOf(element) === '情绪'));
  card.render({ ...props, node: sample({ emotion: [{ tag: '重情绪', w: 3 }, { tag: '承诺', w: 2 }] }) });
  assert.match(textOf(card.tree), /情绪重情绪 \/ 承诺/);
  for (const [heat, label] of [[1, '热'], [2, '温'], [3, '冷']]) {
    card.render({ ...props, node: sample({ heat }) });
    assert.ok(textOf(card.tree).includes(label + '（' + heat + '）'));
  }
  assert.doesNotMatch(textOf(card.tree), /编辑|删除/);
  card.unmount();
});

test('copy sends the complete text and resets its label after 1800ms', async () => {
  const copied = [], env = fixture(async text => copied.push(text));
  const node = sample({ text: '长正文\n'.repeat(400) });
  const card = env.mount(env.components.MemoryDetails, { node });
  byAttribute(card.tree, 'data-memory-engine-copy-body').props.onClick(); await flush(); card.render();
  assert.deepEqual(copied, [node.text]);
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-copy-body')), '已复制 ✓');
  assert.equal(env.timers.size, 1);
  const [id, timer] = [...env.timers][0]; assert.equal(timer.milliseconds, 1800);
  env.timers.delete(id); timer.callback(); card.render();
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-copy-body')), '复制正文');
  card.unmount(); assert.equal(env.timers.size, 0);
});

test('switching nodes and unmounting invalidate pending clipboard work and clear timers', async () => {
  const pending = [], env = fixture(() => new Promise(resolve => pending.push(resolve)));
  const card = env.mount(env.components.MemoryDetails, { node: sample() });
  byAttribute(card.tree, 'data-memory-engine-copy-body').props.onClick(); await flush();
  card.render({ node: sample({ id: 'second', text: '另一条正文' }) });
  pending.shift()(); await flush(); card.render();
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-copy-body')), '复制正文'); assert.equal(env.timers.size, 0);
  byAttribute(card.tree, 'data-memory-engine-copy-body').props.onClick(); await flush(); pending.shift()(); await flush();
  assert.equal(env.timers.size, 1);
  card.unmount(); assert.equal(env.timers.size, 0);
  const closed = env.mount(env.components.MemoryDetails, { node: sample() });
  byAttribute(closed.tree, 'data-memory-engine-copy-body').props.onClick(); await flush();
  closed.unmount(); const updates = closed.updates; pending.shift()(); await flush();
  assert.equal(closed.updates, updates); assert.equal(env.timers.size, 0);
});

function graphFixture() {
  const env = fixture();
  const button = env.mount(env.components.MemoryButton, { settings: { showGuideOnEmpty: true } });
  const open = () => { byAttribute(button.tree, 'data-memory-engine-map').props.onClick(); button.render(); };
  const overlay = () => find(button.tree, element => element.props['aria-label'] === '记忆图谱');
  const map = () => find(button.tree, element => element.type === env.components.MemoryCanvas);
  const detail = () => find(button.tree, element => element.type === env.components.MemoryDetails);
  const pointer = (x = 100, y = 100, inside = false) => ({ clientX: x, clientY: y, target: { closest: () => inside ? {} : null } });
  function select(node) {
    overlay().props.onPointerDownCapture(pointer());
    map().props.selectionVersion.current++; map().props.onSelect(node); button.render();
    overlay().props.onClick(); button.render();
  }
  open();
  return { ...env, button, open, overlay, map, detail, pointer, select };
}

test('persona details show a scrollable Unicode-limited body and copy without memory metadata or highlighting', async () => {
  const copied = [], env = fixture(async text => copied.push(text));
  const node = sample({ id: 'persona', kind: '人格', title: '小雅', isCore: true, text: '🐳'.repeat(4001) });
  const card = env.mount(env.components.MemoryDetails, { node });
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-detail-title')), '小雅');
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-detail-kind')), '人格');
  const body = byAttribute(card.tree, 'data-memory-engine-detail-text');
  assert.equal(textOf(body), '🐳'.repeat(4000));
  assert.equal(body.props.style.overflowY, 'auto');
  assert.ok(!all(card.tree).some(element => element.type === 'dl'));
  assert.ok(!byAttribute(card.tree, 'data-memory-engine-highlight'));
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-copy-body')), '复制全文');
  byAttribute(card.tree, 'data-memory-engine-copy-body').props.onClick(); await flush(); card.render();
  assert.deepEqual(copied, ['🐳'.repeat(4000)]);
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-copy-body')), '已复制 ✓');
  const [id, timer] = [...env.timers][0]; env.timers.delete(id); timer.callback(); card.render();
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-copy-body')), '复制全文');
  card.render({ node: sample() }); card.render();
  assert.equal(textOf(byAttribute(card.tree, 'data-memory-engine-copy-body')), '复制正文');
  assert.ok(byAttribute(card.tree, 'data-memory-engine-highlight'));
  assert.ok(all(card.tree).some(element => element.type === 'dl'));
  card.unmount(); assert.equal(env.timers.size, 0);
});

test('Escape closes guide then details then graph; highlighting uses the current id and reopening clears details', () => {
  const env = graphFixture();
  env.select(sample()); assert.ok(env.detail());
  const highlighted = []; env.map().props.rendererRef.current = { fireNeuron: id => highlighted.push(id) };
  env.detail().props.onHighlight(); assert.deepEqual(highlighted, ['first']);
  byAttribute(env.button.tree, 'aria-label', '查看使用指南').props.onClick(); env.button.render();
  assert.ok(find(env.button.tree, element => element.type === env.components.GuideCard));
  env.escape(); env.button.render(); assert.ok(env.detail()); assert.ok(env.overlay());
  assert.ok(!find(env.button.tree, element => element.type === env.components.GuideCard));
  env.escape(); env.button.render(); assert.ok(!env.detail()); assert.ok(env.overlay());
  env.escape(); env.button.render(); assert.ok(!env.overlay());
  env.open(); assert.ok(!env.detail()); env.select(sample());
  byAttribute(env.button.tree, 'aria-label', '关闭记忆图谱').props.onClick(); env.button.render(); env.open(); assert.ok(!env.detail());
  env.button.unmount(); assert.equal(env.listeners.size, 0);
});

test('another selection replaces the same detail component; blank clicks dismiss while drag and card clicks preserve it', () => {
  const env = graphFixture(); env.select(sample());
  const first = env.detail(); env.select(sample({ id: 'second', title: '另一条' }));
  assert.equal(env.detail().type, first.type); assert.equal(env.detail().props.key, first.props.key);
  assert.equal(env.detail().props.node.id, 'second');
  env.overlay().props.onPointerDownCapture(env.pointer(100, 100, true)); env.overlay().props.onClick(); env.button.render(); assert.ok(env.detail());
  env.overlay().props.onPointerDownCapture(env.pointer()); env.overlay().props.onPointerMoveCapture(env.pointer(120, 110));
  env.overlay().props.onClick(); env.button.render(); assert.ok(env.detail());
  env.overlay().props.onPointerDownCapture(env.pointer()); env.overlay().props.onClick(); env.button.render(); assert.ok(!env.detail());
  env.select(sample()); env.detail().props.onClose(); env.button.render(); assert.ok(!env.detail()); assert.ok(env.overlay());
  env.button.unmount();
});
