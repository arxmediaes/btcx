export type Candle={t:number,o:number,h:number,l:number,c:number,v:number};
export type Mode='scalp'|'swing';export type Source='live'|'demo';
export const USER_RULES={rsiPeriod:3,rsiOverbought:80,rsiOversold:20,adxPeriod:5,adxAvoidBelow:20,adxConfirmAbove:25,emaFast:20,emaTrend:99,emaContext:200,targetRisk:.005,minRR:2,maxAuto:1,maxPositions:5};
export type Trade={id:string,symbol:string,mode:Mode,source:Source,strategy:string,side:1|-1,entry:number,exit?:number,qty:number,sl:number,tp:number,opened:number,closed?:number,pnl?:number,reason?:string,fee:number,slip:number,status:'open'|'closed'|'pending'|'cancelled',leverage:number,margin:number,intervention?:boolean,interval:string,snapshot?:Candle[],context?:string,entryKind?:'rule'|'trial'|'manual',confirmed?:boolean,analysis?:string,useSL?:boolean,multiTimeframe?:string};
// Universo ampliado: además de las principales, incluye contratos con motores
// y narrativas propias. No se asume independencia total de BTC; se valida la
// correlación histórica antes de priorizarlos en el radar real.
export const COINS=['BTC','ETH','SOL','XRP','DOGE','BNB','LINK','AVAX','ADA','SUI','TAO','HBAR','LTC','BCH','APT','INJ','NEAR','ATOM','FIL','ARB','OP','SEI'];
// Selección temporal acordada tras revisar los cierres desde el 10/10 a las 15:00 Santiago.
export const VISIBLE_COINS=['OP','ARB','INJ','AVAX','SEI','APT','FIL','ADA','BCH'];
export const RADAR_COINS=[...VISIBLE_COINS,'SUI','NEAR','DOGE','HBAR','TAO','LINK','ATOM','WIF','ENA','WLD','CRV','PENDLE','AAVE','UNI','RUNE','TIA','JUP','PYTH','GALA','SAND'];
export const MARKET_COINS=Array.from(new Set([...COINS,...RADAR_COINS]));
export const STRATEGIES=[{id:'ema',name:'Retroceso de tendencia',tag:'Tendencia',desc:'Retroceso a favor de EMA 99/200; confirmación al cierre.'},{id:'breakout',name:'Ruptura de rango',tag:'Ruptura',desc:'Cierre fuera de las últimas 20 velas, con volumen superior a la media.'},{id:'rsi',name:'Recuperación del RSI',tag:'Reversión',desc:'RSI(3) recupera 20 o pierde 80, confirmando salida de un extremo.'},{id:'vwap',name:'Recuperación del VWAP',tag:'Volumen',desc:'Recuperación o pérdida del VWAP de sesión UTC, a favor de EMA 99/200.'},{id:'adx',name:'Impulso direccional',tag:'Momentum',desc:'ADX(5) mayor que 25, cruce RSI(3) 50 y dirección de EMA 99/200.'},{id:'sweep',name:'Barrido y recuperación',tag:'Estructura',desc:'Barrido del extremo de 10 velas y cierre dentro del rango.'}];
export function ms(tf:string){return Number(tf.slice(0,-1))*({s:1000,m:60000,h:3600000,d:86400000,w:604800000}[tf.slice(-1)]||60000)}
export function ema(v:number[],p:number){let a=v[0]||0;return v.map(x=>(a=x*2/(p+1)+a*(1-2/(p+1))))}
export function indicators(b:Candle[]){const c=b.map(x=>x.c),e20=ema(c,20),e50=ema(c,50),e99=ema(c,99),e200=ema(c,200);let ag=0,al=0,ag3=0,al3=0,atr=0,pdm=0,mdm=0,adx=0,pdm5=0,mdm5=0,adx5=0,pv=0,v=0,day=-1;const rsi:number[]=[],rsi3:number[]=[],atrs:number[]=[],adxs:number[]=[],adxs5:number[]=[],diPlus:number[]=[],diMinus:number[]=[],vw:number[]=[];b.forEach((x,i)=>{let d=i?x.c-b[i-1].c:0;ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;rsi.push(al===0?ag===0?50:100:100-100/(1+ag/al));ag3=(ag3*2+Math.max(d,0))/3;al3=(al3*2+Math.max(-d,0))/3;rsi3.push(al3===0?ag3===0?50:100:100-100/(1+ag3/al3));const tr=i?Math.max(x.h-x.l,Math.abs(x.h-b[i-1].c),Math.abs(x.l-b[i-1].c)):x.h-x.l;atr=(atr*13+tr)/14;atrs.push(atr);let up=i?x.h-b[i-1].h:0,dn=i?b[i-1].l-x.l:0;pdm=(pdm*13+(up>dn&&up>0?up:0))/14;mdm=(mdm*13+(dn>up&&dn>0?dn:0))/14;let dx=pdm+mdm?100*Math.abs(pdm-mdm)/(pdm+mdm):0;adx=(adx*13+dx)/14;adxs.push(adx);pdm5=(pdm5*4+(up>dn&&up>0?up:0))/5;mdm5=(mdm5*4+(dn>up&&dn>0?dn:0))/5;const dx5=pdm5+mdm5?100*Math.abs(pdm5-mdm5)/(pdm5+mdm5):0;adx5=(adx5*4+dx5)/5;adxs5.push(adx5);diPlus.push(atr?pdm/atr*100:0);diMinus.push(atr?mdm/atr*100:0);const nd=Math.floor(x.t/86400000);if(nd!==day){day=nd;pv=0;v=0}pv+=(x.h+x.l+x.c)/3*x.v;v+=x.v;vw.push(v?pv/v:x.c)});return{e20,e50,e99,e200,rsi,rsi3,atr:atrs,adx:adxs,adx5:adxs5,diPlus,diMinus,vwap:vw}}

/**
 * Regimen de tendencia con la misma lectura que usamos en el grafico:
 * precio + EMA 50/99/200 y su pendiente. Un rebote de pocas velas no
 * puede invalidar una alineacion fuerte; debe esperar a que las medias
 * cambien de orden. Esto evita que Auto compre durante un pullback bajista.
 */
export function emaRegime(b:Candle[],a=indicators(b),i=b.length-1){
 if(i<5||!b[i])return{side:0 as 1|-1|0,strong:false,stack:0 as 1|-1|0,slope:0 as 1|-1|0};
 const x=b[i],atr=a.atr[i]||x.c*.001;
 const bullish=x.c>a.e50[i]&&a.e50[i]>a.e99[i]&&a.e99[i]>a.e200[i];
 const bearish=x.c<a.e50[i]&&a.e50[i]<a.e99[i]&&a.e99[i]<a.e200[i];
 const stack=(bullish?1:bearish?-1:0) as 1|-1|0;
 const slopeValue=(a.e50[i]-a.e50[i-5])+(a.e99[i]-a.e99[i-5])*.65+(a.e200[i]-a.e200[i-5])*.35;
 const slope=(slopeValue>atr*.18?1:slopeValue<-atr*.18?-1:0) as 1|-1|0;
 const strong=stack!==0&&slope===stack&&Math.abs(x.c-a.e200[i])>atr*.35;
 return{side:stack,strong,stack,slope};
}

export function signal(b:Candle[],id:string):{side:1|-1|0,checks:{label:string,ok:boolean}[]}{if(b.length<60)return{side:0,checks:[{label:'60 velas cerradas disponibles',ok:false}]};const a=indicators(b),i=b.length-1,x=b[i],p=b[i-1],up=x.c>a.e50[i],prev=b.slice(-21,-1),vol=prev.reduce((s,x)=>s+x.v,0)/20;let long=false,short=false,checks:{label:string,ok:boolean}[]=[];
 if(id==='ema'){long=up&&x.l<=a.e20[i]&&x.c>a.e20[i]&&x.c>x.o;short=!up&&x.h>=a.e20[i]&&x.c<a.e20[i]&&x.c<x.o;checks=[{label:'Retroceso a EMA 20',ok:x.l<=a.e20[i]&&x.h>=a.e20[i]},{label:'Cierre a favor de tendencia',ok:long||short}]}
 if(id==='breakout'){long=x.c>Math.max(...prev.map(x=>x.h))&&x.v>vol*1.2;short=x.c<Math.min(...prev.map(x=>x.l))&&x.v>vol*1.2;checks=[{label:'Cierre fuera del rango de 20 velas',ok:x.c>Math.max(...prev.map(x=>x.h))||x.c<Math.min(...prev.map(x=>x.l))},{label:'Volumen > 1,2 × media',ok:x.v>vol*1.2}]}
 if(id==='rsi'){long=a.rsi3[i-1]<20&&a.rsi3[i]>=20;short=a.rsi3[i-1]>80&&a.rsi3[i]<=80;checks=[{label:'RSI(3) sale de 20 / 80',ok:long||short}]}
 if(id==='vwap'){long=p.c<=a.vwap[i-1]&&x.c>a.vwap[i]&&up;short=p.c>=a.vwap[i-1]&&x.c<a.vwap[i]&&!up;checks=[{label:'Cruce del VWAP de sesión',ok:(p.c-a.vwap[i-1])*(x.c-a.vwap[i])<0},{label:'Confirmación con EMA 50',ok:long||short}]}
 if(id==='adx'){long=a.adx5[i]>25&&up&&a.rsi3[i-1]<=50&&a.rsi3[i]>50;short=a.adx5[i]>25&&!up&&a.rsi3[i-1]>=50&&a.rsi3[i]<50;checks=[{label:'ADX(5) > 25 y subiendo',ok:a.adx5[i]>25&&a.adx5[i]>=a.adx5[i-1]},{label:'Cruce RSI(3) 50 a favor de tendencia',ok:long||short}]}
 if(id==='sweep'){const ten=b.slice(-11,-1),lo=Math.min(...ten.map(x=>x.l)),hi=Math.max(...ten.map(x=>x.h));long=x.l<lo&&x.c>lo&&x.c>x.o;short=x.h>hi&&x.c<hi&&x.c<x.o;checks=[{label:'Barrido y recuperación del rango',ok:long||short}]}
 const rawSide=(long?1:short?-1:0) as 1|-1|0,regime=emaRegime(b,a,i);
 // En un regimen fuerte no validamos entradas contra la alineacion 50/99/200.
 // Asi un rebote alcista dentro de una caida no se convierte en una compra.
 if(rawSide&&regime.strong&&rawSide!==regime.side){
  checks=[...checks,{label:`Alineacion EMA 50/99/200: ${regime.side===1?'alcista':'bajista'}`,ok:false}];
  long=false;short=false;
 }else if(regime.strong){
  checks=[...checks,{label:'Alineacion EMA 50/99/200',ok:true}];
 }
 return{side:long?1:short?-1:0,checks}}
export function demoBars(symbol:string,tf:string,n=500):Candle[]{const base=[64000,2600,145,.58,.11,580,12,26,.35,1.6,300,.02,95,520,8,20,5,4,2.5,.45,.7,.25][COINS.indexOf(symbol)]||100;let seed=symbol.split('').reduce((s,c)=>s+c.charCodeAt(0),0);const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};let c=base;const dt=ms(tf),start=Math.floor(Date.now()/dt)*dt-n*dt;return Array.from({length:n},(_,i)=>{const o=c;const move=(rnd()-.49)*.003+Math.sin(i/21)*.0008;c=o*(1+move);return{t:start+i*dt,o,h:Math.max(o,c)*(1+rnd()*.001),l:Math.min(o,c)*(1-rnd()*.001),c,v:100+rnd()*500}})}
export function net(t:Trade,price:number){const exit=price*(1-t.side*t.slip/10000);return(t.side*(exit-t.entry)*t.qty)-(t.entry+exit)*t.qty*t.fee/10000}
export function finish(t:Trade,price:number,time:number,reason:string):Trade{const exit=price*(1-t.side*t.slip/10000);return{...t,status:'closed',exit,closed:time,pnl:net(t,price),reason}}
export function backtest(b:Candle[],id:string,mode:Mode,fee:number,slip:number,stopATR:number,rr:number){
 let balance=10000,peak=10000,dd=0;let position:Trade|null=null;const trades:Trade[]=[];const a=indicators(b);
 for(let i=61;i<b.length;i++){
  const bar=b[i];
  if(!position){const side=signal(b.slice(0,i),id).side;if(side){const entry=bar.o*(1+side*slip/10000),dist=Math.max(a.atr[i-1]*stopATR,entry*.001),cost=entry*(fee*2+slip)/10000,qty=Math.min(balance*.005/(dist+cost),balance/entry);position={id:'bt'+i,symbol:'',mode,source:'demo',strategy:id,side,entry,qty,sl:entry-side*dist,tp:entry+side*dist*rr,opened:bar.t,fee,slip,status:'open',leverage:1,margin:qty*entry,interval:''}}}
  if(position){const sl=position.side===1?bar.l<=position.sl:bar.h>=position.sl,tp=position.side===1?bar.h>=position.tp:bar.l<=position.tp;if(sl||tp){const px=sl?(position.side===1?Math.min(bar.o,position.sl):Math.max(bar.o,position.sl)):position.tp;const t=finish(position,px,bar.t,sl?'Stop-loss':'Take-profit');trades.push(t);balance+=t.pnl||0;position=null;}}
  const equity=balance+(position?net(position,bar.c):0);peak=Math.max(peak,equity);dd=Math.max(dd,(peak-equity)/peak*100);
 }
 if(position){const t=finish(position,b.at(-1)!.c,b.at(-1)!.t,'Fin de muestra');trades.push(t);balance+=t.pnl||0;peak=Math.max(peak,balance);dd=Math.max(dd,(peak-balance)/peak*100)}
 return{trades,pnl:balance-10000,dd,win:trades.length?trades.filter(t=>(t.pnl||0)>0).length/trades.length*100:0}
}
export function durationModel(b:Candle[],tf:string){if(b.length<100)return null;const a=indicators(b),sign=b.map((x,i)=>x.c>=a.e50[i]?1:-1);let runs:{side:number,n:number}[]=[],start=60;for(let i=61;i<b.length;i++){if(sign[i]!==sign[i-1]){runs.push({side:sign[i-1],n:i-start});start=i}}const side=sign.at(-1)!,age=b.length-start,survivors=runs.filter(r=>r.side===side&&r.n>age).map(r=>r.n-age).sort((a,b)=>a-b);if(survivors.length<20)return null;const q=(v:number)=>survivors[Math.floor((survivors.length-1)*v)],lo=q(.25),hi=q(.75),mid=q(.5);if(hi>mid*2.5||mid<1)return null;return{side,remaining:mid*ms(tf),lo:lo*ms(tf),hi:hi*ms(tf),n:survivors.length}}
