import assert from 'node:assert/strict';
import {test} from 'node:test';
import {swingArmLevels,processV2Market,createV2Round} from '../lib/binance-v2-swing.ts';
import {assertSwingVacant,assertSwingWindow,planSwingInverse,executeSwingInverse,swingSignalKey,discoverSwingNormal} from '../lib/real-swing-inverse.ts';
const now=7200000+60000;
function fixture(side=1,boost=0){
 const stop=side===1?98:102,target=side===1?105:95;
 const evidence={strategy:'adx',signalSide:side,signalTime:3600000,plannedStop:stop,plannedTarget:target,signalClose:100,atr:2,spread:.0001};
 const reservation={symbol:'ETHUSDT',strategy:'adx',side,signalTime:3600000,scheduledAt:now,evidence};
 const market={symbol:'ETHUSDT',observedAt:now,mark:100,spread:.0001,step:.001,minimum:.051,minNotional:5,tick:.01,brackets:[{leverage:20,floor:0,cap:100000,maintenanceRate:.005,maintenanceOffset:0}],primary:[],context:[],minutes:[],funding:[]};
 return {reservation,market,available:10,fee:.0005,boost,maxPositions:5};
}
function adapter(input){let consumed=false;const events=[],orders=[];const io={now:()=>now,enabled:()=>true,used:()=>consumed,consume:()=>{consumed=true;events.push('consume')},vacancy:async()=>({positions:[],orders:[],conditionals:[]}),leverage:async n=>({leverage:n}),entry:async(side,quantity)=>{events.push(['entry',side,quantity]);return {quantity,price:100,orderId:'12345'}},filled:()=>events.push('filled'),protection:async(kind,side,quantity,price)=>{const id=orders.length+1;orders.push({algoId:id,symbol:input.reservation.symbol,orderType:kind==='sl'?'STOP_MARKET':'TAKE_PROFIT_MARKET',side:side===1?'SELL':'BUY',quantity,triggerPrice:price,workingType:'MARK_PRICE'});return id},orders:async()=>orders,emergency:async()=>events.push('emergency')};return {io,events,orders};}
for(const side of [1,-1])test(`normal ${side===1?'LONG':'SHORT'} produces only inverse entry with exact absolute barriers`,async()=>{
 const f=fixture(side),a=adapter(f),p=planSwingInverse(f.market,f.reservation,10,0,.0005,now),r=await executeSwingInverse(f,a.io);
 assert.equal(r.side,-side);assert.equal(r.stop,f.reservation.evidence.plannedTarget);assert.equal(r.target,f.reservation.evidence.plannedStop);
 assert.deepEqual(a.events.filter(Array.isArray),[['entry',-side,p.quantity]]);assert.ok(a.events.indexOf('consume')<a.events.findIndex(Array.isArray));assert.equal(a.orders.length,2);
});
test('simulator and real adapter share exact inversion for both arms',()=>{
 for(const side of [1,-1]){const f=fixture(side),e=f.reservation.evidence;
 assert.deepEqual(swingArmLevels(side,e.plannedStop,e.plannedTarget,'normal'),{side,stop:e.plannedStop,target:e.plannedTarget});
 const p=planSwingInverse(f.market,f.reservation,10,0,.0005,now);assert.deepEqual(swingArmLevels(side,e.plannedStop,e.plannedTarget,'inverse'),{side:p.side,stop:p.stop,target:p.target});}
});
test('base margin, boosts, minimum notional and confirmed bracket sizing',()=>{
 const f=fixture();for(const boost of [0,20,50]){const p=planSwingInverse(f.market,f.reservation,10,boost,.0005,now);assert.equal(p.allocation,.2*(1+boost/100));assert.ok(p.quantity*100>=5);assert.equal(p.leverage,20);assert.ok(Math.abs(p.quantity/.001-Math.round(p.quantity/.001))<1e-8);}
 const p=planSwingInverse(f.market,f.reservation,10,0,.0005,now);assert.equal(p.minimumAdjusted,true);
 assert.throws(()=>planSwingInverse(f.market,f.reservation,.01,0,.0005,now),/Saldo/);
 assert.throws(()=>planSwingInverse({...f.market,brackets:[]},f.reservation,10,0,.0005,now),/confirmado/);
});
test('duplicate signal cannot submit twice, including ambiguous network response',async()=>{
 const f=fixture(),a=adapter(f);a.io.entry=async()=>{a.events.push('send');throw Error('network timeout')};
 await assert.rejects(executeSwingInverse(f,a.io),/network/);await assert.rejects(executeSwingInverse(f,a.io),/utilizada/);assert.equal(a.events.filter(e=>e==='send').length,1);
 assert.equal(swingSignalKey(f.reservation),'ETHUSDT:adx:3600000');
});
test('expired, future, stale quote and disabled reservations never send',async()=>{
 for(const clock of [now-1,now+60000,now+16000]){const f=fixture(),a=adapter(f);a.io.now=()=>clock;await assert.rejects(executeSwingInverse(f,a.io));assert.equal(a.events.filter(Array.isArray).length,0);}
 const f=fixture(),a=adapter(f);a.io.enabled=()=>false;await assert.rejects(executeSwingInverse(f,a.io));assert.equal(a.events.length,0);
 assert.throws(()=>assertSwingWindow({...f.reservation,signalTime:0},now),/fuera/);
 assert.equal(discoverSwingNormal({...f.market,observedAt:0},0,()=>false,now),null);
});
test('all same-symbol positions including opposite hedge, pending orders and conditionals block without closing',async()=>{
 for(const vacancy of [{positions:[{symbol:'ETHUSDT',side:'LONG'}],orders:[],conditionals:[]},{positions:[{symbol:'ETHUSDT',side:'SHORT'}],orders:[],conditionals:[]},{positions:[],orders:[{}],conditionals:[]},{positions:[],orders:[],conditionals:[{}]}]){const f=fixture(),a=adapter(f);a.io.vacancy=async()=>vacancy;await assert.rejects(executeSwingInverse(f,a.io),/ocupado/);assert.deepEqual(a.events,[]);}
 assert.doesNotThrow(()=>assertSwingVacant('ETHUSDT',[{symbol:'BTCUSDT'}],[],[],5));
 assert.throws(()=>assertSwingVacant('ETHUSDT',[{symbol:'BTCUSDT'}],[],[],1),/Cupo/);
});
test('a scalp entry appearing after leverage confirmation wins the symbol',async()=>{
 const f=fixture(),a=adapter(f);let reads=0;a.io.vacancy=async()=>({positions:++reads===1?[]:[{symbol:'ETHUSDT'}],orders:[],conditionals:[]});await assert.rejects(executeSwingInverse(f,a.io),/ocupado/);assert.deepEqual(a.events,[]);
});
test('wrong leverage never sends; TP and SL verification failures stop the new entry',async()=>{
 let f=fixture(),a=adapter(f);a.io.leverage=async()=>({leverage:1});await assert.rejects(executeSwingInverse(f,a.io),/Apalancamiento/);assert.deepEqual(a.events,[]);
 for(const kind of ['STOP_MARKET','TAKE_PROFIT_MARKET']){f=fixture();a=adapter(f);const read=a.io.orders;a.io.orders=async()=>{const rows=await read();return rows.map(o=>o.orderType===kind?{...o,triggerPrice:200}:o)};await assert.rejects(executeSwingInverse(f,a.io),/fallo de protección/);assert.ok(a.events.includes('emergency'));}
});
test('simulated pending pair still opens with same quantity and swapped absolute levels',()=>{
 const f=fixture(),r=createV2Round({},now-60000);r.scanRules='swing-volatility-target-v5';r.running=false;
 for(const arm of ['normal','inverse'])r.trades.push({id:arm,pairId:'pair',arm,symbol:'ETHUSDT',strategy:'adx',side:arm==='normal'?1:-1,signalTime:3600000,scheduledAt:now,status:'pending',createdAt:now-60000,plannedStopDistance:2,plannedTargetDistance:5,funding:0,fundingThrough:0,reason:'test',evidence:f.reservation.evidence});
 processV2Market(r,{...f.market,minimum:.051,minutes:[{t:now,o:100,h:100.1,l:99.9,c:100,v:1}]},now+60000,false);
 assert.deepEqual(r.trades.map(t=>t.status),['open','open']);assert.equal(r.trades[0].qty,r.trades[1].qty);assert.equal(r.trades[0].stop,r.trades[1].target);assert.equal(r.trades[0].target,r.trades[1].stop);
});

import {cleanupFlatBinanceProtections} from '../lib/binance-protection-cleanup.ts';
import {lossPauseStatus,startLossPauseSession} from '../lib/loss-pause.ts';
import {withRealAccountLock} from '../lib/real-account-lock.ts';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RealSwingInverse} from '../components/pulse/real-swing-inverse.tsx';
test('inverse starts off and sends no request when rendered',()=>{
 const html=renderToStaticMarkup(React.createElement(RealSwingInverse,{visible:true,ready:true,apiKey:'test',privateKey:'unused',boost:0,maxPositions:5,marginMode:'CROSSED',journal:[],positions:[],blocked:()=>false,acquire:()=>{throw Error('No execution during render')},release:()=>{},record:()=>{},refresh:()=>{}}));
 assert.match(html,/aria-checked="false"/);assert.match(html,/Activar búsqueda/);assert.doesNotMatch(html,/Historial Swing Inversa/);assert.match(html,/Estado de búsqueda Swing/);
});
test('cleanup cancels inverse leftovers only when entire symbol is flat',async()=>{
 for(const positions of [[{symbol:'ETHUSDT'}],[]]){let orders=[{algoId:12,symbol:'ETHUSDT',orderType:'TAKE_PROFIT_MARKET',reduceOnly:true}],canceled=[];
 await cleanupFlatBinanceProtections({readOrders:async()=>orders,readPositions:async()=>positions,cancel:async id=>{canceled.push(id);orders=[]}});
 assert.deepEqual(canceled,positions.length?[]:[12]);}
});
test('night off never blocks; night on counts only new closes and pauses one hour',()=>{
 const start=1000,session=startLossPauseSession(start),losses=[1,2,3].map(i=>({id:String(i),closedAt:start+i,net:-.1,verified:true}));
 assert.equal(lossPauseStatus(losses,session,2000,true,false).blocked,false);
 const status=lossPauseStatus(losses,session,2000,true,true);assert.equal(status.blocked,true);assert.equal(status.guard.until,2000+3600000);
 assert.equal(lossPauseStatus(losses,startLossPauseSession(2000),2000,true,true).blocked,false);
});
test('account lock rejects a concurrent bot and allows a subsequent one',async()=>{
 let held=false,release,started=0,blocked=0;
 const original=Object.getOwnPropertyDescriptor(navigator,'locks');
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name,options,run)=>{if(held)return run(null);held=true;try{return await run({name})}finally{held=false}}}});
 try{const first=withRealAccountLock('account1234',async()=>{started++;await new Promise(resolve=>release=resolve)});
 await withRealAccountLock('account1234',async()=>{started++},()=>{blocked++});assert.equal(started,1);assert.equal(blocked,1);release();await first;
 await withRealAccountLock('account1234',async()=>{started++});assert.equal(started,2);
 }finally{if(original)Object.defineProperty(navigator,'locks',original);else delete navigator.locks;}
});

import {swingSummary,swingPositionRows} from '../lib/swing-position-view.ts';
import {SwingInverseDesk} from '../components/pulse/swing-inverse-desk.tsx';
test('real inverse quantity and barriers equal the actual paired simulator for both sides and boosts',()=>{
 for(const side of [1,-1])for(const boost of [0,20,50]){
  const f=fixture(side,boost),r=createV2Round({boost},now-60000);r.scanRules='swing-volatility-target-v5';r.running=false;
  for(const arm of ['normal','inverse'])r.trades.push({id:arm,pairId:'pair',arm,symbol:f.market.symbol,strategy:'adx',side:arm==='normal'?side:-side,signalTime:f.reservation.signalTime,scheduledAt:now,status:'pending',createdAt:now-60000,plannedStopDistance:2,plannedTargetDistance:5,funding:0,fundingThrough:0,reason:'test',evidence:f.reservation.evidence});
  processV2Market(r,{...f.market,minutes:[{t:now,o:100,h:100.1,l:99.9,c:100,v:1}]},now+60000,false);
  const inverse=r.trades[1],plan=planSwingInverse(f.market,f.reservation,10,boost,.0005,now);
  assert.equal(inverse.status,'open');assert.equal(plan.quantity,inverse.qty);assert.equal(plan.leverage,inverse.leverage);assert.equal(plan.stop,inverse.stop);assert.equal(plan.target,inverse.target);
 }
});
const journalEntry={id:'ETHUSDT:1',orderId:'1',entryMotor:'swing-inverse',symbol:'ETHUSDT',side:'SHORT',quantity:.1,entry:100,plannedStop:105,plannedTarget:98,openedAt:1000,strategy:'adx',mode:'swing',timeframe:'1h',leverage:20,marginType:'CROSSED',takerRate:.0005,signalTime:0};
const livePosition={symbol:'ETHUSDT',side:'SHORT',quantity:-.1,entryPrice:100,markPrice:99,unrealizedProfit:.1,leverage:20,liquidationPrice:120};
test('position view includes partial closes, flags mixed positions and excludes scalp',()=>{
 assert.equal(swingPositionRows([journalEntry],[livePosition])[0].attribution,true);
 const partial=swingPositionRows([journalEntry],[{...livePosition,quantity:-.05}])[0];assert.equal(partial.attribution,true);assert.equal(partial.partial,true);
 assert.equal(swingPositionRows([journalEntry],[{...livePosition,quantity:-.2}])[0].attribution,false);
 assert.equal(swingPositionRows([journalEntry],[{...livePosition,entryPrice:101}])[0].attribution,false);
 assert.equal(swingPositionRows([{...journalEntry,entryMotor:'impulso-rsi'}],[livePosition]).length,0);
});
test('independent P&L includes only verified inverse closes and attributed floating',()=>{
 const rows=[journalEntry,{...journalEntry,id:'closed',symbol:'BTCUSDT',outcome:{status:'verified',net:.12,closedAt:2000}},{...journalEntry,id:'pending',outcome:{status:'unmatched',net:10}},{...journalEntry,id:'scalp',entryMotor:'impulso-rsi',outcome:{status:'verified',net:9,closedAt:2000}}];
 const stats=swingSummary(rows,[livePosition],1500);assert.equal(stats.net,.12);assert.equal(stats.today,.12);assert.equal(stats.floating,.1);assert.equal(stats.closed.length,1);
 assert.equal(swingSummary(rows,[{...livePosition,quantity:-.2}],1500).floating,0);
});
test('complete inverse desk renders position prices, protections, chart controls and separate history',()=>{
 const html=renderToStaticMarkup(React.createElement(SwingInverseDesk,{visible:true,ready:false,apiKey:'',privateKey:'',entries:[journalEntry],positions:[livePosition],updatedAt:Date.now(),onRefresh:()=>{}}));
 for(const label of ['Entrada real','Precio de marca','Stop-loss','Take-profit','Cantidad actual','Liquidación','Avance de la operación','Acumulado verificado','Historial Swing Inversa','4h'])assert.ok(html.includes(label),label);
 assert.ok(html.includes('Nivel planeado'));assert.ok(!html.includes('Confirmado en Binance'));assert.ok(!html.includes('RUTA ILUSTRATIVA'));
});

import {createSwingSource,processSwingSource,sourceCopyReservation,sourceReadPlan,logSwingCopy} from '../lib/swing-normal-source.ts';
import {SwingNormalSourcePanel} from '../components/pulse/swing-normal-source-panel.tsx';
function sourceFixture(side=1){
 const f=fixture(side),round=createSwingSource(now-60000);round.scanRules='swing-volatility-target-v5';round.running=false;
 for(const arm of ['normal','inverse'])round.trades.push({id:arm,pairId:'source-pair',arm,symbol:f.market.symbol,strategy:'adx',side:arm==='normal'?side:-side,signalTime:f.reservation.signalTime,scheduledAt:now,status:'pending',createdAt:now-60000,plannedStopDistance:2,plannedTargetDistance:5,funding:0,fundingThrough:0,reason:'test',evidence:f.reservation.evidence});
 return {...f,round,market:{...f.market,minutes:[{t:now,o:100,h:110,l:90,c:100,v:1}]}};
}
test('visible normal source accepts current-minute open without reading its unfinished high/low for exits',()=>{
 const f=sourceFixture();processSwingSource(f.round,f.market,now+2000);
 assert.deepEqual(f.round.trades.map(t=>t.status),['open','open']);assert.equal(f.round.trades[0].openedAt,now);
 assert.equal(f.round.trades[0].lastBar,now-60000);
 processSwingSource(f.round,f.market,now+60000);
 assert.deepEqual(f.round.trades.map(t=>t.status),['closed','closed']);assert.equal(f.round.trades[0].ambiguous,true);
});
test('original paired simulator still waits for completed minute by default',()=>{
 const f=sourceFixture();processV2Market(f.round,f.market,now+2000,false);
 assert.deepEqual(f.round.trades.map(t=>t.status),['pending','pending']);
});
for(const side of [1,-1])test(`accepted simulated normal ${side} is sole source for inverse real size and barriers`,async()=>{
 const f=sourceFixture(side);processSwingSource(f.round,f.market,now+2000);const normal=f.round.trades[0],r=sourceCopyReservation(normal,0,now-1000,now+2000);
 const market={...f.market,mark:100.1,observedAt:now};const input={...f,market,reservation:r,boost:50},a=adapter(input);
 const result=await executeSwingInverse(input,a.io);assert.equal(result.quantity,normal.qty);assert.equal(result.stop,normal.target);assert.equal(result.target,normal.stop);assert.equal(result.leverage,normal.leverage);
 assert.deepEqual(a.events.filter(Array.isArray),[['entry',-side,normal.qty]]);assert.equal(result.allocation,.2);
});
test('source copier refuses reserved, historical, closed, incomplete and late normal trades',()=>{
 const f=sourceFixture(),pending=f.round.trades[0];assert.throws(()=>sourceCopyReservation(pending,0,now-1000,now+2000));
 processSwingSource(f.round,f.market,now+2000);const normal=f.round.trades[0];
 assert.throws(()=>sourceCopyReservation(normal,0,now+1000,now+2000));
 assert.throws(()=>sourceCopyReservation(normal,0,now-1000,now+60000));
 assert.throws(()=>sourceCopyReservation({...normal,status:'closed'},0,now-1000,now+2000));
 assert.throws(()=>sourceCopyReservation({...normal,qty:undefined},0,now-1000,now+2000));
});
test('source quantity is never inflated for real minimum or reduced to fit insufficient balance',()=>{
 const f=sourceFixture();processSwingSource(f.round,f.market,now+2000);const r=sourceCopyReservation(f.round.trades[0],0,now-1000,now+2000);
 assert.throws(()=>planSwingInverse({...f.market,minNotional:100},r,10,0,.0005,now),/mínimo/);
 assert.throws(()=>planSwingInverse(f.market,r,.001,0,.0005,now),/Saldo/);
 const mutated={...r,source:{...r.source,target:123}};assert.throws(()=>planSwingInverse(f.market,mutated,10,0,.0005,now),/alterada/);
});
test('source market plan prioritizes reservations and keeps paused existing trades monitored',()=>{
 const f=sourceFixture();const plan=sourceReadPlan(f.round);assert.deepEqual(plan,['ETHUSDT']);
 f.round.running=true;const activePlan=sourceReadPlan(f.round);assert.equal(activePlan[0],'ETHUSDT');assert.ok(activePlan.length<=4);
});
test('normal source panel exposes virtual positions and persistent real rejection reasons',()=>{
 const f=sourceFixture();processSwingSource(f.round,f.market,now+2000);
 logSwingCopy(f.round,{sourceId:'normal',symbol:'ETHUSDT',time:now,status:'skipped',reason:'Activo ocupado por scalp'});
 const html=renderToStaticMarkup(React.createElement(SwingNormalSourcePanel,{round:f.round,enabled:false,ready:true,onToggle:()=>{throw Error('No actions during render')}}));
 for(const text of ['Swing normal','SOLO SIMULACIÓN','Abierta virtual','Inversa omitida','Activo ocupado por scalp','Historial normal simulado'])assert.ok(html.includes(text),text);
 const restored=JSON.parse(JSON.stringify(f.round));assert.equal(restored.copies.normal.reason,'Activo ocupado por scalp');
});

import {linkedSwingState,pauseSwingSource} from '../lib/linked-swing-control.ts';
test('linked motor has no simulation-search-only authorization state',()=>{
 for(const enabled of [false,true]){const control=linkedSwingState(enabled);assert.equal(control.normalSearching,control.realCopying);assert.equal(control.realCopying,enabled);}
});
test('pausing cancels only unfilled virtual reservations and retains open trades, history and copy audit',()=>{
 const f=sourceFixture();f.round.trades.push({...f.round.trades[0],id:'open',status:'open',entry:100,qty:.051});f.round.trades.push({...f.round.trades[0],id:'closed',status:'closed',net:.12});
 logSwingCopy(f.round,{sourceId:'old',symbol:'ETHUSDT',time:now,status:'skipped',reason:'Copia real apagada'});
 const history=f.round.trades.find(t=>t.id==='closed'),open=f.round.trades.find(t=>t.id==='open');pauseSwingSource(f.round,'Motor completo pausado');
 assert.equal(f.round.running,false);assert.equal(f.round.trades.filter(t=>t.status==='pending').length,0);assert.equal(f.round.trades.find(t=>t.id==='normal').status,'skipped');assert.equal(f.round.trades.find(t=>t.id==='closed'),history);assert.equal(f.round.trades.find(t=>t.id==='open'),open);assert.equal(f.round.copies.old.status,'skipped');
});
test('one explicit real activation switch replaces both independent controls in the complete UI',()=>{
 const html=renderToStaticMarkup(React.createElement(RealSwingInverse,{visible:true,ready:true,apiKey:'test',privateKey:'unused',boost:0,maxPositions:5,marginMode:'CROSSED',journal:[],positions:[],blocked:()=>false,acquire:()=>{throw Error('No orders')},release:()=>{},record:()=>{},refresh:()=>{}}));
 assert.equal((html.match(/role="switch"/g)||[]).length,1);assert.ok(html.includes('Activar búsqueda y copia real'));assert.ok(html.includes('aria-checked="false"'));assert.ok(html.includes('Búsqueda apagada'));assert.equal((html.match(/data-dashboard-block=/g)||[]).length,1);assert.ok(!html.includes('swing-linked-grid'));assert.ok(!html.includes('Iniciar simulación'));
});

import {sourceMayDiscover,expireSwingCopy} from '../lib/swing-normal-source.ts';
import {binanceExecutionQuote} from '../lib/binance-execution-quote.ts';
test('a pending normal entry takes the read slot before unrelated markets and forbids more reservations',()=>{
 const f=sourceFixture();f.round.running=true;f.round.trades.push({...f.round.trades[0],id:'unrelated',symbol:'BTCUSDT',status:'open',openedAt:now-120000,entry:100,lastMark:100,qty:.051,margin:.255,risk:.1,stop:98,target:105,leverage:20,lastBar:now-60000});
 assert.deepEqual(sourceReadPlan(f.round,now),['ETHUSDT']);assert.equal(sourceMayDiscover(f.round,now),false);
 processSwingSource(f.round,f.market,now+2000);assert.equal(sourceMayDiscover(f.round,now+2000),false);
 logSwingCopy(f.round,{sourceId:'normal',symbol:'ETHUSDT',time:now+2000,status:'opened',reason:'copied'});assert.equal(sourceMayDiscover(f.round,now+2000),true);
});
test('slow unrelated markets are not read ahead of the normal entry; slow preflight refreshes price and sends in time',async()=>{
 const f=sourceFixture();f.round.running=true;f.round.trades.push({...f.round.trades[0],id:'slow',symbol:'BTCUSDT',status:'open',openedAt:now-120000,entry:100,lastMark:100,qty:.051,margin:.255,risk:.1,stop:98,target:105,leverage:20,lastBar:now-60000});
 let clock=now,readSymbols=[];
 for(const symbol of sourceReadPlan(f.round,clock)){readSymbols.push(symbol);clock+=symbol==='BTCUSDT'?80000:5000;processSwingSource(f.round,{...f.market,observedAt:clock},clock);}
 assert.deepEqual(readSymbols,['ETHUSDT']);
 const normal=f.round.trades.find(t=>t.id==='normal'),r=sourceCopyReservation(normal,0,now-1000,clock),input={...f,reservation:r,market:{...f.market,observedAt:clock}},a=adapter(input);
 a.io.now=()=>clock;a.io.vacancy=async()=>{clock+=8000;return {positions:[],orders:[],conditionals:[],available:10}};a.io.leverage=async n=>{clock+=6000;return {leverage:n}};
 let refreshes=0;a.io.refreshMarket=async()=>{clock+=1000;refreshes++;return {...input.market,observedAt:clock}};
 const result=await executeSwingInverse(input,a.io);assert.equal(refreshes,1);assert.ok(clock-r.scheduledAt<60000);assert.equal(result.quantity,normal.qty);assert.equal(a.events.filter(Array.isArray).length,1);
});
test('fresh quote cannot extend an expired source window or permit a stale final price',async()=>{
 const f=sourceFixture();processSwingSource(f.round,f.market,now+2000);const r=sourceCopyReservation(f.round.trades[0],0,now-1000,now+2000),input={...f,reservation:r};
 for(const late of [true,false]){let clock=now;const a=adapter(input);a.io.now=()=>clock;
 a.io.vacancy=async()=>{clock+=late?31000:8000;return {positions:[],orders:[],conditionals:[]}};
 a.io.refreshMarket=async()=>({...f.market,observedAt:late?clock:now});await assert.rejects(executeSwingInverse(input,a.io));assert.equal(a.events.filter(Array.isArray).length,0);}
});
test('executable quote chooses bid/ask, keeps trigger mark and rejects old or malformed prices',()=>{
 const f=fixture(),book={bidPrice:99.99,askPrice:100.01,time:now},premium={markPrice:100,time:now};
 assert.equal(binanceExecutionQuote(f.market,book,premium,1,now).mark,100.01);assert.equal(binanceExecutionQuote(f.market,book,premium,-1,now).mark,99.99);assert.equal(binanceExecutionQuote(f.market,book,premium,-1,now).executionMark,100);
 assert.throws(()=>binanceExecutionQuote(f.market,{...book,time:now-16000},premium,1,now));assert.throws(()=>binanceExecutionQuote(f.market,book,{...premium,markPrice:'bad'},1,now));
 const r={...f.reservation,source:{id:'test',quantity:.051,leverage:20,stop:98,target:105,rawEntry:100,openedAt:now,boost:0}};
 assert.throws(()=>planSwingInverse({...f.market,executionMark:106},r,10,0,.0005,now),/SL/);
});
test('expiration preserves the actual previous Binance error and stage instead of masking it',()=>{
 const f=sourceFixture();processSwingSource(f.round,f.market,now+2000);const t=f.round.trades[0];
 logSwingCopy(f.round,{sourceId:t.id,symbol:t.symbol,time:now+4000,status:'waiting',stage:'cuenta y filtros',lastFailure:'Binance no confirmó exchangeInfo para este contrato',lastFailureStage:'cuenta y filtros',attempts:2,reason:'retry'});
 expireSwingCopy(f.round,t,now+60000);const e=f.round.copies[t.id];assert.equal(e.status,'skipped');assert.match(e.reason,/exchangeInfo/);assert.match(e.reason,/cuenta y filtros/);assert.equal(e.attempts,2);assert.equal(e.history.length,2);
});
