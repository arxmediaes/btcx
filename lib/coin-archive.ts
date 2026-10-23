export type DailyBar={t:number;o:number;h:number;l:number;c:number;v:number};
export type CoinArchive={symbol:string;bars:DailyBar[];checkedAt:number;complete:boolean;error?:string};
const DAY=86400000;
// Pagination starts at the first exchange candle; no 500/700/1500 total cap.
export async function collectDailyArchive(symbol:string,read:(start:number,limit:number)=>Promise<unknown>,now=Date.now()):Promise<CoinArchive>{
  const bars:DailyBar[]=[];let cursor=0;
  try{
    for(;;){
      const raw=await read(cursor,1500);
      if(!Array.isArray(raw))throw Error('Respuesta histórica inválida.');
      if(!raw.length)break;
      const batch=raw.map(row=>({t:Number(row[0]),o:Number(row[1]),h:Number(row[2]),l:Number(row[3]),c:Number(row[4]),v:Number(row[5])}));
      if(batch.some(row=>!Object.values(row).every(Number.isFinite)))throw Error('Vela histórica inválida.');
      batch.sort((a,b)=>a.t-b.t);
      const next=batch.filter(row=>row.t>=cursor&&row.t+DAY<=now);
      for(const row of next){const last=bars.at(-1);if(last&&row.t<=last.t)continue;if(last&&row.t-last.t!==DAY)throw Error('Hay un hueco en la serie diaria; cobertura por verificar.');bars.push(row)}
      const last=batch.at(-1)!;
      if(last.t<cursor)throw Error('El proveedor repitió una página histórica.');
      cursor=last.t+DAY;
      if(cursor>now||raw.length<1500)break;
    }
    if(!bars.length)throw Error('No hay velas diarias disponibles.');
    if(bars.at(-1)!.t+DAY<Math.floor(now/DAY)*DAY)throw Error('El historial no llega al último día cerrado.');
    return {symbol,bars,checkedAt:now,complete:true};
  }catch(error){return {symbol,bars,checkedAt:now,complete:false,error:error instanceof Error?error.message:'Historial no disponible'}}
}
export function archiveSummary(archive:CoinArchive){
  let peak=0,maxDrawdown=0,volatility=0,up=0,down=0;
  archive.bars.forEach((bar,i)=>{peak=Math.max(peak,bar.c);maxDrawdown=Math.max(maxDrawdown,(peak-bar.c)/peak);if(i){const r=bar.c/archive.bars[i-1].c-1;volatility+=r*r;if(r>0)up++;if(r<0)down++}});
  return {from:archive.bars[0]?.t,to:archive.bars.at(-1)?.t,count:archive.bars.length,maxDrawdown:maxDrawdown*100,dailyVolatility:Math.sqrt(volatility/Math.max(1,archive.bars.length-1))*100,up,down};
}
export function correlationWithBtc(archive:CoinArchive,btc:CoinArchive|null){
  if(!btc||archive.symbol==='BTC'||archive.bars.length<20||btc.bars.length<20)return null;
  const btcByDay=new Map(btc.bars.map(row=>[row.t,row.c])),a:number[]=[],b:number[]=[];
  for(let i=1;i<archive.bars.length;i++){const previous=archive.bars[i-1],current=archive.bars[i],btcPrevious=btcByDay.get(previous.t),btcCurrent=btcByDay.get(current.t);if(btcPrevious&&btcCurrent){a.push(current.c/previous.c-1);b.push(btcCurrent/btcPrevious-1)}}
  if(a.length<20)return null;const ma=a.reduce((s,v)=>s+v,0)/a.length,mb=b.reduce((s,v)=>s+v,0)/b.length,den=Math.sqrt(a.reduce((s,v)=>s+(v-ma)**2,0)*b.reduce((s,v)=>s+(v-mb)**2,0));return den?Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+(v-ma)*(b[i]-mb),0)/den)):null;
}
export async function loadCoinArchive(symbol:string):Promise<CoinArchive>{
  const key=`hyrule-futures-daily-v1:${symbol}`,today=Math.floor(Date.now()/DAY);
  try{const cached=JSON.parse(localStorage.getItem(key)||'null');if(cached?.complete&&Math.floor(cached.checkedAt/DAY)===today&&cached.symbol===symbol&&Array.isArray(cached.bars))return cached}catch{/* Cache optional. */}
  const result=await collectDailyArchive(symbol,async(start,limit)=>{
    const query=new URLSearchParams({symbol:`${symbol}USDT`,interval:'1d',startTime:String(start),limit:String(limit),market:'futures'});
    try{const response=await fetch(`/api/market?${query}`,{signal:AbortSignal.timeout(15000)});const data:any=await response.json();if(!response.ok||data.source!=='Binance USDⓈ-M Futures')throw Error('Futuros no disponible');return data.data}catch{
      query.delete('market');const response=await fetch(`https://fapi.binance.com/fapi/v1/klines?${query.toString()}`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`Binance Futures no disponible (${response.status}).`);return response.json();
    }
  });
  if(result.complete)try{localStorage.setItem(key,JSON.stringify(result))}catch{/* Keep in memory if storage is full. */}
  return result;
}
