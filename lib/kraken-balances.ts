// Kraken REST /accounts: cash and Multi-M are separate wallets.
// Never interpret missing data as a zero balance or assume stablecoins equal USD.
export function balanceNumber(value: unknown): number | null {
 if (typeof value !== 'number' && typeof value !== 'string') return null;
 if (typeof value === 'string' && !value.trim()) return null;
 const n=Number(value); return Number.isFinite(n)?n:null;
}
export function krakenBalances(wallet:any){
 const accounts=wallet?.accounts;
 if(!accounts||typeof accounts!=='object'||Array.isArray(accounts))throw Error('Kraken no devolvió sus billeteras.');
 const flex=accounts.flex;
 const currencies=flex?.currencies;
 const rows=currencies&&typeof currencies==='object'?Object.entries(currencies):[];
 const assets=rows.map(([asset,v]:[string,any])=>({asset:asset.toUpperCase(),quantity:balanceNumber(v?.quantity),usdValue:balanceNumber(v?.value)}));
 const values=assets.map(a=>a.usdValue);
 const walletBalance=balanceNumber(flex?.balanceValue)??(values.length&&values.every(v=>v!==null)?values.reduce<number>((s,v)=>s+v!,0):null);
 const margin=balanceNumber(flex?.availableMargin),equity=balanceNumber(flex?.marginEquity),reservedMargin=balanceNumber(flex?.initialMarginWithOrders);
 const availableBalance=margin===null?null:Math.max(0,equity!==null&&reservedMargin!==null?Math.min(margin,equity-reservedMargin):margin);
 const operatingBudget=walletBalance===null||equity===null?null:Math.max(0,Math.min(40,Math.min(walletBalance,equity)));
 const operatingAvailable=availableBalance===null||reservedMargin===null||operatingBudget===null?null:Math.max(0,Math.min(availableBalance,operatingBudget-Math.max(0,reservedMargin)));
 const otherWallets=Object.entries(accounts).filter(([id])=>id!=='flex').map(([id,w]:[string,any])=>({
  id,label:w?.type==='cashAccount'?'Fondos de Futures':id,
  assets:Object.entries(w?.balances||{}).filter(([asset])=>/^[a-zA-Z0-9]{2,12}$/.test(asset)).map(([asset,value])=>({asset:asset.toUpperCase(),quantity:balanceNumber(value)})).filter(a=>a.quantity!==0)
 })).filter(w=>w.assets.length);
 return {walletBalance,equity,availableBalance,reservedMargin,operatingBudget,operatingAvailable,unrealizedProfit:balanceNumber(flex?.pnl),assets,otherWallets,
  balanceWarning:!flex?'Kraken no devolvió la billetera Multi-M.':walletBalance===null?'Saldo Multi-M pendiente de confirmar.':null};
}
export function krakenTradingAvailable(account:ReturnType<typeof krakenBalances>){
 if(account.availableBalance===null||account.operatingAvailable===null)throw Error('Kraken no confirmó el margen disponible; actualiza la cuenta.');
 return Math.min(account.availableBalance,account.operatingAvailable);
}
