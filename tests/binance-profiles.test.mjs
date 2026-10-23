import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileApiUrl,profileOwnerKey,profileFromRequest,profileStorageKey,browserBinanceProfile} from '../lib/binance-profile.ts';
import {profileLocalStorage,profileSessionStorage} from '../lib/profile-storage.ts';
import {samePassword,createAccessToken,validAccessToken} from '../lib/access-token.ts';
import {excludedRealClose} from '../lib/real-history-exclusions.ts';
const request=profile=>new Request('https://test.local/api/state'+profile);
test('primary retains exact existing database keys, secondary is disjoint, unknown profile is rejected',()=>{
 assert.equal(profileOwnerKey('owner','primary'),'owner');assert.notEqual(profileOwnerKey('owner','secondary'),'owner');assert.notEqual(profileOwnerKey('other','secondary'),profileOwnerKey('owner','secondary'));
 assert.equal(profileFromRequest(request('')),'primary');assert.equal(profileFromRequest(request('?profile=secondary')),'secondary');assert.throws(()=>profileFromRequest(request('?profile=unknown')),e=>e instanceof Response&&e.status===400);
 assert.equal(profileApiUrl('/api/state','primary'),'/api/state');assert.equal(profileApiUrl('/api/binance/connection?symbol=BTCUSDT','secondary'),'/api/binance/connection?symbol=BTCUSDT&profile=secondary');
});
test('credential sessions, activation flags, caches, preferences, and dismissals never leak from primary to secondary',()=>{
 const original=globalThis.window;const local=new Map(),session=new Map();const storage=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
 globalThis.window={location:{pathname:'/'},localStorage:storage(local),sessionStorage:storage(session)};
 try{
  const keys=['pulse-multiauto','hyrule-real-motor-activation','hyrule-swing-real-settings-v1:1234','pulse-real-history-operations-v1','hyrule-profit-dismissed:1234:today','pulse-real-open-order'];
  for(const key of keys)profileLocalStorage.setItem(key,'primary');profileSessionStorage.setItem('pulse-binance-session-v1','primary-secret');
  window.location.pathname='/binance-2';assert.equal(browserBinanceProfile(),'secondary');
  for(const key of keys)assert.equal(profileLocalStorage.getItem(key),null);assert.equal(profileSessionStorage.getItem('pulse-binance-session-v1'),null);
  profileSessionStorage.setItem('pulse-binance-session-v1','secondary-secret');profileLocalStorage.setItem('pulse-multiauto','secondary');
  profileSessionStorage.removeItem('pulse-binance-session-v1');window.location.pathname='/';
  assert.equal(profileSessionStorage.getItem('pulse-binance-session-v1'),'primary-secret');assert.equal(profileLocalStorage.getItem('pulse-multiauto'),'primary');
  assert.equal(profileStorageKey('legacy-key'),'legacy-key');
  assert.equal(excludedRealClose('OPUSDT',Date.parse('2026-10-11T02:31:30Z')),true);window.location.pathname='/binance-2';assert.equal(excludedRealClose('OPUSDT',Date.parse('2026-10-11T02:31:30Z')),false);
 }finally{if(original===undefined)delete globalThis.window;else globalThis.window=original;}
});
test('replacement passwords reject previous values and keep signed cookie verification intact',async()=>{
 assert.equal(await samePassword('replacement-test-pin','replacement-test-pin'),true);assert.equal(await samePassword('previous-test-pin','replacement-test-pin'),false);
 const secret='test-only-secret-for-access-token-verification';const token=await createAccessToken(secret,1000);assert.equal(await validAccessToken(token,secret,2000),true);assert.equal(await validAccessToken(token,'different-secret',2000),false);
});
