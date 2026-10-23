import {browserBinanceProfile} from './binance-profile';
// User-requested exclusion: accidental OP closes on 10 Oct 2026, 23:31 Santiago.
// Scoped to that minute and exact known trade IDs, never to later OP operations.
const ids=new Set(['979340577','979340578']);
const from=Date.parse('2026-10-11T02:31:00Z'),until=from+60000;
export function excludedRealClose(symbol:string,time:number,tradeId?:string){if(browserBinanceProfile()==='secondary')return false;return symbol.replace(/USDT$/i,'')==='OP'&&(ids.has(String(tradeId||''))||(time>=from&&time<until));}
export function excludedRealEntry(entry:{symbol:string;outcome?:{closedAt?:number;tradeIds?:string[]}}){if(browserBinanceProfile()==='secondary')return false;return excludedRealClose(entry.symbol,Number(entry.outcome?.closedAt||0))||(entry.symbol==='OPUSDT'&&entry.outcome?.tradeIds?.some(id=>ids.has(String(id))))||false;}
