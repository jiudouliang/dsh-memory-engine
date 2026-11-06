// 由 scripts/build-client.mjs 生成，别直接改这个文件
window.__ModuleLoader__.load({
  id: "dsh-memory-engine",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var ReactDOM = require("react-dom");
    // 2026-10-30：从 views.actions 挪到 header.actions。
    // views.actions 是「更多视图」下拉菜单的行（Chat/Trajectory 旁边的 ⋯），
    // 注册进去只是菜单里多一行，看不见；header.actions 才是头部正常按钮区。
    var SLOT_NAME = "conversation.session.header.actions";
    // 不同 DSH 版本暴露的插槽名不一样：新版本用 header.actions，
    // 老版本没有这个槽时退回 views.actions（会出现在「更多视图」菜单里，虽然不显眼但能用）。
    var SLOT_FALLBACKS = ["conversation.session.header.actions", "conversation.session.header.views.actions"];

    function createRenderer(canvas, data, options = {}) {
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


    function layoutPositions(nodes, layout = 'sphere') {
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

    var defaultSettings = { hideButton: false, showGuideOnEmpty: true, graphTheme: "classic", graphLayout: "sphere", autoMemory: { enabled: false, maxPerTurn: 2, dailyCap: 40 }, showAutoMemoryCostHint: true };
    var actionStyle = { padding: "7px 12px", borderRadius: "8px", border: "1px solid var(--memory-border,#6999b8)", background: "var(--memory-button,#102236)", color: "var(--memory-text,#e2f4ff)", font: "inherit", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 };
    var closeStyle = Object.assign({}, actionStyle, { padding: "11px 20px", minHeight: "42px", fontWeight: 700, letterSpacing: "0.02em" });
        var fieldStyle = { boxSizing: "border-box", padding: "10px 12px", borderRadius: "8px", border: "1px solid #35536b", background: "#091422", color: "#e2f4ff", font: "inherit", minWidth: 0 };
    var kinds = ["知识", "印象", "对话", "事件", "日记"];
    var appearanceOptions = [
      { key: "graphTheme", label: "配色", choices: [["classic", "经典星空"], ["neon", "赛博霓虹"], ["paper", "铅绘素描"], ["mono", "极简单色"]] },
      { key: "graphLayout", label: "布局", choices: [["sphere", "球体"], ["galaxy", "星系"], ["brain", "大脑神经网络"]] },
    ];
    var appearanceStyles = {
      classic: {},
      neon: { "--memory-text": "#f4dfff", "--memory-muted": "#ba9aca", "--memory-accent": "#ff9de1", "--memory-border": "#704580", "--memory-panel": "#170d21ee", "--memory-button": "#271333", "--memory-shadow": "none" },
      paper: { "--memory-text": "#303030", "--memory-muted": "#72716d", "--memory-accent": "#404040", "--memory-border": "#b5b1a9", "--memory-panel": "#f7f5f0f2", "--memory-button": "#eeece6", "--memory-shadow": "none" },
      mono: { "--memory-text": "#eeeeee", "--memory-muted": "#aaaaaa", "--memory-accent": "#eeeeee", "--memory-border": "#666666", "--memory-panel": "#171717ee", "--memory-button": "#252525", "--memory-shadow": "none" },
    };

    function AppearanceControls(props) {
      return React.createElement("section", { "aria-label": "图谱外观", "data-memory-engine-appearance-options": props.location,
        style: { color: "var(--memory-text,#dbeaf8)", font: "14px/1.7 system-ui,sans-serif" } },
        appearanceOptions.map(function (group) {
          return React.createElement("fieldset", { key: group.key, disabled: props.busy, style: { border: 0, margin: "0 0 14px", padding: 0 } },
            React.createElement("legend", { style: { marginBottom: "8px", color: "var(--memory-muted,#9fb7ce)" } }, group.label),
            React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px 14px" } }, group.choices.map(function (choice) {
              return React.createElement("label", { key: choice[0], style: { display: "inline-flex", alignItems: "center", gap: "6px", cursor: props.busy ? "wait" : "pointer" } },
                React.createElement("input", { type: "radio", name: "memory-" + props.location + "-" + group.key, value: choice[0],
                  "data-memory-engine-appearance-choice": group.key + ":" + choice[0],
                  checked: props.settings[group.key] === choice[0], style: { margin: 0, accentColor: "var(--memory-accent,#a4e6ff)" },
                  onChange: function () { var changes = {}; changes[group.key] = choice[0]; props.onChange(changes); } }), choice[1]);
            })));
        }), React.createElement("button", { type: "button", disabled: props.busy, style: actionStyle,
          "data-memory-engine-appearance-reset": props.location,
          onClick: function () { props.onChange({ graphTheme: "classic", graphLayout: "sphere" }); } }, "恢复默认"));
    }

    function requestApi(url, options) {
      return fetch(url, Object.assign({ cache: "no-store" }, options)).then(function (response) {
        return response.json().then(function (result) {
          if (!response.ok || !result || result.ok !== true) throw new Error(result && result.error || "HTTP " + response.status);
          if (!result.data || typeof result.data !== "object") throw new Error("接口返回格式无效");
          return result.data;
        });
      });
    }

    function readApi(url, signal) { return requestApi(url, { signal: signal }); }

    function loadSettings() {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 5000);
      return Promise.resolve().then(function () {
        return readApi("/memory-engine/api/config", controller.signal);
      }).then(function (settings) {
        if (typeof settings.hideButton !== "boolean" || typeof settings.showGuideOnEmpty !== "boolean") throw new Error("按钮配置格式无效");
        return settings;
      }).finally(function () { clearTimeout(timer); });
    }

    function copyText(text) {
      function fallback() {
        var area = document.createElement("textarea");
        var active = document.activeElement;
        area.value = text;
        area.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(area);
        area.select();
        try {
          if (!document.execCommand("copy")) throw new Error("复制失败");
        } finally {
          area.remove();
          if (active && typeof active.focus === "function") active.focus();
        }
      }
      return Promise.resolve().then(function () {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        return fallback();
      }).catch(function () { return fallback(); });
    }

    function GuideCard(props) {
      var copiedState = React.useState("复制这段提示词");
      var copyLabel = copiedState[0];
      var setCopyLabel = copiedState[1];
      var card = React.useRef(null);
      React.useEffect(function () { if (card.current) card.current.focus(); }, []);
      function trapTab(event) {
        if (event.key !== "Tab" || !card.current) return;
        var buttons = Array.from(card.current.querySelectorAll("button"));
        var position = buttons.indexOf(document.activeElement);
        if (event.shiftKey && position <= 0) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && (position === -1 || position === buttons.length - 1)) { event.preventDefault(); buttons[0].focus(); }
      }
      var data = props.data;
      return React.createElement("div", {
        "data-memory-engine-guide-layer": "true",
        style: { position: "absolute", inset: 0, zIndex: 2, display: "grid", placeItems: "center", padding: "16px", background: "rgba(3,6,12,.7)" },
      }, React.createElement("section", {
        ref: card, role: "dialog", "aria-modal": "true", "aria-label": "使用指南", tabIndex: -1,
        "data-memory-engine-guide": "true", onKeyDown: trapTab,
        style: { boxSizing: "border-box", width: "min(620px,100%)", maxHeight: "calc(100vh - 32px)", overflow: "auto", padding: "24px", border: "1px solid #3976a0", borderRadius: "16px", background: "#07111f", color: "#dbeaf8", font: "14px/1.65 system-ui,sans-serif", boxShadow: "0 16px 80px #0008" },
      }, React.createElement("h2", { style: { margin: "0 0 16px", fontSize: "22px", color: "#b7e9ff" } }, "怎么用"),
      props.error ? React.createElement("div", { role: "alert" },
        React.createElement("p", null, "引导加载失败，请重试。"),
        React.createElement("button", { type: "button", onClick: props.onRetry, style: actionStyle }, "重试"))
        : !data ? React.createElement("p", { role: "status" }, "正在加载使用指南……")
        : React.createElement(React.Fragment, null,
          data.empty ? React.createElement("p", { style: { color: "#9fb7ce" } }, "还没有记忆，从下面任一步开始。") : null,
          data.steps.map(function (step, index) {
            return React.createElement("div", { key: index, style: { borderLeft: "3px solid #28577e", paddingLeft: "14px", marginBottom: "18px" } },
              React.createElement("h3", { style: { fontSize: "15px", color: "#9fd0f5", margin: "0 0 6px" } }, "第 " + (index + 1) + " 步  " + step.title),
              React.createElement("p", { style: { margin: "0 0 8px" } }, step.body),
              index === 0 ? React.createElement(React.Fragment, null,
                React.createElement("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "180px", overflow: "auto", margin: "8px 0", padding: "12px", background: "#030a13", borderRadius: "8px", font: "12px/1.6 ui-monospace,Consolas,monospace" } }, data.prompt),
                React.createElement("button", { type: "button", "data-memory-engine-copy": "true", style: actionStyle,
                  onClick: function () { copyText(data.prompt).then(function () { setCopyLabel("已复制 ✓"); }, function () { setCopyLabel("复制失败，请手动复制"); }); },
                }, copyLabel)) : null,
              index === 2 ? React.createElement("button", { type: "button", onClick: props.onRefresh, style: actionStyle }, "刷新图谱") : null);
          }),
          React.createElement("p", { style: { fontSize: "12px", color: "#9fb7ce", overflowWrap: "anywhere" } }, "数据目录：", data.dataDir)),
      React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: "16px" } },
        React.createElement("button", { type: "button", onClick: props.onClose, style: actionStyle }, "知道了"))));
    }

    function MemoryDetails(props) {
      var node = props.node;
      var text = typeof node.text === "string" ? node.text : "";
      if (node.isCore) text = Array.from(text).slice(0, 4000).join("");
      var defaultCopyLabel = node.isCore ? "复制全文" : "复制正文";
      var title = String(node.title || "").trim() || Array.from(text).slice(0, 20).join("");
      var date = new Date(node.ts);
      var day = Number.isFinite(date.getTime()) ? date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") : "未知";
      var heat = { 1: "热", 2: "温", 3: "冷" }[node.heat];
      var rows = [
        ["重要度", heat ? heat + "（" + node.heat + "）" : "未知"],
        ["留存", Number.isFinite(node.retention) ? node.retention.toFixed(2) : "—"],
        ["连接数", node.degree == null ? 0 : node.degree],
        ["时间", day],
      ];
      var emotion = Array.isArray(node.emotion) ? node.emotion.filter(function (item) { return item && item.tag; }).map(function (item) { return item.tag; }).join(" / ") : "";
      if (emotion) rows.push(["情绪", emotion]);
      var copiedState = React.useState(defaultCopyLabel);
      var copyLabel = copiedState[0];
      var setCopyLabel = copiedState[1];
      var timer = React.useRef(null);
      var copyVersion = React.useRef(0);
      var body = React.useRef(null);
      React.useEffect(function () {
        copyVersion.current++;
        clearTimeout(timer.current);
        timer.current = null;
        setCopyLabel(defaultCopyLabel);
        if (body.current) body.current.scrollTop = 0;
        return function () { copyVersion.current++; clearTimeout(timer.current); timer.current = null; };
      }, [node.id, text, defaultCopyLabel]);
      function copyBody() {
        var version = ++copyVersion.current;
        clearTimeout(timer.current);
        copyText(text).then(function () {
          if (version !== copyVersion.current) return;
          setCopyLabel("已复制 ✓");
          timer.current = setTimeout(function () {
            if (version === copyVersion.current) setCopyLabel(defaultCopyLabel);
            timer.current = null;
          }, 1800);
        }, function () {
          if (version === copyVersion.current) setCopyLabel("复制失败，请重试");
        });
      }
      return React.createElement("section", {
        role: "region", "aria-label": "记忆详情", "data-memory-engine-detail": "true", "data-memory-engine-node": node.id,
        style: { position: "absolute", top: "72px", right: "18px", zIndex: 1, width: "min(350px,calc(100% - 36px))", maxHeight: "calc(100% - 96px)", boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px", border: "1px solid #3976a0", borderRadius: "14px", background: "#07111fee", color: "#dbeaf8", font: "14px/1.6 system-ui,sans-serif", boxShadow: "0 0 40px #1763a033", backdropFilter: "blur(8px)", animation: "dsh-memory-detail-in 180ms ease-out" },
      }, React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexShrink: 0 } },
        React.createElement("span", { "data-memory-engine-detail-kind": "true", style: { color: "#a4e6ff", background: "#15344b", borderRadius: "6px", padding: "2px 8px", overflowWrap: "anywhere" } }, node.kind || "未分类"),
        React.createElement("button", { type: "button", "aria-label": "关闭记忆详情", onClick: props.onClose, style: Object.assign({ minWidth: "40px", minHeight: "40px", fontSize: "18px", lineHeight: 1, cursor: "pointer" }, { border: 0, padding: "2px 6px", background: "transparent", color: "#a4bad0", fontSize: "22px", cursor: "pointer" }) }, "×")),
      React.createElement("h2", { "data-memory-engine-detail-title": "true", style: { margin: "10px 0", fontSize: "18px", color: "#b7e9ff", overflowWrap: "anywhere", whiteSpace: "normal", maxHeight: "18vh", overflowY: "auto", flexShrink: 0 } }, title),
      node.isCore ? null : React.createElement("dl", { style: { display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: "5px 10px", margin: "0 0 12px", fontSize: "12px", color: "#9fb7ce", maxHeight: "25vh", overflowY: "auto", flexShrink: 0 } },
        rows.map(function (row) { return React.createElement(React.Fragment, { key: row[0] },
          React.createElement("dt", { style: { margin: 0 } }, row[0]),
          React.createElement("dd", { style: { margin: 0, overflowWrap: "anywhere" } }, row[1])); })),
      React.createElement("div", { ref: body, "data-memory-engine-detail-text": "true", style: { minHeight: 0, flex: "1 1 auto", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderTop: "1px solid #3976a055", borderBottom: "1px solid #3976a055", padding: "12px 0" } }, text),
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px", flexShrink: 0 } },
        node.isCore ? null : React.createElement("button", { type: "button", "data-memory-engine-highlight": "true", style: actionStyle, onClick: props.onHighlight }, "在图里高亮它"),
        React.createElement("button", { type: "button", "data-memory-engine-copy-body": "true", style: actionStyle, onClick: copyBody }, copyLabel)));
    }

    function MemoryCanvas(props) {
      var canvas = React.useRef(null);
      var appearance = React.useRef(null);
      appearance.current = { graphTheme: props.graphTheme || "classic", graphLayout: props.graphLayout || "sphere" };
      var dataState = React.useState(null);
      var data = dataState[0];
      var setData = dataState[1];
      var errorState = React.useState("");
      var error = errorState[0];
      var setError = errorState[1];
      var retryState = React.useState(0);
      var retry = retryState[0];
      var setRetry = retryState[1];
      React.useEffect(function () {
        var controller = new AbortController();
        var active = true;
        var renderer;
        setError("");
        readApi("/memory-engine/api/map", controller.signal).then(function (nextData) {
          if (!active) return;
          renderer = createRenderer(canvas.current, nextData, Object.assign({ frameInterval: 25, layoutNodes: layoutPositions }, appearance.current));
          props.rendererRef.current = renderer;
          renderer.onSelect(function (node) { props.selectionVersion.current++; props.onSelect(node); });
          renderer.start();
          setData(nextData);
        }).catch(function (failure) {
          if (!active) return;
          if (renderer) renderer.destroy();
          if (props.rendererRef.current === renderer) props.rendererRef.current = null;
          console.error("[dsh-memory-engine] Canvas 图谱加载失败：", failure);
          setError(failure.message);
        });
        return function () {
          active = false;
          controller.abort();
          if (renderer) renderer.destroy();
          if (props.rendererRef.current === renderer) props.rendererRef.current = null;
        };
      }, [retry, props.rendererRef, props.selectionVersion, props.onSelect]);
      React.useEffect(function () {
        if (!props.rendererRef.current) return;
        props.rendererRef.current.setTheme(appearance.current.graphTheme);
        props.rendererRef.current.setLayout(appearance.current.graphLayout);
      }, [props.graphTheme, props.graphLayout]);
      return React.createElement(React.Fragment, null,
        React.createElement("canvas", {
          ref: canvas, "data-memory-engine-canvas": "true", "aria-label": "记忆神经网络",
          style: { display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "grab" },
        }),
        React.createElement("div", {
          "data-memory-engine-summary": "true",
          style: { position: "absolute", top: "16px", left: "18px", pointerEvents: "none", color: "var(--memory-text,#d8e9f8)", font: "13px/1.65 system-ui,sans-serif", textShadow: "var(--memory-shadow,0 0 12px #3388bb88)" },
        }, React.createElement("strong", { style: { color: "var(--memory-accent,#a4e6ff)", fontSize: "16px" } }, "记忆神经网络"),
        React.createElement("div", null, data ? data.nodes.length + " 个神经元 · " + data.links.length + " 条突触" : "正在加载图谱……"),
        React.createElement("div", { style: { color: "var(--memory-muted,#7491a8)", fontSize: "12px" } }, "大小＝重要度和连接数 · 亮度＝留存")),
        data ? React.createElement("section", {
          "aria-label": "复习清单",
          style: { position: "absolute", bottom: "16px", left: "18px", width: "min(400px,calc(100% - 36px))", boxSizing: "border-box", maxHeight: "32%", overflow: "auto", padding: "15px", background: "var(--memory-panel,#07111fee)", border: "1px solid var(--memory-border,#3976a055)", borderRadius: "14px", boxShadow: "var(--memory-shadow,0 0 40px #1763a033)", backdropFilter: "blur(8px)", font: "12px/1.65 system-ui,sans-serif", color: "var(--memory-text,#b1c6d9)" },
        }, React.createElement("h2", { style: { fontSize: "14px", color: "var(--memory-accent,#ffdb82)", margin: "0 0 8px" } }, "复习清单 · 留存最低的记忆"),
        data.review.map(function (item, index) {
          return React.createElement("div", { key: item.id || index, style: { display: "flex", gap: "7px", alignItems: "center", margin: "5px 0" } },
            React.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, (index + 1) + ". [" + item.kind + "] " + item.title),
            React.createElement("span", { style: { width: "52px", height: "5px", borderRadius: "5px", background: "var(--memory-border,#335066)", overflow: "hidden" } },
              React.createElement("i", { style: { display: "block", height: "100%", background: "var(--memory-accent,#6bc9fa)", width: Math.min(100, Math.max(0, item.retention * 100)) + "%" } })));
        })) : null,
        React.createElement("div", { style: { position: "absolute", right: "18px", bottom: "18px", pointerEvents: "none", color: "var(--memory-muted,#7b99ad)", font: "13px system-ui,sans-serif" } }, "拖拽旋转 · 滚轮缩放 · 点光点看关联"),
        error ? React.createElement("div", { role: "alert", style: { position: "absolute", inset: "40% 20% auto", textAlign: "center", color: "#d8e9f8" } },
          React.createElement("p", null, "图谱加载失败：" + error),
          React.createElement("button", { type: "button", style: actionStyle, onClick: function () { setRetry(function (value) { return value + 1; }); } }, "重试")) : null);
    }

    function ConfirmationDialog(props) {
      var valueState = React.useState("");
      var value = valueState[0], setValue = valueState[1];
      var errorState = React.useState("");
      var error = errorState[0], setError = errorState[1];
      var form = React.useRef(null);
      React.useEffect(function () {
        var active = document.activeElement;
        var target = form.current && form.current.querySelector("input,button");
        if (target) target.focus();
        return function () { if (active && active.isConnected) active.focus(); };
      }, []);
      function onKey(event) {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          if (!props.busy) props.onClose();
        }
        if (event.key === "Tab" && form.current) {
          var controls = Array.from(form.current.querySelectorAll("input,button")).filter(function (control) { return !control.disabled; });
          if (!controls.length) { event.preventDefault(); return; }
          var index = controls.indexOf(document.activeElement);
          if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1].focus(); }
          else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
        }
      }
      return React.createElement("div", { "data-memory-engine-confirm": "true", onKeyDown: onKey,
        style: { position: "fixed", inset: 0, zIndex: 3, display: "grid", placeItems: "center", padding: "24px", background: "#03060ccc" } },
        React.createElement("form", { ref: form, role: "dialog", "aria-modal": "true", "aria-label": props.title,
          onSubmit: function (event) {
            event.preventDefault();
            if (props.busy) return;
            if (props.requireDelete && value !== "DELETE") { setError("请输入大写 DELETE，其他内容不会执行清空。"); return; }
            setError(""); props.onConfirm();
          },
          style: { width: "min(460px,100%)", padding: "24px", border: "1px solid #8b505c", borderRadius: "16px", background: "#101a29", color: "#e2f4ff", boxShadow: "0 16px 80px #0008" } },
          React.createElement("h2", { style: { margin: "0 0 12px", fontSize: "20px" } }, props.title),
          React.createElement("p", { style: { color: "#c2cedc" } }, props.message),
          props.requireDelete ? React.createElement("label", null, "输入 DELETE 确认",
            React.createElement("input", { "aria-label": "输入 DELETE 确认", autoComplete: "off", value: value, disabled: props.busy,
              onChange: function (event) { setValue(event.target.value); setError(""); }, style: Object.assign({}, fieldStyle, { display: "block", width: "100%", marginTop: "8px" }) })) : null,
          error || props.error ? React.createElement("p", { role: "alert", style: { color: "#ffb8b8" } }, error || props.error) : null,
          React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" } },
            React.createElement("button", { type: "button", disabled: props.busy, onClick: props.onClose, style: actionStyle }, "取消"),
            React.createElement("button", { type: "submit", disabled: props.busy, style: Object.assign({}, actionStyle, { borderColor: "#c86b7a", background: "#572a38" }) }, props.busy ? "正在处理…" : props.submitLabel))));
    }

    function MemoryRow(props) {
      var item = props.item;
      var expandedState = React.useState(false);
      var expanded = expandedState[0], setExpanded = expandedState[1];
      var detailState = React.useState(item);
      var detail = detailState[0], setDetail = detailState[1];
      var editState = React.useState(null);
      var edit = editState[0], setEdit = editState[1];
      var confirmState = React.useState(false);
      var confirming = confirmState[0], setConfirming = confirmState[1];
      var errorState = React.useState("");
      var error = errorState[0], setError = errorState[1];
      var loadingState = React.useState(false);
      var loading = loadingState[0], setLoading = loadingState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var mutation = React.useRef(null);
      React.useEffect(function () { return function () { if (mutation.current) mutation.current.abort(); }; }, []);
      React.useEffect(function () {
        if (!expanded) return;
        var controller = new AbortController();
        setLoading(true); setError("");
        readApi("/memory-engine/api/item/" + encodeURIComponent(item.id), controller.signal).then(function (result) {
          if (!controller.signal.aborted) setDetail(result);
        }).catch(function (failure) {
          if (!controller.signal.aborted) setError("读取详情失败：" + failure.message);
        }).finally(function () { if (!controller.signal.aborted) setLoading(false); });
        return function () { controller.abort(); };
      }, [expanded, item.id]);
      function mutate(method) {
        if (mutation.current) return;
        var controller = new AbortController();
        mutation.current = controller;
        setBusy(true); setError("");
        var options = { method: method, signal: controller.signal };
        if (method === "PUT") { options.headers = { "Content-Type": "application/json" }; options.body = JSON.stringify(edit); }
        requestApi("/memory-engine/api/item/" + encodeURIComponent(item.id), options).then(function () {
          if (controller.signal.aborted) return;
          setEdit(null); setExpanded(false); setConfirming(false); props.onChanged();
        }).catch(function (failure) {
          if (!controller.signal.aborted) setError((method === "PUT" ? "保存失败：" : "删除失败：") + failure.message);
        }).finally(function () {
          if (!controller.signal.aborted) { mutation.current = null; setBusy(false); }
        });
      }
      function change(field, value) { setEdit(function (previous) { var next = Object.assign({}, previous); next[field] = value; return next; }); }
      var choices = kinds.includes(detail.kind) ? kinds : [detail.kind].concat(kinds);
      return React.createElement("article", { "data-memory-engine-row": item.id,
        style: { marginBottom: "12px", border: "1px solid " + (expanded ? "#4c85a4" : "#263f54"), borderRadius: "12px", background: "#0b1624", overflowWrap: "anywhere" } },
        React.createElement("button", { type: "button", "data-memory-engine-expand": item.id, "aria-expanded": expanded, disabled: busy,
          onClick: function () { setExpanded(!expanded); setEdit(null); setError(""); },
          style: { width: "100%", display: "block", padding: "18px 20px", border: 0, borderRadius: "12px", background: "transparent", color: "inherit", textAlign: "left", font: "inherit", cursor: "pointer" } },
          React.createElement("span", { style: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" } },
            React.createElement("span", { style: { color: "#a4e6ff", background: "#15344b", padding: "2px 8px", borderRadius: "6px", flexShrink: 0 } }, item.kind),
            React.createElement("strong", { style: { flex: "1 1 180px", overflowWrap: "anywhere" } }, item.title),
            React.createElement("span", { style: { color: "#8db0c7", fontSize: "12px", whiteSpace: "nowrap" } }, "留存 " + item.retention.toFixed(2) + " · " + item.degree + " 个连接")),
          !expanded ? React.createElement("span", { style: { display: "block", color: "#9fb7ce", marginTop: "8px", overflowWrap: "anywhere" } }, item.preview) : null),
        expanded ? React.createElement("div", { style: { padding: "0 20px 18px" } },
          loading ? React.createElement("p", { role: "status" }, "正在读取全文…") : null,
          edit ? React.createElement("form", { "data-memory-engine-editor": item.id, onSubmit: function (event) { event.preventDefault(); mutate("PUT"); } },
            React.createElement("textarea", { "aria-label": "记忆正文", value: edit.text, disabled: busy,
              onChange: function (event) { change("text", event.target.value); },
              style: Object.assign({}, fieldStyle, { width: "100%", minHeight: "150px", maxHeight: "40vh", resize: "vertical", lineHeight: 1.7 }) }),
            React.createElement("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", margin: "12px 0" } },
              React.createElement("label", null, "分类 ", React.createElement("select", { "aria-label": "编辑分类", value: edit.kind, disabled: busy, style: fieldStyle,
                onChange: function (event) { change("kind", event.target.value); } }, choices.map(function (value) { return React.createElement("option", { key: value, value: value }, value); }))),
              React.createElement("label", null, "重要度 ", React.createElement("select", { "aria-label": "编辑重要度", value: edit.heat, disabled: busy, style: fieldStyle,
                onChange: function (event) { change("heat", Number(event.target.value)); } },
                [[1, "热（1）"], [2, "温（2）"], [3, "冷（3）"]].map(function (entry) { return React.createElement("option", { key: entry[0], value: entry[0] }, entry[1]); }))),
              React.createElement("label", null, "相关人 ", React.createElement("input", { "aria-label": "编辑相关人", value: edit.who, disabled: busy,
                onChange: function (event) { change("who", event.target.value); }, style: Object.assign({}, fieldStyle, { width: "140px" }) }))),
            React.createElement("div", { style: { display: "flex", gap: "8px" } },
              React.createElement("button", { type: "submit", disabled: busy, "data-memory-engine-save": "true", style: actionStyle }, busy ? "正在保存…" : "保存"),
              React.createElement("button", { type: "button", disabled: busy, "data-memory-engine-cancel-edit": "true", style: actionStyle,
                onClick: function () { setEdit(null); setExpanded(false); setError(""); } }, "取消")))
            : React.createElement(React.Fragment, null,
              React.createElement("div", { "data-memory-engine-full-text": "true", style: { whiteSpace: "pre-wrap", maxHeight: "40vh", overflowY: "auto", color: "#c2d3e3", marginBottom: "14px" } }, detail.text),
              React.createElement("div", { style: { display: "flex", gap: "8px" } },
                React.createElement("button", { type: "button", "data-memory-engine-edit": item.id, disabled: loading || busy, style: actionStyle,
                  onClick: function () { setError(""); setEdit({ text: detail.text, kind: detail.kind, heat: detail.heat, who: detail.who || "" }); } }, "编辑"),
                React.createElement("button", { type: "button", "data-memory-engine-delete": item.id, disabled: loading || busy,
                  onClick: function () { setError(""); setConfirming(true); }, style: Object.assign({}, actionStyle, { color: "#ffb8b8", borderColor: "#8b505c" }) }, "删除"))),
          error ? React.createElement("p", { role: "alert", style: { color: "#ffb8b8" } }, error) : null) : null,
        confirming ? React.createElement(ConfirmationDialog, { title: "删除这条记忆", message: "确定删除这条记忆？不可撤销。操作前会保留备份。", submitLabel: "确定删除",
          busy: busy, error: error, onClose: function () { setConfirming(false); }, onConfirm: function () { mutate("DELETE"); } }) : null);
    }

    function MemoryList(props) {
      var searchState = React.useState("");
      var search = searchState[0], setSearch = searchState[1];
      var queryState = React.useState("");
      var query = queryState[0], setQuery = queryState[1];
      var kindState = React.useState("");
      var kind = kindState[0], setKind = kindState[1];
      var sortState = React.useState("recent");
      var sort = sortState[0], setSort = sortState[1];
      var offsetState = React.useState(0);
      var offset = offsetState[0], setOffset = offsetState[1];
      var pageState = React.useState({ items: [], total: 0, allTotal: 0 });
      var page = pageState[0], setPage = pageState[1];
      var loadingState = React.useState(true);
      var loading = loadingState[0], setLoading = loadingState[1];
      var errorState = React.useState("");
      var error = errorState[0], setError = errorState[1];
      var retryState = React.useState(0);
      var retry = retryState[0], setRetry = retryState[1];
      function refresh() {
        setOffset(0); setRetry(function (value) { return value + 1; });
        if (props.onChanged) props.onChanged();
      }
      React.useEffect(function () {
        if (search === query) return;
        var timer = setTimeout(function () { setOffset(0); setQuery(search); }, 250);
        return function () { clearTimeout(timer); };
      }, [search]);
      React.useEffect(function () {
        var controller = new AbortController();
        var active = true;
        setLoading(true); setError("");
        var params = new URLSearchParams({ q: query, kind: kind, sort: sort, limit: "50", offset: String(offset) });
        readApi("/memory-engine/api/list?" + params, controller.signal).then(function (result) {
          if (!active) return;
          setPage(function (previous) { return Object.assign({}, result, { items: offset === 0 ? result.items : previous.items.concat(result.items) }); });
        }).catch(function (failure) {
          if (active) setError("加载记忆失败：" + failure.message);
        }).finally(function () { if (active) setLoading(false); });
        return function () { active = false; controller.abort(); };
      }, [query, kind, sort, offset, retry]);
      return React.createElement("section", {
        "aria-label": "记忆列表", "data-memory-engine-list": "true",
        style: { position: "absolute", inset: "76px 0 0", display: "flex", flexDirection: "column", color: "#dbeaf8", font: "14px/1.6 system-ui,sans-serif" },
      }, React.createElement("div", { style: { width: "min(980px,100%)", margin: "0 auto", padding: "0 24px 16px", display: "flex", gap: "12px", flexWrap: "wrap" } },
        React.createElement("input", { type: "search", "aria-label": "搜索记忆", placeholder: "搜索正文或标题…", value: search,
          onChange: function (event) { setSearch(event.target.value); }, style: Object.assign({}, fieldStyle, { flex: "1 1 220px" }) }),
        React.createElement("select", { "aria-label": "分类筛选", value: kind, style: fieldStyle,
          onChange: function (event) { setOffset(0); setKind(event.target.value); } },
          [""].concat(kinds).map(function (value) { return React.createElement("option", { key: value, value: value }, value || "全部分类"); })),
        React.createElement("select", { "aria-label": "记忆排序", value: sort, style: fieldStyle,
          onChange: function (event) { setOffset(0); setSort(event.target.value); } },
          [["recent", "最近"], ["oldest", "最老"], ["fading", "快忘了"], ["degree", "连接最多"]].map(function (entry) { return React.createElement("option", { key: entry[0], value: entry[0] }, entry[1]); }))),
      React.createElement("div", { "data-memory-engine-list-scroll": "true", style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 24px 24px" } },
        React.createElement("div", { style: { maxWidth: "932px", margin: "0 auto" }, "aria-busy": loading },
          error ? React.createElement("div", { role: "alert", style: { color: "#ffb8b8", padding: "16px" } }, error,
            React.createElement("button", { type: "button", style: actionStyle, onClick: function () { setRetry(function (value) { return value + 1; }); } }, "重试")) : null,
          page.items.map(function (item) {
            return React.createElement(MemoryRow, { key: item.id, item: item, onChanged: refresh });
          }),
          !loading && !error && !page.items.length ? React.createElement("p", { role: "status", style: { padding: "24px", textAlign: "center", color: "#9fb7ce" } }, page.allTotal ? "没有匹配的记忆，试试其他关键词或分类。" : "还没有记忆，可以点右上角 ? 查看导入方法。") : null)),
          React.createElement("div", { "data-memory-engine-list-total": "true", style: { padding: "14px", textAlign: "center", color: "#9fb7ce", flexShrink: 0, borderTop: "1px solid #263f54" } },
            "共 " + page.total + " 条 · 已显示 " + page.items.length + " 条",
            loading ? React.createElement("span", { role: "status" }, " · 正在加载…") : null,
            page.items.length < page.total ? React.createElement("button", { type: "button", "data-memory-engine-more": "true", disabled: loading || search !== query || !!error,
              onClick: function () { setOffset(page.items.length); }, style: Object.assign({}, actionStyle, { marginLeft: "12px", opacity: loading ? 0.5 : 1 }) }, "加载更多") : null));
    }

    function AutoMemoryToggle(props) {
      var enabled = props.settings.autoMemory && props.settings.autoMemory.enabled === true;
      var maximum = props.settings.autoMemory && props.settings.autoMemory.maxPerTurn || 2;
      return React.createElement("button", {
        type: "button", role: "switch", "aria-checked": enabled, "aria-label": "自动记忆",
        "data-memory-engine-auto-memory": props.location, disabled: props.busy, onClick: props.onToggle,
        title: enabled ? "当前：开（每轮对话后会抽 0~" + maximum + " 条记忆）" : "当前：关（不会自动调用模型抽取记忆）",
        style: Object.assign({}, actionStyle, { color: enabled ? "#e2f4ff" : "#8195aa", borderColor: enabled ? "#64bca0" : "#35536b", opacity: props.busy ? 0.6 : 1 }),
      }, React.createElement("span", { "aria-hidden": "true", style: { color: enabled ? "#89f0bb" : "#8195aa", textShadow: enabled ? "0 0 8px #56d890" : "none" } }, enabled ? "●" : "○"), " 自动记忆");
    }

    function MemorySettings(props) {
      var statsState = React.useState(null);
      var stats = statsState[0], setStats = statsState[1];
      var errorState = React.useState("");
      var error = errorState[0], setError = errorState[1];
      var noticeState = React.useState("");
      var notice = noticeState[0], setNotice = noticeState[1];
      var retryState = React.useState(0);
      var retry = retryState[0], setRetry = retryState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var confirmState = React.useState(false);
      var confirming = confirmState[0], setConfirming = confirmState[1];
      var mutation = React.useRef(null);
      var download = React.useRef(null);
      var timer = React.useRef(null);
      var active = React.useRef(true);
      React.useEffect(function () {
        active.current = true;
        return function () {
          active.current = false;
          if (mutation.current) mutation.current.abort();
          clearTimeout(timer.current);
          if (download.current) URL.revokeObjectURL(download.current);
        };
      }, []);
      React.useEffect(function () {
        var controller = new AbortController();
        setError("");
        readApi("/memory-engine/api/stats", controller.signal).then(function (result) {
          if (!controller.signal.aborted) setStats(result);
        }).catch(function (failure) {
          if (!controller.signal.aborted) setError("读取设置失败：" + failure.message);
        });
        return function () { controller.abort(); };
      }, [retry]);
      function manage(clearing) {
        if (mutation.current) return;
        var controller = new AbortController();
        mutation.current = controller; setBusy(true); setError(""); setNotice("");
        var options = { signal: controller.signal };
        if (clearing) { options.method = "POST"; options.headers = { "Content-Type": "application/json" }; options.body = JSON.stringify({ confirm: "DELETE" }); }
        requestApi("/memory-engine/api/" + (clearing ? "clear" : "export"), options).then(function (result) {
          if (controller.signal.aborted) return;
          if (clearing) { props.onCleared(); return; }
          if (download.current) URL.revokeObjectURL(download.current);
          clearTimeout(timer.current);
          download.current = URL.createObjectURL(new Blob([JSON.stringify({ ok: true, data: result }, null, 2) + "\n"], { type: "application/json;charset=utf-8" }));
          var anchor = document.createElement("a");
          var date = new Date();
          anchor.href = download.current;
          anchor.download = "memories-" + date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + ".json";
          document.body.appendChild(anchor); anchor.click(); anchor.remove();
          timer.current = setTimeout(function () { URL.revokeObjectURL(download.current); download.current = null; timer.current = null; }, 1000);
          setNotice("已开始下载，共 " + result.total + " 条记忆。");
        }).catch(function (failure) {
          if (!controller.signal.aborted) setError((clearing ? "清空失败：" : "导出失败：") + failure.message);
        }).finally(function () {
          if (!controller.signal.aborted) { mutation.current = null; setBusy(false); }
        });
      }
      var directory = stats ? stats.file.replace(/[\\/][^\\/]*$/, "") : "";
      return React.createElement("section", { "aria-label": "记忆设置", "data-memory-engine-settings": "true",
        style: { position: "absolute", inset: "76px 0 0", overflowY: "auto", padding: "0 24px 32px", color: "#dbeaf8", font: "14px/1.7 system-ui,sans-serif" } },
        React.createElement("div", { style: { maxWidth: "900px", margin: "0 auto", padding: "28px", border: "1px solid #263f54", borderRadius: "14px", background: "#0b1624" } },
          props.settings.autoImport?.hint === "no-session-matched" ? React.createElement("div", { role: "alert", "data-memory-engine-import-hint": "true",
            style: { marginBottom: "20px", padding: "12px 16px", border: "1px solid #9c7243", borderRadius: "8px", background: "#2a2118", color: "#ffe1ac" } },
            React.createElement("span", null, props.settings.autoImport.message), " ",
            React.createElement("button", { type: "button", "data-memory-engine-use-auto-import": "true", disabled: props.configBusy,
              onClick: props.onUseAutoImport, style: actionStyle }, "改用宽松模式")) : null,
          React.createElement("section", { style: { marginBottom: "24px", padding: "20px", border: "1px solid var(--memory-border,#263f54)", borderRadius: "10px", background: "var(--memory-panel,#0b1624)" } },
            React.createElement("h2", { style: { margin: "0 0 12px", fontSize: "20px", color: "var(--memory-accent,#b7e9ff)" } }, "图谱外观"),
            React.createElement(AppearanceControls, { settings: props.settings, busy: props.configBusy, onChange: props.onAppearanceChange, location: "settings" })),
          React.createElement("section", { style: { marginBottom: "24px", paddingBottom: "20px", borderBottom: "1px solid #263f54" } },
            React.createElement("h2", { style: { margin: "0 0 12px", fontSize: "20px", color: "#b7e9ff" } }, "自动记忆"),
            React.createElement(AutoMemoryToggle, { settings: props.settings, busy: props.configBusy, onToggle: props.onToggle, location: "settings" }),
            React.createElement("p", { style: { color: "#9fb7ce", marginBottom: 0 } }, "默认关闭。开启后每轮对话会额外调用一次模型，抽取值得记住的事实；通常最多 2 条，可随时关闭。大约每轮几分钱，实际费用以模型及计费方案为准。自动导入是独立设置，不受此开关控制。")),
          React.createElement("h2", { style: { margin: "0 0 20px", fontSize: "20px", color: "#b7e9ff" } }, "数据管理"),
          stats ? React.createElement(React.Fragment, null,
            React.createElement("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "12px" } },
              React.createElement("span", { style: { flex: "1 1 360px", overflowWrap: "anywhere" } }, "数据目录：", React.createElement("code", { "data-memory-engine-directory": "true" }, directory)),
              React.createElement("button", { type: "button", "data-memory-engine-copy-path": "true", style: actionStyle,
                onClick: function () {
                  setNotice(""); setError("");
                  copyText(directory).then(function () { if (active.current) setNotice("数据目录已复制 ✓"); }, function () { if (active.current) setError("复制路径失败，请手动复制上方目录。"); });
                } }, "复制路径")),
            React.createElement("p", { "data-memory-engine-storage-stats": "true", style: { color: "#9fb7ce", margin: "16px 0 24px" } }, "记忆条数：" + stats.total + "　 文件大小：" + (stats.bytes / 1024).toFixed(1) + " KB"))
            : React.createElement("p", { role: "status" }, error ? "暂时无法读取数据目录。" : "正在读取数据目录…"),
          error ? React.createElement("div", { role: "alert", style: { color: "#ffb8b8", marginBottom: "16px" } }, error,
            !stats ? React.createElement("button", { type: "button", style: actionStyle, onClick: function () { setRetry(function (value) { return value + 1; }); } }, "重试") : null) : null,
          notice ? React.createElement("p", { role: "status", style: { color: "#9fe5c4" } }, notice) : null,
          React.createElement("div", { style: { padding: "24px 0", borderTop: "1px solid #263f54", borderBottom: "1px solid #263f54" } },
            React.createElement("button", { type: "button", "data-memory-engine-export": "true", disabled: busy, onClick: function () { manage(false); }, style: actionStyle }, "导出全部记忆（JSON）"),
            React.createElement("p", { style: { margin: "10px 0 0", fontSize: "12px", color: "#9fb7ce" } }, "下载包含全部原始条目的 JSON 文件。导入已有记忆请使用 memory_import 工具。")),
          React.createElement("h3", { style: { color: "#ffb8b8", marginTop: "24px" } }, "危险操作"),
          React.createElement("p", { style: { color: "#9fb7ce" } }, "清空前会自动备份，最近五份操作备份保留在数据目录。"),
          React.createElement("button", { type: "button", "data-memory-engine-clear": "true", disabled: busy,
            onClick: function () { setError(""); setNotice(""); setConfirming(true); }, style: Object.assign({}, actionStyle, { color: "#ffb8b8", borderColor: "#8b505c", background: "#341c28" }) }, "清空全部记忆")),
        confirming ? React.createElement(ConfirmationDialog, { title: "清空全部记忆", message: "这会删除当前记忆库的全部条目。请确认已导出需要保留的内容。", requireDelete: true,
          submitLabel: "确认清空", busy: busy, error: error, onClose: function () { setConfirming(false); }, onConfirm: function () { manage(true); } }) : null);
    }

    function MemoryButton(props) {
      var state = React.useState(false);
      var open = state[0];
      var setOpen = state[1];
      var settingsState = React.useState(Object.assign({}, defaultSettings, props.settings));
      var settings = settingsState[0], setSettings = settingsState[1];
      var configBusyState = React.useState(false);
      var configBusy = configBusyState[0], setConfigBusy = configBusyState[1];
      var configErrorState = React.useState("");
      var configError = configErrorState[0], setConfigError = configErrorState[1];
      var costHintState = React.useState(false);
      var costHint = costHintState[0], setCostHint = costHintState[1];
      var configRequest = React.useRef(null);
      var guideState = React.useState(false);
      var guideOpen = guideState[0];
      var setGuideOpen = guideState[1];
      var dataState = React.useState(null);
      var guideData = dataState[0];
      var setGuideData = dataState[1];
      var errorState = React.useState("");
      var guideError = errorState[0];
      var setGuideError = errorState[1];
      var retryState = React.useState(0);
      var retry = retryState[0];
      var setRetry = retryState[1];
      var selectedState = React.useState(null);
      var selected = selectedState[0];
      var setSelected = selectedState[1];
      var tabState = React.useState("map");
      var tab = tabState[0], setTab = tabState[1];
      var renderer = React.useRef(null);
      var selectionVersion = React.useRef(0);
      var pointer = React.useRef(null);
      var help = React.useRef(null);
      var dismissed = React.useRef(false);
      var appearanceState = React.useState(false);
      var appearanceOpen = appearanceState[0], setAppearanceOpen = appearanceState[1];
      var appearancePanel = React.useRef(null);
      var appearanceButton = React.useRef(null);
      React.useEffect(function () {
        if (!open || !appearanceOpen) return undefined;
        var first = appearancePanel.current && appearancePanel.current.querySelector("input:checked");
        if (first) first.focus();
        function outside(event) {
          if (appearancePanel.current && !appearancePanel.current.contains(event.target)
              && appearanceButton.current && !appearanceButton.current.contains(event.target)) setAppearanceOpen(false);
        }
        window.addEventListener("pointerdown", outside);
        return function () { window.removeEventListener("pointerdown", outside); };
      }, [open, appearanceOpen]);
      React.useEffect(function () {
        return function () { if (configRequest.current) configRequest.current.abort(); };
      }, []);
      React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        var controller = new AbortController();
        setConfigBusy(true);
        readApi("/memory-engine/api/config", controller.signal).then(function (data) {
          if (!controller.signal.aborted) { setSettings(Object.assign({}, defaultSettings, data)); setConfigError(""); }
        }).catch(function (failure) {
          if (!controller.signal.aborted) setConfigError("读取配置失败：" + failure.message);
        }).finally(function () { if (!controller.signal.aborted) setConfigBusy(false); });
        return function () { controller.abort(); };
      }, [open]);
      function saveAppearance(changes) {
        if (configBusy || configRequest.current) return;
        if (Object.keys(changes).every(function (key) { return settings[key] === changes[key]; })) return;
        var previous = settings;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 10000);
        configRequest.current = controller;
        setConfigBusy(true); setConfigError("");
        setSettings(Object.assign({}, settings, changes));
        requestApi("/memory-engine/api/config", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes), signal: controller.signal }).then(function (data) {
            if (!controller.signal.aborted) setSettings(Object.assign({}, defaultSettings, data));
          }).catch(function (failure) {
            setSettings(previous);
            setConfigError("外观保存失败，已恢复原设置：" + (controller.signal.aborted ? "请求超时或已中断，请刷新确认状态" : failure.message));
          }).finally(function () { clearTimeout(timer); configRequest.current = null; setConfigBusy(false); });
      }
      function saveAutoMemory(enabled) {
        if (configRequest.current) return;
        var previous = settings;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 10000);
        configRequest.current = controller;
        setConfigBusy(true); setConfigError(""); setCostHint(false);
        setSettings(Object.assign({}, settings, { autoMemory: Object.assign({}, settings.autoMemory, { enabled: enabled }) }));
        requestApi("/memory-engine/api/config", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoMemory: { enabled: enabled } }), signal: controller.signal }).then(function (data) {
            setSettings(Object.assign({}, defaultSettings, data));
          }).catch(function (failure) {
            setSettings(previous);
            setConfigError("保存失败：" + (controller.signal.aborted ? "请求超时或已中断，请刷新确认状态" : failure.message));
          }).finally(function () { clearTimeout(timer); configRequest.current = null; setConfigBusy(false); });
      }
      function toggleAutoMemory() {
        if (configBusy) return;
        var enabled = settings.autoMemory && settings.autoMemory.enabled === true;
        setConfigError("");
        if (!enabled && settings.showAutoMemoryCostHint !== false) setCostHint(true);
        else saveAutoMemory(!enabled);
      }
      function useAutoImport() {
        if (configBusy || configRequest.current) return;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 10000);
        configRequest.current = controller;
        setConfigBusy(true); setConfigError("");
        requestApi("/memory-engine/api/config", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoImport: { sessionFilter: { mode: "auto" } } }), signal: controller.signal }).then(function (data) {
            setSettings(Object.assign({}, defaultSettings, data));
          }).catch(function (failure) {
            setConfigError("保存失败：" + (controller.signal.aborted ? "请求超时或已中断，请刷新确认状态" : failure.message));
          }).finally(function () { clearTimeout(timer); configRequest.current = null; setConfigBusy(false); });
      }
      function closeGuide() {
        dismissed.current = true;
        setGuideOpen(false);
        if (help.current) help.current.focus();
      }
      function openMap() {
        dismissed.current = false;
        setGuideOpen(false);
        setSelected(null);
        setAppearanceOpen(false);
        setTab("map");
        setOpen(Date.now());
      }
      function closeMap() { setSelected(null); setCostHint(false); setAppearanceOpen(false); setOpen(false); }
      function startPointer(event) {
        if (event.target.closest("[data-memory-engine-detail], [data-memory-engine-guide-layer], [data-memory-engine-controls], [data-memory-engine-appearance-panel]")) { pointer.current = null; return; }
        pointer.current = { x: event.clientX, y: event.clientY, moved: 0, version: selectionVersion.current };
      }
      function movePointer(event) {
        if (!pointer.current) return;
        pointer.current.moved += Math.abs(event.clientX - pointer.current.x) + Math.abs(event.clientY - pointer.current.y);
        pointer.current.x = event.clientX; pointer.current.y = event.clientY;
      }
      function dismissOutside() {
        var gesture = pointer.current;
        pointer.current = null;
        if (gesture && gesture.moved < 6 && gesture.version === selectionVersion.current) setSelected(null);
      }
      React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        var controller = new AbortController();
        var active = true;
        setGuideData(null);
        setGuideError("");
        readApi("/memory-engine/api/onboard", controller.signal).then(function (data) {
          if (typeof data.empty !== "boolean" || typeof data.prompt !== "string" || typeof data.dataDir !== "string"
              || !Array.isArray(data.steps) || data.steps.length !== 3
              || data.steps.some(function (step) { return !step || typeof step.title !== "string" || typeof step.body !== "string"; })) throw new Error("引导数据格式无效");
          if (!active) return;
          setGuideData(data);
          if (data.empty && settings.showGuideOnEmpty && !dismissed.current) setGuideOpen(true);
        }).catch(function (error) {
          if (active) setGuideError(error.message);
        });
        return function () { active = false; controller.abort(); };
      }, [open, retry, settings.showGuideOnEmpty]);
      React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        function onEscape() {
          if (guideOpen) closeGuide();
          else if (appearanceOpen) { setAppearanceOpen(false); if (appearanceButton.current) appearanceButton.current.focus(); }
          else if (selected) setSelected(null);
          else closeMap();
        }
        function onKey(event) {
          if (event.key !== "Escape") return;
          if (event.target && event.target.closest && event.target.closest("[data-memory-engine-confirm]")) return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) onEscape();
        }
        window.addEventListener("keydown", onKey, true);
        return function () { window.removeEventListener("keydown", onKey, true); };
      }, [open, guideOpen, selected, appearanceOpen]);
      var button = React.createElement("button", {
        type: "button",
        onClick: openMap,
        "data-memory-engine-map": "true",
        "aria-label": "打开记忆图谱",
        title: "记忆图谱",
        style: { display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 9px", borderRadius: "8px", border: "1px solid rgba(130,160,190,.4)", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" },
      }, React.createElement("span", { "aria-hidden": "true" }, "🧠"), "记忆图谱");
      if (!open) return button;
      var overlay = React.createElement("div", {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "记忆图谱",
        "data-memory-engine-theme": settings.graphTheme, "data-memory-engine-layout": settings.graphLayout,
        onPointerDownCapture: startPointer, onPointerMoveCapture: movePointer,
        onPointerCancelCapture: function () { pointer.current = null; }, onClick: dismissOutside,
        style: Object.assign({ position: "fixed", inset: 0, maxWidth: "none", maxHeight: "none", zIndex: 9999, background: "#03060c", colorScheme: settings.graphTheme === "paper" ? "light" : "dark" }, appearanceStyles[settings.graphTheme]),
      }, tab === "map" ? React.createElement(MemoryCanvas, { key: open, rendererRef: renderer, selectionVersion: selectionVersion, onSelect: setSelected,
        graphTheme: settings.graphTheme, graphLayout: settings.graphLayout })
        : tab === "memories" ? React.createElement(MemoryList, { onChanged: function () { setRetry(function (value) { return value + 1; }); } })
          : React.createElement(MemorySettings, { settings: settings, configBusy: configBusy, onToggle: toggleAutoMemory, onUseAutoImport: useAutoImport,
            onAppearanceChange: saveAppearance,
            onCleared: function () { openMap(); setGuideOpen(true); } }),
      tab !== "map" ? React.createElement("strong", { style: { position: "absolute", top: "23px", left: "24px", font: "600 18px system-ui,sans-serif", color: "#b7e9ff" } }, "记忆管理") : null,
      React.createElement("style", null, "@keyframes dsh-memory-detail-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}@media(prefers-reduced-motion:reduce){[data-memory-engine-detail]{animation:none!important}}"),
      React.createElement("div", {
        "data-memory-engine-controls": "true",
        style: { position: "absolute", top: "16px", right: "18px", zIndex: 1, display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: "8px", rowGap: "8px", maxWidth: "calc(100% - 36px)" },
      }, React.createElement("div", { role: "tablist", "aria-label": "记忆面板", style: { display: "flex", gap: "4px", marginRight: "8px" } },
        [["map", "图谱"], ["memories", "记忆"], ["settings", "设置"]].map(function (entry) {
          return React.createElement("button", { key: entry[0], type: "button", role: "tab", "aria-selected": tab === entry[0], "data-memory-engine-tab": entry[0],
            onClick: function () { setSelected(null); setAppearanceOpen(false); setTab(entry[0]); },
            style: Object.assign({}, actionStyle, { background: tab === entry[0] ? "var(--memory-button,#204762)" : "var(--memory-panel,#091422)", borderColor: tab === entry[0] ? "var(--memory-accent,#8acded)" : "var(--memory-border,#35536b)" }) }, entry[1]);
        })), React.createElement("button", { ref: appearanceButton, type: "button", "data-memory-engine-appearance": "true", "aria-expanded": appearanceOpen,
          "aria-haspopup": "dialog", onClick: function () { setAppearanceOpen(!appearanceOpen); }, style: actionStyle }, "外观"),
        React.createElement(AutoMemoryToggle, { settings: settings, busy: configBusy, onToggle: toggleAutoMemory, location: "header" }), React.createElement("button", {
        ref: help, type: "button", onClick: function () { setGuideOpen(true); },
        "aria-label": "查看使用指南", title: "使用指南", style: actionStyle,
      }, "?"), React.createElement("button", {
        type: "button",
        onClick: closeMap,
        "aria-label": "关闭记忆图谱",
        title: "关闭（Esc）",
        style: Object.assign({}, closeStyle, { marginLeft: "4px" }),
      }, "关闭 ×")), appearanceOpen ? React.createElement("section", { ref: appearancePanel, role: "dialog", "aria-label": "外观", "data-memory-engine-appearance-panel": "true",
        style: { position: "absolute", top: "62px", right: "18px", zIndex: 3, boxSizing: "border-box", width: "min(380px,calc(100vw - 36px))", maxHeight: "calc(100vh - 90px)", overflowY: "auto",
          padding: "18px", border: "1px solid var(--memory-border,#3976a0)", borderRadius: "12px", background: "var(--memory-panel,#07111f)", boxShadow: "0 12px 35px #0004" } },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", color: "var(--memory-text,#dbeaf8)" } },
          React.createElement("strong", null, "外观"), React.createElement("button", { type: "button", "aria-label": "关闭外观", style: closeStyle,
            onClick: function () { setAppearanceOpen(false); if (appearanceButton.current) appearanceButton.current.focus(); } }, "×")),
        React.createElement(AppearanceControls, { settings: settings, busy: configBusy, onChange: saveAppearance, location: "header" })) : null,
      configError ? React.createElement("p", { role: "alert", "data-memory-engine-config-error": "true",
        style: { position: "absolute", top: "50px", left: "18px", zIndex: 4, color: "#ff9c9c", background: "#271923", padding: "8px 12px", borderRadius: "8px", maxWidth: "min(600px,90vw)" } }, configError) : null,
      costHint ? React.createElement(ConfirmationDialog, { title: "开启自动记忆", message: "自动记忆会在每轮对话后调用一次模型，大约每轮几分钱。可以随时在这里关掉。实际费用以模型及计费方案为准。",
        submitLabel: "知道了，开启", busy: configBusy, onClose: function () { setCostHint(false); }, onConfirm: function () { saveAutoMemory(true); } }) : null,
      selected ? React.createElement(MemoryDetails, {
        node: selected, onClose: function () { setSelected(null); },
        onHighlight: function () { if (renderer.current) renderer.current.fireNeuron(selected.id); },
      }) : null, guideOpen ? React.createElement(GuideCard, {
        data: guideData, error: guideError, onClose: closeGuide, onRefresh: openMap,
        onRetry: function () { setRetry(function (value) { return value + 1; }); },
      }) : null);
      return React.createElement(React.Fragment, null, button, ReactDOM.createPortal(overlay, document.body));
    }

    function registerOn(slots, name, settings) {
      var disposable = null;
      slots.inject(name, function () {
        try {
          disposable = slots.register({
            name: name,
            id: "memory-engine-map",
            order: 50,
            label: function () { return "记忆图谱"; },
          }, function ConfiguredMemoryButton() { return React.createElement(MemoryButton, { settings: settings }); });
        } catch (error) {
          try { console.error("[dsh-memory-engine] 注册到 " + name + " 失败：", error); } catch (ignored) {}
        }
        return disposable;
      });
      return disposable;
    }

    function apply(ctx) {
      try {
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") {
          try { console.warn("[dsh-memory-engine] 宿主没有 slots 服务，跳过图谱按钮（记忆工具不受影响）"); } catch (ignored) {}
          return;
        }
        // 只注册第一个能用的插槽：优先 header.actions，老宿主没有就退到 views.actions
        var target = ctx.slots && typeof ctx.slots.has === "function" && !ctx.slots.has(SLOT_FALLBACKS[0])
          ? SLOT_FALLBACKS[1]
          : SLOT_NAME;
        function mount(settings) {
          if (!settings.hideButton) registerOn(ctx.slots, target, settings);
        }
        function fallback(error) {
          try { console.warn("[dsh-memory-engine] 配置读取失败，按默认显示按钮：", error); } catch (ignored) {}
          mount(defaultSettings);
        }
        try { loadSettings().then(mount, fallback); }
        catch (error) { fallback(error); }
      } catch (error) {
        try { console.error("[dsh-memory-engine] 插槽注册失败：", error); } catch (ignored) {}
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
