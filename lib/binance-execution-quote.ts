import type {V2Market} from './binance-v2-swing';
/** Only two live prices are needed after a normal simulation has accepted the signal. */
export function binanceExecutionQuote(m:V2Market,book:{bidPrice:unknown;askPrice:unknown;time:unknown},premium:{markPrice:unknown;time:unknown},side:1|-1,now=Date.now()):V2Market{
 const bid=Number(book.bidPrice),ask=Number(book.askPrice),mark=Number(premium.markPrice),bookTime=Number(book.time),markTime=Number(premium.time);
 if(![bid,ask,mark,bookTime,markTime].every(Number.isFinite)||bid<=0||ask<bid||mark<=0||Math.abs(now-bookTime)>15000||Math.abs(now-markTime)>15000)throw Error('Cotización de ejecución incompleta o antigua; esperando precios actuales.');
 return {...m,mark:side===1?ask:bid,executionMark:mark,spread:(ask-bid)/((ask+bid)/2),observedAt:Math.min(bookTime,markTime)};
}
