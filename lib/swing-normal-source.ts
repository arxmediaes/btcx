import {createV2Round,processV2Market,type V2Round,type V2Trade,type V2Market} from './binance-v2-swing';
import {RADAR_COINS} from './engine';
import type {SwingReservation} from './real-swing-inverse';
export type SwingCopyEvent={sourceId:string;symbol:string;time:number;status:'waiting'|'submitted'|'opened'|'skipped'|'error';reason:string;orderId?:string|number;stage?:string;attempts?:number;lastFailure?:string;lastFailureStage?:string;elapsedMs?:number;history?:{time:number;stage:string;reason:string}[]};
export type SwingSourceRound=V2Round&{copies?:Record<string,SwingCopyEvent>};
export function createSwingSource(now=Date.now()):SwingSourceRound{return {...createV2Round({maxPositions:5},now),running:false,copies:{}}}
export function processSwingSource(r:SwingSourceRound,m:V2Market,now=Date.now(),discover=true){
 // Read the current minute OPEN only for entry. Exits still require CLOSED minute candles.
 processV2Market(r,m,now,discover&&sourceMayDiscover(r,now),true);r.lastTick=now;
}
export function sourceCopyReservation(t:V2Trade,boost:0|20|50,activatedAt:number,now=Date.now()):SwingReservation{
 if(t.arm!=='normal'||t.status!=='open'||!t.openedAt||t.openedAt<activatedAt||now<t.openedAt||now>=t.openedAt+60000)throw Error('La entrada normal simulada es anterior a la activación o su minuto ya expiró.');
 if(![t.qty,t.leverage,t.rawEntry,t.stop,t.target].every(n=>Number.isFinite(n)&&Number(n)>0))throw Error('Entrada simulada aún sin tamaño o niveles confirmados.');
 return {symbol:t.symbol,strategy:t.strategy,side:t.side,signalTime:t.signalTime,scheduledAt:t.openedAt,evidence:t.evidence,source:{id:t.id,quantity:t.qty!,leverage:t.leverage!,stop:t.stop!,target:t.target!,rawEntry:t.rawEntry!,openedAt:t.openedAt,boost}};
}
export function sourceMayDiscover(r:SwingSourceRound,now=Date.now()){
 return !r.trades.some(t=>t.arm==='normal'&&(t.status==='pending'||t.status==='open'&&now<(t.openedAt??0)+60000&&(!r.copies?.[t.id]||r.copies[t.id].status==='waiting')));
}
export function sourceReadPlan(r:SwingSourceRound,now=Date.now()){
 // Execution has one turn. Do not read unrelated markets ahead of an accepted entry.
 const waiting=r.trades.filter(t=>t.arm==='normal'&&t.status==='open'&&now<(t.openedAt??0)+60000&&(!r.copies?.[t.id]||r.copies[t.id].status==='waiting')).sort((a,b)=>a.openedAt!-b.openedAt!)[0];
 const pending=r.trades.filter(t=>t.arm==='normal'&&t.status==='pending').sort((a,b)=>a.scheduledAt-b.scheduledAt)[0];
 if(waiting||pending)return [(waiting||pending)!.symbol];
 const active=[...new Set(r.trades.filter(t=>t.status==='open'||t.status==='pending').sort((a,b)=>(a.status==='pending'?-1:1)-(b.status==='pending'?-1:1)||(a.lastBar??a.scheduledAt)-(b.lastBar??b.scheduledAt)).map(t=>t.symbol))];
 const fresh:string[]=[];if(r.running)for(let i=0;i<3;i++){fresh.push(RADAR_COINS[r.cursor%RADAR_COINS.length]+'USDT');r.cursor=(r.cursor+1)%RADAR_COINS.length;}
 return [...new Set([...active,...fresh])];
}
export function logSwingCopy(r:SwingSourceRound,event:SwingCopyEvent){
 const previous=r.copies?.[event.sourceId],history=[...(previous?.history||[]),{time:event.time,stage:event.stage||event.status,reason:event.reason}].slice(-30);
 r.copies={...r.copies,[event.sourceId]:{...previous,...event,history}};
}
export function expireSwingCopy(r:SwingSourceRound,t:V2Trade,now:number){
 const previous=r.copies?.[t.id];if(previous?.status!=='waiting'||t.status==='open'&&now<(t.openedAt??0)+60000)return;
 const failure=previous.lastFailure||previous.reason,stage=previous.lastFailureStage||previous.stage||'turno de ejecución';
 logSwingCopy(r,{sourceId:t.id,symbol:t.symbol,time:now,status:'skipped',stage:'caducada',elapsedMs:now-(t.openedAt??now),reason:`La copia caducó sin enviarse. Último bloqueo (${stage}): ${failure}`});
}
