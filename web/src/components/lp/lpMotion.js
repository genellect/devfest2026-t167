/*
 * Topos の LP の動き（スクロールに合わせた演出）。lpMarkup.ts の HTML に対して動く。
 * initLp(root) は後片付けの関数を返す（イベントと IntersectionObserver、requestAnimationFrame を止める）。
 * ?static を付けると、すべての演出を最後の状態で表示する（デザインの書き出し用）。
 * prefers-reduced-motion が reduce のときも、最後の状態で表示する。
 */
export function initLp(root) {
const $id = (id) => root.querySelector("#" + id);
const offs = [];
const on = (type, fn, opt) => { addEventListener(type, fn, opt); offs.push(() => removeEventListener(type, fn, opt)); };
const cleanup = () => { offs.forEach((f) => f()); };

const STATIC=/static/.test(location.search);
if(STATIC){root.classList.add('static');root.querySelectorAll('.faq details').forEach(d=>d.open=true);}
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile=()=>innerWidth<=734;

/* waveform */
root.querySelectorAll('[data-wave]').forEach((svg,k)=>{
  const N=96,W=1440,H=340,bw=6,A=[76,141,246],B=[155,92,255],C=[255,106,213];
  const L=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));let s='';
  for(let i=0;i<N;i++){const t=i/(N-1);let h=(0.35+0.65*Math.abs(Math.sin(i*0.37+.3)*Math.cos(i*0.11+.6)))*H*.95*(0.55+0.45*Math.sin(Math.PI*t));h=Math.max(h,12);
    const c=t<.5?L(A,B,t*2):L(B,C,(t-.5)*2);const x=i*(W/N)+(W/N-bw)/2;
    s+=`<rect x="${x.toFixed(1)}" y="${((H-h)/2).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="3" fill="rgb(${c})" style="animation-delay:${(-(i*0.13+k*0.4)%2.4).toFixed(2)}s"/>`;}
  svg.innerHTML=s;
});

/* recreated app screens */
const pc=`<div class="top"><div><div class="t1">クラス全体 ＞ グループ1</div><div class="t2">グループ1の話し合い</div></div><div><span class="demo">デモデータ</span><span class="av">T</span></div></div>
<div class="body"><div class="side"><div class="on">ホーム</div><div>設定</div></div><div class="main">
<span class="back">クラス全体に戻る</span>
<div class="amber"><div class="k">結論の認識のちがい</div><div class="h">同じ結論の理解が、2通りに分かれました。</div><div class="two"><div>さまざまな職場を経験して視野を広げること<br><span>1人の入力</span></div><div>将来の仕事に役立つ経験を増やすこと<br><span>1人の入力</span></div></div></div>
<div class="card"><div class="h">議論の流れ（20分）</div><div class="flow"><div style="flex:6;background:#d3e3fd">意見の出し合い<br>6分</div><div style="flex:7;background:#d3e3fd">理由の深掘り<br>7分</div><div style="flex:3;background:#fff0d1;color:#5f3b00">テーマから脱線<br>3分</div><div style="flex:4;background:#d3e3fd">まとめ<br>4分</div></div><div style="font-size:12px;color:#444746;margin-top:12px">脱線から別の見方が出ました。脱線の良し悪しはグループで確認してください。</div></div>
<div class="row2"><div class="card"><span class="tag" style="background:#c2e7ff;color:#001d35">よかった点</span><div style="font-size:12px;color:#444746;margin-top:10px">6分ごろの発言</div><div style="font-size:17px;margin-top:4px">別の見方を出して、話題を広げました。</div></div><div class="card"><span class="tag" style="background:#fff0d1;color:#5f3b00">見直す点</span><div style="font-size:12px;color:#444746;margin-top:10px">12分ごろの場面</div><div style="font-size:17px;margin-top:4px">この場面で、事前の意見を話す機会がありました。</div></div></div>
</div></div>`;
const hd=(n,step)=>`<div class="hd"><div class="s">あなたはグループ1</div><div class="t"><span style="font-size:22px">←</span><b>大学生のうちに経験すべきバイトは？</b><span class="ic">あ</span></div><div class="steps">${[0,1,2,3].map(i=>`<i class="${i<n?'on':''}" style="${i<n-1?'background:#747775':''}"></i>`).join('')}</div><div class="sn">${step}</div></div>`;
const M={
rec:hd(2,'ステップ 2/4：議論')+`<div class="cd" style="text-align:center;padding:24px 16px"><div style="font-size:18px">グループ議論</div><div style="width:160px;height:160px;border-radius:50%;background:#ffdad6;margin:18px auto;display:flex;flex-direction:column;align-items:center;justify-content:center"><div style="width:14px;height:14px;border-radius:50%;background:#b3261e;margin-bottom:8px"></div><div style="font-size:30px">12:40</div><div style="font-size:12px;color:#b3261e">録音中</div></div><div style="display:flex;justify-content:center;gap:4px;height:40px;align-items:center">${Array.from({length:24},(_,i)=>`<i style="display:block;width:4px;border-radius:2px;background:#0b57d0;height:${8+Math.abs(Math.sin(i*.8))*30}px"></i>`).join('')}</div><div style="margin-top:18px;border:1px solid #747775;border-radius:20px;padding:10px;color:#0b57d0;font-size:14px">一時停止</div></div><div class="cd"><div style="font-size:16px">結論が出たら</div><div style="font-size:13px;color:#444746;margin-top:4px">1人が押すと、全員が結論の入力に進みます。</div><div style="margin-top:12px;border:1px solid #747775;border-radius:20px;padding:10px;text-align:center;color:#0b57d0;font-size:14px">議論を終えて結論を書く</div></div>`,
result:hd(4,'ステップ 4/4：結果')+`<div class="h2">議論の分析</div><div style="font-size:12px;color:#444746;margin:0 16px">AIによる推定を含みます</div><div class="cd"><div style="display:flex;justify-content:space-between"><span style="font-size:14px">あなたの理解</span><span style="font-size:11px;background:#f0f4f9;border-radius:6px;padding:2px 8px">あなたの入力</span></div><div style="font-size:15px;margin-top:10px">将来の仕事に役立つ経験を増やすこと</div></div><div class="am"><div style="font-size:12px;color:#5f3b00">グループの理解の分かれ方</div><div style="font-size:16px;font-weight:700;margin-top:6px">2通りに分かれました。</div><div style="font-size:13px;line-height:1.7;margin-top:8px">・さまざまな職場を経験して視野を広げること（1人）<br>・将来の仕事に役立つ経験を増やすこと（1人）</div><div style="font-size:12px;color:#444746;margin-top:8px">同じ理解だった人：50%（デモデータ）</div></div><div class="cd"><div style="font-size:14px">議論のテーマ</div><div style="font-size:16px;margin-top:6px">大学生のうちに経験すべきバイトは？</div></div>`,
flow:hd(4,'ステップ 4/4：結果')+`<div class="h2">グループの議論</div><div class="cd"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:15px">議論の流れとあなたの発言率</span><span style="font-size:11px;background:#f0f4f9;border-radius:6px;padding:2px 8px">Geminiによる推定</span></div><div style="font-size:13px;margin-top:8px">12〜14分ごろ、テーマから脱線する前後で、発言の割合が下がりました。</div><svg viewBox="0 0 320 130" style="width:100%;margin-top:10px"><rect x="180" y="0" width="18" height="120" fill="#fff0d1"/><line x1="0" y1="34" x2="320" y2="34" stroke="#747775" stroke-dasharray="4 4"/><polyline points="0,72 25,58 70,47 115,42 150,47 170,50 190,100 210,110 235,85 265,78" fill="none" stroke="#0b57d0" stroke-width="2.5"/><line x1="0" y1="120" x2="320" y2="120" stroke="#c4c7c5"/></svg><div style="display:flex;gap:4px;margin-top:8px;font-size:11px;text-align:center"><div style="flex:6;background:#d3e3fd;border-radius:6px;padding:6px 0">出し合い<br>6分</div><div style="flex:7;background:#d3e3fd;border-radius:6px;padding:6px 0">深掘り<br>7分</div><div style="flex:3;background:#fff0d1;border-radius:6px;padding:6px 0">脱線<br>3分</div><div style="flex:4;background:#d3e3fd;border-radius:6px;padding:6px 0">まとめ<br>4分</div></div><div style="display:flex;gap:8px;margin-top:10px">${[['全体','32%'],['最も高い','10分 48%'],['低下','12〜14分']].map(a=>`<div style="flex:1;background:#f0f4f9;border-radius:10px;padding:8px"><div style="font-size:10px;color:#444746">${a[0]}</div><div style="font-size:14px">${a[1]}</div></div>`).join('')}</div></div><div class="cd"><span style="font-size:11px;background:#fff0d1;color:#5f3b00;border-radius:6px;padding:2px 8px">見直す点</span><div style="font-size:12px;color:#444746;margin-top:8px">12分ごろの場面</div><div style="font-size:15px;margin-top:4px">この場面で、事前の意見を話す機会がありました。</div></div>`,
refl:hd(4,'ステップ 4/4：結果')+`<div class="cd" style="border:2px solid #0b57d0;margin-top:16px"><div style="font-size:18px">あなたの振り返り</div><div style="font-size:12px;color:#444746">ここから入力します。本人のみ保存されます。</div><div style="background:#f0f4f9;border-radius:12px;padding:12px;margin-top:12px"><div style="font-size:12px;color:#444746">今日の目標</div><div style="font-size:15px;margin-top:2px">根拠をつけて意見を話す</div><div style="font-size:12px;color:#444746;margin-top:12px">目標の達成度</div><div style="display:flex;gap:6px;margin-top:6px;font-size:13px;text-align:center"><div style="flex:1;border:1px solid #747775;border-radius:8px;padding:8px 0">できた</div><div style="flex:1;border:2px solid #0b57d0;background:#c2e7ff;border-radius:8px;padding:8px 0">✓ 少しできた</div><div style="flex:1;border:1px solid #747775;border-radius:8px;padding:8px 0">まだ</div></div></div><div style="background:#f0f4f9;border-radius:12px;padding:12px;margin-top:10px"><div style="font-size:12px;color:#444746">見直す点の問いに答える</div><div style="background:#fff0d1;border-radius:8px;padding:8px;font-size:12px;margin-top:6px;color:#5f3b00">問い：このとき意見を求められていたら、何と答えますか。</div><div style="border:1px solid #747775;border-radius:8px;padding:10px;font-size:13px;margin-top:8px;background:#fff">アルバイトで学んだことを、事前の意見として話したい</div><div style="font-size:12px;color:#444746;margin-top:10px">次の議論で実践する目標</div><div style="border:1px solid #747775;border-radius:8px;padding:10px;font-size:14px;margin-top:6px;background:#fff">自分の意見の前に、1つ質問する</div></div><div style="background:#0b57d0;color:#fff;border-radius:20px;text-align:center;padding:11px;font-size:14px;margin-top:14px">振り返りを保存</div></div>`
};
root.querySelectorAll('[data-app="pc"]').forEach(e=>e.innerHTML=pc);
root.querySelectorAll('[data-m]').forEach(e=>e.innerHTML=M[e.dataset.m]);
const stage=$id('stage'),sw=$id('sw');
const fitStage=()=>{const h=sw.clientHeight,w=innerWidth;const mob=mobile();const dh=mob?400:560,dw=mob?390:1320;const k=Math.max(.42,Math.min(1,h/dh,w/dw));stage.style.transform=`scale(${k})`};fitStage();on('resize',fitStage);
const fitM=()=>root.querySelectorAll('.m').forEach(m=>{const w=m.parentElement.clientWidth;if(w)m.style.transform=`scale(${w/390})`});fitM();on('resize',fitM);

/* statement chars */
const chars=[];root.querySelectorAll('[data-chars] > span').forEach(sp=>{const t=sp.textContent;sp.textContent='';for(const ch of t){const c=document.createElement('span');c.className='c';c.textContent=ch;sp.appendChild(c);chars.push(c);}});

/* reveal */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.2});
root.querySelectorAll('.rv').forEach(e=>io.observe(e));

/* counter */
const num=root.querySelector('[data-count]'),digit=num.querySelector('.d');let counted=false,raf=0;
const runCount=()=>{if(counted)return;counted=true;num.classList.remove('pop');const t0=performance.now(),D=1200;const step=t=>{const p=Math.min(1,(t-t0)/D);const e=1-Math.pow(1-p,1.6);digit.textContent=Math.min(12,Math.floor(12*e+0.0001));if(p<1){raf=requestAnimationFrame(step)}else{digit.textContent=12;void num.offsetWidth;num.classList.add('pop')}};raf=requestAnimationFrame(step)};
const resetCount=()=>{if(!counted)return;cancelAnimationFrame(raf);counted=false;digit.textContent=0;num.classList.remove('pop')};

const LA=[...root.querySelectorAll('.split path.la')],LB=[...root.querySelectorAll('.split path.lb')];
const LN=[...LA,...LB].map(p=>{const l=p.getTotalLength();p.style.strokeDasharray=l;return l});
const setLines=d=>[...LA,...LB].forEach((p,i)=>p.style.strokeDashoffset=LN[i]*(1-d));
const ra=root.querySelector('.ra'),rb=root.querySelector('.rb'),cap=root.querySelector('.split .cap');
const chart=root.querySelector('.chart'),csvg=chart.querySelector('svg');
const laptop=$id('laptop'),hphone=$id('hphone');
const screens=[...root.querySelectorAll('.story [data-m]')],stps=[...root.querySelectorAll('.story .stp')];
const prog=el=>{const r=el.getBoundingClientRect();return Math.min(1,Math.max(0,-r.top/(r.height-innerHeight)))};
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));

const lostEl=$id('lost'),lcap=lostEl.querySelector('.cap'),field=$id('field');
// scatter anonymous notes (seeded, so layout is stable)
(()=>{let sd=7;const rnd=()=>(sd=(sd*9301+49297)%233280)/233280;const N=mobile()?16:30;const frag=document.createDocumentFragment();
  for(let i=0;i<N;i++){let x,y,ok=0;for(let t=0;t<30&&!ok;t++){x=4+rnd()*92;y=4+rnd()*92;ok=!( (x>14&&x<88&&y>8&&y<42&&rnd()<.6) )}
    const n=document.createElement('div');n.className='nt';n.dataset.x=x.toFixed(1);n.dataset.y=y.toFixed(1);n.dataset.d=(.3+rnd()*.7).toFixed(2);n.innerHTML='<i></i><i></i>';frag.appendChild(n)}
  field.prepend(frag)})();
const notes=[...field.children],tgt=$id('lostc');
const easeIO=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
function setLost(p){const W=field.clientWidth,H=field.clientHeight;const k=easeIO(clamp((p-0.3)/0.32));
  notes.forEach(n=>{const d=+n.dataset.d,w=n.offsetWidth,h=n.offsetHeight;const mb=mobile()&&n.dataset.mx;let x=+(mb?n.dataset.mx:n.dataset.x)/100*W,y=+(mb?n.dataset.my:n.dataset.y)/100*H;let sc=1-d*.45,op=n.classList.contains('nt')?.75-d*.5:1-d*.4;
    y+=(1-d)*-60*p;y=Math.max(y,h*sc/2);
    if(n===tgt){x=x+(W/2-x)*k;y=y+(H/2-y)*k;sc=sc+(1.15-sc)*k;op=op+(1-op)*k;n.style.zIndex=50}
    else{op*=1-.82*k;sc*=1-.12*k;n.style.zIndex=Math.round((1-d)*40)}
    n.style.transform=`translate(${(x-w/2).toFixed(1)}px,${(y-h/2).toFixed(1)}px) scale(${sc.toFixed(3)})`;n.style.opacity=op.toFixed(3);
    if(n.classList.contains('rd'))n.classList.toggle('said',p>0.14);});
  tgt.classList.toggle('lo',k>0.96);lcap.style.opacity=clamp((p-0.66)/0.12);}
const roomsEl=$id('rooms'),grid8=$id('grid8'),rc1=roomsEl.querySelector('.c1'),rc2=roomsEl.querySelector('.c2');
function setRooms(p){const r1=grid8.children[0];const ox=r1.offsetLeft+r1.offsetWidth/2,oy=r1.offsetTop+r1.offsetHeight/2;grid8.style.transformOrigin=`${ox}px ${oy}px`;
  const z=easeIO(clamp((p-0.12)/0.45));const S=mobile()?2:2.3;const s=S-(S-1)*z;const tx=(grid8.offsetWidth/2-ox)*(1-z),ty=(r1.offsetHeight*S/2-oy)*(1-z);grid8.style.transform=`translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
  [...grid8.children].forEach((r,i)=>{if(i)r.style.opacity=(.25+.75*z).toFixed(2)});
  rc1.style.opacity=(1-clamp((p-0.2)/0.12)).toFixed(2);rc2.style.opacity=clamp((p-0.5)/0.1).toFixed(2);roomsEl.classList.toggle('on',p>0.66);}
on('resize',()=>{setLost(STATIC||reduce?1:prog(lostEl))});
function setFinal(){setLost(1);setRooms(1);chars.forEach(c=>c.classList.add('on'));setLines(1);[ra,rb,cap].forEach(e=>{e.style.opacity=1;e.style.transform='none'});csvg.style.clipPath='none';chart.classList.add('on');digit.textContent=12;}
if(!(STATIC||reduce))digit.textContent=0;
if(STATIC||reduce){setFinal();stps.forEach(s=>s.classList.add('on'));if(STATIC)return cleanup;}

function frame(){
  const y=scrollY,vh=innerHeight;
  // hero parallax: laptop zooms toward viewer, phone rises faster
  if(!reduce){const p=clamp(y/700);laptop.style.transform=`translateY(${-p*120}px) scale(${1+p*0.12})`;hphone.style.transform=`translateY(${-p*220}px)`;}
  // statement char highlight
  if(!reduce){const p=prog($id('statement'));const n=Math.floor(clamp(p*1.25)*chars.length);chars.forEach((c,i)=>c.classList.toggle('on',i<n));}
  // lost opinions
  if(!reduce){setLost(prog(lostEl));setRooms(prog(roomsEl));}
  // split lines
  if(!reduce){const p=prog($id('split'));const d=clamp((p-0.15)/0.35);setLines(d);
    const oa=clamp((p-0.4)/0.15),ob=clamp((p-0.5)/0.15),oc=clamp((p-0.65)/0.15);
    ra.style.opacity=oa;ra.style.transform=`translateY(${(1-oa)*30}px)`;rb.style.opacity=ob;rb.style.transform=`translateY(${(1-ob)*30}px)`;cap.style.opacity=oc;}
  // moment
  const mo=$id('moment').getBoundingClientRect();
  if(mo.top<vh*0.45)runCount(); else if(mo.top>vh)resetCount();
  if(!reduce){const cr=chart.getBoundingClientRect();const p=clamp((vh*0.95-cr.top)/(vh*0.35));csvg.style.clipPath=`inset(0 ${(100-p*100).toFixed(1)}% 0 0)`;chart.classList.toggle('on',p>0.97);}
  // story steps
  let active=0;const th=mobile()?vh*0.8:vh*0.55;stps.forEach((s,i)=>{const r=s.getBoundingClientRect();if(r.top<th)active=i;});
  stps.forEach((s,i)=>s.classList.toggle('on',i===active));screens.forEach((s,i)=>s.style.opacity=i===active?1:0);
}
let ticking=false;on('scroll',()=>{if(!ticking){requestAnimationFrame(()=>{frame();ticking=false});ticking=true}},{passive:true});
on('resize',frame);frame();

/* carousel buttons */
const track=$id('track');
root.querySelectorAll('.hl-btn').forEach(b=>b.addEventListener('click',()=>track.scrollBy({left:(+b.dataset.dir)*Math.min(584,innerWidth*0.85),behavior:reduce?'auto':'smooth'})));

offs.push(() => io.disconnect(), () => cancelAnimationFrame(raf));
return cleanup;
}
