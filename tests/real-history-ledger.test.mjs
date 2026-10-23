import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {registerHooks} from 'node:module';
import {mergeRealHistory,historyRecoveryFor} from '../lib/real-history-ledger.ts';
import {realHistoryView,RECOVERED_PRIMARY_SWING_HISTORY_START as start} from '../lib/real-history-view.ts';
import {RealHistoryProfit} from '../components/pulse/real-history-profit.tsx';
const at=start+10000,row={id:'AAAUSDT-income1',symbol:'AAA',tradeId:'101',realizedPnl:1.2,time:at};
test('a partial/empty or missing live response cannot erase restored closures; corrections and losses still reduce total',()=>{
 assert.deepEqual(mergeRealHistory([row],[]),[row]);assert.deepEqual(mergeRealHistory([row],null),[row]);assert.equal(mergeRealHistory(null,undefined),null);assert.deepEqual(mergeRealHistory([]),[]);
 assert.equal(mergeRealHistory([row],[{...row,id:'alternate-income-id',symbol:'AAAUSDT',realizedPnl:.9}]).length,1);
 const merged=mergeRealHistory([row],[{...row,realizedPnl:.9},{...row,id:'other',tradeId:'102',realizedPnl:-.8}]);assert.ok(Math.abs(realHistoryView(merged,start,start).total-.1)<1e-10);
 assert.throws(()=>mergeRealHistory([{...row,realizedPnl:NaN}]),/inválido/);
});
test('recovery requires the authenticated stable user, selected profile and matching account',()=>{
 const data=JSON.stringify({ownerUserId:'owner',profile:'primary',accountKey:'test',start,readAt:at,rows:[row]});
 assert.equal(historyRecoveryFor(data,'other','primary','test'),null);assert.equal(historyRecoveryFor(data,'owner','secondary','test'),null);assert.equal(historyRecoveryFor(data,'owner','primary','else'),null);
 assert.equal(historyRecoveryFor(data,'owner','primary','test').rows.length,1);assert.equal(historyRecoveryFor(undefined,'owner','primary','test'),null);
});
test('all restored rows, rather than only today, feed the balloon and floating Total',()=>{
 const now=Date.parse('2026-10-24T14:00:00Z'),newRow={...row,id:'new',tradeId:'103',time:now,realizedPnl:.3};
 const rows=mergeRealHistory([row],[newRow]);const html=renderToStaticMarkup(React.createElement(RealHistoryProfit,{historyStart:start,rows,positions:[],floating:0,accountKey:'test',accountName:'Erre Binance',updatedAt:now,pnlUpdatedAt:now,now}));
 assert.equal((html.match(/>\+?US\$1,50</g)||[]).length,2);assert.match(html,/US\$0,30/);
});
const state={user:{userId:'owner'},connection:{apiKeyLast4:'test'},env:{HYRULE_REAL_HISTORY_RECOVERY:JSON.stringify({ownerUserId:'owner',profile:'primary',accountKey:'test',start,readAt:at,rows:[row]})}};globalThis.__historyApiTest=state;
registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'mock:history-env',shortCircuit:true};return next(specifier,context)},load(url,context,next){if(url==='mock:history-env')return {format:'module',source:'export const env=globalThis.__historyApiTest.env',shortCircuit:true};if(url.endsWith('/app/chatgpt-auth.ts'))return {format:'module',source:'export async function getChatGPTUser(){return globalThis.__historyApiTest.user}',shortCircuit:true};if(url.endsWith('/db/index.ts'))return {format:'module',source:'export function getDb(){return {select(){return {from(){return {where(){return globalThis.__historyApiTest.connection?[globalThis.__historyApiTest.connection]:[]}}}}}}}',shortCircuit:true};return next(url,context)}});
const {GET}=await import('../app/api/real-history/route.ts');
test('recovery endpoint is GET-only, private, and never returns another user/account report',async()=>{
 let response=await GET(new Request('https://test/api/real-history'));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private/);assert.equal((await response.json()).recovery.rows.length,1);
 state.user={userId:'other'};assert.equal((await (await GET(new Request('https://test/api/real-history'))).json()).recovery,null);
 state.user={userId:'owner'};assert.equal((await (await GET(new Request('https://test/api/real-history?profile=secondary'))).json()).recovery,null);
 state.connection={apiKeyLast4:'different'};assert.equal((await (await GET(new Request('https://test/api/real-history'))).json()).recovery,null);
 state.user=null;assert.equal((await GET(new Request('https://test/api/real-history'))).status,401);
});
