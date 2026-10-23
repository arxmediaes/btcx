'use client';
import {DashboardBlock} from './dashboard-block';
import {profileLocalStorage} from '../../lib/profile-storage';
import {DEFAULT_SWING_REAL_SETTINGS,normalizeSwingRealSettings,type SwingRealSettings} from '../../lib/swing-real-settings';
import {linkedSwingState,pauseSwingSource} from '../../lib/linked-swing-control';
import {SwingSearchStatus} from './swing-search-status';
import {useSearchAwake} from './search-awake';
import {initialSearchActivity,searchInterrupted,type SearchActivity,type SearchRead} from '../../lib/search-activity';
import {RADAR_COINS} from '../../lib/engine';
import {binanceReadWait} from '../../lib/binance-read-coordinator';
import {withRealAccountLock} from '../../lib/real-account-lock';
import {useEffect,useRef,useState} from 'react';
import {readV2Market} from '../../lib/binance-v2-market';
import {normalizeV2Brackets,type V2Bracket} from '../../lib/binance-v2-sizing';
import {executeSwingInverse,swingSignalKey,assertSwingVacant,type SwingReservation} from '../../lib/real-swing-inverse';
import {createSwingSource,processSwingSource,sourceReadPlan,sourceCopyReservation,logSwingCopy,expireSwingCopy,type SwingSourceRound} from '../../lib/swing-normal-source';
import * as exchange from '../../lib/binance-browser';
import type {RealEntryEvidence} from '../../lib/real-journal';
type Position={symbol:string;side:string;quantity:number;entryPrice:number;unrealizedProfit:number;markPrice?:number;leverage?:number|null;liquidationPrice?:number|null};
type Props={visible:boolean;ready:boolean;apiKey:string;privateKey:string;blocked:()=>boolean;marginMode:'CROSSED'|'ISOLATED';journal:RealEntryEvidence[];positions:Position[];acquire:()=>boolean;release:()=>void;record:(entry:RealEntryEvidence)=>void;refresh:()=>void;onClose?:(position:Position)=>void;updatedAt?:number;accountBusy?:boolean;sourceRound?:SwingSourceRound;onSourceRound?:(round:SwingSourceRound)=>void};
export function RealSwingInverse(props:Props){
 const [enabled,setEnabled]=useState(false),[note,setNote]=useState('Motor completo apagado. Un solo control activa la normal simulada y su copia inversa real.'),[fatal,setFatal]=useState(false),[sourceView,setSourceView]=useState<SwingSourceRound|undefined>(props.sourceRound);
 const [settings,setSettings]=useState<SwingRealSettings>(DEFAULT_SWING_REAL_SETTINGS);
 const current=useRef({...props,...settings});current.current={...props,...settings};
 const settingsKey=`hyrule-swing-real-settings-v1:${props.apiKey.slice(-4)}`;
 useEffect(()=>{try{setSettings(normalizeSwingRealSettings(JSON.parse(profileLocalStorage.getItem(settingsKey)||'null')))}catch{setSettings({...DEFAULT_SWING_REAL_SETTINGS})}},[settingsKey]);
 function changeSettings(patch:Partial<SwingRealSettings>){
  if(on.current)return;
  const next=normalizeSwingRealSettings({...settings,...patch});setSettings(next);
  try{profileLocalStorage.setItem(settingsKey,JSON.stringify(next))}catch{}
 }
 const on=useRef(false),activatedAt=useRef(0),source=useRef<SwingSourceRound|undefined>(props.sourceRound),busy=useRef(false),nextRead=useRef(0);
 const [activity,setActivity]=useState<SearchActivity>(initialSearchActivity);
 const activityRef=useRef(activity),lastBeat=useRef(0),recoveryEpoch=useRef(0),resumeTick=useRef<()=>void>(()=>{});
 function report(patch:Partial<SearchActivity>){const next={...activityRef.current,...patch,lastActivityAt:Date.now()};activityRef.current=next;setActivity(next);}
 function recover(){const now=Date.now(),gap=lastBeat.current?now-lastBeat.current:0;if(searchInterrupted(lastBeat.current,now)){recoveryEpoch.current++;if(on.current)activatedAt.current=now;report({recoveredAt:now,gapMs:gap,phase:'idle'});}lastBeat.current=now;nextRead.current=0;resumeTick.current();}
 const awake=useSearchAwake(enabled&&props.ready,recover);
 useEffect(()=>{
  on.current=false;setEnabled(false);
  source.current=current.current.sourceRound?structuredClone(current.current.sourceRound):undefined;
  if(source.current){pauseSwingSource(source.current,'Reserva virtual pausada al cargar la página; no se envía una entrada real antigua.');setSourceView(structuredClone(source.current));current.current.onSourceRound?.(structuredClone(source.current));}
  const storageKey=`hyrule-swing-inverse-attempts-v1:${props.apiKey.slice(-4)}`;
  const used=()=>{const raw=profileLocalStorage.getItem(storageKey);if(!raw)return {} as Record<string,number>;const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Registro de señales inválido; búsqueda detenida.');return value as Record<string,number>};
  const seen=(r:SwingReservation)=>!!used()[swingSignalKey(r)]||current.current.journal.some(e=>e.entryMotor==='swing-inverse'&&swingSignalKey({symbol:e.symbol,strategy:e.strategy,signalTime:e.signalTime})===swingSignalKey(r));
  const consume=(r:SwingReservation)=>profileLocalStorage.setItem(storageKey,JSON.stringify({...used(),[swingSignalKey(r)]:Date.now()}));
  let stopped=false,bracketsAt=0,brackets:Record<string,V2Bracket[]>={};
  const persist=()=>{if(!source.current||stopped)return;setSourceView(structuredClone(source.current));current.current.onSourceRound?.(structuredClone({...source.current,running:false}));};
  const tick=async()=>{
   const heartbeat=Date.now();
   if(searchInterrupted(lastBeat.current,heartbeat)){recoveryEpoch.current++;if(on.current)activatedAt.current=heartbeat;nextRead.current=0;report({recoveredAt:heartbeat,gapMs:heartbeat-lastBeat.current,phase:'idle'});}
   lastBeat.current=heartbeat;
   const p=current.current;if(stopped||busy.current||!p.ready||Date.now()<nextRead.current)return;
   if(on.current&&p.blocked())stopMotor('Modo noche activo: búsqueda normal y copia real pausadas.');
   if(!source.current){if(!on.current)return;source.current=createSwingSource();}
   const round=source.current;
   if(!on.current&&!round.trades.some(t=>t.status==='open'||t.status==='pending'))return;
   if(!navigator.onLine){report({phase:'error',lastError:'Sin conexión. Esperando a recuperar la red.'});nextRead.current=Date.now()+5000;return;}
   const readWait=binanceReadWait();if(readWait){nextRead.current=Date.now()+readWait;report({phase:'error',nextAttemptAt:nextRead.current,lastError:`Binance limita las consultas. Nuevo intento en ${Math.ceil(readWait/1000)} s.`});return;}
   busy.current=true;
   report({phase:'limits',startedAt:activityRef.current.startedAt||Date.now(),cycle:activityRef.current.cycle+1,completed:0,total:0,reads:[],nextAttemptAt:undefined});
   try{
    round.running=on.current;round.config.boost=p.boost;round.config.maxPositions=p.maxPositions;
    if(Date.now()-bracketsAt>60000){brackets=normalizeV2Brackets(await exchange.readV2BracketsInBrowser(p.apiKey,p.privateKey));bracketsAt=Date.now();}
    const symbols=sourceReadPlan(round);let completed=0;
    const reads:SearchRead[]=symbols.map(symbol=>({symbol,state:'reading'}));
    report({phase:'reading',total:symbols.length,completed:0,reads:[...reads],radarCursor:round.cursor,radarTotal:RADAR_COINS.length});
    const results=await Promise.allSettled(symbols.map(async(symbol,index)=>{
     try{const market=await readV2Market(symbol,round,Date.now(),round.running&&!round.trades.some(t=>t.symbol===symbol&&(t.status==='open'||t.status==='pending')),brackets[symbol]||[],'account-browser');reads[index]={symbol,state:'ok'};if(!stopped)report({reads:[...reads],completed:++completed,lastSuccessAt:Math.max(activityRef.current.lastSuccessAt||0,market.observedAt)});return market;}
     catch(error){reads[index]={symbol,state:'error',reason:exchange.friendlyBrowserBinanceError(error)};if(!stopped)report({reads:[...reads],completed:++completed});throw error;}
    }));
    if(stopped)return;
    const markets=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
    const errors=results.flatMap((r,i)=>r.status==='rejected'?[symbols[i]+': '+exchange.friendlyBrowserBinanceError(r.reason)]:[]);
    round.lastError=errors.join(' · ')||undefined;report({phase:markets.length?'evaluating':'error',lastError:round.lastError});
    // Update every active leg before discovering new candidates, as in the paired simulator.
    for(const market of markets)processSwingSource(round,market,Date.now(),market.primary.length>0);
    for(const trade of round.trades.filter(t=>t.arm==='normal'))expireSwingCopy(round,trade,Date.now());
    persist();
    for(const t of round.trades.filter(t=>t.arm==='normal'&&t.status==='open'&&!['submitted','opened','skipped','error'].includes(round.copies?.[t.id]?.status||''))){
     const symbol=t.symbol;if(!markets.some(m=>m.symbol===symbol))continue;
     let r:SwingReservation;
     try{
      if(!on.current)throw Error('Copia real apagada al aceptar la entrada normal simulada.');
      r=sourceCopyReservation(t,round.config.boost,activatedAt.current,Date.now());
      if(seen(r))throw Error('Esta señal ya fue enviada anteriormente; no se duplica.');
     }catch(error){logSwingCopy(round,{sourceId:t.id,symbol,time:Date.now(),status:'skipped',reason:exchange.friendlyBrowserBinanceError(error)});continue;}
     logSwingCopy(round,{sourceId:t.id,symbol,time:Date.now(),status:'waiting',reason:'Normal simulada aceptada; esperando el turno de ejecución real'});
     const copyEpoch=recoveryEpoch.current;report({phase:'copying'});
     await withRealAccountLock(p.apiKey,async()=>{
      if(!p.acquire())return;
      let submitted=false,stage='cuenta y filtros';const attempts=(round.copies?.[t.id]?.attempts||0)+1;
      const trace=(name:string)=>{stage=name;logSwingCopy(round,{sourceId:t.id,symbol,time:Date.now(),status:'waiting',stage,attempts,elapsedMs:Date.now()-r.scheduledAt,reason:`Preparando copia: ${stage}`});persist()};
      try{
       if(!on.current||stopped||copyEpoch!==recoveryEpoch.current||searchInterrupted(lastBeat.current,Date.now())||current.current.blocked())throw Error('Copia real pausada o página recuperada antes del envío.');
       trace('cuenta y filtros');
       const context=await exchange.readBinanceEntryContextInBrowser(p.apiKey,p.privateKey,symbol);
       const baseMarket=markets.find(m=>m.symbol===symbol)!;const template={...baseMarket,step:context.rules.stepSize,minimum:context.rules.minQty,minNotional:context.rules.minNotional,tick:context.rules.tickSize,brackets:brackets[symbol]||[]};
       trace('cotización ejecutable');
       const market=await exchange.readSwingExecutionQuoteInBrowser(template,r.side===1?-1:1);
    const positionSide=context.positionMode==='HEDGE'?(r.side===1?'SHORT':'LONG') as 'SHORT'|'LONG':undefined;
    if(context.rules.marginType!==p.marginMode){
     trace('modo de margen del símbolo libre');
     const [account,orders,conditionals]=await Promise.all([exchange.readBinanceLiveAccount(p.apiKey,p.privateKey),exchange.readBinanceOpenOrdersInBrowser(p.apiKey,p.privateKey,symbol),exchange.readBinanceOpenAlgoOrdersInBrowser(p.apiKey,p.privateKey,symbol)]);
     assertSwingVacant(symbol,account.positions,orders,conditionals,p.maxPositions);
     try{const confirmed=await exchange.setBinanceMarginTypeInBrowser(p.apiKey,p.privateKey,symbol,p.marginMode);if(confirmed.code!==200)throw Error('Binance no confirmó el modo de margen solicitado.');}catch(error){if((error as {code?:number}).code!==-4046)throw error}
    }
    const executionBoost=r.source!.boost;
    const result=await executeSwingInverse({reservation:r,market,available:context.account.availableBalance,boost:executionBoost,fee:context.commission.takerRate,maxPositions:p.maxPositions,positionSide},{
     now:Date.now,enabled:()=>!stopped&&on.current&&copyEpoch===recoveryEpoch.current&&!searchInterrupted(lastBeat.current,Date.now())&&current.current.ready&&!current.current.blocked(),used:()=>seen(r),consume:()=>{consume(r);submitted=true;logSwingCopy(round,{sourceId:t.id,symbol,time:Date.now(),status:'submitted',stage:'envío de orden',attempts,elapsedMs:Date.now()-r.scheduledAt,reason:'Envío inverso real de la entrada normal simulada'});persist()},
     refreshMarket:async()=>{trace('precio final antes del envío');return exchange.readSwingExecutionQuoteInBrowser(template,r.side===1?-1:1)},
     vacancy:async()=>{trace('posiciones y órdenes pendientes');const [account,orders,conditionals]=await Promise.all([exchange.readBinanceLiveAccount(p.apiKey,p.privateKey),exchange.readBinanceOpenOrdersInBrowser(p.apiKey,p.privateKey,symbol),exchange.readBinanceOpenAlgoOrdersInBrowser(p.apiKey,p.privateKey,symbol)]);return {positions:account.positions,orders,conditionals,available:account.availableBalance}},
     leverage:n=>{trace('confirmación de apalancamiento');return exchange.setBinanceLeverageInBrowser(p.apiKey,p.privateKey,symbol,n)},
     entry:async(side,quantity)=>{stage='envío de orden';const order=await exchange.placeBinanceMarketOrderInBrowser(p.apiKey,p.privateKey,{symbol,side:side===1?'BUY':'SELL',quantity,positionSide});return {quantity:exchange.executedQuantity(order),price:exchange.executedPrice(order,market.mark),orderId:order.orderId}},
     filled:(fill,plan)=>{const e=r.evidence;p.record({id:`${symbol}:${fill.orderId}`,orderId:fill.orderId,openedAt:Date.now(),engineVersion:'real-swing-inverse-v1',entryMotor:'swing-inverse',symbol,side:plan.side===1?'LONG':'SHORT',mode:'swing',timeframe:'1h',strategy:r.strategy,sourceSimulationId:t.id,reason:'Swing Inversa · copia de entrada normal simulada '+t.id,scheduledAt:r.scheduledAt,boostPercent:executionBoost,quantity:fill.quantity,entry:fill.price,entryPriceConfirmed:true,plannedStop:plan.stop,plannedTarget:plan.target,leverage:plan.leverage,marginType:p.marginMode,takerRate:context.commission.takerRate,confluence:0,signalConfirmed:true,pulseSide:e.signalSide,fomo:0,frameAgreement:0,higherAgreement:0,historicalAgreement:0,signalTime:r.signalTime,candleCount:market.primary.length,signalClose:e.signalClose!,entryDriftATR:(fill.price-e.signalClose!)/e.atr,indicators:{ema50:e.ema50,ema99:e.ema99,ema200:e.ema200,rsi3:e.rsi,adx5:e.adx,atr:e.atr},frames:[]})},
     protection:async(kind,side,quantity,price)=>{stage=kind==='sl'?'protección SL':'protección TP';const send=kind==='sl'?exchange.placeBinanceStopMarketOrderInBrowser:exchange.placeBinanceTakeProfitMarketOrderInBrowser;const order=await send(p.apiKey,p.privateKey,{symbol,side:side===1?'SELL':'BUY',quantity,stopPrice:price,positionSide,priceProtect:false});return Number(order.algoId)},
     orders:()=>exchange.readBinanceOpenAlgoOrdersInBrowser(p.apiKey,p.privateKey,symbol),
     emergency:async quantity=>{const account=await exchange.readBinanceLiveAccount(p.apiKey,p.privateKey),own=account.positions.filter((pos:Position)=>pos.symbol===symbol);if(own.length!==1||own[0].side!==(r.side===1?'SHORT':'LONG')||Math.abs(Math.abs(own[0].quantity)-quantity)>1e-8)throw Error('La posición cambió; no se modifica cantidad ajena.');await exchange.closeBinancePositionInBrowser(p.apiKey,p.privateKey,{symbol,side:r.side===1?'BUY':'SELL',quantity,positionSide});const after=await exchange.readBinanceLiveAccount(p.apiKey,p.privateKey);if(after.positions.some((pos:Position)=>pos.symbol===symbol))throw Error('Cierre pendiente');await exchange.cleanupBinanceProtectionsInBrowser(p.apiKey,p.privateKey,symbol)},
    });

       logSwingCopy(round,{sourceId:t.id,symbol,time:Date.now(),status:'opened',stage:'protegida',attempts,elapsedMs:Date.now()-r.scheduledAt,reason:`Inversa ${result.side===1?'LONG':'SHORT'} abierta · SL/TP verificados`,orderId:result.orderId});
       setNote(`${symbol} · normal simulada → inversa real abierta · ${result.leverage}×`);p.refresh();
      }catch(error){const reason=exchange.friendlyBrowserBinanceError(error);logSwingCopy(round,{sourceId:t.id,symbol,time:Date.now(),status:submitted?'error':Date.now()<r.scheduledAt+60000&&!/ocupado|Cupo|Saldo|minim|mínim|cantidad|compatible|fuera|apagada|pausada/i.test(reason)?'waiting':'skipped',stage,attempts,lastFailure:reason,lastFailureStage:stage,elapsedMs:Date.now()-r.scheduledAt,reason});setNote(`${symbol}: ${reason}`);if(submitted){stopMotor('Búsqueda y copia pausadas por una ejecución que requiere revisión: '+reason);setFatal(true);current.current.refresh();}}
      finally{p.release();persist()}
     });
    }
    persist();nextRead.current=Date.now()+2000;report({phase:markets.length?'waiting':'error',nextAttemptAt:nextRead.current,lastError:round.lastError});
   }catch(error){round.lastError=exchange.friendlyBrowserBinanceError(error);setNote(round.lastError);persist();nextRead.current=Date.now()+7000;report({phase:'error',lastError:round.lastError,nextAttemptAt:nextRead.current});}
   finally{busy.current=false}
  };
  resumeTick.current=()=>void tick();
  const timer=window.setInterval(()=>void tick(),1000);
  return()=>{stopped=true;on.current=false;window.clearInterval(timer);resumeTick.current=()=>{}};
 },[props.apiKey]);
 function stopMotor(reason:string){
  on.current=false;setEnabled(false);recoveryEpoch.current++;setNote(reason);
  if(source.current){pauseSwingSource(source.current,reason);setSourceView(structuredClone(source.current));current.current.onSourceRound?.(structuredClone(source.current));}
 }
 function toggleMotor(){
  if(on.current){stopMotor('Búsqueda normal y copia real pausadas. Las posiciones ya abiertas conservan sus protecciones.');return;}
  if(!current.current.ready||fatal)return;
  if(current.current.blocked()){setNote('Modo noche: espera a que termine la pausa antes de activar ambos motores.');return;}
  on.current=true;setEnabled(true);recoveryEpoch.current++;activatedAt.current=Date.now();nextRead.current=0;
  report({phase:'idle',startedAt:Date.now()});setNote('Ambos activos: cada próxima entrada normal aceptada en simulación se enviará a la inversa real, sujeta a las comprobaciones de Binance.');
 }
 const controls=linkedSwingState(enabled);
 return <section hidden={!props.visible} className="swing-linked-engine" aria-label="Swing normal simulado e inversa real">
  <DashboardBlock id="swing-controls" label="Swing Inversa"><div className="panel swing-source-heading"><h2>Swing Inversa</h2><button className={enabled?'primary':'outline'} role="switch" aria-label="Búsqueda normal y copia inversa real" aria-checked={enabled} disabled={!props.ready||fatal} onClick={toggleMotor}>{enabled?'Buscar y copiar activos · pausar ambos':'Activar búsqueda y copia real'}</button><></><></></div>
  <div className="panel" style={{padding:20,display:'flex',gap:20,flexWrap:'wrap',alignItems:'center'}} aria-label="Configuración exclusiva de Swing Inversa">
   <div><span className="eyebrow">TAMAÑO SWING INVERSA</span><div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}} role="group" aria-label="Aumento de tamaño Swing Inversa">{([0,20,50] as const).map(boost=><button key={boost} className={settings.boost===boost?'primary':'outline'} aria-pressed={settings.boost===boost} disabled={enabled} onClick={()=>changeSettings({boost})}>{boost===0?'Base · US$0,20':`+${boost}% · US$${(.2*(1+boost/100)).toFixed(2).replace('.',',')}`}</button>)}</div></div>
   <label>Cupo de operaciones <select aria-label="Cupo de operaciones Swing Inversa" value={settings.maxPositions} disabled={enabled} onChange={e=>changeSettings({maxPositions:Number(e.target.value) as SwingRealSettings['maxPositions']})}>{([5,10,15] as const).map(limit=><option key={limit} value={limit}>Hasta {limit}</option>)}</select></label>
   <></>
  </div>
  <SwingSearchStatus activity={activity} active={enabled} ready={props.ready} awake={awake.status} visible={awake.visible} online={awake.online} onRetry={awake.retry}/>{fatal&&<p className="red" role="alert">{note}</p>}</DashboardBlock>

 </section>;
}
