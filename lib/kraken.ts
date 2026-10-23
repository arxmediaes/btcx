import {KRAKEN_PNL_PERIOD_START as PNL_PERIOD_START} from './pnl-period';
import {evaluateLossPause,normalizeLossPause} from './loss-pause';
import {isKrakenStop} from './kraken-stop-orders';
import {profitableCloserTarget} from './kraken-tp-adjust';
import {dcaLevels} from './kraken-dca-math';
import {krakenBalances,krakenTradingAvailable} from './kraken-balances';
import {eq,and,desc,ne,lt} from 'drizzle-orm';
import {getDb} from '../db';
import {krakenConnections,krakenExecutions,krakenLocks} from '../db/schema';
import {decryptSecret,encryptSecret} from './binance';
import {Candle,RADAR_COINS,ms} from './engine';
import {aggregateKrakenCandles,buildKrakenPlan,krakenBudget,krakenLossStop,krakenCoin,krakenMinimumQuantity,krakenStep,conservativeLeverage,krakenSettings,krakenSignature,linearInstrument,KrakenInstrument,KrakenPlan,KrakenSettings} from './kraken-core';

const BASE='https://futures.kraken.com';
type Credentials={apiKey:string;secret:string};
export async function krakenRequest(path:string,method='GET',params:Record<string,string|number|boolean>={},credentials?:Credentials){
 const payload=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])).toString(),headers:Record<string,string>={'Accept':'application/json'};
 if(credentials){headers.APIKey=credentials.apiKey;headers.Authent=await krakenSignature(payload,path.replace(/^\/derivatives/,''),credentials.secret);}
 if(method!=='GET')headers['Content-Type']='application/x-www-form-urlencoded';
 const response=await fetch(BASE+path+(method==='GET'&&payload?'?'+payload:''),{method,headers,body:method==='GET'?undefined:payload,cache:'no-store',signal:AbortSignal.timeout(12000)});
 let data:any;try{data=await response.json()}catch{throw Error(`Kraken respondió HTTP ${response.status} sin JSON.`)}
 if(!response.ok||data.result==='error'||data.error)throw Error(`Kraken: ${String(data.error||data.message||'HTTP '+response.status).slice(0,250)+' · consulta '+path}`);
 return data;
}
const publicCache=new Map<string,{time:number;data:any}>();
async function cachedPublic(path:string,params:Record<string,string|number>={},ttl=10000){const key=path+JSON.stringify(params),hit=publicCache.get(key);if(hit&&Date.now()-hit.time<ttl)return hit.data;const data=await krakenRequest(path,'GET',params);if(publicCache.size>160)publicCache.clear();publicCache.set(key,{time:Date.now(),data});return data;}
export async function krakenMarket(){const [info,tickers]=await Promise.all([cachedPublic('/derivatives/api/v3/instruments',{},60000),cachedPublic('/derivatives/api/v3/tickers')]);return {instruments:(info.instruments||[]).filter(linearInstrument),tickers:(tickers.tickers||[]).filter((x:any)=>/^PF_[A-Z0-9]+USD$/.test(x.symbol)&&!x.suspended),checkedAt:Date.now()};}
export async function krakenCandles(symbol:string,tf:string):Promise<Candle[]>{
 if(!/^PF_[A-Z0-9]{1,24}USD$/.test(symbol)||!['1m','3m','5m','15m','1h','4h','1d','1w'].includes(tf))throw Error('Mercado o temporalidad inválidos.');
 const data=await cachedPublic(`/api/charts/v1/trade/${symbol}/${tf==='3m'?'1m':tf}`,{count:tf==='3m'?1000:300});
 if(!Array.isArray(data.candles))throw Error('Kraken no devolvió velas.');
 const rows=data.candles.map((c:any)=>({t:Number(c.time),o:Number(c.open),h:Number(c.high),l:Number(c.low),c:Number(c.close),v:Number(c.volume)})).filter((c:Candle)=>Object.values(c).every(Number.isFinite)&&c.t>0&&c.o>0&&c.h>=c.l&&c.l>0&&c.c>0&&c.v>=0);
 return aggregateKrakenCandles(rows,tf).slice(-300);
}
export async function krakenOwner(userId:string){const [row]=await getDb().select().from(krakenConnections).where(eq(krakenConnections.userId,userId));if(!row)throw Error('Conecta la API de Kraken Futures en este perfil.');return {row,credentials:{apiKey:await decryptSecret(row.apiKeyCipher),secret:await decryptSecret(row.secretCipher)}};}
export async function krakenAccount(credentials:Credentials){
 const [wallet,positions,orders,prefs,accessible]=await Promise.all([krakenRequest('/derivatives/api/v3/accounts','GET',{},credentials),krakenRequest('/derivatives/api/v3/openpositions','GET',{},credentials),krakenRequest('/derivatives/api/v3/openorders','GET',{},credentials),krakenRequest('/derivatives/api/v3/leveragepreferences','GET',{},credentials),krakenRequest('/derivatives/api/v3/trading/instruments','GET',{},credentials)]);
 const account=krakenBalances(wallet);
 if(!Array.isArray(positions.openPositions)||!Array.isArray(orders.openOrders)||!Array.isArray(accessible.instruments))throw Error('Lectura incompleta de posiciones, órdenes o contratos de Kraken.');
 return {account,positions:positions.openPositions.filter((x:any)=>Number(x.size)>0),orders:orders.openOrders,leveragePreferences:prefs.leveragePreferences||[],accessibleInstruments:accessible.instruments,checkedAt:Date.now()};
}
export async function krakenJournal(userId:string){const {row}=await krakenOwner(userId);return await getDb().select().from(krakenExecutions).where(and(eq(krakenExecutions.userId,userId),ne(krakenExecutions.status,'prepared'),eq(krakenExecutions.accountUid,row.accountUid))).orderBy(desc(krakenExecutions.createdAt)).limit(100);}
export async function krakenSnapshot(userId:string){const {row,credentials}=await krakenOwner(userId),[snapshot,journal,fills]=await Promise.all([krakenAccount(credentials),krakenJournal(userId),krakenRequest('/derivatives/api/v3/fills','GET',{},credentials).catch(()=>null)]);return {connected:true,apiKeyLast4:row.apiKeyLast4,settings:krakenSettings(JSON.parse(row.settings)),...snapshot,accessibleInstruments:undefined,journal:journal.map(x=>({...JSON.parse(x.payload),id:x.id,status:x.status,createdAt:x.createdAt})),fills:fills?.fills||[],fillsVerified:!!fills};}
export async function connectKraken(userId:string,body:any){
 const apiKey=typeof body.apiKey==='string'?body.apiKey.trim():'',secret=typeof body.apiSecret==='string'?body.apiSecret.trim():'';
 if(!/^[A-Za-z0-9+/=_-]{20,160}$/.test(apiKey)||!/^[A-Za-z0-9+/]+={0,2}$/.test(secret)||secret.length<32||secret.length>256)throw Error('Revisa la API Key y el API Secret de Kraken Futures.');
 try{if(atob(secret).length<24)throw Error()}catch{throw Error('El API Secret debe estar en el formato Base64 entregado por Kraken.');}
 // Verify before replacing a working credential set. No order is sent here.
 await krakenAccount({apiKey,secret});
 const identity=await krakenRequest('/api/history/v3/account-log','GET',{since:Date.now()},{apiKey,secret});if(typeof identity.accountUid!=='string'||!identity.accountUid)throw Error('Kraken no confirmó la identidad de la cuenta.');
 const db=getDb();const [pending]=await db.select().from(krakenLocks).where(eq(krakenLocks.userId,userId));if(pending)throw Error('Verifica la ejecución pendiente antes de cambiar la API.');const [old]=await db.select().from(krakenConnections).where(eq(krakenConnections.userId,userId));
 if(old&&await decryptSecret(old.apiKeyCipher)!==apiKey){const previous=await krakenAccount({apiKey:await decryptSecret(old.apiKeyCipher),secret:await decryptSecret(old.secretCipher)});if(previous.positions.length||previous.orders.length)throw Error('Cierra o administra las posiciones del perfil actual antes de cambiar su API.');}
 const values={userId,accountUid:identity.accountUid,apiKeyCipher:await encryptSecret(apiKey),secretCipher:await encryptSecret(secret),apiKeyLast4:apiKey.slice(-4),connectedAt:old?.accountUid===identity.accountUid?old.connectedAt:Date.now(),settings:old?.settings||JSON.stringify(krakenSettings(body.settings))};
 await db.insert(krakenConnections).values(values).onConflictDoUpdate({target:krakenConnections.userId,set:values});
 return krakenSnapshot(userId);
}
function applicableInstrument(publicI:KrakenInstrument,account:any){
 const actual=account.accessibleInstruments.find((x:any)=>x.symbol===publicI.symbol);
 if(!actual)throw Error('Este contrato no figura entre los mercados habilitados para tu cuenta Kraken.');
 if(actual.restricted)throw Error('Kraken restringe este contrato para tu cuenta.');
 if(actual.isExpired||actual.tradeable===false||actual.postOnly)throw Error('Este contrato no admite entradas a mercado ahora.');
 if(!Array.isArray(actual.marginLevels)||!actual.marginLevels.length)throw Error('Contrato encontrado; Kraken no devolvió los límites de margen de tu cuenta.');
 return {...publicI,...actual,minimumTradeSize:krakenMinimumQuantity({...publicI,...actual,contractSize:publicI.contractSize,tradeable:publicI.tradeable}),contractSize:publicI.contractSize,tradeable:publicI.tradeable,retailMarginLevels:undefined,marginSchedules:undefined};
}
async function framesFor(symbol:string,settings:KrakenSettings){const tfs=[...new Set((settings.scalpX?['1m','3m','5m','1h','4h','1d']:['1m',settings.timeframe,'5m','15m','1h','4h','1d']))];return Object.fromEntries(await Promise.all(tfs.map(async tf=>[tf,await krakenCandles(symbol,tf)])));}
async function ensureKrakenLossPause(userId:string){const {row}=await krakenOwner(userId),raw=JSON.parse(row.settings),stored=normalizeLossPause(raw.lossPause),journal=await krakenJournal(userId),rows=journal.map(j=>({...JSON.parse(j.payload),id:j.id})).filter(j=>j.outcome?.closedAt>PNL_PERIOD_START).map(j=>({id:j.id,closedAt:j.outcome.closedAt,net:j.outcome.net??null,verified:j.outcome.status==='verified'})),next=evaluateLossPause(rows,stored,Date.now());if(next.until!==stored.until||next.consumedThrough!==stored.consumedThrough)await getDb().update(krakenConnections).set({settings:JSON.stringify({...raw,lossPause:next})}).where(eq(krakenConnections.userId,userId));if(next.until>Date.now())throw Error('MultiAuto bloqueado durante una hora por tres pérdidas consecutivas. Usa la clave en la web para desbloquear.');}

export async function prepareKraken(userId:string,body:any){
 await ensureKrakenLossPause(userId);
 const {row,credentials}=await krakenOwner(userId),settings=krakenSettings(body.settings||JSON.parse(row.settings)),[account,market]=await Promise.all([krakenAccount(credentials),krakenMarket()]);
 await getDb().delete(krakenExecutions).where(and(eq(krakenExecutions.userId,userId),eq(krakenExecutions.status,'prepared'),lt(krakenExecutions.createdAt,Date.now()-3600000)));
 const independent=body.independent===true,requested=typeof body.symbol==='string'?body.symbol:undefined;
 if(!independent&&account.positions.length>=settings.maxPositions)return {plan:null,checked:0,total:0,cursor:body.cursor||0,message:`Cupo completo · ${account.positions.length}/${settings.maxPositions} posiciones; esperando una plaza libre.`};
 let requestedSide:1|-1|undefined,shortTarget=false;
 if(body.square){
  // Re-read the source server-side; a browser cannot fabricate creator agreement.
  const {GET}=await import('../app/api/square/route');
  const response=await GET(new Request('https://hyrule.local/api/square?profiles='+encodeURIComponent(JSON.stringify(body.square.profiles||{}))));if(!response.ok)throw Error('No se pudo verificar Square.');const feed=await response.json() as any;
  const consensus=feed.consensus.find((x:any)=>x.symbol===body.square.symbol&&x.side===body.square.side&&x.creators>=2&&x.opposing===0);
  if(!consensus||Date.now()-feed.checkedAt>300000)throw Error('Square no tiene dos creadores vigentes coincidentes.');
  requestedSide=consensus.side as 1|-1;shortTarget=true;
 }
 const eligible=market.instruments.filter((i:KrakenInstrument)=>!account.positions.some((p:any)=>p.symbol===i.symbol)&&!account.orders.some((o:any)=>o.symbol===i.symbol)&&(!requested||i.symbol===requested)&&(!body.square||krakenCoin(i.symbol)===body.square.symbol));
 const start=Math.max(0,Number(body.cursor)||0),radar=eligible.filter((i:KrakenInstrument)=>requested||body.square||RADAR_COINS.includes(krakenCoin(i.symbol))).sort((a:KrakenInstrument,b:KrakenInstrument)=>krakenCoin(a.symbol).localeCompare(krakenCoin(b.symbol))),pool=requested||body.square?radar:Array.from({length:Math.min(4,radar.length)},(_,offset)=>radar[(start+offset)%radar.length]);
 const failures:string[]=[];
 for(const i of pool){try{
  const instrument=applicableInstrument(i,account),ticker=market.tickers.find((x:any)=>x.symbol===i.symbol);if(!ticker||ticker.suspended)throw Error('Precio no disponible.');
  const history=(await krakenJournal(userId)).map(j=>JSON.parse(j.payload)).filter(j=>j.plan&&j.outcome?.status==='verified').map(j=>({strategy:j.plan.strategy,net:j.outcome.net,notional:j.plan.quantity*j.plan.entry}));
  const frames=await framesFor(i.symbol,settings),plan=buildKrakenPlan({instrument,frames,history,mark:Number(ticker.markPrice),available:krakenTradingAvailable(account.account),positions:account.positions.length,settings,independent,requestedSide,shortTarget});
  await getDb().insert(krakenExecutions).values({id:plan.id,userId,accountUid:row.accountUid,createdAt:plan.createdAt,status:'prepared',payload:JSON.stringify({plan})});
  return {plan,checked:pool.length,total:radar.length,cursor:start+4};
 }catch(error){failures.push(`${krakenCoin(i.symbol)}: ${error instanceof Error?error.message:'sin señal'}`);}}
 return {plan:null,checked:pool.length,total:radar.length,cursor:start+4,message:failures.join(' · ')||'No hay nuevos contratos disponibles sin duplicar posiciones.'};
}
async function send(credentials:Credentials,input:Record<string,string|number|boolean>){const response=await krakenRequest('/derivatives/api/v3/sendorder','POST',input,credentials);if(!['placed','partiallyFilled','filled'].includes(response.sendStatus?.status)||typeof response.sendStatus?.order_id!=='string')throw Error(`Kraken no aceptó la orden: ${response.sendStatus?.status||'sin estado confirmado'}`);return response.sendStatus;}
async function cancel(credentials:Credentials,orderId:string){const r=await krakenRequest('/derivatives/api/v3/cancelorder','POST',{order_id:orderId},credentials);if(!['cancelled','notFound'].includes(r.cancelStatus?.status))throw Error('Kraken no confirmó la cancelación.');}
async function saveExecution(id:string,userId:string,status:string,payload:any){await getDb().update(krakenExecutions).set({status,payload:JSON.stringify(payload)}).where(and(eq(krakenExecutions.id,id),eq(krakenExecutions.userId,userId)));}
export async function executeKraken(userId:string,id:string){
 await ensureKrakenLossPause(userId);
 const db=getDb(),[job]=await db.select().from(krakenExecutions).where(and(eq(krakenExecutions.id,id),eq(krakenExecutions.userId,userId)));if(!job)throw Error('Plan no encontrado.');
 if(job.status!=='prepared')return {status:job.status,...JSON.parse(job.payload)};
 const payload=JSON.parse(job.payload),plan:KrakenPlan=payload.plan;if(Date.now()-plan.createdAt>45000)throw Error('El plan caducó. Analiza de nuevo con velas actuales.');
 const lock=await db.insert(krakenLocks).values({userId,executionId:id,createdAt:Date.now()}).onConflictDoNothing().returning();if(!lock.length)throw Error('Otra operación está en curso o pendiente de verificar. Actualiza la cuenta antes de reintentar.');
 let uncertain=false,started=false;
 try{
  const {credentials,row}=await krakenOwner(userId);if(row.accountUid!==job.accountUid)throw Error('Este plan pertenece a otra cuenta Kraken.');const [account,market]=await Promise.all([krakenAccount(credentials),krakenMarket()]);
  if(account.positions.some((p:any)=>p.symbol===plan.symbol)||account.orders.some((o:any)=>o.symbol===plan.symbol))throw Error('Ya hay una posición u orden en este contrato.');
  if(!plan.independent&&account.positions.length>=plan.settings.maxPositions)throw Error('Cupo automático completo.');
  const publicI=market.instruments.find((i:KrakenInstrument)=>i.symbol===plan.symbol);if(!publicI)throw Error('Contrato no disponible.');
  const ticker=market.tickers.find((t:any)=>t.symbol===plan.symbol),fresh=buildKrakenPlan({instrument:applicableInstrument(publicI,account),frames:await framesFor(plan.symbol,plan.settings),mark:Number(ticker?.markPrice),available:krakenTradingAvailable(account.account),positions:account.positions.length,settings:plan.settings,independent:plan.independent,requestedSide:plan.side});
  if(fresh.side!==plan.side||fresh.quantity<plan.quantity||Math.abs(fresh.entry-plan.entry)>Math.abs(plan.target-plan.entry)*.25||plan.side*(plan.target-fresh.entry)<=0||plan.stop>0&&plan.side*(fresh.entry-plan.stop)<=0)throw Error('Cambió la señal o el margen; analiza otra vez.');
  await krakenRequest('/derivatives/api/v3/leveragepreferences','PUT',plan.marginMode==='ISOLATED'?{symbol:plan.symbol,maxLeverage:plan.leverage}:{symbol:plan.symbol},credentials);
  const prefs=await krakenRequest('/derivatives/api/v3/leveragepreferences','GET',{},credentials),actual=prefs.leveragePreferences?.find((p:any)=>p.symbol===plan.symbol),isolated=Number(actual?.maxLeverage)>0;
  if(isolated!==(plan.marginMode==='ISOLATED')||(isolated&&Number(actual.maxLeverage)!==plan.leverage))throw Error('Kraken no confirmó el modo de margen solicitado.');
  await saveExecution(id,userId,'sending',payload);started=true;uncertain=true;
  const entry=await send(credentials,{symbol:plan.symbol,side:plan.side===1?'buy':'sell',size:plan.quantity,orderType:'mkt',cliOrdId:`hyrule-${id}-entry`});payload.entryOrderId=entry.order_id;await saveExecution(id,userId,'verifying',payload);
  let position:any;
  for(let attempt=0;attempt<3;attempt++){const positions=await krakenRequest('/derivatives/api/v3/openpositions','GET',{},credentials);position=positions.openPositions?.find((p:any)=>p.symbol===plan.symbol);if(position)break;await new Promise(resolve=>setTimeout(resolve,300));}
  if(!position||!(Number(position.size)>0)||position.side!==(plan.side===1?'long':'short'))throw Error('Entrada enviada; Kraken aún no confirmó la posición. No se repetirá la orden.');
  payload.filledQuantity=Number(position.size);payload.confirmedEntry=Number(position.price);payload.actualStop=plan.marginMode==='CROSSED'?krakenLossStop(payload.confirmedEntry,payload.filledQuantity,plan.side,publicI.tickSize,plan.crossLossBudget??.50):plan.stop;await saveExecution(id,userId,'protecting',payload);
  const closeSide=plan.side===1?'sell':'buy';
  if(plan.stop>0){const sl=await send(credentials,{symbol:plan.symbol,side:closeSide,size:payload.filledQuantity,orderType:'stp',stopPrice:payload.actualStop,triggerSignal:'mark',reduceOnly:true,cliOrdId:`hyrule-${id}-sl`});payload.stopOrderId=sl.order_id;await saveExecution(id,userId,'protecting',payload);}
  const tp=await send(credentials,{symbol:plan.symbol,side:closeSide,size:payload.filledQuantity,orderType:'take_profit',stopPrice:plan.target,triggerSignal:'mark',reduceOnly:true,cliOrdId:`hyrule-${id}-tp`});payload.targetOrderId=tp.order_id;
  const confirmed=await krakenAccount(credentials),stillOpen=confirmed.positions.find((p:any)=>p.symbol===plan.symbol);
  if(!stillOpen){payload.message='Kraken confirmó que la posición ya está cerrada.';await saveExecution(id,userId,'closed-unverified',payload);uncertain=false;return {status:'closed-unverified',...payload};}
  for(const orderId of [payload.targetOrderId,plan.stop>0?payload.stopOrderId:null].filter(Boolean))if(!confirmed.orders.some((o:any)=>o.order_id===orderId&&o.reduceOnly&&o.side===closeSide))throw Error('Kraken aún no confirmó todas las protecciones; verifica la posición antes de continuar.');
  payload.message=`${plan.coin} ${plan.side===1?'LONG':'SHORT'} abierta · ${plan.marginMode==='CROSSED'?'cruzado con SL de US$0,50':'aislado con SL'} · TP ${plan.target}`;
  await saveExecution(id,userId,'open',payload);uncertain=false;return {status:'open',...payload};
 }catch(error){payload.message=error instanceof Error?error.message:'No se pudo completar la entrada.';await saveExecution(id,userId,started?'attention':'blocked',payload);if(started)throw Error(payload.message+' Revisa esta posición y sus protecciones en Kraken; la automatización queda pausada.');throw Object.assign(error instanceof Error?error:Error(payload.message),{retryable:true});
 }finally{if(!uncertain)await db.delete(krakenLocks).where(and(eq(krakenLocks.userId,userId),eq(krakenLocks.executionId,id)));}
}
export async function closeKraken(userId:string,symbol:string){
 if(!/^PF_[A-Z0-9]{1,24}USD$/.test(symbol))throw Error('Contrato inválido.');
 const db=getDb(),id=crypto.randomUUID(),locked=await db.insert(krakenLocks).values({userId,executionId:id,createdAt:Date.now()}).onConflictDoNothing().returning();if(!locked.length)throw Error('Hay una ejecución pendiente; verifica su estado antes de cerrar desde Hyrule.');
 let sent=false;
 try{const {credentials,row}=await krakenOwner(userId),account=await krakenAccount(credentials),p=account.positions.find((x:any)=>x.symbol===symbol);if(!p)throw Error('La posición ya no está abierta.');await db.insert(krakenExecutions).values({id,userId,accountUid:row.accountUid,createdAt:Date.now(),status:'verifying',payload:JSON.stringify({action:'close',symbol,message:'Cierre enviado o pendiente de verificar. No se repetirá automáticamente.'})});sent=true;
  const status=await send(credentials,{symbol,side:p.side==='long'?'sell':'buy',size:Number(p.size),orderType:'mkt',reduceOnly:true,cliOrdId:`hyrule-${id}-close`});
  const check=await krakenRequest('/derivatives/api/v3/openpositions','GET',{},credentials);if(check.openPositions?.some((x:any)=>x.symbol===symbol&&Number(x.size)>0))throw Error('Kraken aún mantiene una cantidad abierta; actualiza para revisar el cierre parcial.');
  // Only cancel Hyrule's protection orders for the position just confirmed closed.
  for(const o of account.orders.filter((x:any)=>x.symbol===symbol&&String(x.cliOrdId||'').startsWith('hyrule-')&&x.reduceOnly))await cancel(credentials,o.order_id);
  await saveExecution(id,userId,'resolved',{action:'close',symbol,message:'Kraken confirmó el cierre.',closeOrderId:status.order_id});sent=false;return {message:'Kraken confirmó el cierre.',orderId:status.order_id};
 }finally{if(!sent)await db.delete(krakenLocks).where(and(eq(krakenLocks.userId,userId),eq(krakenLocks.executionId,id)));}
}

async function finishKrakenStopRemoval(userId:string,id:string,payload:any,credentials:Credentials){
 const account=await krakenAccount(credentials);
 for(const order of account.orders.filter((o:any)=>payload.orderIds.includes(o.order_id))){if(order.symbol!==payload.symbol||!order.reduceOnly||!isKrakenStop(order,payload.orderIds)||!String(order.cliOrdId||'').startsWith('hyrule-'))throw Error('El SL no coincide con la protección registrada.');await cancel(credentials,order.order_id);}
 const verified=await krakenAccount(credentials);if(verified.orders.some((o:any)=>o.symbol===payload.symbol&&isKrakenStop(o,payload.orderIds)))throw Error('Kraken aún tiene un SL abierto; la retirada no está confirmada.');
 for(const job of await krakenJournal(userId)){const base=JSON.parse(job.payload);if(!base.action&&base.plan?.symbol===payload.symbol&&job.status==='open'){base.stopRemoved=true;base.actualStop=0;base.stopOrderId=null;base.plan.stop=0;await saveExecution(job.id,userId,'open',base);}}
 await saveExecution(id,userId,'resolved',{...payload,message:'SL retirado y verificado. TP y tamaño conservados.'});
}
export async function removeKrakenStop(userId:string,symbol:string){
 if(!/^PF_[A-Z0-9]{1,24}USD$/.test(symbol))throw Error('Contrato inválido.');const db=getDb(),id=crypto.randomUUID(),locked=await db.insert(krakenLocks).values({userId,executionId:id,createdAt:Date.now()}).onConflictDoNothing().returning();if(!locked.length)throw Error('Hay una ejecución pendiente de verificar.');let uncertain=false,payload:any={action:'remove-stop',symbol};
 try{const {credentials,row}=await krakenOwner(userId),account=await krakenAccount(credentials),position=account.positions.find((p:any)=>p.symbol===symbol);if(!position)throw Error('La posición ya no está abierta.');const jobs=await krakenJournal(userId),knownIds=jobs.flatMap(j=>{const d=JSON.parse(j.payload);return !d.action&&d.plan?.symbol===symbol&&d.stopOrderId?[String(d.stopOrderId)]:[];});const stops=account.orders.filter((o:any)=>o.symbol===symbol&&isKrakenStop(o,knownIds));if(stops.some((o:any)=>!o.reduceOnly||!String(o.cliOrdId||'').startsWith('hyrule-')||o.side!==(position.side==='long'?'sell':'buy')))throw Error('Hay un SL externo; adminístralo directamente en Kraken.');if(!stops.length){payload.orderIds=[];await finishKrakenStopRemoval(userId,id,payload,credentials);return {message:'Lectura actualizada: Kraken no tiene SL abierto para esta posición.'};}payload.orderIds=stops.map((o:any)=>o.order_id);await db.insert(krakenExecutions).values({id,userId,accountUid:row.accountUid,createdAt:Date.now(),status:'protecting',payload:JSON.stringify(payload)});uncertain=true;await finishKrakenStopRemoval(userId,id,payload,credentials);uncertain=false;return {message:'SL retirado y verificado. TP y tamaño conservados.'};
 }catch(e){if(uncertain)await saveExecution(id,userId,'attention',{...payload,message:e instanceof Error?e.message:'Retirada del SL pendiente.'});throw e;}finally{if(!uncertain)await db.delete(krakenLocks).where(and(eq(krakenLocks.userId,userId),eq(krakenLocks.executionId,id)));}
}

export async function repairKraken(userId:string){
 const {credentials}=await krakenOwner(userId),db=getDb(),[lock]=await db.select().from(krakenLocks).where(eq(krakenLocks.userId,userId));
 if(!lock)return {message:'No hay ejecuciones pendientes de verificar.'};
 const [job]=await db.select().from(krakenExecutions).where(and(eq(krakenExecutions.id,lock.executionId),eq(krakenExecutions.userId,userId))),account=await krakenAccount(credentials);
 if(!job){if(account.positions.length||account.orders.length)throw Error('Verifica las posiciones y órdenes en Kraken antes de liberar el cierre pendiente.');await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'Kraken confirmó que no quedan posiciones ni órdenes.'};}
 const payload=JSON.parse(job.payload);if(payload.action==='remove-stop'){await finishKrakenStopRemoval(userId,job.id,payload,credentials);await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'Retirada del SL verificada.'};}if(payload.action==='tp-adjust'){await finishKrakenTp(userId,job.id,payload,credentials);await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'Ajuste de TP verificado; no se repitió la orden.'};}if(payload.action==='dca'){await finishKrakenDca(userId,job.id,payload,credentials);await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'DCA y protecciones verificados; no se repitió la entrada.'};}if(payload.action==='close'){if(Date.now()-lock.createdAt<60000||account.orders.some((o:any)=>o.cliOrdId===`hyrule-${job.id}-close`))throw Error('El cierre sigue pendiente de confirmación; espera un minuto y verifica otra vez.');const remaining=account.positions.find((p:any)=>p.symbol===payload.symbol&&Number(p.size)>0);if(remaining){await saveExecution(job.id,userId,'resolved',{...payload,message:'La posición conserva una cantidad abierta. Puedes cerrar el remanente manualmente; no se repitió la orden.'});await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'Cierre parcial verificado. La cantidad restante aparece en posiciones; puedes cerrarla cuando quieras.'};}for(const order of account.orders.filter((o:any)=>o.symbol===payload.symbol&&String(o.cliOrdId||'').startsWith('hyrule-')&&o.reduceOnly))await cancel(credentials,order.order_id);await saveExecution(job.id,userId,'resolved',{...payload,message:'Kraken confirmó el cierre.'});await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'Kraken confirmó el cierre de este contrato. Las demás posiciones siguen visibles.'};}const plan:KrakenPlan=payload.plan,p=account.positions.find((x:any)=>x.symbol===plan.symbol);
 if(!p){if(Date.now()-lock.createdAt<60000||account.orders.some((o:any)=>o.symbol===plan.symbol))throw Error('Todavía hay órdenes o una lectura muy reciente; espera y vuelve a verificar.');await saveExecution(job.id,userId,'resolved',payload);await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'Kraken no tiene posición ni órdenes en ese contrato. El intento queda registrado y no se repetirá.'};}
 if(p.side!==(plan.side===1?'long':'short'))throw Error('La posición tiene otra dirección. Adminístrala directamente en Kraken.');
 const fills=await krakenRequest('/derivatives/api/v3/fills','GET',{},credentials),opening=fills.fills?.filter((f:any)=>f.order_id===payload.entryOrderId);
 if(!payload.entryOrderId||!opening?.length||opening.reduce((s:number,f:any)=>s+Number(f.size),0)+1e-8<Number(p.size))throw Error('No se pudo atribuir toda la posición a este intento. Adminístrala directamente en Kraken; no se repite la entrada.');
 payload.filledQuantity=Number(p.size);payload.confirmedEntry=Number(p.price);if(payload.stopRemoved)payload.actualStop=0;else if(plan.marginMode==='CROSSED'){const market=await krakenMarket(),instrument=market.instruments.find((i:KrakenInstrument)=>i.symbol===plan.symbol);if(!instrument)throw Error('No se pudo verificar el tick del SL.');payload.actualStop=krakenLossStop(payload.confirmedEntry,payload.filledQuantity,plan.side,instrument.tickSize,plan.crossLossBudget??.50);}else payload.actualStop=plan.stop;
 const side=plan.side===1?'sell':'buy';
 for(const [kind,price,field,suffix] of [['stp',payload.actualStop,'stopOrderId','sl'],['take_profit',plan.target,'targetOrderId','tp']] as const){if(!(price>0))continue;const cliOrdId=`hyrule-${job.id}-${suffix}`,existing=account.orders.find((o:any)=>o.order_id===payload[field]||o.cliOrdId===cliOrdId);if(existing){if(!existing.reduceOnly||existing.side!==side)throw Error('La protección existente no coincide; revisa Kraken.');payload[field]=existing.order_id;continue;}
  const result=await send(credentials,{symbol:plan.symbol,side,size:payload.filledQuantity,orderType:kind,stopPrice:price,triggerSignal:'mark',reduceOnly:true,cliOrdId});payload[field]=result.order_id;await saveExecution(job.id,userId,'protecting',payload);
 }
 const verified=await krakenAccount(credentials),stillOpen=verified.positions.find((x:any)=>x.symbol===plan.symbol&&Number(x.size)>0);
 if(stillOpen){
  if(stillOpen.side!==p.side||Math.abs(Number(stillOpen.size)-payload.filledQuantity)>1e-8)throw Error('La posición cambió durante la verificación; vuelve a revisar sus protecciones.');
  for(const orderId of [payload.stopOrderId,payload.targetOrderId].filter(Boolean))if(!verified.orders.some((o:any)=>o.order_id===orderId&&o.symbol===plan.symbol&&o.reduceOnly&&o.side===side))throw Error('Kraken aún no confirmó las protecciones enviadas. MultiAuto permanece pausado.');
 }else{await saveExecution(job.id,userId,'resolved',{...payload,message:'Kraken confirmó que la posición ya está cerrada.'});await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'La posición ya está cerrada; no se envió otra entrada.'};}
 await saveExecution(job.id,userId,'open',payload);await db.delete(krakenLocks).where(eq(krakenLocks.userId,userId));return {message:'Posición y protecciones verificadas. No se envió otra entrada.'};
}
export async function krakenHistory(userId:string){
 const {row,credentials}=await krakenOwner(userId),[ledger,fills,jobs]=await Promise.all([krakenRequest('/api/history/v3/account-log','GET',{since:Number(row.connectedAt),count:500,sort:'desc'},credentials),krakenRequest('/derivatives/api/v3/fills','GET',{},credentials),krakenJournal(userId)]);
 if(!Array.isArray(ledger.logs)||!Array.isArray(fills.fills))throw Error('Kraken no devolvió el historial completo de esta consulta; se conserva la última lectura.');
 const logs=ledger.logs,executions=fills.fills;
 // Learning uses only completely attributed USD cash movements. Other assets
 // remain visible in the ledger; they are never silently converted or estimated.
 for(const job of jobs){const payload=JSON.parse(job.payload),plan:KrakenPlan=payload.plan;if(payload.action==='dca'||!plan||!payload.entryOrderId||payload.outcome?.status==='verified')continue;
  const rows=executions.filter((f:any)=>String(f.symbol).toUpperCase()===plan.symbol.toUpperCase()).sort((a:any,b:any)=>Date.parse(a.fillTime)-Date.parse(b.fillTime)),opening=rows.filter((f:any)=>(payload.entryOrderIds||[payload.entryOrderId]).includes(f.order_id));if(!opening.length)continue;
  const first=Date.parse(opening[0].fillTime),quantity=opening.reduce((s:number,f:any)=>s+Number(f.size),0),side=plan.side===1?'buy':'sell';let remaining=quantity,ambiguous=false;const exits:any[]=[];
  for(const f of rows){if(Date.parse(f.fillTime)<first||(payload.entryOrderIds||[payload.entryOrderId]).includes(f.order_id))continue;if(f.side===side||Number(f.size)>remaining+1e-8){ambiguous=true;break;}exits.push(f);remaining-=Number(f.size);if(remaining<=1e-8)break;}
  if(ambiguous||remaining>1e-8)continue;
  const ids=new Set([...opening,...exits].map((f:any)=>String(f.fill_id))),matched=logs.filter((l:any)=>ids.has(String(l.execution))&&String(l.contract).toUpperCase()===plan.symbol.toUpperCase()&&String(l.asset).toUpperCase()==='USD');
  if([...ids].some(id=>!matched.some((l:any)=>String(l.execution)===id))||matched.some((l:any)=>String(l.asset).toUpperCase()!=='USD'||l.old_balance==null||l.new_balance==null||![Number(l.old_balance),Number(l.new_balance)].every(Number.isFinite)))continue;
  payload.outcome={status:'verified',net:matched.reduce((s:number,l:any)=>s+Number(l.new_balance)-Number(l.old_balance),0),closedAt:Date.parse(exits.at(-1).fillTime),fillIds:[...ids]};await saveExecution(job.id,userId,'closed',payload);
 }
 return {logs:logs.map((l:any)=>({id:String(l.id),date:l.date,asset:l.asset,contract:l.contract,info:l.info,realizedPnl:l.realized_pnl,fee:l.fee,realizedFunding:l.realized_funding})),fills:executions,checkedAt:Date.now(),scope:'Desde la conexión de Kraken · registros devueltos por Kraken',complete:false};
}

export async function previewKrakenDca(userId:string,symbol:string,fraction:number){
 if(!/^PF_[A-Z0-9]{1,24}USD$/.test(symbol)||![.25,.5,1].includes(fraction))throw Error('DCA inválido.');
 const {row,credentials}=await krakenOwner(userId),[account,market,jobs]=await Promise.all([krakenAccount(credentials),krakenMarket(),krakenJournal(userId)]);
 const p=account.positions.find((x:any)=>x.symbol===symbol),parent=jobs.find(j=>{const d=JSON.parse(j.payload);return !d.action&&d.plan?.symbol===symbol&&j.status==='open'&&!d.outcome;});
 if(!p||!parent)throw Error('No se encontró una posición de Hyrule verificada para añadir DCA.');
 const publicInstrument=market.instruments.find((i:any)=>i.symbol===symbol);if(!publicInstrument)throw Error('Contrato DCA no disponible.');
 const parentPayload=JSON.parse(parent.payload),instrument=applicableInstrument(publicInstrument,account),mark=Number(market.tickers.find((t:any)=>t.symbol===symbol)?.markPrice),side=p.side==='long'?1:-1;
 const owned=account.orders.filter((o:any)=>o.symbol===symbol);if(owned.some((o:any)=>!o.reduceOnly||!String(o.cliOrdId||'').startsWith('hyrule-')))throw Error('Hay órdenes externas en este contrato. Revísalas antes del DCA.');
 const stop=owned.find((o:any)=>o.order_id===parentPayload.stopOrderId),target=owned.find((o:any)=>o.order_id===parentPayload.targetOrderId);if((!stop&&!parentPayload.stopRemoved)||!target)throw Error('Verifica primero las protecciones de la posición.');
 const step=krakenStep(instrument),quantity=Number((Math.ceil(Math.max(Number(instrument.minimumTradeSize),Number(p.size)*fraction)/step-1e-8)*step).toPrecision(12)),leverage=conservativeLeverage(instrument,(Number(p.size)+quantity)*mark),settings=krakenSettings(JSON.parse(row.settings)),isolated=account.leveragePreferences.find((x:any)=>x.symbol===symbol),maxLeverage=Number(isolated?.maxLeverage),marginMode=maxLeverage>0?'ISOLATED':'CROSSED',usedLeverage=marginMode==='ISOLATED'?Math.min(maxLeverage,leverage):leverage;
 const levels=dcaLevels(Number(p.price),Number(p.size),mark,quantity,side,instrument.tickSize,Number(target.stopPrice),marginMode==='ISOLATED'?Number(stop?.stopPrice):undefined,!!parentPayload.stopRemoved,parentPayload.plan.crossLossBudget??.50),cost=quantity*mark*(1/usedLeverage+.0012);
 if(cost>krakenTradingAvailable(account.account)*.9||(levels.total>instrument.maxPositionSize))throw Error('El DCA supera el margen disponible o el límite del contrato.');
 const id=crypto.randomUUID(),quote={id,createdAt:Date.now(),symbol,coin:krakenCoin(symbol),fraction,quantity,stopRemoved:!!parentPayload.stopRemoved,crossLossBudget:parentPayload.plan.crossLossBudget??.50,oldQuantity:Number(p.size),oldEntry:Number(p.price),mark,side,margin:quantity*mark/usedLeverage,commission:quantity*mark*.0005,...levels,leverage:usedLeverage,marginMode,settings,parentId:parent.id,oldOrderIds:owned.map((o:any)=>o.order_id),entryOrderIds:parentPayload.entryOrderIds||[parentPayload.entryOrderId]};
 await getDb().insert(krakenExecutions).values({id,userId,accountUid:row.accountUid,createdAt:quote.createdAt,status:'prepared',payload:JSON.stringify({action:'dca',quote})});return quote;
}
export async function executeKrakenDca(userId:string,id:string){
 const db=getDb(),[job]=await db.select().from(krakenExecutions).where(and(eq(krakenExecutions.id,id),eq(krakenExecutions.userId,userId)));if(!job)throw Error('DCA no encontrado.');const payload=JSON.parse(job.payload),q=payload.quote;if(payload.action!=='dca'||!q)throw Error('Plan de DCA inválido.');if(job.status!=='prepared')return {status:job.status,message:payload.message||'El intento ya está registrado; no se repite.'};if(Date.now()-q.createdAt>30000)throw Error('La cotización DCA caducó; vuelve a calcularla.');
 const acquired=await db.insert(krakenLocks).values({userId,executionId:id,createdAt:Date.now()}).onConflictDoNothing().returning();if(!acquired.length)throw Error('Hay otra ejecución pendiente de verificar.');let uncertain=false;
 try{const {row,credentials}=await krakenOwner(userId);if(row.accountUid!==job.accountUid)throw Error('La cuenta cambió.');const fresh=await previewKrakenDca(userId,q.symbol,q.fraction);if(Math.abs(fresh.oldEntry-q.oldEntry)>1e-8||Math.abs(fresh.oldQuantity-q.oldQuantity)>1e-8||fresh.quantity!==q.quantity||fresh.side!==q.side||fresh.marginMode!==q.marginMode||fresh.parentId!==q.parentId||fresh.target!==q.target||fresh.oldOrderIds.length!==q.oldOrderIds.length||fresh.oldOrderIds.some((id:string)=>!q.oldOrderIds.includes(id))||Math.abs(fresh.mark-q.mark)>q.mark*.001)throw Error('La posición o el precio cambió; revisa una nueva cotización DCA.');
  await saveExecution(id,userId,'sending',payload);uncertain=true;const entry=await send(credentials,{symbol:q.symbol,side:q.side===1?'buy':'sell',size:q.quantity,orderType:'mkt',cliOrdId:`hyrule-${id}-dca`});payload.addOrderId=entry.order_id;await saveExecution(id,userId,'verifying',payload);await finishKrakenDca(userId,id,payload,credentials);uncertain=false;return {status:'resolved',message:'DCA confirmado: promedio, cantidad y protecciones actualizados.'};
 }catch(e){payload.message=e instanceof Error?e.message:'DCA pendiente.';await saveExecution(id,userId,uncertain?'attention':'blocked',payload);throw Error(payload.message+(uncertain?' No repitas el DCA; verifica la posición y sus protecciones.':''));}finally{if(!uncertain)await db.delete(krakenLocks).where(and(eq(krakenLocks.userId,userId),eq(krakenLocks.executionId,id)));}
}
async function finishKrakenDca(userId:string,id:string,payload:any,credentials:Credentials){
 const db=getDb(),q=payload.quote,fills=await krakenRequest('/derivatives/api/v3/fills','GET',{},credentials),addFills=fills.fills?.filter((f:any)=>f.cliOrdId===`hyrule-${id}-dca`||payload.addOrderId&&f.order_id===payload.addOrderId);if(!addFills?.length)throw Error('Kraken todavía no confirmó la ejecución del DCA.');
 const added=addFills.reduce((s:number,f:any)=>s+Number(f.size),0);payload.addOrderId=addFills[0].order_id;payload.entryOrderIds=[...new Set([...q.entryOrderIds,payload.addOrderId])];
 const account=await krakenAccount(credentials);if(account.orders.some((o:any)=>o.cliOrdId===`hyrule-${id}-dca`))throw Error('El DCA aún tiene cantidad pendiente de ejecución.');const p=account.positions.find((x:any)=>x.symbol===q.symbol);if(!p)throw Error('La posición se cerró durante el DCA. Revisa Kraken antes de liberar este intento.');
 if(p.side!==(q.side===1?'long':'short')||Math.abs(Number(p.size)-q.oldQuantity-added)>1e-8)throw Error('La cantidad cambió durante el DCA; requiere revisión.');
 const publicI=(await krakenMarket()).instruments.find((i:any)=>i.symbol===q.symbol),tick=Number(publicI?.tickSize),average=Number(p.price),total=Number(p.size),actualStop=q.stopRemoved?0:q.marginMode==='CROSSED'?krakenLossStop(average,total,q.side,tick,q.crossLossBudget??.50):q.stop,closeSide=q.side===1?'sell':'buy';
 payload.filledQuantity=total;payload.confirmedEntry=average;payload.actualStop=actualStop;await saveExecution(id,userId,'protecting',payload);
 for(const [kind,price,field,suffix] of [['stp',actualStop,'stopOrderId','sl'],['take_profit',q.target,'targetOrderId','tp']] as const){if(!(price>0))continue;const existing=account.orders.find((o:any)=>o.order_id===payload[field]||o.cliOrdId===`hyrule-${id}-${suffix}`);if(existing){if(!existing.reduceOnly||existing.side!==closeSide||Math.abs(Number(existing.size)-total)>1e-8)throw Error('Protección DCA pendiente de revisar.');payload[field]=existing.order_id;}else{const result=await send(credentials,{symbol:q.symbol,side:closeSide,size:total,orderType:kind,stopPrice:price,triggerSignal:'mark',reduceOnly:true,cliOrdId:`hyrule-${id}-${suffix}`});payload[field]=result.order_id;await saveExecution(id,userId,'protecting',payload);}}
 const verified=await krakenAccount(credentials);for(const orderId of [payload.stopOrderId,payload.targetOrderId].filter(Boolean))if(!verified.orders.some((o:any)=>o.order_id===orderId&&o.symbol===q.symbol&&o.reduceOnly&&o.side===closeSide))throw Error('Kraken no confirmó las protecciones del DCA.');
 const vp=verified.positions.find((x:any)=>x.symbol===q.symbol);if(!vp||vp.side!==p.side||Math.abs(Number(vp.size)-total)>1e-8)throw Error('La posición cambió al verificar el DCA.');
 for(const orderId of q.oldOrderIds)if(verified.orders.some((o:any)=>o.order_id===orderId))await cancel(credentials,orderId);
 const [parent]=await db.select().from(krakenExecutions).where(and(eq(krakenExecutions.id,q.parentId),eq(krakenExecutions.userId,userId)));if(!parent)throw Error('No se encontró la operación original.');const base=JSON.parse(parent.payload);base.entryOrderIds=payload.entryOrderIds;base.filledQuantity=total;base.confirmedEntry=average;base.actualStop=actualStop;base.stopOrderId=payload.stopOrderId;base.targetOrderId=payload.targetOrderId;base.plan={...base.plan,quantity:total,entry:average,stop:actualStop,target:q.target};base.dcaCount=(base.dcaCount||0)+1;base.message='DCA confirmado; cantidad, promedio y protección actualizados.';await saveExecution(parent.id,userId,'open',base);await saveExecution(id,userId,'resolved',{...payload,message:'DCA confirmado.'});
}

export async function previewKrakenTp(userId:string,symbol:string,percent:number){
 if(!/^PF_[A-Z0-9]{1,24}USD$/.test(symbol)||![25,50,75].includes(percent))throw Error('Porcentaje de TP inválido.');
 const {row,credentials}=await krakenOwner(userId),[account,market,jobs,ledger,fills]=await Promise.all([krakenAccount(credentials),krakenMarket(),krakenJournal(userId),krakenRequest('/api/history/v3/account-log','GET',{since:Number(row.connectedAt),count:500},credentials),krakenRequest('/derivatives/api/v3/fills','GET',{},credentials)]);
 const p=account.positions.find((x:any)=>x.symbol===symbol),parent=jobs.find(j=>{const d=JSON.parse(j.payload);return !d.action&&d.plan?.symbol===symbol&&j.status==='open'&&!d.outcome;});if(!p||!parent)throw Error('No hay una posición de Hyrule verificada para ajustar.');const base=JSON.parse(parent.payload),order=account.orders.find((o:any)=>o.order_id===base.targetOrderId&&o.symbol===symbol&&o.reduceOnly&&String(o.cliOrdId||'').startsWith('hyrule-'));if(!order)throw Error('Kraken no confirmó el TP actual.');
 const instrument=market.instruments.find((i:any)=>i.symbol===symbol);if(!instrument)throw Error('No se confirmó el tick del contrato.');const ids=base.entryOrderIds||[base.entryOrderId],opening=(fills.fills||[]).filter((f:any)=>ids.includes(f.order_id)),usd=(ledger.logs||[]).filter((l:any)=>String(l.asset).toUpperCase()==='USD'&&String(l.contract).toUpperCase()===symbol);
 if(ids.some((id:string)=>!opening.some((f:any)=>f.order_id===id))||opening.some((f:any)=>!usd.some((l:any)=>String(l.execution)===String(f.fill_id)&&l.fee!=null&&Number.isFinite(Number(l.fee)))))throw Error('Faltan comisiones verificadas de entrada; no se estima una ganancia sin esos costes.');
 const fillIds=new Set(opening.map((f:any)=>String(f.fill_id))),fees=usd.filter((l:any)=>fillIds.has(String(l.execution))).reduce((s:number,l:any)=>s+Math.max(0,Number(l.fee)),0),funding=usd.filter((l:any)=>Date.parse(l.date)>=parent.createdAt).reduce((s:number,l:any)=>s+Math.max(0,-Number(l.realized_funding||0)),0),side=p.side==='long'?1:-1,entry=Number(p.price),quantity=Number(p.size),result=profitableCloserTarget({entry,quantity,target:Number(order.stopPrice),side,tick:instrument.tickSize,percent,entryCosts:fees+funding,rate:.0005,slipRate:.0002}),mark=Number(market.tickers.find((t:any)=>t.symbol===symbol)?.markPrice);
 if(!Number.isFinite(mark)||side*(result.target-mark)<=instrument.tickSize)throw Error('El nuevo TP ya está en el precio actual; vuelve a calcular para evitar un cierre inmediato.');
 const quote={id:crypto.randomUUID(),createdAt:Date.now(),symbol,coin:krakenCoin(symbol),side,entry,quantity,oldTarget:Number(order.stopPrice),oldOrderId:order.order_id,parentId:parent.id,fees,funding,...result};await getDb().insert(krakenExecutions).values({id:quote.id,userId,accountUid:row.accountUid,createdAt:quote.createdAt,status:'prepared',payload:JSON.stringify({action:'tp-adjust',quote})});return quote;
}
export async function executeKrakenTp(userId:string,id:string){
 const db=getDb(),[job]=await db.select().from(krakenExecutions).where(and(eq(krakenExecutions.id,id),eq(krakenExecutions.userId,userId)));if(!job)throw Error('Cotización TP no encontrada.');const payload=JSON.parse(job.payload),q=payload.quote;if(payload.action!=='tp-adjust'||!q)throw Error('Cotización TP inválida.');if(job.status!=='prepared')return {message:payload.message||'Este ajuste ya está registrado; no se repite.'};if(Date.now()-q.createdAt>30000)throw Error('Cotización TP caducada; vuelve a calcular.');const lock=await db.insert(krakenLocks).values({userId,executionId:id,createdAt:Date.now()}).onConflictDoNothing().returning();if(!lock.length)throw Error('Hay una ejecución pendiente de verificar.');let uncertain=false;
 try{const {row,credentials}=await krakenOwner(userId);if(row.accountUid!==job.accountUid)throw Error('La cuenta cambió.');const fresh=await previewKrakenTp(userId,q.symbol,q.requestedPercent);if(fresh.quantity!==q.quantity||Math.abs(fresh.entry-q.entry)>1e-8||fresh.oldOrderId!==q.oldOrderId||fresh.side!==q.side||fresh.target!==q.target)throw Error('La posición o los costes cambiaron; recalcula el TP antes de confirmar.');
 await saveExecution(id,userId,'protecting',payload);uncertain=true;const tp=await send(credentials,{symbol:q.symbol,side:q.side===1?'sell':'buy',size:q.quantity,orderType:'take_profit',stopPrice:q.target,triggerSignal:'mark',reduceOnly:true,cliOrdId:`hyrule-${id}-near-tp`});payload.targetOrderId=tp.order_id;await saveExecution(id,userId,'protecting',payload);await finishKrakenTp(userId,id,payload,credentials);uncertain=false;return {message:'TP actualizado y verificado. No se añadió tamaño ni se modificó el SL.'};
 }catch(e){payload.message=e instanceof Error?e.message:'TP pendiente de verificar.';await saveExecution(id,userId,uncertain?'attention':'blocked',payload);throw Error(payload.message+(uncertain?' Verifica la posición antes de repetir el ajuste.':''));}finally{if(!uncertain)await db.delete(krakenLocks).where(and(eq(krakenLocks.userId,userId),eq(krakenLocks.executionId,id)));}
}
async function finishKrakenTp(userId:string,id:string,payload:any,credentials:Credentials){
 const db=getDb(),q=payload.quote,account=await krakenAccount(credentials),p=account.positions.find((x:any)=>x.symbol===q.symbol),replacement=account.orders.find((o:any)=>o.order_id===payload.targetOrderId||o.cliOrdId===`hyrule-${id}-near-tp`);
 if(!p){for(const o of account.orders.filter((o:any)=>o.symbol===q.symbol&&o.reduceOnly&&(o.order_id===q.oldOrderId||o.order_id===payload.targetOrderId||o.cliOrdId===`hyrule-${id}-near-tp`)))await cancel(credentials,o.order_id);await saveExecution(id,userId,'resolved',{...payload,message:'Kraken confirmó que la posición ya se cerró.'});return;}
 if(p.side!==(q.side===1?'long':'short')||Number(p.size)!==q.quantity||!replacement||!replacement.reduceOnly||replacement.symbol!==q.symbol||replacement.side!==(q.side===1?'sell':'buy')||Math.abs(Number(replacement.stopPrice)-q.target)>1e-8||Math.abs(Number(replacement.size)-Number(p.size))>1e-8||Math.abs(Number(p.price)-q.entry)>1e-8)throw Error('Kraken aún no confirmó el nuevo TP completo; el anterior se conserva.');
 payload.targetOrderId=replacement.order_id;await saveExecution(id,userId,'protecting',payload);if(account.orders.some((o:any)=>o.order_id===q.oldOrderId))await cancel(credentials,q.oldOrderId);
 const [parent]=await db.select().from(krakenExecutions).where(and(eq(krakenExecutions.id,q.parentId),eq(krakenExecutions.userId,userId)));if(!parent)throw Error('No se encontró la operación original.');const base=JSON.parse(parent.payload);base.targetOrderId=replacement.order_id;base.plan.target=q.target;base.message='TP acercado manualmente; neto estimado positivo después de costes.';await saveExecution(parent.id,userId,'open',base);await saveExecution(id,userId,'resolved',{...payload,message:'Nuevo TP verificado.'});
}
