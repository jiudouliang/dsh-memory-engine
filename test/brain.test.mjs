import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { layoutPositions } from '../lib/render/layout.mjs';

const fixture = (prefix = 'brain') => [
  { id: 'persona', isCore: true, radius: 8, degree: 0, retention: 1, pos: { x: 0, y: 0, z: 0 } },
  ...Array.from({ length: 450 }, (_, index) => ({ id: `${prefix}-${index}`, degree: 450 - index,
    radius: 1 + index % 3, retention: 0.8, heat: 1 + index % 3, kind: '知识', pos: { x: index, y: index % 7, z: index % 13 } })),
];

test('brain preserves 451 nodes and their metadata, with a lower central persona', () => {
  const data = fixture(), previous = JSON.stringify(data);
  const result = layoutPositions(data, 'brain');
  assert.equal(result.length, 451);
  assert.ok(Object.values(result[0].pos).every(value => Math.abs(value) < 20));
  assert.ok(result[0].pos.y > 0);
  assert.deepEqual(result.map(({ pos, ...node }) => node), data.map(({ pos, ...node }) => node));
  assert.equal(JSON.stringify(data), previous);
});

test('brain has separated x-distribution peaks, a ten-unit fissure and no mirrored hemispheres', () => {
  const result = layoutPositions(fixture(), 'brain').slice(1);
  const sides = [result.filter(node => node.pos.x < 0), result.filter(node => node.pos.x > 0)];
  assert.ok(sides.every(side => side.length >= 180 && side.length <= 270));
  assert.ok(result.every(node => node.pos.x <= -4 || node.pos.x >= 6));
  for (const side of sides) {
    const centerCount = side.filter(node => Math.abs(node.pos.x) < 20).length;
    const peakCount = side.filter(node => Math.abs(node.pos.x) >= 20 && Math.abs(node.pos.x) < 60).length;
    assert.ok(peakCount / 40 > centerCount / 20);
  }
  const mirrored = new Set(sides[0].map(node => `${-node.pos.x + 2}:${node.pos.y - 1}:${node.pos.z}`));
  assert.ok(sides[1].every(node => !mirrored.has(`${node.pos.x}:${node.pos.y}:${node.pos.z}`)));
});

test('brain has at least eight dense grid regions per hemisphere and an uneven surface', () => {
  const result = layoutPositions(fixture(), 'brain').slice(1);
  for (const sign of [-1, 1]) {
    const side = result.filter(node => Math.sign(node.pos.x) === sign);
    const cells = new Map();
    for (const node of side) {
      const key = Object.values(node.pos).map(value => Math.floor(value / 24)).join(':');
      cells.set(key, (cells.get(key) || 0) + 1);
    }
    assert.ok([...cells.values()].filter(count => count >= 4).length >= 8);
    const widths = Array.from({ length: 8 }, (_, index) => {
      const band = side.filter(node => node.pos.y >= -100 + index * 25 && node.pos.y < -75 + index * 25);
      return band.length ? Math.max(...band.map(node => Math.abs(node.pos.x))) : 0;
    }).filter(Boolean);
    assert.ok(Math.max(...widths) - Math.min(...widths) > 10);
    assert.ok(side.every(node => Math.abs(node.pos.y) < 120 && Math.abs(node.pos.z) < 65));
  }
});

test('brain is deterministic across three runs, reordered inputs and browser inlining', () => {
  const data = fixture(), first = layoutPositions(data, 'brain');
  for (let round = 0; round < 3; round++) assert.deepEqual(layoutPositions(data, 'brain'), first);
  assert.deepEqual(layoutPositions([...data].reverse(), 'brain').reverse(), first);
  const browser = vm.runInNewContext('(' + layoutPositions.toString() + ')');
  assert.equal(JSON.stringify(browser(data, 'brain')), JSON.stringify(first));
  assert.notDeepEqual(layoutPositions(fixture('other'), 'brain').map(node => node.pos), first.map(node => node.pos));
});

test('brain supports empty, core-only, tiny and no-persona datasets without invalid coordinates', () => {
  const data = fixture();
  for (const nodes of [[], [data[0]], [data[1]], data.slice(0, 3), data.slice(1, 9), data.slice(1)]) {
    const result = layoutPositions(nodes, 'brain');
    assert.equal(result.length, nodes.length);
    assert.ok(result.every(node => Object.values(node.pos).every(Number.isFinite)));
  }
});
