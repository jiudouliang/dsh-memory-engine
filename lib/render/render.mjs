import fs from 'node:fs';
import { stripRendererExport } from '../../scripts/lib/strip-export.mjs';
import { layoutPositions } from './layout.mjs';

const rendererSource = stripRendererExport(fs.readFileSync(new URL('./canvas.js', import.meta.url), 'utf8'));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function renderHtml(data, title = '记忆神经网络') {
  const embedded = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%}
  body{overflow:hidden;background:#03060c;color:#d8e9f8;font:13px/1.65 system-ui,"Microsoft YaHei",sans-serif}
  canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}canvas:active{cursor:grabbing}
  .hud{position:fixed;top:16px;left:18px;pointer-events:none;text-shadow:0 0 12px #3388bb88}
  .hud strong{color:#a4e6ff;font-size:16px}.sub{color:#7491a8;font-size:12px}
  .panel,.review{position:fixed;background:#07111fee;border:1px solid #3976a055;border-radius:14px;box-shadow:0 0 40px #1763a033;padding:15px;backdrop-filter:blur(8px)}
  .panel{display:none;top:16px;right:18px;width:min(350px,calc(100vw - 36px));max-height:78vh;overflow:auto}
  .panel h2{font-size:16px;color:#b7e9ff;margin:5px 0}.panel .meta{color:#8ba8c2;margin:7px 0}.panel .text{white-space:pre-wrap;overflow-wrap:anywhere}
  .panel.core .text{max-height:52vh;overflow:auto}.copy{margin-top:12px;padding:7px 12px;border:1px solid #6999b8;border-radius:8px;background:#102236;color:#e2f4ff;font:inherit;cursor:pointer}
  .close{float:right;border:0;background:transparent;color:#a4bad0;font-size:18px;cursor:pointer}
  .review{bottom:16px;left:18px;width:min(400px,calc(100vw - 36px));max-height:32vh;overflow:auto;font-size:12px}
  .review h2{font-size:14px;color:#ffdb82;margin:0 0 8px}.row{display:flex;gap:7px;align-items:center;margin:5px 0;color:#b1c6d9}
  .row .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar{width:52px;height:5px;border-radius:5px;background:#335066;overflow:hidden}.bar i{display:block;height:100%;background:#6bc9fa}
  .tip{position:fixed;right:18px;bottom:18px;color:#7b99ad;pointer-events:none}
  body[data-graph-theme=neon]{--text:#f4dfff;--muted:#ba9aca;--accent:#ff9de1;--border:#704580;--panel:#170d21ee;--button:#271333}
  body[data-graph-theme=paper]{color-scheme:light;--text:#303030;--muted:#72716d;--accent:#404040;--border:#b5b1a9;--panel:#f7f5f0f2;--button:#eeece6}
  body[data-graph-theme=mono]{--text:#eee;--muted:#aaa;--accent:#eee;--border:#666;--panel:#171717ee;--button:#252525}
  body:not([data-graph-theme=classic]){color:var(--text)}
  body:not([data-graph-theme=classic]) .hud{color:var(--text);text-shadow:none}
  body:not([data-graph-theme=classic]) .hud strong,body:not([data-graph-theme=classic]) h2{color:var(--accent)}
  body:not([data-graph-theme=classic]) .sub,body:not([data-graph-theme=classic]) .tip,body:not([data-graph-theme=classic]) .meta{color:var(--muted)}
  body:not([data-graph-theme=classic]) .panel,body:not([data-graph-theme=classic]) .review{background:var(--panel);border-color:var(--border);box-shadow:none}
  body:not([data-graph-theme=classic]) .row,body:not([data-graph-theme=classic]) .close{color:var(--text)}
  body:not([data-graph-theme=classic]) .copy{color:var(--text);background:var(--button);border-color:var(--border)}
  body:not([data-graph-theme=classic]) .bar{background:var(--border)}body:not([data-graph-theme=classic]) .bar i{background:var(--accent)}
  @media(max-width:700px){.hud{top:8px;left:10px}.hud .sub,.tip{display:none}.review{left:10px;bottom:10px;max-height:24vh}.panel{top:8px;right:8px;max-height:55vh}}
</style>
</head>
<body data-graph-theme="${escapeHtml(data.graphTheme || 'classic')}">
<canvas id="map" aria-label="记忆神经网络"></canvas>
<div class="hud"><strong>${safeTitle}</strong><div><span id="total"></span> 个神经元 · <span id="linkCount"></span> 条突触</div><div class="sub">大小＝重要度和连接数 · 亮度＝留存</div></div>
<section class="panel" id="panel"><button class="close" id="close" aria-label="关闭">×</button><div id="kind"></div><h2 id="title"></h2><div class="meta" id="meta"></div><div class="text" id="body"></div><button class="copy" id="copy" hidden>复制全文</button></section>
<section class="review"><h2>复习清单 · 留存最低的记忆</h2><div id="reviewList"></div></section>
<div class="tip">拖拽旋转 · 滚轮缩放 · 点击光点看关联</div>
<script>
const DATA = ${embedded};
const canvas = document.getElementById('map');
${rendererSource}
${layoutPositions.toString()}
const renderer = createRenderer(canvas, { ...DATA, nodes: DATA.stars }, { layoutNodes: layoutPositions });
document.getElementById('close').onclick=() => { document.getElementById('panel').style.display='none'; };
document.getElementById('total').textContent=DATA.stats.total;
document.getElementById('linkCount').textContent=DATA.links.length;
for (const [index,item] of DATA.review.entries()) {
  const row=document.createElement('div'); row.className='row';
  const name=document.createElement('span'); name.className='name'; name.textContent=(index+1)+'. ['+item.kind+'] '+item.title;
  const bar=document.createElement('span'); bar.className='bar';
  const fill=document.createElement('i'); fill.style.width=Math.min(100,Math.max(0,item.retention*100))+'%'; bar.append(fill);
  row.append(name,bar); document.getElementById('reviewList').append(row);
}
renderer.onSelect(node => {
  document.getElementById('panel').style.display='block';
  document.getElementById('panel').className=node.isCore?'panel core':'panel';
  document.getElementById('kind').textContent=node.kind;
  document.getElementById('title').textContent=node.title;
  document.getElementById('meta').hidden=!!node.isCore;
  document.getElementById('meta').textContent='重要度 '+node.heat+' · 留存 '+node.retention.toFixed(2)+' · 连接数 '+node.degree+(node.emotion.length?' · '+node.emotion.map(item=>item.tag).join('/'):'');
  const text=node.isCore?Array.from(node.text).slice(0,4000).join(''):node.text;
  document.getElementById('body').textContent=text;
  document.getElementById('body').scrollTop=0;
  const copy=document.getElementById('copy');
  copy.hidden=!node.isCore; copy.textContent='复制全文';
  const copyBody=async () => {
    function fallback() {
      const area=document.createElement('textarea');
      area.value=text; area.style.cssText='position:fixed;left:-9999px'; document.body.append(area); area.select();
      try { if (!document.execCommand('copy')) throw new Error('复制失败'); } finally { area.remove(); }
    }
    try {
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); } catch { fallback(); }
      } else fallback();
      if (copy.onclick===copyBody) copy.textContent='已复制 ✓';
    } catch { if (copy.onclick===copyBody) copy.textContent='复制失败，请重试'; }
  };
  copy.onclick=copyBody;
});
renderer.start();
</script>
</body>
</html>`;
}
