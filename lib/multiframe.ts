import {Candle,Mode,indicators,signal} from './engine';

export type FrameReading={tf:string;direction:1|-1|0;label:string;strength:string;confidence:number;rsi3:number;adx5:number;close:number;signal:1|-1|0;ready:boolean};
export type MultiReading={frames:FrameReading[];bias:1|-1|0;confidence:number;agreement:number;safe:boolean;route:string;historyNote:string};
const sign=(v:number,e=0)=>v>e?1:v<-e?-1:0;
const rank=(tf:string)=>({'1m':1,'3m':2,'5m':3,'15m':4,'1h':5,'4h':6,'1d':7,'1w':8}[tf]||9);

export function analyzeFrame(b:Candle[],tf:string,strategy:string):FrameReading{
 if(b.length<65)return{tf,direction:0,label:'Sin datos',strength:'Esperando',confidence:0,rsi3:50,adx5:0,close:b.at(-1)?.c||0,signal:0,ready:false};
 const a=indicators(b),i=b.length-1,last=b[i],prior=b.slice(-9,-1),hi=Math.max(...prior.map(x=>x.h)),lo=Math.min(...prior.map(x=>x.l));
 // El marco no se considera alineado solo porque el precio cruce EMA 99:
 // exigimos el orden completo 50/99/200 para no comprar un rebote dentro
 // de una tendencia bajista (y viceversa).
 const trend=last.c>a.e50[i]&&a.e50[i]>a.e99[i]&&a.e99[i]>a.e200[i]?1:last.c<a.e50[i]&&a.e50[i]<a.e99[i]&&a.e99[i]<a.e200[i]?-1:0;
 const momentum=sign(a.rsi3[i]-50,5),di=sign(a.diPlus[i]-a.diMinus[i],3),structure=last.c>hi?1:last.c<lo?-1:sign(last.c-b[Math.max(0,i-3)].c,(a.atr[i]||last.c*.001)*.12);
 const score=trend*2+momentum+di+structure, direction=score>=3?1:score<=-3?-1:0, strength=a.adx5[i]>=25?'Fuerte':a.adx5[i]>=20?'Moderada':'Baja';
 const confidence=Math.round(Math.min(96,Math.max(0,42+Math.abs(score)*8+(a.adx5[i]>=25?13:a.adx5[i]>=20?6:-8)+(direction?8:0))));
 return{tf,direction:direction as 1|-1|0,label:direction===1?'Alcista':direction===-1?'Bajista':'En rango',strength,confidence,rsi3:a.rsi3[i],adx5:a.adx5[i],close:last.c,signal:signal(b,strategy).side,ready:true};
}

export function multiTimeframeAnalysis(frames:Record<string,Candle[]>,mode:Mode,strategy:string,primaryTf:string):MultiReading{
 const order=Object.keys(frames).sort((a,b)=>rank(a)-rank(b));
 const readings=order.map(tf=>analyzeFrame(frames[tf]||[],tf,strategy)).filter(x=>x.ready);
 if(!readings.length)return{frames:[],bias:0,confidence:0,agreement:0,safe:false,route:'Reuniendo lecturas de todos los marcos',historyNote:'Aún no hay historial suficiente.'};
 const higher=readings.filter(x=>rank(x.tf)>=rank(primaryTf));
 const weighted=readings.reduce((s,x)=>s+x.direction*(rank(x.tf)>=rank(primaryTf)?2:1),0);
 const bias=weighted>=4?1:weighted<=-4?-1:0;
 const aligned=bias?readings.filter(x=>x.direction===bias).length:0;
 const agreement=readings.length?Math.round(aligned/readings.length*100):0;
 const higherAgreement=higher.length?higher.filter(x=>x.direction===bias).length/higher.length:0;
 const primary=readings.find(x=>x.tf===primaryTf);
 const safe=!!bias&&agreement>=60&&higherAgreement>=.5&&!!primary&&primary.direction===bias&&readings.some(x=>x.adx5>=20);
 const confidence=Math.round(readings.reduce((s,x)=>s+x.confidence,0)/readings.length*.55+agreement*.45);
 const route=safe?`Ruta segura: ${aligned}/${readings.length} marcos alineados; objetivo más corto y confirmado.`:bias?`Ruta en observación: solo ${agreement}% de confluencia; esperar confirmación.`:'Sin ruta limpia: las temporalidades se contradicen.';
 const historyNote=mode==='scalp'?'Scalp ejecuta rápido, pero exige contexto de 15m/1h/4h.':'Swing prioriza 4h/1d/1w antes de entrar.';
 return{frames:readings,bias: bias as 1|-1|0,confidence,agreement,safe,route,historyNote};
}
