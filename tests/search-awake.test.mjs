import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSearchAwake} from '../lib/search-awake.ts';
import {initialSearchActivity,searchActivityLabel,searchInterrupted} from '../lib/search-activity.ts';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SwingSearchStatus} from '../components/pulse/swing-search-status.tsx';
function lease(){const listeners=[];return {released:false,releaseCount:0,async release(){if(this.released)return;this.released=true;this.releaseCount++;for(const listener of listeners)listener();},addEventListener(type,listener){listeners.push(listener)}};}
test('screen wake lock activates only after confirmed grant, releases when stopped',async()=>{
 const states=[],screen=lease();let requests=0;
 const c=createSearchAwake({visible:()=>true,status:s=>states.push(s),request:async()=>{requests++;return screen}});
 await c.setEnabled(true);assert.deepEqual(states,['requesting','active']);await c.refresh();assert.equal(requests,1);
 await c.setEnabled(false);assert.equal(states.at(-1),'off');assert.equal(screen.releaseCount,1);
 await c.dispose();assert.equal(screen.releaseCount,1);
});
test('denied and unsupported screen locks never claim active',async()=>{
 for(const request of [undefined,async()=>{throw Error('NotAllowedError')}]){const states=[],c=createSearchAwake({visible:()=>true,status:s=>states.push(s),request});await c.setEnabled(true);assert.equal(states.includes('active'),false);assert.equal(states.at(-1),request?'denied':'unsupported');await c.dispose();}
});
test('hidden document releases its screen lock and reacquires on visible resume',async()=>{
 let visible=true;const states=[],leases=[];
 const c=createSearchAwake({visible:()=>visible,status:s=>states.push(s),request:async()=>{const screen=lease();leases.push(screen);return screen}});
 await c.setEnabled(true);visible=false;await c.refresh();assert.equal(states.at(-1),'hidden');assert.equal(leases[0].released,true);
 visible=true;await c.refresh();assert.equal(states.at(-1),'active');assert.equal(leases.length,2);await c.dispose();
});
test('platform release is visible and retry reacquires without duplicate held leases',async()=>{
 const states=[],leases=[];const c=createSearchAwake({visible:()=>true,status:s=>states.push(s),request:async()=>{const screen=lease();leases.push(screen);return screen}});
 await c.setEnabled(true);await leases[0].release();assert.equal(states.at(-1),'released');await c.refresh();assert.equal(states.at(-1),'active');assert.equal(leases.length,2);await c.dispose();
});
test('a late grant after stop or unmount is immediately released',async()=>{
 for(const stop of ['disable','dispose']){const states=[],screen=lease();let grant;
 const c=createSearchAwake({visible:()=>true,status:s=>states.push(s),request:()=>new Promise(resolve=>grant=resolve)});
 const pending=c.setEnabled(true);if(stop==='disable')await c.setEnabled(false);else await c.dispose();grant(screen);await pending;
 assert.equal(screen.released,true);assert.equal(states.includes('active'),false);}
});
test('simultaneous wake requests share one pending request',async()=>{
 let requests=0,grant;const screen=lease(),c=createSearchAwake({visible:()=>true,status:()=>{},request:()=>{requests++;return new Promise(resolve=>grant=resolve)}});
 const start=c.setEnabled(true),retry=c.refresh();assert.equal(requests,1);grant(screen);await Promise.all([start,retry]);await c.dispose();
});
test('search heartbeat distinguishes a real interruption from ordinary ticks',()=>{
 assert.equal(searchInterrupted(0,100000),false);assert.equal(searchInterrupted(1000,16000),false);assert.equal(searchInterrupted(1000,16001),true);
});
test('search status never labels offline, hidden, stalled or disabled engines as searching',()=>{
 const a={...initialSearchActivity(),phase:'reading',lastActivityAt:1000,total:3,completed:1};
 assert.equal(searchActivityLabel(a,false,true,true,true,2000).title,'Búsqueda apagada');
 assert.match(searchActivityLabel(a,true,true,false,true,2000).title,/Sin conexión/);
 assert.match(searchActivityLabel(a,true,true,true,false,2000).title,/segundo plano/);
 assert.match(searchActivityLabel(a,true,true,true,true,50000).title,/Esperando respuesta/);
 assert.match(searchActivityLabel(a,true,true,true,true,2000).detail,/1\/3/);
 assert.match(searchActivityLabel({...a,phase:'error',nextAttemptAt:100000,lastError:'Límite Binance'},true,true,true,true,50000).title,/reintento programado/);
});
test('visible panel includes real read progress, last successful data age and honest screen state',()=>{
 const activity={...initialSearchActivity(),phase:'reading',lastActivityAt:Date.now(),lastSuccessAt:Date.now(),total:3,completed:1,cycle:7,radarCursor:3,radarTotal:30,reads:[{symbol:'BTCUSDT',state:'ok'},{symbol:'ETHUSDT',state:'reading'},{symbol:'SOLUSDT',state:'error',reason:'red'}]};
 const html=renderToStaticMarkup(React.createElement(SwingSearchStatus,{activity,active:true,ready:true,awake:'denied',visible:true,online:true,onRetry:()=>{}}));
 for(const text of ['Buscando entradas','Ciclo','Últimos datos válidos','BTC','ETH','SOL','aria-valuenow="33"','no permitió mantener la pantalla activa','Reintentar pantalla activa'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Pantalla activa confirmada'));
});
