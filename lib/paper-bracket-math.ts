// Net per unit including both fees and adverse exit spread/slippage. Entry is already filled.
export function netAt(entry:number,rawExit:number,side:1|-1,fee:number,slip:number){const exit=rawExit*(1-side*slip);return side*(exit-entry)-(entry+exit)*fee}
export function netBracketTarget(entry:number,stop:number,side:1|-1,fee:number,slip:number,rr:number,tick:number){
 const risk=-netAt(entry,stop,side,fee,slip);
 return (rr*risk+entry*(slip+2*fee-side*slip*fee))/((1-side*slip)*(1-side*fee))+2*tick;
}
