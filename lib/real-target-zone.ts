import type {Candle} from './engine';

type Zone={target:number;boundary:number;touches:number;source:'repeated'|'swing';frame:'primary'|'15m'};
/** Closed candles only. Long rejection wicks contribute their body edge. */
export function supportedTargetZone(bars:Candle[],mark:number,side:1|-1,atr:number,tick:number,contextBars:Candle[]=[]){
 if(![mark,atr,tick].every(Number.isFinite)||mark<=0||atr<=0||tick<=0||![1,-1].includes(side))throw Error('No hay estructura suficiente para un TP confirmado.');
 const zones:Zone[]=[];
 for(const [frame,input] of [['primary',bars],['15m',contextBars]] as const){
  const recent=input.slice(-48).filter(c=>[c.o,c.h,c.l,c.c].every(Number.isFinite)&&c.l>0&&c.h>=Math.max(c.o,c.c)&&c.l<=Math.min(c.o,c.c));
  if(recent.length<5)continue;
  const ranges=recent.map((c,i)=>Math.max(c.h-c.l,i?Math.abs(c.h-recent[i-1].c):0,i?Math.abs(c.l-recent[i-1].c):0)).sort((a,b)=>a-b);
  const typical=frame==='primary'?Math.min(atr,Math.max(tick,ranges[Math.floor(ranges.length/2)]*2)):Math.max(tick,ranges[Math.floor(ranges.length/2)]*2);
  const tolerance=Math.max(tick*2,typical*.25),buffer=Math.max(tick,typical*.15,mark*.0002);
  const points=recent.map((c,i)=>{const body=Math.abs(c.c-c.o),edge=side===1?Math.max(c.o,c.c):Math.min(c.o,c.c),wick=side===1?c.h-edge:edge-c.l;return{i,level:wick>Math.max(body*1.5,typical*.75)?edge:(side===1?c.h:c.l)};});
  const add=(boundary:number,touches:number,source:Zone['source'])=>{if(side*(boundary-mark)<=0)return;const raw=boundary-side*buffer,target=Number(((side===1?Math.floor(raw/tick+1e-8):Math.ceil(raw/tick-1e-8))*tick).toPrecision(12));zones.push({target,boundary,touches,source,frame});};
  // Similar prices alone are not structure: each touch must be a local
  // rejection with a closed candle moving away from that boundary.
  const reactions=points.filter(p=>p.i>0&&p.i<points.length-1&&
   side*(p.level-points[p.i-1].level)>=0&&side*(p.level-points[p.i+1].level)>=0&&
   side*(p.level-recent[p.i+1].c)>=Math.max(tick*2,typical*.25));
  for(const p of points){
   const matches=reactions.filter(q=>Math.abs(q.level-p.level)<=tolerance);
   if(reactions.includes(p)&&matches.some(q=>Math.abs(q.i-p.i)>=2)){add(side===1?Math.min(...matches.map(q=>q.level)):Math.max(...matches.map(q=>q.level)),matches.length,'repeated');continue;}
   // A pivot needs two closed bars on either side and a meaningful retreat.
   if(p.i<2||p.i>points.length-3)continue;
   const neighbours=[points[p.i-2],points[p.i-1],points[p.i+1],points[p.i+2]];
   if(!neighbours.every(q=>side*(p.level-q.level)>tick*.5))continue;
   const retreat=side*(p.level-recent[p.i+2].c);
   if(retreat>=Math.max(tick*2,typical*.5))add(p.level,1,'swing');
  }
 }
 if(!zones.length)throw Error('No encontramos soporte o resistencia válida en el marco principal ni en 15m; esperamos una zona repetida o un giro confirmado.');
 // Honour the nearest obstacle, including a confirmed pivot before a distant repeated zone.
 zones.sort((a,b)=>side*(a.boundary-b.boundary)||Number(a.source==='swing')-Number(b.source==='swing'));
 const zone=zones[0];
 if(side*(zone.target-mark)<=0)throw Error('Hay una zona válida, pero no queda recorrido antes de ella para colocar el TP.');
 return zone;
}
