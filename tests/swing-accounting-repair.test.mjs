import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileEntry,normalizeRealFills} from '../lib/real-learning.ts';
import {nextHistoryEntry} from '../lib/real-history-queue.ts';
import {missingSwingCopy,recoverSwingEntry} from '../lib/swing-journal-recovery.ts';
const base={id:'ETHUSDT:100',orderId:'100',symbol:'ETHUSDT',side:'SHORT',entryMotor:'swing-inverse',quantity:1,entry:100,openedAt:1000};
const fill=(id,orderId,side,qty,realizedPnl='0',time=id)=>({id,orderId,symbol:'ETHUSDT',side,positionSide:'BOTH',qty:String(qty),price:'100',realizedPnl:String(realizedPnl),commission:'0.01',commissionAsset:'USDT',time});
test('actual numeric Binance IDs reconcile both directions and recover correct realized net after entry and exit commissions',()=>{
 for(const side of ['LONG','SHORT']){
  const buy=side==='LONG'?'BUY':'SELL',sell=side==='LONG'?'SELL':'BUY';
  const result=reconcileEntry({...base,side},[fill(1,100,buy,1),fill(2,101,sell,1,.2)]);
  assert.equal(result.status,'verified');assert.ok(Math.abs(result.net-.18)<1e-12);assert.deepEqual(result.tradeIds,['1','2']);
 }
});
test('mixed string/numeric duplicate fills, partial closes and large exact string IDs are handled without double counting',()=>{
 const opening=fill(1,100,'SELL',1),exit=fill(2,101,'BUY',.5,.1),close=fill('3','102','BUY',.5,.1);
 assert.equal(reconcileEntry(base,[opening,exit]).status,'open');
 const result=reconcileEntry(base,[opening,{...opening,id:'1',orderId:'100'},exit,close]);assert.equal(result.status,'verified');assert.ok(Math.abs(result.net-.17)<1e-12);
 assert.equal(normalizeRealFills([fill('9007199254740993123','9007199254740993124','BUY',1)])[0].id,'9007199254740993123');
 assert.throws(()=>normalizeRealFills([fill(Number.MAX_SAFE_INTEGER+10,100,'SELL',1)]),/precisión/);
 assert.equal(reconcileEntry(base,[fill(1,Number.MAX_SAFE_INTEGER+10,'SELL',1)]).status,'unmatched');
});
test('closed inverse entries are verified ahead of old scalp rows, known live opens do not consume the read queue',()=>{
 const inverse={...base,outcome:{status:'unmatched'}},legacy={...base,id:'old',entryMotor:'impulso-rsi'},positions=[{symbol:'ETHUSDT',side:'SHORT'}];
 assert.equal(nextHistoryEntry([legacy,inverse],[],true,{}).id,inverse.id);
 assert.equal(nextHistoryEntry([legacy,{...inverse,outcome:{status:'open'}}],positions,true,{}).id,'old');
 assert.equal(nextHistoryEntry([{...inverse,outcome:{status:'open'}}],[],true,{}).id,inverse.id);
});
test('lost journal rows can recover only from an opened real copy and exact verified entry fills, never virtual results',()=>{
 const normal={id:'source',arm:'normal',symbol:'ETHUSDT',side:1,strategy:'adx',stop:98,target:105,leverage:20,signalTime:1,openedAt:1000,evidence:{signalSide:1,atr:2}};
 const event={sourceId:'source',symbol:'ETHUSDT',status:'opened',orderId:100,time:1000};const round={trades:[normal],copies:{source:event}};
 const copy=missingSwingCopy(round,[],{},100000);assert.ok(copy);
 const recovered=recoverSwingEntry(copy,[fill(1,100,'SELL',1,'0',1000)]);
 assert.equal(recovered.entryMotor,'swing-inverse');assert.equal(recovered.entry,100);assert.equal(recovered.plannedStop,105);assert.equal(recovered.plannedTarget,98);assert.equal(recovered.orderId,'100');assert.equal(recovered.takerRate,.0001);
 assert.equal(missingSwingCopy(round,[recovered],{},100000),undefined);
 assert.equal(missingSwingCopy({...round,copies:{source:{...event,status:'waiting'}}},[],{},100000),undefined);
 assert.equal(missingSwingCopy(round,[],{'copy:source':99999},100000),undefined);
 assert.throws(()=>recoverSwingEntry(copy,[fill(1,999,'SELL',1)]),/confirma/);
});
