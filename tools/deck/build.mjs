// Writes the demo-day deck to web/public/slidepdf (served at /slidepdf), with its image and a PDF beside it.
//   node tools/deck/build.mjs          -> web/public/slidepdf/index.html + img/
//   node tools/deck/build.mjs --pdf    -> + web/public/slidepdf/syncly-deck.pdf (rendered with the system Chrome)
// Slides live in tools/deck/slides/<id>.html, one 1920×1080 <section> each, in ORDER.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ORDER = ['title', 'pain', 'flow', 'proof', 'unblock', 'plan'];
const dir = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.resolve(dir, '../../web/public/slidepdf');
fs.mkdirSync(path.join(outDir, 'img'), { recursive: true });
for (const f of fs.readdirSync(path.join(dir, 'img'))) fs.copyFileSync(path.join(dir, 'img', f), path.join(outDir, 'img', f));

// Speaker notes stay out of the public page.
const slides = ORDER.map((id) => fs.readFileSync(path.join(dir, 'slides', `${id}.html`), 'utf8').replace(/<aside>[\s\S]*?<\/aside>\s*/, ''));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><base href="/slidepdf/"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Syncly · Deck</title>
<meta name="description" content="Syncly: AI agents do the work, you pay only if you like it. Live on Arc mainnet.">
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@1&display=swap">
<style>
*{margin:0;box-sizing:border-box}
html,body{height:100%;background:#0C1A12;overflow:hidden}
.stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
.deck{position:relative;width:1920px;height:1080px;flex:none;transform-origin:center center}
section{position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden;display:none;border-radius:6px}
section.on{display:flex}
section div{display:flex;flex-direction:column;min-width:0}
h1{line-height:1.1}h2{line-height:1.15}h3{line-height:1.2}p,li{line-height:1.4}
img{display:block}
.hud{position:fixed;left:0;right:0;bottom:16px;display:flex;justify-content:center;gap:10px;font:500 14px 'Geist Mono',monospace;color:#C9D6CC;z-index:2}
.hud button,.hud a{all:unset;cursor:pointer;background:#1D3527;border:1px solid #3A5444;border-radius:999px;padding:8px 16px;color:#F1EEE6}
.hud a.pdf{background:#B6E37E;color:#13271C;border-color:#B6E37E}
.hud span{padding:8px 6px}
.print .stage{position:static;display:block}.print .deck{transform:none!important;width:auto;height:auto}
.print section{position:relative;display:flex;border-radius:0;break-after:page}.print .hud{display:none}
.print,.print body{overflow:visible;height:auto}
@page{size:1920px 1080px;margin:0}
</style></head>
<body>
<div class="stage"><div class="deck">
${slides.join('\n')}
</div></div>
<nav class="hud"><button id="prev" aria-label="Previous slide">←</button><span id="count"></span><button id="next" aria-label="Next slide">→</button><a class="pdf" href="syncly-deck.pdf" download>Download PDF</a></nav>
<script>
(() => {
  const s = [...document.querySelectorAll('section')], deck = document.querySelector('.deck'), count = document.getElementById('count');
  if (location.search.includes('print')) { document.documentElement.classList.add('print'); return; }
  let k = Math.max(0, Math.min(s.length - 1, (parseInt(location.hash.slice(1)) || 1) - 1));
  const fit = () => { const sc = Math.min(innerWidth / 1920, (innerHeight - 64) / 1080); deck.style.transform = 'scale(' + sc + ') translateY(-' + (32 / sc) + 'px)'; };
  const go = (n) => { k = Math.max(0, Math.min(s.length - 1, n)); s.forEach((e, i) => e.classList.toggle('on', i === k)); count.textContent = (k + 1) + ' / ' + s.length; history.replaceState(null, '', location.pathname + '#' + (k + 1)); };
  document.getElementById('prev').onclick = () => go(k - 1);
  document.getElementById('next').onclick = () => go(k + 1);
  addEventListener('keydown', (e) => { if (['ArrowRight', 'PageDown', ' '].includes(e.key)) go(k + 1); if (['ArrowLeft', 'PageUp'].includes(e.key)) go(k - 1); });
  let x0 = null; addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }); addEventListener('touchend', (e) => { if (x0 === null) return; const d = e.changedTouches[0].clientX - x0; if (Math.abs(d) > 40) go(k + (d < 0 ? 1 : -1)); x0 = null; });
  addEventListener('resize', fit); fit(); go(k);
})();
</script>
</body></html>
`;
const out = path.join(outDir, 'index.html');
fs.writeFileSync(out, html);
console.log('wrote', out);

if (!process.argv.includes('--pdf')) process.exit(0);
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Users/mac/Documents/Hacks/zecathon/stowaway-video/node_modules/puppeteer-core');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
// The page sets <base href="/slidepdf/"> for the site; the print copy drops it so file:// paths resolve.
const printFile = path.join(outDir, '_print.html');
fs.writeFileSync(printFile, html.replace('<base href="/slidepdf/">', ''));
await page.goto('file://' + printFile + '?print', { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const issues = await page.evaluate(() => {
  const res = [];
  document.querySelectorAll('section').forEach((s, k) => {
    const sr = s.getBoundingClientRect();
    s.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > sr.right + 1 || r.bottom > sr.bottom + 1)) res.push(`slide ${k + 1}: <${el.tagName.toLowerCase()}> runs off the slide`);
      if (r.width && el.tagName !== 'DIV' && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).display !== 'inline') res.push(`slide ${k + 1}: <${el.tagName.toLowerCase()}> "${el.textContent.slice(0, 30)}" overflows its box`);
    });
  });
  return res;
});
console.log(issues.length ? issues.join('\n') : 'no overflow found');
const pdf = path.join(outDir, 'syncly-deck.pdf');
await page.pdf({ path: pdf, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
console.log('wrote', pdf, (fs.statSync(pdf).size / 1024 / 1024).toFixed(2), 'MB');
const shots = process.env.DECK_SHOTS;
if (shots) {
  fs.mkdirSync(shots, { recursive: true });
  const els = await page.$$('section');
  for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: path.join(shots, `slide-${i + 1}.png`) });
}
fs.rmSync(printFile);
await browser.close();
process.exit(0);
