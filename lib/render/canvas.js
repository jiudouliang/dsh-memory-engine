export function createRenderer(canvas, data, options = {}) {
  const document = canvas.ownerDocument;
  const window = document.defaultView;
  const performance = window.performance;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D 不可用');
  const THEMES = {
    classic: {
      colors: { '人格':[255,215,106], '印象':[143,216,255], '知识':[126,231,178], '日记':[190,160,255], '对话':[255,160,140], '情绪':[255,90,90] },
      fallback:[145,205,255], background:'#03060c', grid:'rgba(40,90,140,0.055)',
      link:'rgba(110,190,255,0.30)', linkHighlight:'rgba(160,220,255,0.22)',
      pulse:[205,245,255], center:[255,255,255], fading:[255,110,110], glow:[0.7,0.19],
      vignette:['rgba(0,0,0,0)','rgba(0,0,0,.78)'],
    },
    neon: {
      colors: { '人格':[255,255,255], '印象':[63,242,224], '知识':[255,95,210], '事件':[165,107,255], '日记':[192,125,255], '对话':[255,147,233], '情绪':[255,66,130] },
      fallback:[145,143,255], background:'#0a0410', grid:'rgba(156,70,210,0.07)',
      link:['rgba(255,95,210,0.36)','rgba(165,107,255,0.36)'], linkHighlight:'rgba(224,175,255,0.24)',
      pulse:[245,210,255], center:[255,255,255], fading:[255,90,165], glow:[0.7,0.19],
      vignette:['rgba(10,4,16,0)','rgba(10,4,16,.78)'],
    },
    paper: {
      colors: { '人格':[40,40,40], '印象':[107,107,107], '知识':[64,64,64], '事件':[85,85,85], '日记':[133,133,133], '对话':[116,116,116], '情绪':[76,76,76] },
      fallback:[96,96,96], background:'#f7f5f0', grid:'rgba(80,78,73,0.022)',
      link:'rgba(65,65,65,0.34)', linkHighlight:'rgba(100,100,100,0.055)',
      pulse:[48,48,48], center:[36,36,36], fading:[126,126,126], glow:[0.025,0.006],
      vignette:['rgba(135,132,125,0)','rgba(135,132,125,.08)'],
    },
    mono: {
      colors: { '人格':[232,232,232], '印象':[200,200,200], '知识':[255,255,255], '事件':[138,138,138], '日记':[174,174,174], '对话':[218,218,218], '情绪':[160,160,160] },
      fallback:[185,185,185], background:'#0d0d0d', grid:'rgba(130,130,130,0.045)',
      link:'rgba(178,178,178,0.30)', linkHighlight:'rgba(210,210,210,0.22)',
      pulse:[235,235,235], center:[255,255,255], fading:[150,150,150], glow:[0.7,0.19],
      vignette:['rgba(0,0,0,0)','rgba(0,0,0,.78)'],
    },
  };
  let themeName = options.graphTheme ?? data.graphTheme ?? 'classic';
  if (!Object.hasOwn(THEMES, themeName)) throw new Error('未知图谱配色');
  let theme = THEMES[themeName];
  let layoutName = options.graphLayout ?? data.graphLayout ?? 'sphere';
  if (layoutName === 'flat') layoutName = 'galaxy';
  if (layoutName === 'spiral') layoutName = 'brain';
  if (!['sphere', 'galaxy', 'brain'].includes(layoutName)) throw new Error('未知图谱布局');
  let sphereNodes = [];
  const layouts = new Map();
  let nodes = [], links = [], hubs = [], linkTwinkle = [], visibleLinks = [];
  const byId = new Map(), adjacency = new Map(), sprites = new Map();
  const pulses = [], firing = new Map(), selections = new Set();
  // 默认不画连线（数量太大会卡），只画选中光点周围的线
  let selectedId=null, selectedNeighbours=new Set();
  if (typeof options.onSelect === 'function') selections.add(options.onSelect);
  let seed = 987654321;
  const random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
  let width=0,height=0,dpr=1,rotX=0.3,rotY=0.15,zoom=data.nodes.length<50?1.6:1,autoSpin=true;
  let spinSpeed=data.spinSpeed??0.35,resumeAt=0;
  const frameInterval=Number.isFinite(options.frameInterval)?Math.max(0,options.frameInterval):0;
  let drag=null,nextFire=0,lastTime=0,lastDrawAt=0,rafId=null,running=false,destroyed=false,generation=0,observer=null;

function glowSprite(rgb) {
  const off = document.createElement('canvas');
  off.width = off.height = 96;
  const brush = off.getContext('2d');
  const gradient = brush.createRadialGradient(48,48,1,48,48,48);
  gradient.addColorStop(0,'rgba('+rgb.join(',')+','+theme.glow[0]+')');
  gradient.addColorStop(0.4,'rgba('+rgb.join(',')+','+theme.glow[1]+')');
  gradient.addColorStop(1,'rgba('+rgb.join(',')+',0)');
  brush.fillStyle = gradient; brush.fillRect(0,0,96,96);
  return off;
}

  function recolor() {
    sprites.clear();
    for (const star of nodes) {
      star._rgb = theme.colors[star.kind] || theme.fallback;
      const key = star._rgb.join(',');
      if (!sprites.has(key)) sprites.set(key, glowSprite(star._rgb));
      star._glow = sprites.get(key);
    }
  }

  function setTheme(nextTheme) {
    if (destroyed || nextTheme === themeName) return;
    if (!Object.hasOwn(THEMES, nextTheme)) throw new Error('未知图谱配色');
    themeName = nextTheme;
    theme = THEMES[nextTheme];
    recolor();
  }

  function setLayout(nextLayout) {
    if (destroyed) return;
    if (nextLayout === 'flat') nextLayout = 'galaxy';
    if (nextLayout === 'spiral') nextLayout = 'brain';
    if (!['sphere', 'galaxy', 'brain'].includes(nextLayout)) throw new Error('未知图谱布局');
    if (layoutName === nextLayout && layouts.has(nextLayout)) return;
    if (!layouts.has(nextLayout)) {
      if (typeof options.layoutNodes !== 'function') throw new Error('缺少图谱布局函数');
      layouts.set(nextLayout, options.layoutNodes(sphereNodes, nextLayout).map(node => ({ ...node.pos })));
    }
    const positions = layouts.get(nextLayout);
    nodes.forEach((node, index) => { node.pos = { ...positions[index] }; });
    layoutName = nextLayout;
  }

  // 字符串 → 32 位无符号哈希。给连线的闪烁参数做种子：
  // 用 id 而不是 Math.random，保证同一条线在每次打开时节奏一致（不会每次刷新都跳），
  // 但不同连线之间互不同步。
  function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function setData(nextData) {
    if (destroyed) return;
    spinSpeed=nextData.spinSpeed??0.35;
    nodes = nextData.nodes.map(node => ({ ...node, pos: { ...node.pos } }));
    sphereNodes = nextData.nodes.map(node => ({ ...node, pos: { ...node.pos } }));
    layouts.clear();
    layouts.set('sphere', sphereNodes.map(node => ({ ...node.pos })));
    if (layoutName !== 'sphere') setLayout(layoutName);
    links = nextData.links.map(link => [...link]);
    byId.clear(); adjacency.clear(); sprites.clear(); pulses.length = 0; firing.clear();
    selectedId=typeof options.selectedId==='string'?options.selectedId:null;
    selectedNeighbours=new Set(selectedId?(adjacency.get(selectedId)||[]):[]);
    seed = 987654321; nextFire = 0;
    for (const node of nextData.nodes) byId.set(node.id, node);
    for (const node of nodes) adjacency.set(node.id, []);
    for (const [left,right] of links) {
      if (adjacency.has(left) && adjacency.has(right)) { adjacency.get(left).push(right); adjacency.get(right).push(left); }
    }
    hubs = nodes.filter(star => star.degree > 0).sort((left,right) => right.degree-left.degree).slice(0,6);
    // 每条连线一份自己的闪烁参数：相位和频率都不一样，整体才不会"齐刷刷"地一起亮。
    // 用连线两端 id 的哈希做种子，保证同一条线每次打开图的节奏一致（不会跳变），
    // 但线与线之间互不同步。
    linkTwinkle = links.map(([left, right]) => {
      const h = hashString(left + '|' + right);
      return {
        // 频率调低：周期从 4~18 秒放慢到 18~55 秒，变成"慢慢呼吸"而不是"闪"
        freq: 0.000114 + (h % 1000) / 1000 * 0.000235,
        phase: (Math.floor(h / 1000) % 6283) / 1000,       // 0 ~ 6.28，彼此错开
        amp: 0.05 + (Math.floor(h / 7e6) % 100) / 100 * 0.12,
        // 弯曲：一半往左弯一半往右弯，弯度 8%~24%。
        // 之前所有线都朝同一侧弯，视觉上像漩涡，边界区域就显空。
        bow: (h % 2 === 0 ? 1 : -1) * (0.08 + (Math.floor(h / 13) % 100) / 100 * 0.16),
        // 端点偏移：同一个节点被很多线连时，让它们从不同角度进来，散成扇面而不是叠成一条
        jitterStart: ((Math.floor(h / 31) % 100) / 100 - 0.5) * 1.6,
        jitterEnd: ((Math.floor(h / 977) % 100) / 100 - 0.5) * 1.6,
      };
    });
    // 连线数量会随记忆增长爆炸（332 条时 383 根，479 条时 1738 根）。
    // 每帧全画会卡，所以按"两端留存"排序，最多画 LINK_DRAW_CAP 根最亮的，
    // 其余的不进这一帧（数据没丢，只是不画，缩放/点击仍按全量算）。
    const LINK_DRAW_CAP = 1200;
    if (links.length <= LINK_DRAW_CAP) {
      visibleLinks = links.map((_, index) => index);
    } else {
      const byIdLocal = new Map(nodes.map(node => [node.id, node]));
      const strength = index => {
        const [left, right] = links[index];
        const a = byIdLocal.get(left), b = byIdLocal.get(right);
        return Math.min(a?.retention ?? 0, b?.retention ?? 0) + Math.min(a?.degree ?? 0, b?.degree ?? 0) * 0.002;
      };
      visibleLinks = links.map((_, index) => index)
        .sort((x, y) => strength(y) - strength(x))
        .slice(0, LINK_DRAW_CAP);
    }
for (const star of nodes) {
  const count = Math.min(9, 4 + Math.round(Math.sqrt(star.degree) * 1.2));
  star._dendrites = Array.from({length:count},(_,index) => ({
    angle:index/count*Math.PI*2+random()*0.7,
    length:0.9+random()*1.5, bend:(random()-0.5)*0.9, width:0.5+random()*0.7,
    fork:random()<0.55 ? (random()-0.5)*1.5 : null
  }));
}
recolor();

  }

  function resize() {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    width=bounds.width; height=bounds.height; dpr=Math.min(1.5,window.devicePixelRatio||1);
    canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

function project(pos) {
  const cy=Math.cos(rotY),sy=Math.sin(rotY),cx=Math.cos(rotX),sx=Math.sin(rotX);
  const x=pos.x*cy-pos.z*sy,z=pos.x*sy+pos.z*cy;
  const y=pos.y*cx-z*sx,depth=pos.y*sx+z*cx+250;
  if (depth<=12) return null;
  const scale=760/depth*zoom;
  return {x:width/2+x*scale,y:height/2+y*scale,scale,depth};
}
function fire(id,now) {
  firing.set(id,1);
  const neighbours=adjacency.get(id)||[];
  // 选中某个光点时，把它的关联线都点亮几条脉冲（最多 24 条，避免又糊成一片）；
  // 未选中时的随机心跳只挑 2~4 条，避免整片区域同时亮。
  const selected = id===selectedId;
  const limit = selected ? 24 : 2+Math.floor(Math.random()*3);
  const count=Math.min(neighbours.length,limit);
  const picked=new Set();
  let guard=0;
  while (picked.size<count && neighbours.length && guard++<400) {
    picked.add(neighbours[Math.floor(Math.random()*neighbours.length)]);
  }
  for (const other of picked) {
    // 邻居亮度也压低：原来 0.65 会让整片区域同时亮起来
    firing.set(other,Math.max(selected?0.4:0.26,firing.get(other)||0));
    pulses.push({from:id,to:other,born:now,life:700+Math.random()*2400});
  }
}

  function select(x,y) {
  let best=null,bestScore=Infinity;
  for (const star of nodes) {
    if (!star._screen) continue;
    const value=Math.hypot(star._screen.x-x,star._screen.y-y);
    const tolerance=Math.max(14,star._screen.r*1.15);
    if (value>tolerance) continue;
    const score=value-star._screen.r*0.22;
    if (score<bestScore) {bestScore=score;best=star;}
  }
  if (!best) return;
  selectedId = best.id;
  selectedNeighbours = new Set(adjacency.get(best.id) || []);
  fire(best.id,performance.now());
    for (const callback of selections) callback(byId.get(best.id));
  }

  function onPointerDown(event) {
    resumeAt=Infinity;
    autoSpin=false; drag={x:event.clientX,y:event.clientY,moved:0,pointerId:event.pointerId};
    canvas.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event) {
    if (!drag) return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    drag.x=event.clientX; drag.y=event.clientY; drag.moved+=Math.abs(dx)+Math.abs(dy);
    rotY+=dx*0.006; rotX=Math.max(-1.5,Math.min(1.5,rotX+dy*0.006));
  }
  function releaseDrag() {
    if (drag && running) resumeAt=performance.now()+2000;
    if (drag && canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    drag=null;
  }
  function onPointerUp(event) {
    const clicked = drag && drag.moved<6;
    releaseDrag();
    if (clicked) {
      const bounds = canvas.getBoundingClientRect();
      select(event.clientX-bounds.left,event.clientY-bounds.top);
    }
  }
  function onWheel(event) {
    event.preventDefault();
    zoom=Math.max(0.3,Math.min(4.5,zoom*(event.deltaY>0?0.92:1.08)));
  }

function frame(now) {
  const delta=Math.min(50,now-lastTime||16.7); lastTime=now;
  if (!autoSpin && !drag && now>=resumeAt) autoSpin=true;
  if (autoSpin) rotY+=0.0011*spinSpeed*3*delta/16.7;
  if (now>nextFire) {
    // 默认不画连线，所以也不撒"沿线的脉冲"——否则会出现飘来飘去的小点，找不到来源。
    // 选中光点后，脉冲只在它的关联线上跑。
    if (selectedId) {
      fire(selectedId,now);
    } else {
      // 没选中时只让枢纽光点自己亮一下，不动线
      if (hubs.length) {
        const hub=hubs[Math.floor(Math.random()*hubs.length)];
        firing.set(hub.id,1);
      }
    }
    nextFire=now+1400+Math.random()*3200;
  }
  ctx.globalCompositeOperation='source-over'; ctx.fillStyle=theme.background; ctx.fillRect(0,0,width,height);
  ctx.strokeStyle=theme.grid;ctx.lineWidth=1;
  for (let index=0;index<20;index++) {
    const y=index/20*height;
    ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(width*.3,y+Math.sin(now*.00007+index)*30,width*.7,y-Math.cos(now*.00006+index)*30,width,y);ctx.stroke();
  }
  const points=[];
  for (const star of nodes) {
    const p=project(star.pos);
    if (!p || p.x< -100 || p.x>width+100 || p.y< -100 || p.y>height+100) {star._screen=null;continue;}
    points.push({star,p});
  }
  points.sort((left,right)=>left.star.isCore?1:right.star.isCore?-1:right.p.depth-left.p.depth);
  const screen=new Map(points.map(point=>[point.star.id,point]));
  // 连线只在"选中某个光点"时画，且只画和它相连的那些。
  // 全量 1738 根每帧画会卡；默认干干净净，点谁看谁的关联。
  const linkPaths=[];
  if (selectedId) {
    for (const [left,right] of links) {
      if (left!==selectedId && right!==selectedId) continue;
      const first=screen.get(left),second=screen.get(right);
      if (!first||!second) continue;
      const target = left===selectedId ? second : first;
      const ret = Math.min(first.star.retention, second.star.retention);
      const alpha = Math.min(.9, .22 + ret*.35);
      const dx=second.p.x-first.p.x, dy=second.p.y-first.p.y;
      const len=Math.hypot(dx,dy)||1;
      const nx=-dy/len, ny=dx/len;
      // 朝选中点那一侧弯，形成"从中心散开"的观感
      const bow = (target===second ? 1 : -1) * .16;
      const mx=(first.p.x+second.p.x)/2+nx*len*bow*.5;
      const my=(first.p.y+second.p.y)/2+ny*len*bow*.5;
      linkPaths.push([first.p.x,first.p.y,mx,my,second.p.x,second.p.y,alpha]);
    }
  }
  if (linkPaths.length) {
    if (layoutName === 'galaxy') ctx.globalAlpha=0.8;
    if (Array.isArray(theme.link)) {
      const gradient = ctx.createLinearGradient(0,0,width,height);
      gradient.addColorStop(0,theme.link[0]);
      gradient.addColorStop(1,theme.link[1]);
      ctx.strokeStyle=gradient;
    } else ctx.strokeStyle=theme.link;
    ctx.lineWidth=layoutName === 'galaxy' ? 0.8 : 1;
    ctx.beginPath();
    for (const p of linkPaths) { ctx.moveTo(p[0],p[1]); ctx.quadraticCurveTo(p[2],p[3],p[4],p[5]); }
    ctx.stroke();
    // 更亮的一层，让关联线看得清
    ctx.strokeStyle=theme.linkHighlight;
    ctx.lineWidth=layoutName === 'galaxy' ? 1.6 : 2;
    ctx.stroke();
    if (layoutName === 'galaxy') ctx.globalAlpha=1;
  }
  for (let index=pulses.length-1;index>=0;index--) {
    const pulse=pulses[index],fraction=(now-pulse.born)/pulse.life;
    if (fraction>=1) {pulses.splice(index,1);continue;}
    const first=screen.get(pulse.from),second=screen.get(pulse.to);
    if (!first||!second) continue;
    const mx=(first.p.x+second.p.x)/2+(first.p.y-second.p.y)*.18,my=(first.p.y+second.p.y)/2+(second.p.x-first.p.x)*.18;
    const inverse=1-fraction;
    const x=inverse*inverse*first.p.x+2*inverse*fraction*mx+fraction*fraction*second.p.x;
    const y=inverse*inverse*first.p.y+2*inverse*fraction*my+fraction*fraction*second.p.y;
    ctx.fillStyle='rgba('+theme.pulse.join(',')+','+(.9*inverse)+')';ctx.beginPath();ctx.arc(x,y,2.5+2*inverse,0,Math.PI*2);ctx.fill();
  }
  for (const {star,p} of points) {
    const act=firing.get(star.id)||0,ret=Math.max(.05,Math.min(1.2,star.retention));
    const intensity=Math.min(1,.22+ret*.72)*(1+act*1.1);
    // 每颗星自己的呼吸频率和相位：从 id 哈希来，避免全图同一个节拍
    if (star._pulse===undefined) {
      const h=hashString(star.id);
      star._pulse={freq:0.00018+(h%1000)/1000*0.00045,phase:(Math.floor(h/1000)%6283)/1000,amp:0.035+(Math.floor(h/7e6)%100)/100*0.045};
    }
    const pulse=star._pulse;
    const breathe=Math.sin(now*pulse.freq+pulse.phase)*pulse.amp;
    const radius=Math.max(2,star.radius*p.scale*.55)*(1+breathe)*(1+act*.5);
    const rgb=star._rgb.join(',');
    if (star.isCore) {
      const halo=ctx.createRadialGradient(p.x,p.y,radius*.75,p.x,p.y,radius*2.2);
      halo.addColorStop(0,'rgba('+rgb+',0.12)');
      halo.addColorStop(.65,'rgba('+rgb+',0.04)');
      halo.addColorStop(1,'rgba('+rgb+',0)');
      ctx.fillStyle=halo;ctx.beginPath();ctx.arc(p.x,p.y,radius*2.2,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba('+rgb+',0.38)';ctx.lineWidth=.7;ctx.setLineDash([3,5]);ctx.lineDashOffset=-now*.008;
      ctx.beginPath();ctx.arc(p.x,p.y,radius*1.6,0,Math.PI*2);ctx.stroke();
      ctx.setLineDash([]);ctx.lineDashOffset=0;
    }
    ctx.strokeStyle='rgba('+rgb+','+Math.min(1,.3*intensity)+')';
    if (radius>2.5) for (const branch of star._dendrites) {
      const length=radius*2.2*branch.length,dx=Math.cos(branch.angle),dy=Math.sin(branch.angle);
      const ex=p.x+dx*length,ey=p.y+dy*length;
      const cx=p.x+dx*length*.55-dy*length*branch.bend*.5;
      const cy=p.y+dy*length*.55+dx*length*branch.bend*.5;
      ctx.lineWidth=branch.width;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.quadraticCurveTo(cx,cy,ex,ey);ctx.stroke();
      if (branch.fork!==null) {
        const angle=branch.angle+branch.fork;
        ctx.lineWidth=branch.width*.65;ctx.beginPath();ctx.moveTo(cx,cy);ctx.quadraticCurveTo(cx+Math.cos(angle)*length*.2,cy+Math.sin(angle)*length*.2,cx+Math.cos(angle)*length*.34,cy+Math.sin(angle)*length*.34);ctx.stroke();
      }
    }
    const glowRadius=radius*3.6;
    ctx.globalAlpha=Math.min(1,.4+intensity*.7);ctx.drawImage(star._glow,p.x-glowRadius,p.y-glowRadius,glowRadius*2,glowRadius*2);ctx.globalAlpha=1;
    ctx.fillStyle='rgba('+rgb+','+Math.min(1,.42*intensity)+')';ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba('+rgb+','+Math.min(1,.75*intensity)+')';ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle='rgba('+theme.center.join(',')+','+Math.min(1,.6*intensity)+')';ctx.beginPath();ctx.arc(p.x,p.y,radius*.42,0,Math.PI*2);ctx.fill();
    if (star.retention<.25) {
      ctx.strokeStyle='rgba('+theme.fading.join(',')+','+Math.max(0,.45-star.retention)+')';ctx.setLineDash([3,4]);
      ctx.beginPath();ctx.arc(p.x,p.y,radius*3.2,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    star._screen={x:p.x,y:p.y,r:Math.max(8,radius*2.6)};
  }
  for (const [id,value] of firing) {
    const next=value*Math.pow(.965,delta/16.7);
    if (next<.02) firing.delete(id); else firing.set(id,next);
  }
  ctx.globalCompositeOperation='source-over';
  const vignette=ctx.createRadialGradient(width/2,height/2,Math.min(width,height)*.34,width/2,height/2,Math.max(width,height)*.8);
  vignette.addColorStop(0,theme.vignette[0]);vignette.addColorStop(1,theme.vignette[1]);
  ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
}
  function start() {
    if (running || destroyed) return;
    running=true; lastTime=0; nextFire=0; autoSpin=true; resumeAt=0;
    const currentGeneration = ++generation;
    canvas.addEventListener('pointerdown',onPointerDown);
    canvas.addEventListener('pointermove',onPointerMove);
    canvas.addEventListener('pointerup',onPointerUp);
    canvas.addEventListener('pointercancel',releaseDrag);
    canvas.addEventListener('wheel',onWheel,{passive:false});
    window.addEventListener('resize',resize);
    if (window.ResizeObserver) {
      observer = new window.ResizeObserver(resize);
      observer.observe(canvas);
    }
    resize();
    function tick(now) {
      if (!running || destroyed || currentGeneration !== generation) return;
      rafId=null;
      // 帧率上限靠 options.frameInterval 控制（默认 0 = 不限）。
      // 界面里按 40fps 传；测试里不传，保持逐帧确定性。
      if (frameInterval > 0 && now - lastDrawAt < frameInterval) {
        rafId=window.requestAnimationFrame(tick);
        return;
      }
      lastDrawAt = now;
      frame(now);
      if (running && !destroyed && currentGeneration === generation) rafId=window.requestAnimationFrame(tick);
    }
    rafId=window.requestAnimationFrame(tick);
  }

  function stop() {
    running=false; generation++;
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    rafId=null;
    observer?.disconnect(); observer=null;
    canvas.removeEventListener('pointerdown',onPointerDown);
    canvas.removeEventListener('pointermove',onPointerMove);
    canvas.removeEventListener('pointerup',onPointerUp);
    canvas.removeEventListener('pointercancel',releaseDrag);
    canvas.removeEventListener('wheel',onWheel);
    window.removeEventListener('resize',resize);
    releaseDrag();
    pulses.length=0; firing.clear(); lastTime=0; nextFire=0;
  }

  function destroy() {
    if (destroyed) return;
    stop(); destroyed=true;
    selections.clear(); byId.clear(); adjacency.clear(); sprites.clear();
    nodes=[]; links=[]; hubs=[]; sphereNodes=[]; layouts.clear();
  }

  setData(data);
  return {
    start, stop, resize, setData, setTheme, setLayout, destroy,
    fireNeuron(id) { if (!destroyed && byId.has(id)) fire(id,performance.now()); },
    onSelect(callback) {
      if (!destroyed) selections.add(callback);
      return () => selections.delete(callback);
    },
  };
}

