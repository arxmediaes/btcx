// One read budget for the real desk and simulations in this browser.
// Credentials stay in memory; only the IP-wide backoff deadline is shared across tabs.
const reads=new Map<string,{until:number;pending:boolean;response:Promise<Response>}>();
const storageKey='hyrule-binance-read-backoff-v1';
let backoffUntil=0,backoffStatus=429;
export function binanceReadWait(now=Date.now()){
 try{if(typeof window!=='undefined'){const stored=Number(window.localStorage.getItem(storageKey))||0;if(stored>backoffUntil){backoffUntil=stored;backoffStatus=Number(window.localStorage.getItem(storageKey+'-status'))||429}}}catch{}
 return Math.max(0,backoffUntil-now);
}
export function assertBinanceReadAllowed(){const wait=binanceReadWait();if(wait)throw Object.assign(new Error(`${backoffStatus===403?'Binance bloqueó el acceso de lectura (HTTP 403/WAF)':'Binance limita las consultas'}. Espera ${Math.ceil(wait/1000)} s; la búsqueda se reanudará automáticamente.`),{status:backoffStatus,code:-1003})}
export function binanceReadKey(input:string,init?:RequestInit){
 const url=new URL(input,'https://fapi.binance.com');
 for(const k of ['signature','timestamp','recvWindow'])url.searchParams.delete(k);
 // Income is a minute-cached snapshot. Keep every page cursor and stabilize its moving window.
 if(url.pathname.endsWith('/income'))for(const k of ['startTime','endTime'])if(url.searchParams.has(k))url.searchParams.set(k,String(Math.floor(Number(url.searchParams.get(k))/60000)*60000));
 url.searchParams.sort();
 return `${new Headers(init?.headers).get('X-MBX-APIKEY')||'public'}:${url.pathname}?${url.searchParams}`;
}
function ttl(input:string){
 const u=new URL(input,'https://fapi.binance.com'),p=u.pathname;
 if(/exchangeInfo|leverageBracket|commissionRate/.test(p))return 300000;
 if(p.endsWith('/income'))return 60000;
 if(p.endsWith('/dual'))return 30000;
 if(p.endsWith('/klines')){const tf=u.searchParams.get('interval')||'1m',n=Number(tf.slice(0,-1)),unit={m:60000,h:3600000,d:86400000,w:604800000}[tf.slice(-1)]||60000,span=n*unit;return Math.max(1,Math.min(30000,span-Date.now()%span))}
 return 1000;
}
export function invalidateBinanceAccountReads(){for(const key of reads.keys())if(!key.startsWith('public:')&&!/\/leverageBracket\?|\/commissionRate\?/.test(key))reads.delete(key)}
export async function coordinatedBinanceFetch(input:string,init:RequestInit={}):Promise<Response>{
 const reading=!init.method||init.method==='GET';
 if(reading)assertBinanceReadAllowed();
 const key=binanceReadKey(input,init),now=Date.now(),cached=reads.get(key);
 if(reading&&cached&&(cached.pending||cached.until>now))return (await cached.response).clone();
 const request=(async()=>{
  try{
   const publicRead=reading&&input.startsWith('https://fapi.binance.com/')&&!new Headers(init.headers).has('X-MBX-APIKEY');
   const response=await fetchCompleteJson(input,init,reading,publicRead);
   let body:any; if(!response.ok)try{body=await response.clone().json()}catch{}
   if(response.status===429||response.status===418||response.status===403&&input.startsWith('https://fapi.binance.com/')||body?.code===-1003){
    backoffStatus=response.status===403?403:429;
    const retry=response.headers.get('Retry-After'),seconds=Number(retry),date=retry?Date.parse(retry):NaN;
    const banned=String(body?.msg||'').match(/(?:banned until|ban until)\s+(\d{13})/i);
    backoffUntil=Math.max(backoffUntil,Date.now()+(response.status===418?120000:60000),Number.isFinite(seconds)&&seconds>0?Date.now()+seconds*1000:0,Number.isFinite(date)?date:0,banned?Number(banned[1]):0);
    try{if(typeof window!=='undefined'){window.localStorage.setItem(storageKey,String(backoffUntil));window.localStorage.setItem(storageKey+'-status',String(backoffStatus))}}catch{}
   }
   if(!response.ok)reads.delete(key);
   return response;
  }finally{if(!reading)invalidateBinanceAccountReads()}
 })();
 if(reading){for(const [k,v] of reads)if(!v.pending&&v.until<=now)reads.delete(k);reads.set(key,{until:now+ttl(input),pending:true,response:request});}
 try{const response=await request;const entry=reads.get(key);if(entry?.response===request)entry.pending=false;return response.clone()}catch(error){if(reads.get(key)?.response===request)reads.delete(key);throw error}
}

// Resolve the shared promise only after the complete JSON body is received.
// A cached Response must never retain an unfinished/aborted network stream.
async function fetchCompleteJson(input:string,init:RequestInit,reading:boolean,publicRead:boolean):Promise<Response>{
 for(let attempt=0;;attempt++){
  const response=await fetch(input,init);
  if(!reading||!response.ok)return response;
  let raw:string;
  try{raw=await response.text()}catch(cause){throw Object.assign(Error('La descarga de datos de Binance se interrumpió antes de completarse. Se volverá a leer.'),{status:response.status,responseReason:'body-read',cause})}
  raw=raw.replace(/^\uFEFF/,'');
  try{JSON.parse(raw)}catch(cause){
   const kind=!raw.trim()?'vacía':/^\s*</.test(raw)?'HTML':'JSON incompleto o no válido';
   // Only unsigned public reads can be replayed here. Signatures may expire;
   // order mutations retain their original one-request/unknown-result semantics.
   if(publicRead&&attempt===0&&!init.signal?.aborted)continue;
   throw Object.assign(Error(`Binance devolvió una respuesta ${kind} con HTTP ${response.status}; no son velas verificables.`),{status:response.status,responseReason:'invalid-json',cause});
  }
  return new Response(raw,{status:response.status,statusText:response.statusText,headers:response.headers});
 }
}
