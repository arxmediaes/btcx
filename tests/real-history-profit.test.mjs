import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {realHistoryView} from '../lib/real-history-view.ts';
import {PNL_PERIOD_START,santiagoDayStart} from '../lib/pnl-period.ts';
import {RealHistoryProfit} from '../components/pulse/real-history-profit.tsx';
const now=Date.parse('2026-10-23T00:13:00Z'),day=santiagoDayStart(now);
const rows=Array.from({length:32},(_,i)=>({id:String(i),symbol:'INJ',realizedPnl:i===0?-.02:.06,time:day+1000+i,tradeId:String(i)}));
test('the same 32 visible real history rows supply the total without requiring any bot journal',()=>{
 const view=realHistoryView(rows,day);assert.equal(view.count,32);assert.ok(Math.abs(view.total-1.84)<1e-12);assert.equal(view.today,view.total);
 const html=renderToStaticMarkup(React.createElement(RealHistoryProfit,{rows,positions:[],floating:0,accountKey:'test',accountName:'Erre Binance',updatedAt:now,pnlUpdatedAt:now,now}));
 assert.match(html,/¡Has ganado!/);assert.match(html,/US\$1,84/);assert.match(html,/32 cierres del Historial real/);assert.match(html,/Erre Binance · P&amp;L/);assert.match(html,/antes de comisiones y financiación/);
 assert.doesNotMatch(html,/Verificando Swing|Acumulado e historial Swing|profit-recent-history|with-history/);
 assert.match(html,/Cerrar aviso de ganancias acumuladas/);
});
test('history rows apply the same reset, exclusions and deduplication for the table and balloon',()=>{
 const input=[...rows,rows[0],{...rows[0],id:'old',time:PNL_PERIOD_START-1}];
 const result=realHistoryView(input,day);assert.equal(result.rows.length,32);assert.ok(Math.abs(result.total-1.84)<1e-12);
 const prior={...rows[0],id:'prior-day',time:day-1,realizedPnl:.5};const mixed=realHistoryView([...rows,prior],day);assert.ok(Math.abs(mixed.total-2.34)<1e-12);assert.ok(Math.abs(mixed.today-1.84)<1e-12);
});
test('missing history stays unavailable, a confirmed empty history is zero, and a loss is never advertised as won',()=>{
 assert.equal(realHistoryView(undefined,day).total,null);assert.equal(realHistoryView(null,day).total,null);assert.equal(realHistoryView([],day).total,0);
 const html=renderToStaticMarkup(React.createElement(RealHistoryProfit,{rows:[{...rows[0],realizedPnl:-1}],positions:[],floating:0,accountKey:'test',accountName:'Erre Binance',updatedAt:now,now}));
 assert.match(html,/−US\$1,00/);assert.match(html,/display:none/);
});
test('account floating values and count remain available even with no inverse journal or failed history refresh',()=>{
 const html=renderToStaticMarkup(React.createElement(RealHistoryProfit,{rows,positions:[{symbol:'ETHUSDT',quantity:1,unrealizedProfit:.3}],floating:.3,accountKey:'test',accountName:'Usuario 2 Binance',updatedAt:now,pnlUpdatedAt:now-120000,error:'Lectura temporal pendiente',now}));
 assert.match(html,/US\$0,30/);assert.match(html,/Abiertas <strong>1/);assert.match(html,/US\$1,84/);assert.match(html,/última lectura/);assert.match(html,/Usuario 2 Binance · P&amp;L/);
});
