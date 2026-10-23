import {normalizeV2Brackets} from './binance-v2-sizing';
/** Both real and paper execution use MARKET_LOT_SIZE and the account's actual brackets. */
export function binanceContractRules(exchange:any,rawBrackets:any,symbol:string){
 const info=exchange?.symbols?.find((x:any)=>x.symbol===symbol);
 if(!info)throw Error(`${symbol}: Binance no confirmó exchangeInfo para este contrato.`);
 if(info.status!=='TRADING'||info.contractType!=='PERPETUAL')throw Error(`${symbol}: contrato perpetuo no disponible para operar.`);
 const lot=info.filters?.find((f:any)=>f.filterType==='MARKET_LOT_SIZE'&&Number(f.stepSize)>0)||info.filters?.find((f:any)=>f.filterType==='LOT_SIZE'),notional=info.filters?.find((f:any)=>['MIN_NOTIONAL','NOTIONAL'].includes(f.filterType)),price=info.filters?.find((f:any)=>f.filterType==='PRICE_FILTER');
 const brackets=normalizeV2Brackets(rawBrackets)[symbol];if(!brackets?.length)throw Error(`${symbol}: Binance no confirmó sus tramos de apalancamiento.`);
 const rules={symbol,minQty:Number(lot?.minQty),stepSize:Number(lot?.stepSize),minNotional:Number(notional?.notional??notional?.minNotional),tickSize:Number(price?.tickSize),maxLeverage:Math.max(...brackets.map(b=>b.leverage))};
 const missing=Object.entries(rules).filter(([key,value])=>key!=='symbol'&&(!Number.isFinite(value)||Number(value)<=0)).map(([key])=>key);
 if(missing.length)throw Error(`${symbol}: filtros Binance incompletos (${missing.join(', ')}).`);
 return rules;
}
export function unconfirmedBinanceRules(symbol:string,readError:string){return {symbol,minQty:0,stepSize:0,minNotional:0,tickSize:0,maxLeverage:null,readError}}
