import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swingProfitView} from '../lib/swing-profit-view.ts';
const day=Date.parse('2026-10-22T03:00:00Z');
const base={id:'swing-1',entryMotor:'swing-inverse',symbol:'ETHUSDT',side:'SHORT',quantity:.1,entry:100,openedAt:day-3600000};
const closed=(id,net,closedAt=day+1000)=>({...base,id,outcome:{status:'verified',net,closedAt,commission:.01}});
test('motor baseline counts existing inverse wins and losses and excludes prior scalp or legacy account trades',()=>{
 const entries=[closed('old-swing',.5,day-1000),closed('win',.2),closed('loss',-.1),{...closed('scalp',-9),entryMotor:'impulso-rsi'},{...closed('legacy',10),entryMotor:'legacy'}];
 const original=structuredClone(entries),view=swingProfitView(entries,[],day);
 assert.ok(Math.abs(view.net-.6)<1e-12);assert.ok(Math.abs(view.today-.1)<1e-12);assert.equal(view.closed.length,3);assert.equal(view.startedAt,base.openedAt);assert.deepEqual(entries,original);
});
test('unverified, ambiguous, partial, nonfinite and duplicate outcomes cannot inflate the winnings',()=>{
 const rows=[closed('good',.25),closed('good',.25),...['open','unmatched','ambiguous','fees-unverified','excluded'].map(status=>({...closed(status,99),outcome:{status,net:99,closedAt:day+1}})),closed('nan',NaN),closed('missing-time',.4,undefined)];
 rows.at(-1).outcome.closedAt=undefined;
 const view=swingProfitView(rows,[],day);assert.equal(view.net,.25);assert.equal(view.closed.length,1);
});
test('floating widgets include only positions attributed to the inverse motor, allowing partial positions',()=>{
 const entry={...base,id:'open'},positions=[{symbol:'ETHUSDT',side:'SHORT',quantity:-.05,entryPrice:100,unrealizedProfit:.12},{symbol:'BTCUSDT',side:'LONG',quantity:1,entryPrice:100,unrealizedProfit:9}];
 const view=swingProfitView([entry],positions,day);assert.equal(view.floating,.12);assert.equal(view.count,1);assert.equal(view.best.symbol,'ETH');
 const mixed=swingProfitView([entry],[{...positions[0],quantity:-.2}],day);assert.equal(mixed.floating,0);assert.equal(mixed.count,0);
});
test('no inverse trades begins at zero and never imports a previous account balance',()=>{
 const view=swingProfitView([{...closed('scalp',3),entryMotor:'impulso-rsi'}],[],day);assert.equal(view.net,0);assert.equal(view.today,0);assert.equal(view.startedAt,null);
});
