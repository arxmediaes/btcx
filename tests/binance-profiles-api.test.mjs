import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {getTableName} from 'drizzle-orm';
const state={user:{userId:'user-owner',displayName:'Test'},tables:new Map(),reads:[]};globalThis.__profileApiTest=state;
registerHooks({load(url,context,next){
 if(url.endsWith('/app/chatgpt-auth.ts'))return {format:'module',source:'export async function getChatGPTUser(){return globalThis.__profileApiTest.user}',shortCircuit:true};
 if(url.endsWith('/db/index.ts'))return {format:'module',source:'export function getDb(){return globalThis.__profileApiTest.db}',shortCircuit:true};
 if(url.endsWith('/lib/binance.ts'))return {format:'module',source:`export const encryptSecret=async v=>'enc:'+v;export const decryptSecret=async v=>v.slice(4);export const friendlyBinanceError=e=>e.message;export const binanceRequest=()=>{throw Error('Unexpected request')};export async function readBinanceSnapshot(key){globalThis.__profileApiTest.reads.push(key);return {account:{positions:[],availableBalance:10}}}`,shortCircuit:true};
 return next(url,context);
}});
function params(value,out=[]){if(!value||typeof value!=='object')return out;if(value.constructor?.name==='Param'){out.push(value.value);return out}for(const chunk of value.queryChunks||[])params(chunk,out);return out}
const table=t=>{const name=getTableName(t);if(!state.tables.has(name))state.tables.set(name,new Map());return state.tables.get(name)};
const owner=where=>params(where).find(v=>typeof v==='string'&&v.startsWith('user-'));
state.db={select:()=>({from:t=>({where:async w=>{const row=table(t).get(owner(w));return row?[structuredClone(row)]:[]}})}),insert:t=>({values:row=>({onConflictDoNothing:async()=>{if(!table(t).has(row.userId))table(t).set(row.userId,{...row})},onConflictDoUpdate:async({set})=>{table(t).set(row.userId,table(t).has(row.userId)?{...table(t).get(row.userId),...set}:{...row})}})}),update:t=>({set:patch=>({where:w=>{const key=owner(w),row=table(t).get(key),revision=params(w).find(v=>typeof v==='number');const rows=[];if(row&&(revision===undefined||row.revision===revision)){table(t).set(key,{...row,...patch});rows.push({revision:patch.revision})}return {returning:async()=>rows,then:(resolve,reject)=>Promise.resolve(rows).then(resolve,reject)}}})}),delete:t=>({where:async w=>{table(t).delete(owner(w))}})};
const connection=await import('../app/api/binance/connection/route.ts');
const workspace=await import('../app/api/state/route.ts');
const req=(path,method='GET',body)=>new Request('https://test.local'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
const credentials=apiKey=>({apiKey,keyType:'hmac',apiSecret:'fake-secret-long-enough-for-tests'});
const primary='PRIMARY_API_KEY_1234567890',secondary='SECONDARY_API_KEY_1234567890';
test('two authenticated profile connections and workspaces remain isolated through read, write and delete',async()=>{
 assert.equal((await connection.POST(req('/api/binance/connection','POST',credentials(primary)))).status,200);
 const before=structuredClone(state.tables.get('binance_connections').get('user-owner'));
 assert.equal((await connection.POST(req('/api/binance/connection?profile=secondary','POST',credentials(secondary)))).status,200);
 assert.deepEqual(state.tables.get('binance_connections').get('user-owner'),before);
 const first=await (await connection.GET(req('/api/binance/connection'))).json(),second=await (await connection.GET(req('/api/binance/connection?profile=secondary'))).json();
 assert.equal(first.sessionCredentials.apiKey,primary);assert.equal(second.sessionCredentials.apiKey,secondary);
 for(const [profile,net] of [['',1],['?profile=secondary',2]]){
  const result=await workspace.POST(req('/api/state'+profile,'POST',{revision:0,state:{trades:[],experiments:[],realJournal:[{id:net}]}}));assert.equal(result.status,200);
 }
 assert.equal((await (await workspace.GET(req('/api/state'))).json()).state.realJournal[0].id,1);
 assert.equal((await (await workspace.GET(req('/api/state?profile=secondary'))).json()).state.realJournal[0].id,2);
 assert.equal((await connection.POST(req('/api/binance/connection?profile=secondary','POST',credentials(primary)))).status,409);
 assert.equal((await connection.DELETE(req('/api/binance/connection?profile=secondary','DELETE'))).status,200);
 assert.equal((await (await connection.GET(req('/api/binance/connection?profile=secondary'))).json()).connected,false);
 assert.equal((await (await connection.GET(req('/api/binance/connection'))).json()).sessionCredentials.apiKey,primary);
 assert.equal((await (await workspace.GET(req('/api/state?profile=secondary'))).json()).state.realJournal[0].id,2);
});
test('unknown profiles fail closed, identities cannot select another owner, and missing identity never exposes credentials',async()=>{
 const before=JSON.stringify([...state.tables.entries()].map(([k,v])=>[k,[...v]]));
 for(const route of [connection,workspace])assert.equal((await route.GET(req('/api/test?profile=user-owner'))).status,400);
 assert.equal(JSON.stringify([...state.tables.entries()].map(([k,v])=>[k,[...v]])),before);
 state.user={userId:'user-other',displayName:'Other'};
 assert.equal((await (await connection.GET(req('/api/binance/connection'))).json()).connected,false);
 assert.equal((await (await workspace.GET(req('/api/state?profile=secondary'))).json()).state,null);
 state.user=null;assert.equal((await connection.GET(req('/api/binance/connection'))).status,401);assert.equal((await workspace.GET(req('/api/state'))).status,401);
});
