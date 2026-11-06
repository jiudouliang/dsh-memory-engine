import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { layoutPositions } from '../lib/render/layout.mjs';

const fixture = (prefix = 'galaxy') => [
  { id: 'persona', isCore: true, radius: 8, degree: 0, retention: 1, pos: { x: 0, y: 0, z: 0 } },
  ...Array.from({ length: 450 }, (_, index) => ({ id: `${prefix}-${index}`, degree: 450 - index,
    radius: 1 + index % 3, retention: 0.8, heat: 1 + index % 3, kind: '知识', pos: { x: index, y: index % 7, z: index % 13 } })),
];

function angularStructure(nodes) {
  const residuals = nodes.filter(node => !node.isCore && Math.hypot(node.pos.x, node.pos.y) > 22)
    .map(node => Math.atan2(node.pos.y, node.pos.x) - (Math.hypot(node.pos.x, node.pos.y) - 18) / 95 * Math.PI * 2.2);
  const harmonics = [2, 3, 4].map(arms => {
    const horizontal = residuals.reduce((sum, angle) => sum + Math.cos(angle * arms), 0) / residuals.length;
    const vertical = residuals.reduce((sum, angle) => sum + Math.sin(angle * arms), 0) / residuals.length;
    return { arms, strength: Math.hypot(horizontal, vertical), phase: Math.atan2(vertical, horizontal) / arms };
  });
  const strongest = harmonics.reduce((best, item) => item.strength > best.strength ? item : best);
  const nearArms = Array.from({ length: strongest.arms }, () => 0);
  let scattered = 0;
  for (const angle of residuals) {
    const distances = nearArms.map((_, index) => {
      const offset = angle - strongest.phase - index * Math.PI * 2 / strongest.arms;
      return Math.abs(Math.atan2(Math.sin(offset), Math.cos(offset)));
    });
    const nearest = Math.min(...distances);
    if (nearest < 0.45) nearArms[distances.indexOf(nearest)]++;
    if (nearest > 0.55) scattered++;
  }
  return { ...strongest, nearArms, scattered: scattered / residuals.length };
}

test('galaxy preserves 451 identities, metadata and centered persona without mutating input', () => {
  const data = fixture(), previous = JSON.stringify(data);
  const galaxy = layoutPositions(data, 'galaxy');
  assert.equal(galaxy.length, 451);
  assert.deepEqual(galaxy[0].pos, { x: 0, y: 0, z: 0 });
  assert.deepEqual(galaxy.map(({ pos, ...node }) => node), data.map(({ pos, ...node }) => node));
  assert.equal(JSON.stringify(data), previous);
});

test('galaxy is deterministic across repeated runs, source ordering and standalone browser use', () => {
  const data = fixture(), first = layoutPositions(data, 'galaxy');
  for (let round = 0; round < 3; round++) assert.deepEqual(layoutPositions(data, 'galaxy'), first);
  assert.deepEqual(layoutPositions([...data].reverse(), 'galaxy').reverse(), first);
  const browserLayout = vm.runInNewContext('(' + layoutPositions.toString() + ')');
  assert.equal(JSON.stringify(browserLayout(data, 'galaxy')), JSON.stringify(first));
});

test('galaxy responds to node ids and importance instead of using a fixed point cloud', () => {
  const data = fixture(), first = layoutPositions(data, 'galaxy');
  assert.notDeepEqual(layoutPositions(fixture('another'), 'galaxy').map(node => node.pos), first.map(node => node.pos));
  const promoted = data.map(node => node.id === 'galaxy-449' ? { ...node, degree: 1000 } : node);
  const position = layoutPositions(promoted, 'galaxy').find(node => node.id === 'galaxy-449').pos;
  assert.ok(Math.hypot(position.x, position.y) <= 22);
});

test('galaxy has a dense top-fifteen-percent core, disk and sparse outer halo', () => {
  const nodes = layoutPositions(fixture(), 'galaxy').slice(1);
  const core = nodes.slice(0, 68), disk = nodes.slice(68, 428), halo = nodes.slice(428);
  assert.ok(core.every(node => Math.hypot(node.pos.x, node.pos.y) <= 22 + 1e-9));
  assert.ok(disk.every(node => Math.hypot(node.pos.x, node.pos.y) >= 22 - 1e-9 && Math.hypot(node.pos.x, node.pos.y) <= 95 + 1e-9));
  assert.ok(halo.every(node => Math.hypot(node.pos.x, node.pos.y) >= 95 - 1e-9 && Math.hypot(node.pos.x, node.pos.y) <= 130 + 1e-9));
  const densities = [core.length / (22 ** 2), disk.length / (95 ** 2 - 22 ** 2), halo.length / (130 ** 2 - 95 ** 2)];
  assert.ok(densities[0] > densities[1] && densities[1] > densities[2]);
});

test('galaxy has multiple angular peaks and off-arm dust, not symmetric lines or pure noise', () => {
  const nodes = layoutPositions(fixture(), 'galaxy');
  const structure = angularStructure(nodes);
  assert.ok(structure.strength > 0.20);
  assert.ok(structure.nearArms.filter(count => count > 20).length >= 2);
  assert.ok(structure.scattered > 0.10 && structure.scattered < 0.45);
  const angles = nodes.slice(1).map(node => Math.atan2(node.pos.y, node.pos.x));
  assert.equal(new Set(angles.map(angle => angle.toFixed(8))).size, 450);
});

test('galaxy thickness tapers outward and empty or small maps remain finite', () => {
  const data = fixture();
  for (const count of [0, 1, 2, 3, 8, 451]) {
    const nodes = layoutPositions(data.slice(0, count), 'galaxy');
    assert.equal(nodes.length, count);
    for (const node of nodes) {
      assert.ok(Object.values(node.pos).every(Number.isFinite));
      assert.ok(Math.abs(node.pos.z) <= 8 / (1 + Math.hypot(node.pos.x, node.pos.y) / 40) + 1e-9);
    }
  }
  assert.ok(layoutPositions(data, 'galaxy').some(node => Math.abs(node.pos.z) > 1));
});
