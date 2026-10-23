import {fixedPositionSize} from './fixed-position-size';
// Fixed US$0.20 reference, independent of account capital and remaining slots.
export function krakenMarginQuantity(input:{price:number;available:number;slots:number;leverage:number;step:number;minimumQty:number;rate:number;slipRate:number;boostPercent?:20|50}){
 const {price,available,slots,leverage,step,minimumQty,rate,slipRate}=input;
 if(![price,available,slots,leverage,step,minimumQty,rate,slipRate].every(Number.isFinite)||price<=0||available<=0||slots<1||leverage<1||step<=0||minimumQty<=0||rate<0||slipRate<0)throw Error('Kraken no confirmó los datos de margen y tamaño.');
 return fixedPositionSize({price,available,leverage,step,minimumQty,rate,slipRate,boostPercent:input.boostPercent});
}
