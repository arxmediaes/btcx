export function quickScalpReady(input:{primaryCount:number;contextCount:number;primaryConfirmed:boolean;minuteConfirmed:boolean;continuationConfirmed?:boolean;pulseOpposes:boolean;contextOpposes:boolean;confluence:number;fomo:number}){
 return input.primaryCount>=65&&input.contextCount>=65&&!input.contextOpposes&&!input.pulseOpposes&&input.confluence>=12&&input.fomo<95&&input.primaryConfirmed;
}

export function scalpContinuationSide(price:number,ema:number,previousEma:number,atr:number,rsi:number):1|-1|0{
 if(![price,ema,previousEma,atr,rsi].every(Number.isFinite)||price<=0||ema<=0||atr<=0)return 0;
 const side=ema>previousEma?1:ema<previousEma?-1:0;
 if(!side||side*(price-ema)<-atr*.5)return 0;
 if(side===1?rsi<30||rsi>95:rsi<5||rsi>70)return 0;
 return side;
}
