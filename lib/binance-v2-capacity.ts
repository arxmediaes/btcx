// A net R:R floor must include the same fees and slippage charged at execution.
export function minimumNetTarget(entry:number,stop:number,side:1|-1,fee:number,slip:number,tick:number){
 const risk=Math.abs(entry-stop)+(entry+stop)*fee+entry*slip;
 return (risk+2*entry*fee+entry*slip)/(1-side*fee)+2*tick;
}
