import { createRequire } from 'module';
const require = createRequire(import.meta.url); // playwright: локально или глобально (NODE_PATH)
const { chromium } = require('playwright');
import { spawn } from 'child_process';
import fs from 'fs';
const dir = process.cwd();
const tl = JSON.parse(fs.readFileSync(process.env.TL || 'timeline.json','utf8'));
const mode = process.argv[2] || 'shots';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1080,height:1920}, deviceScaleFactor:1 });
page.on('pageerror', e=>console.error('PAGEERR', e.message));
await page.goto('file://'+dir+'/demo.html');
await page.evaluate(()=>document.fonts.ready);
const meta = JSON.parse(fs.readFileSync('shots/meta.json','utf8')).meta;
await page.evaluate(([tl, meta]) => window.init(tl, meta), [tl, meta]);
fs.writeFileSync(process.env.EVENTS || 'events.json', JSON.stringify(await page.evaluate(() => window.events())));
if (mode==='shots') {
  const ts = process.argv.slice(3).map(Number);
  fs.mkdirSync('frames',{recursive:true});
  for (const t of ts) { await page.evaluate(t=>window.seek(t), t); await page.screenshot({path:`frames/t${t.toFixed(2)}.jpg`, type:'jpeg', quality:80}); }
} else {
  // video [from to out.mp4] — диапазон кадров, чтобы рендерить в несколько процессов
  const fps=30, N=Math.round(tl.total*fps);
  const from=+(process.argv[3]??0), to=Math.min(N, +(process.argv[4]??N)), out=process.argv[5]||'video.mp4';
  const ff = spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(fps),'-c:v','mjpeg','-i','-','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p',out],{stdio:['pipe','inherit','inherit']});
  for (let i=from;i<to;i++){
    await page.evaluate(t=>window.seek(t), i/fps);
    const buf = await page.screenshot({type:'jpeg', quality:95});
    if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));
    if((i-from)%90===0) console.log(out,'frame',i,'/',to);
  }
  ff.stdin.end(); await new Promise(r=>ff.on('close',r));
}
await browser.close();
