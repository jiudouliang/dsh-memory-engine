const SEED = 20261030;

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
