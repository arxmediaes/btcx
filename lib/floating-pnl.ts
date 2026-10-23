export type OpenPnlPosition={symbol:string;quantity:number;unrealizedProfit:number};
export function summarizeOpenPnl(positions:OpenPnlPosition[]|undefined){
 if(!positions)return {count:null,best:null};
 const open=positions.filter(p=>Number.isFinite(p.quantity)&&Math.abs(p.quantity)>0),priced=open.filter(p=>Number.isFinite(p.unrealizedProfit));
 const best=priced.reduce<OpenPnlPosition|null>((best,p)=>!best||p.unrealizedProfit>best.unrealizedProfit?p:best,null);
 return {count:open.length,best:best?{symbol:best.symbol.replace(/\/?USDT$/i,''),pnl:best.unrealizedProfit}:null};
}
export function clampPanel(x:number,y:number,width:number,height:number,viewportWidth:number,viewportHeight:number){
 return {x:Math.max(8,Math.min(x,Math.max(8,viewportWidth-width-8))),y:Math.max(8,Math.min(y,Math.max(8,viewportHeight-height-8)))};
}
