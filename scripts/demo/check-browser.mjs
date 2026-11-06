import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateDemo } from '../generate-demo.mjs';
import { assertClean, assertInside, safeFile, safeRoot } from './common.mjs';

const root = safeRoot();
const generated = safeFile(root, 'generated');
const profile = safeFile(root, 'generated/browser-profile');
const base = 'http://127.0.0.1:8899';
const evidence = { checks: [], errors: [] };
const check = (value, label) => { assert.ok(value, label); evidence.checks.push(label); };
const child = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=19483',
  '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let browser;
let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { targets = await (await fetch('http://127.0.0.1:19483/json/list')).json(); if (targets.length) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const target = targets.find(item => item.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const frame = JSON.parse(event.data);
    if (!frame.id) return;
    const callback = pending.get(frame.id);
    pending.delete(frame.id);
    if (frame.error) callback.reject(new Error(frame.error.message)); else callback.resolve(frame.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.result.description);
    return result.result.value;
  };
  browser = { call, evaluate };
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await evaluate(`Boolean(${expression})`);
      if (result) return result;
      await delay(100);
    }
    throw new Error('Browser condition timed out: ' + expression);
  };
  const click = async selector => {
    await waitFor(`document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(100);
  };
  const value = (selector, text) => evaluate(`(() => {const element=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value').set.call(element,${JSON.stringify(text)});element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const screenshot = async name => {
    const result = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(safeFile(root, 'generated/' + name), Buffer.from(result.data, 'base64'));
  };
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: generated });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
window.demoDraws=[];window.demoEdgeCounts=[];let edgeCount=0;
const draw=CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage=function(image,left,top,width,height){if(this.canvas.matches('[data-memory-engine-canvas]')){window.demoDraws.push({x:left+width/2,y:top+height/2,r:width/7.2});if(window.demoDraws.length>902)window.demoDraws.shift()}return draw.apply(this,arguments)};
const stroke=CanvasRenderingContext2D.prototype.stroke;
CanvasRenderingContext2D.prototype.stroke=function(){if(this.canvas.matches('[data-memory-engine-canvas]')&&String(this.strokeStyle).replaceAll(' ','')==='rgba(110,190,255,0.3)')edgeCount++;return stroke.apply(this,arguments)};
const frame=window.requestAnimationFrame;window.requestAnimationFrame=function(callback){return frame.call(window,function(time){edgeCount=0;callback(time);window.demoEdgeCounts.push(edgeCount);if(window.demoEdgeCounts.length>40)window.demoEdgeCounts.shift()})};` });
  await call('Page.navigate', { url: base + '/memory-engine/' });
  await waitFor(`document.querySelector('[data-memory-engine-summary]')?.textContent.includes('451 个神经元')`);
  await delay(1000);
  const map = (await (await fetch(base + '/memory-engine/api/map')).json()).data;
  const memories = map.nodes.filter(node => !node.isCore);
  check(memories.length === 450 && map.links.length >= 800 && map.links.length <= 1500, 'Expanded demo has 450 memories and 800–1500 connections');
  check(memories.filter(node => node.degree === 0).length >= 40 && memories.filter(node => node.degree === 0).length <= 80, 'Expanded demo retains 40–80 independent memories');
  check(Math.max(...memories.map(node => node.degree)) >= 15, 'Expanded demo has a hub with at least 15 connections');
  check(map.nodes[0].isCore && map.nodes[0].title === '小夏', 'Golden center is the fictional persona');
  check(new Set(map.nodes.filter(node => !node.isCore).map(node => node.kind)).size === 5, 'All five memory categories appear');
  check(await evaluate('window.demoEdgeCounts.every(count=>count===0)'), 'Unselected map does not draw the complete edge network');
  const positions = await evaluate('window.demoDraws.slice(-451).map(point=>point.x)');
  await delay(400);
  check(JSON.stringify(positions) !== JSON.stringify(await evaluate('window.demoDraws.slice(-451).map(point=>point.x)')), 'Canvas is animated');
  await screenshot('demo-map.png');
  const pointer = async (x, y) => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await delay(150);
  };
  await pointer(720, 500);
  await waitFor(`document.querySelector('[data-memory-engine-node="persona"]')`);
  const persona = await evaluate(`document.querySelector('[data-memory-engine-detail-text]').textContent`);
  assertClean(persona);
  check(persona === fs.readFileSync(safeFile(root, 'roles/小夏.md'), 'utf8'), 'Clicking center shows the full fake persona');
  await screenshot('demo-persona.png');
  await click('[aria-label="关闭记忆详情"]');
  let selected;
  for (let attempt = 0; attempt < 30; attempt++) {
    const points = await evaluate('window.demoDraws.slice(-451).filter(point=>Math.hypot(point.x-720,point.y-500)>70 && point.x>450 && point.x<1000 && point.y>140 && point.y<800 && point.r>2.5)');
    const point = points[attempt % points.length];
    await pointer(point.x, point.y);
    const id = await evaluate(`document.querySelector('[data-memory-engine-detail]')?.getAttribute('data-memory-engine-node')`);
    const degree = map.links.filter(link => link[0] === id || link[1] === id).length;
    if (degree) { selected = { id, degree }; break; }
    if (id) await click('[aria-label="关闭记忆详情"]');
  }
  check(!!selected, 'Clicking an ordinary neuron shows its memory detail');
  await delay(250);
  const visibleEdges = await evaluate('Math.max(...window.demoEdgeCounts.slice(-5))');
  check(visibleEdges > 0 && visibleEdges <= selected.degree, 'Selected neuron draws only its incident connections');
  evidence.selectedConnections = { available: selected.degree, drawn: visibleEdges };
  await screenshot('demo-links.png');
  await click('[data-memory-engine-tab="memories"]');
  await waitFor(`document.querySelectorAll('[data-memory-engine-row]').length===50`);
  await value('[aria-label="搜索记忆"]', '咖啡');
  const coffee = (await (await fetch(base + '/memory-engine/api/list?q=' + encodeURIComponent('咖啡'))).json()).data;
  await waitFor(`document.querySelectorAll('[data-memory-engine-row]').length===${coffee.items.length} && document.querySelector('[aria-busy]')?.getAttribute('aria-busy')==='false'`);
  check(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-memory-engine-row]')].map(row=>row.getAttribute('data-memory-engine-row')))===${JSON.stringify(JSON.stringify(coffee.items.map(row => row.id)))}`), 'Coffee search returns only matching demo memories');
  await screenshot('demo-search.png');
  await value('[aria-label="搜索记忆"]', '');
  await waitFor(`document.querySelectorAll('[data-memory-engine-row]').length===50`);
  await value('[aria-label="记忆排序"]', 'fading');
  const expected = (await (await fetch(base + '/memory-engine/api/list?sort=fading')).json()).data.items[0].id;
  await waitFor(`document.querySelector('[data-memory-engine-row]')?.getAttribute('data-memory-engine-row')===${JSON.stringify(expected)}`);
  check(true, 'Fading sort agrees with backend retention order');
  await screenshot('demo-memories.png');
  await click('[data-memory-engine-tab="settings"]');
  await waitFor(`document.querySelector('[data-memory-engine-directory]')`);
  const directory = await evaluate(`document.querySelector('[data-memory-engine-directory]').textContent`);
  check(directory === 'demo/home/.dsh/memory-engine', 'Settings displays the public demo directory alias');
  const settings = await evaluate(`document.querySelector('[data-memory-engine-settings]').textContent`);
  assertClean(settings);
  check(settings.includes('450'), 'Settings shows 450 demo records');
  await screenshot('demo-settings.png');
  await click('[data-memory-engine-export]');
  await delay(300);
  check((await (await fetch(base + '/memory-engine/api/export')).json()).data.total === 450, 'Export returns the complete demo library');
  await click('[data-memory-engine-tab="memories"]');
  await waitFor(`document.querySelectorAll('[data-memory-engine-row]').length===50`);
  const id = await evaluate(`document.querySelector('[data-memory-engine-row]').getAttribute('data-memory-engine-row')`);
  await click(`[data-memory-engine-expand="${id}"]`);
  await click(`[data-memory-engine-edit="${id}"]`);
  await value('[aria-label="记忆正文"]', '阿远在演示里试着把咖啡配方写得更清楚。');
  await click('[data-memory-engine-save]');
  await waitFor(`!document.querySelector('[data-memory-engine-editor]')`);
  check((await (await fetch(base + '/memory-engine/api/item/' + id)).json()).data.text.includes('在演示里'), 'GUI edit persists to demo storage');
  await click(`[data-memory-engine-expand="${id}"]`);
  await click(`[data-memory-engine-delete="${id}"]`);
  await click('[data-memory-engine-confirm] button[type="submit"]');
  await waitFor(`document.querySelector('[data-memory-engine-list-total]')?.textContent.includes('449')`);
  check(true, 'GUI delete changes demo count only');
  await click('[data-memory-engine-tab="settings"]');
  await click('[data-memory-engine-clear]');
  await value('[aria-label="输入 DELETE 确认"]', 'DELETE');
  await click('[data-memory-engine-confirm] button[type="submit"]');
  await waitFor(`document.querySelector('[data-memory-engine-guide]')`);
  check((await (await fetch(base + '/memory-engine/api/stats')).json()).data.total === 0, 'GUI clear uses the isolated store and shows onboarding');
  assertClean(await evaluate(`document.querySelector('[data-memory-engine-guide]').textContent`));
  evidence.passed = true;
} catch (error) {
  evidence.errors.push(error.message);
  process.exitCode = 1;
} finally {
  generateDemo();
  if (browser) { await browser.call('Browser.close').catch(() => {}); socket.close(); }
  else child.kill();
  fs.writeFileSync(safeFile(root, 'generated/browser-checks.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await new Promise(resolve => setTimeout(resolve, 500));
  assertInside(root, profile);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
