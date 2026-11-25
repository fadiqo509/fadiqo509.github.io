/* Shahd precision game surfaces. No client-authoritative game state. */
(()=>{'use strict';
const colors=['#ff9659','#63c9c0','#7fa7ff','#ddadff'];
const names={ludo:'شيش',jackaroo:'جاكارو',pool:'بلياردو'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const path=[];
for(let y=13;y>=9;y--)path.push([6,y]);for(let x=5;x>=0;x--)path.push([x,8]);path.push([0,7],[0,6]);for(let x=1;x<=5;x++)path.push([x,6]);for(let y=5;y>=0;y--)path.push([6,y]);path.push([7,0],[8,0]);for(let y=1;y<=5;y++)path.push([8,y]);for(let x=9;x<=14;x++)path.push([x,6]);path.push([14,7],[14,8]);for(let x=13;x>=9;x--)path.push([x,8]);for(let y=9;y<=14;y++)path.push([8,y]);path.push([7,14],[6,14]);
let current=null,send=null,pending=false,selectedCard='',selectedChoice=0,power=0,angle=0,placement={x:230,y:250},lastRev=-1,errorMessage='',animationRev=-1,animating=false,poolPointer=null,cardPointer=null;
const defs=`<defs><radialGradient id="arena-wood"><stop stop-color="#283849"/><stop offset="1" stop-color="#0c1527"/></radialGradient><radialGradient id="arena-ball" cx=".3" cy=".25"><stop stop-color="#fff" stop-opacity=".75"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".36"/></radialGradient><filter id="arena-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-opacity=".65"/></filter></defs>`;
const circle=(x,y,r,fill,stroke='#ffffff35',extra='')=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
function coord(t,seat,p,token){
 if(t.game==='ludo'){
  if(p<0){const homes=[[2,11],[2,2],[11,2],[11,11]];return [25+(homes[seat][0]+token%2*2)*30,25+(homes[seat][1]+Math.floor(token/2)*2)*30];}
  if(p<52){const c=path[(p+seat*13)%52];return [25+c[0]*30,25+c[1]*30];}
  const k=Math.min(5,p-52);return seat===0?[235,415-k*30]:seat===1?[55+k*30,235]:seat===2?[235,55+k*30]:[415-k*30,235];
 }
 if(p<0){const homes=[[135,105],[365,105],[365,365],[105,365]];return [homes[seat][0]+(token%2-.5)*29,homes[seat][1]+(Math.floor(token/2)-.5)*29];}
 if(p>=64){const a=seat*Math.PI/2-Math.PI/2,r=155-(p-64)*24;return [235+Math.cos(a)*r,235+Math.sin(a)*r];}
 const a=((p+seat*16)%64)*Math.PI/32-Math.PI/2;return [235+Math.cos(a)*204,235+Math.sin(a)*204];
}
function board(t){
 let art=defs+'<rect x="1" y="1" width="468" height="468" rx="35" fill="url(#arena-wood)" stroke="#6984a0"/><rect x="12" y="12" width="446" height="446" rx="28" fill="none" stroke="#ffffff15"/>';
 if(t.game==='ludo'){
  [[0,9],[0,0],[9,0],[9,9]].forEach(([x,y],i)=>{art+=`<rect x="${10+x*30}" y="${10+y*30}" width="180" height="180" rx="24" fill="${colors[i]}" fill-opacity=".12" stroke="${colors[i]}" stroke-opacity=".6"/><rect x="${34+x*30}" y="${34+y*30}" width="132" height="132" rx="19" fill="#0b1423"/>`;});
  path.forEach(([x,y],i)=>{art+=`<rect x="${11+x*30}" y="${11+y*30}" width="28" height="28" rx="5" fill="${i%13===0?colors[Math.floor(i/13)]:'#e3e7df'}" stroke="#08101e"/>`;if([0,8,13,21,26,34,39,47].includes(i))art+=circle(25+x*30,25+y*30,5,'none','#40617e');});
  for(let s=0;s<4;s++)for(let p=52;p<58;p++){const [x,y]=coord(t,s,p,0);art+=`<rect x="${x-13}" y="${y-13}" width="26" height="26" rx="5" fill="${colors[s]}" fill-opacity=".52"/>`;}
  art+='<path d="M190 190H280V280H190Z" fill="#121f33" stroke="#7286a0"/><text x="235" y="240" text-anchor="middle" fill="#f4c78e" font-size="22">شهد</text>';
 }else{
  art+=circle(235,235,180,'none','#526681')+circle(235,235,175,'none','#30435f');
  for(let i=0;i<64;i++){const a=i*Math.PI/32-Math.PI/2;art+=circle(235+204*Math.cos(a),235+204*Math.sin(a),7,i%16===0?colors[i/16]:'#060e1c','#51617a');}
  for(let s=0;s<4;s++){for(let p=64;p<68;p++){const [x,y]=coord(t,s,p,0);art+=circle(x,y,9,colors[s]+'44',colors[s]);}for(let k=0;k<4;k++){const [x,y]=coord(t,s,-1,k);art+=circle(x,y,11,'#070c18',colors[s]+'77');}}
  art+='<text x="235" y="232" text-anchor="middle" fill="#ecc291" font-size="27">جاكارو</text><text x="235" y="254" text-anchor="middle" fill="#8ba3bd" font-size="9" letter-spacing="4">SHAHD TABLE</text>';
 }
 const targets=new Map();(t.options||[]).forEach((o,i)=>{if(o.kind==='move'&&(!selectedCard||o.card===selectedCard)&&!targets.has(o.token))targets.set(o.token,i);});
 const control=t.game==='jackaroo'&&t.tokens[t.seat??0].every(p=>p>=t.track)?((t.seat??0)+2)%4:t.seat;
 t.tokens.forEach((row,s)=>row.forEach((p,k)=>{const [x,y]=coord(t,s,p,k);const choice=s===control&&targets.has(k)?targets.get(k):null;art+=`<g ${choice!==null?`data-arena-choice="${choice}" class="arena-target" role="button" aria-label="القطعة ${k+1}"`:''}>${circle(x,y,14,'transparent','transparent')}${circle(x,y,10,colors[s],'#ecf2ff',`filter="url(#arena-shadow)"`)}${circle(x,y,10,'url(#arena-ball)','none')}<text x="${x}" y="${y+3}" text-anchor="middle" font-size="9" fill="#102030" font-weight="bold">${k+1}</text>${choice!==null?circle(x,y,15,'none','#fff','stroke-dasharray="3 2"'):''}</g>`;}));
 return `<svg class="arena-board" viewBox="0 0 470 470" role="img" aria-label="لوحة ${names[t.game]}">${art}</svg>`;
}
const ballColors=['#f9f6ea','#f1c142','#4f84ea','#e96554','#a87ece','#fa984c','#54b298','#b15e72','#182033','#f1c142','#4f84ea','#e96554','#a87ece','#fa984c','#54b298','#b15e72'];
function pool(t){let art=defs+'<rect x="0" y="0" width="1100" height="600" rx="45" fill="#573b2c" stroke="#bd9870" stroke-width="4"/><rect x="22" y="22" width="1056" height="556" rx="32" fill="#16212b" stroke="#9b7860"/><rect x="50" y="50" width="1000" height="500" rx="20" fill="#126966" stroke="#25877e" stroke-width="8"/>';
 [[0,0],[500,0],[1000,0],[0,500],[500,500],[1000,500]].forEach(([x,y])=>art+=circle(x+50,y+50,25,'#030909','#a88956','stroke-width="3"'));
 for(let x=150;x<1000;x+=125)art+=`<path d="M${x} 32l4 4-4 4-4-4Z M${x} 564l4 4-4 4-4-4Z" fill="#c7a675"/>`;
 const mine=t.seat===t.turn&&t.phase==='playing',cue=t.balls[0];
  const shown=t.ballInHand&&mine?placement:cue,cx=shown.x+50,cy=shown.y+50,pull=poolPointer?.mode==='shot'?(poolPointer.pull||0):power*190;
  if(mine&&!t.ballInHand&&!animating){
   const dx=Math.cos(angle),dy=Math.sin(angle);let ray=310,hit=null;
   for(const ball of t.balls.filter(ball=>ball.in&&ball.id!==0)){
    const bx=ball.x+50,by=ball.y+50,rx=bx-cx,ry=by-cy,along=rx*dx+ry*dy,side=Math.abs(rx*dy-ry*dx);
    if(along>22&&side<=22&&(!hit||along<hit.along))hit={ball,bx,by,along,side};
   }
   if(hit)ray=Math.max(0,hit.along-Math.sqrt(Math.max(0,22*22-hit.side*hit.side)));
   const ax=cx+dx*ray,ay=cy+dy*ray;
   const near=34+pull*.45,far=172+pull*.85;
   art+=`<line x1="${cx}" y1="${cy}" x2="${ax}" y2="${ay}" stroke="#f8f3d0" stroke-opacity=".76" stroke-width="2" stroke-dasharray="9 8"/>`;
   if(hit){
    const nx=(hit.bx-ax)/22,ny=(hit.by-ay)/22,dot=dx*nx+dy*ny,tx=dx-nx*dot,ty=dy-ny*dot,tlen=Math.hypot(tx,ty),deflect=Math.min(105,105*tlen);
    art+=`<circle cx="${ax}" cy="${ay}" r="11" fill="none" stroke="#ffffff88" stroke-width="2" stroke-dasharray="4 4"/><line x1="${hit.bx+nx*14}" y1="${hit.by+ny*14}" x2="${hit.bx+nx*145}" y2="${hit.by+ny*145}" stroke="#ffcf79" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 7"/>`;
    if(tlen>.08)art+=`<line x1="${ax+tx/tlen*13}" y1="${ay+ty/tlen*13}" x2="${ax+tx/tlen*deflect}" y2="${ay+ty/tlen*deflect}" stroke="#8fe5db" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 7"/>`;
   }
   art+=`<g class="pool-cue" data-pool-cue role="button" aria-label="اسحب العصا للخلف للضرب"><line x1="${cx-dx*near}" y1="${cy-dy*near}" x2="${cx-dx*far}" y2="${cy-dy*far}" stroke="transparent" stroke-width="34" stroke-linecap="round"/><line x1="${cx-dx*near}" y1="${cy-dy*near}" x2="${cx-dx*far}" y2="${cy-dy*far}" stroke="#d9ba8a" stroke-width="7" stroke-linecap="round"/></g>`;
  }
 t.balls.filter(b=>b.in).forEach(b=>{const x=b.id===0?cx:b.x+50,y=b.id===0?cy:b.y+50;art+=`<g data-ball="${b.id}" class="${b.id===0&&t.ballInHand&&mine?'pool-white movable':''}">${b.id===0&&t.ballInHand&&mine?circle(x,y,18,'none','#ffb15f','stroke-width="3" stroke-dasharray="5 4"'):''}${circle(x,y,11,b.id>8?'#eee9d7':ballColors[b.id],'#0007',`filter="url(#arena-shadow)"`)}${b.id>8?`<path d="M${x-10} ${y-4}h20v8h-20Z" fill="${ballColors[b.id]}"/>`:''}${circle(x,y,11,'url(#arena-ball)','none')}${b.id?circle(x,y,5,'#faf9ef','none')+`<text x="${x}" y="${y+2.5}" fill="#161b21" font-size="7" text-anchor="middle">${b.id}</text>`:''}</g>`;});
 const confirm=t.ballInHand&&mine?'<button type="button" class="pool-place-confirm" data-pool-confirm>ثبّت الكرة هنا</button>':'';
 const guide=mine?(t.ballInHand?'اسحب الكرة البيضاء مباشرة، ثم ثبّت مكانها.':'اسحب على الطاولة للتوجيه، ثم اسحب العصا نفسها للخلف للضرب.'):'شاهد تصويب المنافس وحركة الكرات مباشرة.';
  return `<div class="pool-wrap ${mine?'mine':''} ${t.ballInHand?'placing':''}"><div class="pool-table-frame"><svg class="arena-pool" viewBox="0 0 1100 600" role="img" aria-label="طاولة بلياردو تفاعلية">${art}</svg>${confirm}</div><div class="pool-console"><span class="pool-power"><i style="--power:${Math.round(power*100)}%"></i><b>${Math.round(power*100)}%</b></span>${mine&&!t.ballInHand?`<label class="pool-pull"><span data-pool-pull-label>أمسك المقبض واسحب، ثم أفلت للضرب</span><input id="arena-power" type="range" min="0" max="100" step="1" value="0" aria-label="اسحب لتحديد قوة الضربة ثم أفلت"><output>0%</output></label>`:''}<small>${guide}</small></div></div>`;
}
function options(t){return (t.options||[]).map((o,i)=>({o,i})).filter(({o})=>!selectedCard||!o.card||o.card===selectedCard);}
function render(t){current=t;if(t.game==='pool'&&t.rev>0&&animationRev!==t.rev&&t.trace?.length){animationRev=t.rev;animating=true;requestAnimationFrame(()=>replay(t));}if(lastRev!==t.rev){if(t.game==='pool'&&t.ballInHand)placement={x:t.balls[0].x,y:t.balls[0].y};lastRev=t.rev;selectedCard='';selectedChoice=0;}const turn=t.players[t.turn];const mine=t.seat===t.turn&&t.phase==='playing';const opts=options(t);const status=t.phase==='done'?`الفائز: ${esc(t.players[t.winner]?.name||'الفريق')}`:mine?'دورك الآن':`دور ${esc(turn?.name)}`;
 return `<section class="arena-shell" data-arena-rev="${t.rev}"><header class="arena-head"><span><small>مجلس شهد</small><h3>${names[t.game]}</h3></span><span class="arena-turn ${mine?'mine':''}">${status}${t.game==='pool'&&t.phase==='playing'?`<b class="arena-clock" data-start="${t.turnStarted||0}" data-seconds="${t.turnSeconds||45}">00:45</b>`:''}</span></header><div class="arena-seats">${t.players.map((p,i)=>`<span class="${i===t.turn?'active':''}" style="--seat:${colors[i]}"><i></i>${esc(p.name)}${i===t.seat?' · أنت':''}</span>`).join('')}</div>${t.game==='pool'?pool(t):board(t)}<div class="arena-caption" aria-live="polite">${esc(t.last)}</div>${t.game==='jackaroo'?`<div class="arena-hand">${(t.hand||[]).map(c=>`<button type="button" data-arena-card="${c}" class="${selectedCard===c?'selected':''}">${esc(c.slice(0,-1))}<img src="/telegram/shahd/suit-${c.slice(-1)}.svg" alt="${c.slice(-1)}"></button>`).join('')}</div>`:''}
 <div class="arena-controls">${t.phase==='done'?'<p>انتهت المباراة. يبدأ قائد الغرفة جولة جديدة من قائمة الغرفة.</p>':t.game==='pool'?'<small>وجّه من الطاولة واضرب من شريط القوة الخارجي.</small>':`${t.game==='ludo'?`<div class="arena-die" aria-label="النرد ${t.dice||'لم يرم'}">${t.dice?Array.from({length:t.dice},(_,i)=>`<i style="--dot:${i}"></i>`).join(''):'<span>دورك</span>'}</div>`:''}${opts.length?`<label>الحركة<select id="arena-choice">${opts.map(({o,i})=>`<option value="${i}" ${i===selectedChoice?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label><button type="button" data-arena-move ${pending?'disabled':''}>${opts[0].o.kind==='roll'?'ارمِ النرد':'نفّذ الحركة'}</button>`:'<small>في انتظار حركة اللاعب.</small>'}`}</div><details class="arena-rules"><summary>قواعد الطاولة والتحكم</summary><p>${t.game==='ludo'?'أربع قطع لكل لون. الستة تُخرج قطعة وتمنح دورًا إضافيًا. التقاط الخصم أو الوصول يمنح دورًا إضافيًا. الخانات المعلّمة آمنة، والدخول النهائي بالعدد الدقيق. ثلاث ستات متتالية تنهي الدور.':t.game==='jackaroo'?'نسخة شهد: شريكان متقابلان، ٦٤ خانة وأربع خانات بيت. A وK للإخراج، A خطوة أو ١١، K ١٣، Q ١٢، J تبديل، ٤ للخلف، و٧ يمكن تقسيمها. قطعة البداية محمية. بعد إنهاء قطعك تساعد شريكك. اختر ورقة ثم حركة؛ الخادم يحجب الأيدي الأخرى.':'ثماني كرات: يتم اختيار المجموعات بأول إسقاط قانوني بعد الكسرة. البيضاء في الجيب أو ملامسة الكرة الخطأ أو عدم وصول كرة إلى الحافة بعد التصادم = كرة باليد. إسقاط ٨ قبل إنهاء مجموعتك خسارة. ٨ في الكسرة تعاد إلى الطاولة. الفيزياء والنتيجة تُحسمان على الخادم.'}</p></details><p class="arena-error" role="alert" ${errorMessage?'':'hidden'}>${esc(errorMessage)}</p></section>`;
}
function replay(t){
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){animating=false;return;}
 let frame=0;animating=true;
 const tick=()=>{const svg=document.querySelector('.pool-wrap');
  if(!svg||current?.rev!==t.rev){animating=false;return;}
  if(frame>=t.trace.length){svg.outerHTML=pool(current);animating=false;return;}
  const positions=new Map(t.trace[frame++].map(b=>[b[0],b]));
  const scene={...t,seat:t.seat,ballInHand:false,balls:t.balls.map(b=>({...b,in:positions.has(b.id),x:positions.get(b.id)?.[1]??b.x,y:positions.get(b.id)?.[2]??b.y}))};
  svg.outerHTML=pool(scene);setTimeout(tick,35);
 };tick();
}
function refresh(){const host=document.querySelector('.arena-shell');if(host&&current)host.outerHTML=render(current);}
async function action(body){if(pending||animating||!current||!send)return;pending=true;errorMessage='';const rev=current.rev;refresh();try{await send({...body,rev});}catch(e){errorMessage=String(e.message)==='staleMove'?'تغيّرت الطاولة، اختر الحركة من الحالة الجديدة.':'تعذرت الحركة: '+e.message;}finally{pending=false;refresh();}}
document.addEventListener('click',e=>{if(!e.target.closest('.arena-shell'))return;const turn=e.target.closest('[data-pool-turn]');if(turn&&current&&current.seat===current.turn&&!current.ballInHand){angle+=Number(turn.dataset.poolTurn)*Math.PI/90;redrawPool();return;}if(e.target.closest('[data-pool-confirm]')){action({placeOnly:true,...placement});return;}const c=e.target.closest('[data-arena-card]');if(c){selectedCard=c.dataset.arenaCard;const opts=options(current);selectedChoice=opts[0]?.i??0;refresh();return;}const choice=e.target.closest('[data-arena-choice]');if(choice){selectedChoice=Number(choice.dataset.arenaChoice);refresh();return;}if(e.target.closest('[data-arena-move]'))action({choice:Number(document.getElementById('arena-choice')?.value??selectedChoice)});if(e.target.closest('[data-arena-shoot]'))action({angle,power,...placement});});
document.addEventListener('change',e=>{if(e.target.id==='arena-choice')selectedChoice=Number(e.target.value);});
function paintPullPreview(input){
 const pct=Math.round(power*100),wrap=input?.closest('.pool-pull'),bar=document.querySelector('.pool-power');
 if(wrap){wrap.classList.add('is-pulling');const o=wrap.querySelector('output');if(o)o.textContent=pct+'%';const label=wrap.querySelector('[data-pool-pull-label]');if(label)label.textContent=`ممسوك الآن · قوة ${pct}%`;}
 if(bar){bar.classList.add('is-pulling');bar.querySelector('i')?.style.setProperty('--power',pct+'%');const b=bar.querySelector('b');if(b)b.textContent=pct+'%';}
 const group=document.querySelector('[data-pool-cue]');if(!group||!current)return;
 const cue=current.balls[0],cx=cue.x+50,cy=cue.y+50,pull=power*190,near=34+pull*.45,far=172+pull*.85;
 group.querySelectorAll('line').forEach(line=>{line.setAttribute('x1',cx-Math.cos(angle)*near);line.setAttribute('y1',cy-Math.sin(angle)*near);line.setAttribute('x2',cx-Math.cos(angle)*far);line.setAttribute('y2',cy-Math.sin(angle)*far);});
}
document.addEventListener('input',e=>{if(e.target.id==='arena-power'){power=Number(e.target.value)/100;paintPullPreview(e.target);}if(e.target.id==='arena-angle'){angle=Number(e.target.value)*Math.PI/180;const svg=document.querySelector('.arena-pool');if(svg)svg.outerHTML=pool(current);}});
function poolCoords(clientX,clientY,box){return {x:(clientX-box.left)/box.width*1100-50,y:(clientY-box.top)/box.height*600-50};}
function redrawPool(){const live=document.querySelector('.pool-wrap');if(live&&current)live.outerHTML=pool(current);}
function aimAt(clientX,clientY,box){const p=poolCoords(clientX,clientY,box),cue=current.balls[0];angle=Math.atan2(p.y-cue.y,p.x-cue.x);redrawPool();}
function moveWhite(clientX,clientY,box){const p=poolCoords(clientX,clientY,box);placement={x:Math.max(25,Math.min(975,p.x)),y:Math.max(25,Math.min(475,p.y))};redrawPool();}
document.addEventListener('pointerdown',e=>{
 if(e.target.id==='arena-power'){power=0;e.target.value='0';paintPullPreview(e.target);try{e.target.setPointerCapture(e.pointerId);}catch(_){}return;}
 const svg=e.target.closest('.arena-pool');
 if(svg&&current&&!pending&&!animating&&current.seat===current.turn&&current.phase==='playing'&&e.button===0){
  if(poolPointer)return;
  if(current.ballInHand&&!e.target.closest('[data-ball="0"]'))return;
  const box=svg.getBoundingClientRect();let mode='aim';
  if(current.ballInHand&&e.target.closest('[data-ball="0"]'))mode='place';
  else if(!current.ballInHand&&e.target.closest('[data-pool-cue]'))mode='shot';
  e.preventDefault();poolPointer={id:e.pointerId,box,capture:svg.closest('.arena-shell'),mode,startX:e.clientX,startY:e.clientY,pull:0,armed:false};
  try{poolPointer.capture.setPointerCapture(e.pointerId);}catch(_){}
  if(mode==='aim')aimAt(e.clientX,e.clientY,box);return;
 }
 const card=e.target.closest('.bl-hand .pc.live,.arena-hand button');if(!card)return;e.preventDefault();cardPointer={id:e.pointerId,el:card,x:e.clientX,y:e.clientY,moved:false};try{card.setPointerCapture(e.pointerId);}catch(_){}card.classList.add('is-dragging');
});
document.addEventListener('pointermove',e=>{
 const svg=e.target.closest('.arena-pool');

 if(poolPointer&&poolPointer.id===e.pointerId){e.preventDefault();
  if(poolPointer.mode==='place')moveWhite(e.clientX,e.clientY,poolPointer.box);
  else if(poolPointer.mode==='aim')aimAt(e.clientX,e.clientY,poolPointer.box);
  else{const dx=e.clientX-poolPointer.startX,dy=e.clientY-poolPointer.startY;poolPointer.pull=Math.max(0,-(dx*Math.cos(angle)+dy*Math.sin(angle)));power=Math.max(.05,Math.min(1,poolPointer.pull/190));poolPointer.armed=poolPointer.pull>10;redrawPool();}return;
 }
 if(!cardPointer||cardPointer.id!==e.pointerId)return;e.preventDefault();const dx=e.clientX-cardPointer.x,dy=e.clientY-cardPointer.y;cardPointer.moved=cardPointer.moved||Math.abs(dx)>4||Math.abs(dy)>4;cardPointer.el.style.setProperty('--drag-x',dx+'px');cardPointer.el.style.setProperty('--drag-y',dy+'px');cardPointer.el.style.setProperty('--drag-r',Math.max(-7,Math.min(7,dx/15))+'deg');
},{passive:false});
function endPointer(e){
 if(e.target&&e.target.id==='arena-power'){
  e.preventDefault();const input=e.target,shotPower=power;input.closest('.pool-pull')?.classList.remove('is-pulling');document.querySelector('.pool-power')?.classList.remove('is-pulling');power=0;input.value='0';
  if(e.type!=='pointercancel'&&shotPower>=.05&&current&&!current.ballInHand&&current.seat===current.turn&&!pending)action({angle,power:shotPower,...placement});else redrawPool();return;
 }
 if(poolPointer&&poolPointer.id===e.pointerId){e.preventDefault();const held=poolPointer;poolPointer=null;if(e.type!=='pointercancel'&&held.mode==='shot'&&held.armed&&!pending)action({angle,power,...placement});else redrawPool();}
 if(!cardPointer||cardPointer.id!==e.pointerId)return;e.preventDefault();const held=cardPointer;cardPointer=null;held.el.classList.remove('is-dragging');held.el.style.removeProperty('--drag-x');held.el.style.removeProperty('--drag-y');held.el.style.removeProperty('--drag-r');if(e.type!=='pointercancel'&&held.moved)requestAnimationFrame(()=>held.el.click());
}
document.addEventListener('pointerup',endPointer,{passive:false});document.addEventListener('pointercancel',endPointer,{passive:false});
setInterval(()=>document.querySelectorAll('.arena-clock').forEach(el=>{const remain=Math.max(0,Number(el.dataset.seconds||45)-Math.floor(Date.now()/1000-Number(el.dataset.start||0)));el.textContent=`00:${String(remain).padStart(2,'0')}`;}),250);
document.addEventListener('contextmenu',e=>{if(e.target.closest('.arena-shell,.mj-live-table,.chessboard'))e.preventDefault();});
window.ShahdArena={supports:g=>g in names,render,bind:fn=>send=fn,reset:()=>{lastRev=-1;animationRev=-1;current=null;poolPointer=null;animating=false;selectedCard='';},names};
})();
