export type V2Bracket={leverage:number;floor:number;cap:number;maintenanceRate:number;maintenanceOffset:number};
export function normalizeV2Brackets(raw:any):Record<string,V2Bracket[]>{
 if(!Array.isArray(raw)&&raw&&typeof raw==='object'&&typeof raw.symbol==='string'&&Array.isArray(raw.brackets))raw=[raw];
 if(!Array.isArray(raw))throw Error('Binance no confirmó los límites de apalancamiento');const result:Record<string,V2Bracket[]>={};
 for(const row of raw){if(!/^[A-Z0-9]+USDT$/.test(row?.symbol)||!Array.isArray(row.brackets))continue;
  const brackets=row.brackets.map((b:any)=>({leverage:Number(b.initialLeverage),floor:Number(b.notionalFloor),cap:Number(b.notionalCap),maintenanceRate:Number(b.maintMarginRatio),maintenanceOffset:Number(b.cum??0)}));
  if(!brackets.length||brackets.some((b:V2Bracket)=>!Object.values(b).every(Number.isFinite)||b.leverage<1||b.leverage>1000||b.floor<0||b.cap<=b.floor||b.maintenanceRate<0||b.maintenanceRate>=1||b.maintenanceOffset<0))continue;
  // Binance's authenticated response already supplies the account's effective bracket bounds.
  result[row.symbol]=brackets.sort((a:V2Bracket,b:V2Bracket)=>b.leverage-a.leverage);
 }
 if(!Object.keys(result).length)throw Error('Límites de apalancamiento incompletos');return result;
}
export function v2MaximumSize(input:{price:number;available:number;baseMargin:number;boost:number;step:number;minimum:number;minNotional:number;fee:number;slip:number;brackets:V2Bracket[]}){
 const {price,available,baseMargin,boost,step,minimum,minNotional,fee,slip,brackets}=input;
 if(![price,available,baseMargin,boost,step,minimum,minNotional,fee,slip].every(Number.isFinite)||Math.min(price,available,baseMargin,step,minimum,minNotional)<=0||fee<0||slip<0||![0,20,50].includes(boost)||!brackets?.length)throw Error('Faltan saldo, filtros o apalancamiento confirmado');
 const floor=(n:number)=>Number((Math.floor(n/step+1e-8)*step).toPrecision(12)),ceil=(n:number)=>Number((Math.ceil(n/step-1e-8)*step).toPrecision(12));
 const minimumLot=ceil(Math.max(minimum,minNotional/price)),allocation=baseMargin*(1+boost/100);
 for(const bracket of [...brackets].sort((a,b)=>b.leverage-a.leverage)){
  const leverage=bracket.leverage,costPerUnit=price*(1/leverage+2*fee+slip),desired=Math.max(floor(allocation*leverage/price),minimumLot),affordable=floor(available/costPerUnit),quantity=Math.min(desired,affordable);
  if(quantity<minimumLot||quantity<=0)continue;const notional=quantity*price;if(notional<bracket.floor||notional>=bracket.cap)continue;
  const margin=notional/leverage,cost=quantity*costPerUnit;if(cost>available+1e-9)continue;
  return {quantity,leverage,margin,cost,allocation,minimumLot,minimumAdjusted:minimumLot>floor(allocation*leverage/price),maintenanceRate:bracket.maintenanceRate,maintenanceOffset:bracket.maintenanceOffset};
 }
 throw Error('Saldo simulado insuficiente para el lote mínimo y sus costes, o tramo de apalancamiento no confirmado');
}
