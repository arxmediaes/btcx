import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appendRealEvidence,entryEconomics,summarizeRealizedRows} from '../lib/real-journal.ts';

test('realized rows deduplicate income IDs without claiming complete trades',()=>{
 const rows=[{id:'a',realizedPnl:.08},{id:'b',realizedPnl:-.02},{id:'a',realizedPnl:.08},{id:'c',realizedPnl:0}];
 const result=summarizeRealizedRows(rows);
 assert.equal(result.count,3);assert.equal(result.positive,1);assert.equal(result.negative,1);assert.equal(result.zero,1);assert.ok(Math.abs(result.gross-.06)<1e-10);
});
test('entry evidence cannot be overwritten by later indicators',()=>{
 const original={id:'BTCUSDT:1',entry:100};
 assert.deepEqual(appendRealEvidence([original],{...original,entry:200}),[original]);
 assert.equal(appendRealEvidence(Array.from({length:250},(_,i)=>({id:String(i)})),{id:'new'}).length,250);
});
test('target and stop costs use both execution notionals for longs and shorts',()=>{
 for(const side of [1,-1]){
  const entry={entry:100,plannedStop:100-side,plannedTarget:100+side,quantity:2,takerRate:.0005};
  const result=entryEconomics(entry);
  assert.equal(result.stopPct,1);assert.equal(result.targetPct,1);
  assert.ok(Math.abs(result.netTarget-(2-2*(100+entry.plannedTarget)*.0005))<1e-10);
  assert.ok(result.netRisk>2);assert.ok(result.breakEvenWinRate>50);
 }
});
test('an objective below fees is not a profitable target',()=>{
 assert.equal(entryEconomics({entry:100,plannedStop:99,plannedTarget:100.01,quantity:1,takerRate:.0005}).breakEvenWinRate,null);
});
