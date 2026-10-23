import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizeSwingRealSettings} from '../lib/swing-real-settings.ts';
import {assertSwingVacant} from '../lib/real-swing-inverse.ts';
import {RealSwingInverse} from '../components/pulse/real-swing-inverse.tsx';
test('Swing preferences accept only supported caps and boosts, invalid stored data defaults to base and five',()=>{
 for(const boost of [0,20,50])for(const maxPositions of [5,10,15])assert.deepEqual(normalizeSwingRealSettings({boost,maxPositions}),{boost,maxPositions});
 for(const invalid of [null,[],{boost:100,maxPositions:100},{boost:'50',maxPositions:'15'}])assert.deepEqual(normalizeSwingRealSettings(invalid),{boost:0,maxPositions:5});
});
test('ten and fifteen account caps admit slots above five but block at the selected limit including scalp',()=>{
 for(const cap of [5,10,15]){
  const positions=Array.from({length:cap-1},(_,i)=>({symbol:`COIN${i}USDT`,entryMotor:i===0?'impulso-rsi':'swing-inverse'}));
  assert.doesNotThrow(()=>assertSwingVacant('ETHUSDT',positions,[],[],cap));
  assert.throws(()=>assertSwingVacant('ETHUSDT',[...positions,{symbol:'LASTUSDT'}],[],[],cap),/Cupo/);
  assert.throws(()=>assertSwingVacant('COIN0USDT',positions,[],[],cap),/ocupado/);
 }
});
test('Swing controls render independently of active scalp boosts and cap, default off with base size and five slots',()=>{
 const html=renderToStaticMarkup(React.createElement(RealSwingInverse,{visible:true,ready:true,apiKey:'test',privateKey:'unused',boost:50,maxPositions:15,journal:[],positions:[],blocked:()=>false,acquire:()=>false,release:()=>{},record:()=>{},refresh:()=>{},marginMode:'CROSSED'}));
 assert.match(html,/aria-checked="false"/);
 assert.match(html,/aria-pressed="true"[^>]*>Base/);
 assert.match(html,/<option value="5" selected="">Hasta 5/);
 assert.match(html,/>Hasta 10</);assert.match(html,/>Hasta 15</);
 assert.match(html,/\+20%/);assert.match(html,/\+50%/);
 assert.match(html,/aumento 0%/);
});
