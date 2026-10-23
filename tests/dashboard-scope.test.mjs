import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {realHistoryView,swingHistoryStart,accountHistoryStart,RECOVERED_PRIMARY_SWING_HISTORY_START} from '../lib/real-history-view.ts';
import {DashboardBlock} from '../components/pulse/dashboard-block.tsx';
import {RealHistoryProfit} from '../components/pulse/real-history-profit.tsx';
const start=Date.parse('2026-10-21T15:00:00Z'),now=start+86400000,day=start+43200000;
const old=Array.from({length:658},(_,i)=>({id:`old-${i}`,symbol:'BTC',realizedPnl:-.01,time:start-1000-i,tradeId:`old-${i}`}));
const recent=Array.from({length:32},(_,i)=>({id:`new-${i}`,symbol:'INJ',realizedPnl:.4,time:day+1000+i,tradeId:`new-${i}`}));
test('PC with 658 old closes and mobile without them show the same new-motor total',()=>{
 const entries=[{entryMotor:'impulso-rsi',openedAt:start-86400000},{entryMotor:'swing-inverse',openedAt:start},{entryMotor:'swing-inverse',openedAt:start+1000}];
 const cutoff=swingHistoryStart(entries);assert.equal(cutoff,start);
 const pc=realHistoryView([...old,...recent,recent[0]],day,cutoff),mobile=realHistoryView(recent,day,cutoff);
 assert.deepEqual(pc,mobile);assert.equal(pc.count,32);assert.ok(Math.abs(pc.total-12.8)<1e-10);assert.equal(pc.today,pc.total);
 const html=renderToStaticMarkup(React.createElement(RealHistoryProfit,{historyStart:cutoff,rows:[...old,...recent],positions:[],floating:0,accountKey:'test',accountName:'Erre Binance',updatedAt:now,pnlUpdatedAt:now,now}));
 assert.match(html,/US\$12,80/);assert.match(html,/32 cierres/);
});
test('scope uses real confirmed entry evidence and stays pending if no shared start exists',()=>{
 assert.equal(swingHistoryStart([]),null);assert.equal(realHistoryView([...old,...recent],day,null).total,null);
 const round={trades:[{id:'normal-1',openedAt:start}],copies:{one:{sourceId:'normal-1',status:'opened',orderId:123,time:start+500},two:{status:'skipped',time:start-10000}}};
 assert.equal(swingHistoryStart([],round),start);
 assert.equal(swingHistoryStart([{entryMotor:'swing-inverse',openedAt:start+10000}]),start+10000);
});
test('collapsed blocks retain their children in the rendered tree',()=>{
 const html=renderToStaticMarkup(React.createElement(DashboardBlock,{id:'test-block',label:'Motor',defaultCollapsed:true},React.createElement('span',null,'supervisor-mounted')));
 assert.match(html,/aria-expanded="false"/);assert.match(html,/id="block-test-block" hidden=""/);assert.match(html,/supervisor-mounted/);assert.match(html,/Ocultar Motor/);
});
function nonViewBody(source,name){const file=ts.createSourceFile('source.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let fn;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)fn=n;ts.forEachChild(n,visit)}visit(file);assert.ok(fn?.body);const statements=[...fn.body.statements];assert.equal(statements.at(-1).kind,ts.SyntaxKind.ReturnStatement);return statements.slice(0,-1).map(n=>n.getText(file)).join('\n');}
test('Swing supervisor and scalp desk behavior are unchanged; edits only wrap their returned views',()=>{
 for(const [file,name] of [['components/pulse/real-swing-inverse.tsx','RealSwingInverse'],['components/pulse/real-trading-desk.tsx','RealTradingDesk'],['components/pulse/swing-inverse-desk.tsx','SwingInverseDesk']]){
 const original=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'}),current=readFileSync(file,'utf8');assert.equal(nonViewBody(current,name),nonViewBody(original,name),name);
 }
 const changed=execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n');
 assert.ok(!changed.some(file=>/^lib\/(binance-v2|real-entry|real-swing|linked-swing|loss-pause)/.test(file)));
});

test('mobile recovery restores the primary report even with no local inverse journal; secondary stays independent',()=>{
 const amounts=[.15,.15,.285,.35976,.35478,.0616,.04351,.11502,.13984,.852,.149,.149,.149,.1192,.175,.35,.28208,.02296,.615,.0492,.4118,.09765,.3296,.9476,.347,.268,.64416,.53862,.43512,.3288,.23828,.3003,.472,.2,.28014,.1737,.4053];
 const cutoff=accountHistoryStart('primary',[]);assert.equal(cutoff,RECOVERED_PRIMARY_SWING_HISTORY_START);
 const recovered=amounts.map((realizedPnl,i)=>({id:'recovered-'+i,tradeId:'recovered-'+i,symbol:'TEST',realizedPnl,time:cutoff+1+i}));
 const legacy=Array.from({length:658},(_,i)=>({id:'legacy-'+i,tradeId:'legacy-'+i,symbol:'TEST',realizedPnl:-.02,time:cutoff-1-i}));
 const pc=realHistoryView([...legacy,...recovered],cutoff,cutoff),mobile=realHistoryView(recovered,cutoff,cutoff);
 assert.deepEqual(pc,mobile);assert.equal(pc.count,37);assert.ok(Math.abs(pc.total-10.99002)<1e-10);
 assert.equal(accountHistoryStart('secondary',[]),null);assert.equal(accountHistoryStart('secondary',[],undefined,cutoff+5000),cutoff+5000);
 const html=renderToStaticMarkup(React.createElement(RealHistoryProfit,{historyStart:cutoff,rows:[...legacy,...recovered],positions:[],floating:0,accountKey:'test',accountName:'Erre Binance',updatedAt:now,pnlUpdatedAt:now,now}));assert.match(html,/US\$10,99/);
});
