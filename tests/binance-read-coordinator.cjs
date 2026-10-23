const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let now=1800000000000,calls=0,status=200,body={value:1},headers={},stored={},pending;
const modules=new Map();
function load(file){if(modules.has(file))return modules.get(file);const module={exports:{}};modules.set(file,module.exports);vm.runInNewContext(ts.transpile(fs.readFileSync(file,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),{module,exports:module.exports,require:p=>load('lib/'+p.replace('./','')+'.ts'),Date:class extends Date{static now(){return now}},URL,URLSearchParams,Headers,Response,AbortSignal,Map,Error,window:{localStorage:{getItem:k=>stored[k],setItem:(k,v)=>stored[k]=v}},fetch:async()=>{calls++;if(pending)await pending;return new Response(JSON.stringify(body),{status,headers})}},{filename:file});return module.exports}
(async()=>{
const c=load('lib/binance-read-coordinator.ts'),url='https://fapi.binance.com/fapi/v3/account',auth={headers:{'X-MBX-APIKEY':'account-a'}};
let release;pending=new Promise(r=>release=r);const a=c.coordinatedBinanceFetch(url+'?timestamp=1&signature=abc',auth);now+=2000;const b=c.coordinatedBinanceFetch(url+'?signature=def&timestamp=2',auth);release();await Promise.all([a,b]);pending=null;assert.equal(calls,1,'dedup same account despite different signatures');
await c.coordinatedBinanceFetch(url,{headers:{'X-MBX-APIKEY':'account-b'}});assert.equal(calls,2,'accounts isolated');
await c.coordinatedBinanceFetch(url,{...auth,method:'POST'});await c.coordinatedBinanceFetch(url+'?timestamp=3',auth);assert.equal(calls,4,'mutation not cached and invalidates reads');
now+=1100;await c.coordinatedBinanceFetch(url,auth);assert.equal(calls,5,'account refreshes after short TTL');
const income='https://fapi.binance.com/fapi/v1/income?startTime=1&endTime=';
assert.equal(c.binanceReadKey(income+(now+1)+'&page=1',auth),c.binanceReadKey(income+(now+2)+'&page=1',auth));assert.notEqual(c.binanceReadKey(income+now+'&page=1',auth),c.binanceReadKey(income+now+'&page=2',auth));
status=429;body={code:-1003,msg:'Too many requests'};headers={'Retry-After':'90'};
await c.coordinatedBinanceFetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT');const before=calls;
await assert.rejects(c.coordinatedBinanceFetch(url,auth),/Espera 90/);assert.equal(calls,before,'no requests during shared cooldown');assert.equal(c.binanceReadWait(),90000);assert.ok(Object.values(stored).length,'deadline shared with tabs');
status=200;body={ok:true};headers={};await c.coordinatedBinanceFetch(url,{...auth,method:'DELETE'});assert.equal(calls,before+1,'risk reducing mutations are not suppressed/retried by read limiter');
now+=90001;assert.equal(c.binanceReadWait(),0);await c.coordinatedBinanceFetch(url,auth);
const radar=load('lib/real-radar.ts');now+=1100;status=429;body={code:-1003,msg:'Too many requests'};const n=calls;await assert.rejects(radar.readFuturesRadar('ETHUSDT','3m'));assert.equal(calls,n+1,'429 never reroutes through proxy');
now+=60001;status=200;body=Array.from({length:65},()=>[1,2,3]);const n2=calls;await radar.readFuturesRadar('ETHUSDT','3m');await radar.readFuturesRadar('ETHUSDT','3m');assert.equal(calls,n2+1,'radar cached and direct success does not duplicate proxy request');
console.log('PASS: read dedup, credential isolation, mutation invalidation, pagination, TTL, shared Retry-After cooldown, no order retries, no proxy fallback on 429, radar reuse. Mock responses only.');
})().catch(e=>{console.error(e);process.exitCode=1});
