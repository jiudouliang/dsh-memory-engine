const SEED = 20261030;

export function layoutPositions(nodes, layout = 'sphere') {
  if (layout === 'flat') layout = 'galaxy';
  if (layout === 'spiral') layout = 'brain';
  if (!['sphere', 'galaxy', 'brain'].includes(layout)) throw new Error('未知图谱布局');
  if (layout === 'sphere') return nodes.map(node => ({ ...node, pos: { ...node.pos } }));
  const memories = nodes.filter(node => !node.isCore).sort((left, right) =>
    (right.degree || 0) - (left.degree || 0) || (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0));
  const positions = new Map();
  function jitter(id, axis) {
    let hash = 20261030;
    for (const character of String(id) + ':' + axis) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  }
  let datasetSeed = 20261030;
  for (const id of memories.map(node => String(node.id)).sort()) {
    for (const character of id + '\u0000') datasetSeed = Math.imul(datasetSeed ^ character.codePointAt(0), 16777619);
  }
  const uniform = (id, axis) => Math.max(1e-9, Math.min(1 - 1e-9, (jitter(datasetSeed + ':' + id, axis) + 1) / 2));
  const gaussian = (id, axis) => Math.sqrt(-2 * Math.log(uniform(id, axis + ':radius'))) * Math.cos(2 * Math.PI * uniform(id, axis + ':angle'));
  if (layout === 'galaxy') {
    const armCount = 2 + Math.floor(uniform('galaxy', 'arms') * 3);
    const rotation = uniform('galaxy', 'rotation') * Math.PI * 2;
    const coreCount = Math.ceil(memories.length * 0.15);
    const haloCount = Math.floor(memories.length * 0.05);
    const diskEnd = memories.length - haloCount;
    const dustCount = Math.round(memories.length * 0.30);
    const dust = new Set(memories.slice(coreCount, diskEnd)
      .sort((left, right) => uniform(left.id, 'dust') - uniform(right.id, 'dust') || (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0))
      .slice(0, Math.max(0, dustCount - haloCount)).map(node => node.id));
    memories.forEach((node, index) => {
      let radius, angle;
      if (index < coreCount) {
        radius = 6 + Math.sqrt(uniform(node.id, 'core-radius')) * 16;
        angle = uniform(node.id, 'core-angle') * Math.PI * 2;
      } else if (index >= diskEnd) {
        radius = 95 + Math.sqrt(uniform(node.id, 'halo-radius')) * 35;
        angle = uniform(node.id, 'halo-angle') * Math.PI * 2;
      } else if (dust.has(node.id)) {
        radius = 22 + Math.sqrt(uniform(node.id, 'dust-radius')) * 73;
        angle = uniform(node.id, 'dust-angle') * Math.PI * 2;
      } else {
        const fraction = (index - coreCount + 0.5) / Math.max(1, diskEnd - coreCount);
        const offset = fraction * 73 + gaussian(node.id, 'radius') * 9;
        const folded = ((offset % 146) + 146) % 146;
        radius = 22 + (folded <= 73 ? folded : 146 - folded);
        const arm = Math.floor(uniform(node.id, 'arm') * armCount);
        const base = rotation + arm * Math.PI * 2 / armCount + (uniform(arm, 'arm-offset') - 0.5) * 0.35;
        const twist = (radius - 18) / 95 * 2.2 * Math.PI;
        const ripple = Math.sin(radius * 0.055 + uniform(arm, 'phase') * Math.PI * 2) * 0.10;
        angle = base + twist + ripple + gaussian(node.id, 'angle') * 0.30;
      }
      const thickness = 8 / (1 + radius / 40);
      const height = Math.max(-1, Math.min(1, gaussian(node.id, 'height') * 0.5)) * thickness;
      positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: height });
    });
  } else {
    function brainPoint(id, axis, extent = 1) {
      const horizontal = gaussian(id, axis + ':x');
      const vertical = gaussian(id, axis + ':y');
      const depth = gaussian(id, axis + ':z');
      const scale = Math.cbrt(uniform(id, axis + ':distance')) * extent / Math.hypot(horizontal, vertical, depth);
      return { x: 42 + horizontal * scale * 40, y: vertical * scale * 106, z: depth * scale * 52 };
    }
    const centers = [0, 1].map(side => {
      const count = 12 + Math.floor(uniform('brain:' + side, 'clusters') * 3);
      const candidates = Array.from({ length: 96 }, (_, index) => {
        const id = 'brain:' + side + ':' + index;
        const point = brainPoint(id, 'center', 0.82 + uniform(id, 'surface') * 0.12);
        return { ...point, spread: 6 + uniform(id, 'spread') * 8, phase: uniform(id, 'phase') * Math.PI * 2 };
      });
      const interior = candidates.reduce((best, point, index) => Math.hypot(point.x - 42, point.y, point.z)
        < Math.hypot(candidates[best].x - 42, candidates[best].y, candidates[best].z) ? index : best, 0);
      const selected = [candidates.splice(interior, 1)[0]];
      while (selected.length < count) {
        let best = 0, greatest = -Infinity;
        candidates.forEach((point, index) => {
          const distance = Math.min(...selected.map(center => Math.hypot(point.x - center.x, point.y - center.y, (point.z - center.z) * 0.7)));
          if (distance > greatest) { greatest = distance; best = index; }
        });
        selected.push(candidates.splice(best, 1)[0]);
      }
      return selected;
    });
    const roamers = new Set([...memories].sort((left, right) => uniform(left.id, 'roaming') - uniform(right.id, 'roaming')
      || (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0))
      .slice(0, Math.round(memories.length * 0.05)).map(node => node.id));
    memories.forEach(node => {
      const side = uniform(node.id, 'hemisphere') < 0.5 ? 0 : 1;
      const target = brainPoint(node.id, 'target');
      let center, nearest = Infinity;
      centers[side].forEach((candidate, index) => {
        const distance = Math.hypot(target.x - candidate.x, target.y - candidate.y, target.z - candidate.z)
          * (0.8 + uniform(node.id, 'weight:' + index) * 0.4);
        if (distance < nearest) { nearest = distance; center = candidate; }
      });
      const point = roamers.has(node.id) ? target : {
        x: center.x + gaussian(node.id, 'scatter:x') * center.spread,
        y: center.y + gaussian(node.id, 'scatter:y') * center.spread,
        z: center.z + gaussian(node.id, 'scatter:z') * center.spread,
      };
      point.x += Math.sin(point.y * 0.08 + center.phase) * 6;
      point.z += Math.sin(point.y * 0.09 + center.phase) * 4;
      point.y += Math.sin(point.z * 0.12 + center.phase) * 3;
      const envelope = 0.96 + 0.06 * Math.sin(point.y * 0.08) + 0.035 * Math.cos(point.z * 0.11 + side);
      const distance = Math.hypot((point.x - 42) / 40, point.y / 106, point.z / 52);
      if (distance > envelope) {
        const scale = envelope * (0.93 + uniform(node.id, 'edge') * 0.06) / distance;
        point.x = 42 + (point.x - 42) * scale; point.y *= scale; point.z *= scale;
      }
      positions.set(node.id, { x: (side ? 1 : -1) * (4 + Math.abs(point.x)) + (side ? 2 : 0),
        y: point.y - (side ? 1 : 0), z: point.z });
    });
  }
  return nodes.map(node => ({ ...node, pos: node.isCore ? { x: 0, y: layout === 'brain' ? 14 : 0, z: 0 } : positions.get(node.id) }));
}

export function layoutMemories(nodes) {
  if (!nodes.some(node => node.isCore)) return layoutBrain(nodes);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const inner = node => ['印象', '知识', '事件'].includes(node.kind);
  const memories = nodes.filter(node => !node.isCore);
  const shells = [memories.filter(inner), memories.filter(node => !inner(node))];
  const placed = new Map();
  function jitter(index) {
    let hash = (index + 1) ^ SEED;
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  }
  shells.forEach((shell, layer) => {
    shell.forEach((node, index) => {
      const vertical = 1 - index / Math.max(1, shell.length - 1) * 2;
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const angle = golden * (index + layer * 0.5);
      const event = node.kind === '事件';
      // 壳做厚，而不是贴在球面上：薄壳会把 236 个节点挤成一团。
      // 内层 26~58（厚度 32），外层 70~108，节点沿半径方向均匀铺开，看起来才有立体感。
      const layerMin = layer === 0 ? 26 : 70;
      const layerMax = layer === 0 ? 58 : 108;
      const age = layer === 1 ? Math.min(1, Math.max(0, node.ageDays / 30)) * 12 : 0;
      // jitter 归一到 0~1，在 [layerMin, layerMax] 之间铺开
      const spread = 0.5 + 0.5 * jitter(index + layer * memories.length);
      // 情绪重的事件往内层靠一点，视觉上更"贴身"
      const pull = event && node.majorEmotion ? 7 * spread : 0;
      const distance = layerMin + (layerMax - layerMin) * spread - pull + age;
      const baseRadius = node.majorEmotion ? 3.2 : layer === 0
        ? (node.heat === 1 ? 2.4 : node.heat === 2 ? 1.8 : 1.3)
        : (node.heat === 1 ? 2.1 : node.heat === 2 ? 1.5 : 1.0);
      placed.set(node, { ...node, pos: {
        x: Math.cos(angle) * radial * distance,
        y: vertical * distance * 0.92,
        z: Math.sin(angle) * radial * distance,
      }, radius: Math.min(layer === 0 ? 4.2 : 3.2, baseRadius + Math.min(1.1, Math.sqrt(node.degree) * 0.15)) });
    });
  });
  relax([...placed.values()], { iterations: 80, gap: 1.9, strength: 0.5 });
  return nodes.map(node => node.isCore ? { ...node, pos: { x: 0, y: 0, z: 0 }, radius: 8 } : placed.get(node));
}

function layoutBrain(nodes) {
  let seed = SEED;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  function brainPoint(radiusScale) {
    const radius = Math.pow(random(), 1 / 3) * radiusScale;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    return {
      x: radius * Math.sin(phi) * Math.cos(theta) * 1.18,
      y: radius * Math.cos(phi) * 0.92,
      z: radius * Math.sin(phi) * Math.sin(theta) * 0.78,
    };
  }

  const placed = nodes.map((node) => {
    const inner = ['人格', '印象', '知识'].includes(node.kind) || node.majorEmotion;
    // 整体半径放大 1.35 倍：原来 298 个节点挤在一起，点谁都容易点错
    const distance = (inner ? 14 + Math.pow(random(), 0.65) * 36 : 48 + Math.min(1, node.ageDays / 30) * 58 + random() * 12) * 1.35;
    const baseRadius = node.majorEmotion ? 3.2 : inner
      ? (node.heat === 1 ? 2.4 : node.heat === 2 ? 1.8 : 1.3)
      : (node.heat === 1 ? 2.1 : node.heat === 2 ? 1.5 : 1.0);
    // 连接数加成收敛得更紧一点，避免枢纽节点长得过大压住邻居
    return { ...node, pos: brainPoint(distance), radius: baseRadius + Math.min(1.1, Math.sqrt(node.degree) * 0.15) };
  });

  // ── 分离松弛：把互相重叠的节点推开 ──
  // 不做这一步的话，随机落点会让相邻节点的圆重叠，视觉糊成一片，点击也分不清。
  // 只在世界坐标里推开，不改 z 深度关系太多；迭代次数固定，保证同一份数据每次布局一致。
  relax(placed, { iterations: 60, gap: 1.55, strength: 0.5 });
  return placed;
}

function relax(items, { iterations, gap, strength }) {
  if (items.length < 2) return;
  for (let round = 0; round < iterations; round++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dz = b.pos.z - a.pos.z;
        const dist = Math.hypot(dx, dy, dz) || 1e-6;
        const minDist = (a.radius + b.radius) * gap;
        if (dist >= minDist) continue;
        // 单位向量；重合时用一个确定的、由索引决定的偏移方向，避免除零和随机抖动
        const ux = dist > 1e-5 ? dx / dist : Math.cos(i * 2.39996);
        const uy = dist > 1e-5 ? dy / dist : Math.sin(i * 2.39996);
        const uz = dist > 1e-5 ? dz / dist : 0.35;
        const push = (minDist - dist) * strength * 0.5;
        a.pos.x -= ux * push; a.pos.y -= uy * push; a.pos.z -= uz * push;
        b.pos.x += ux * push; b.pos.y += uy * push; b.pos.z += uz * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}
