/** Serialize both entry motors across tabs of this Site. No account or order mutation. */
export async function withRealAccountLock<T>(account:string,action:()=>Promise<T>,busy:()=>void=()=>{}){
 if(typeof navigator==='undefined'||!navigator.locks)return action();
 return navigator.locks.request(`hyrule-real-entry:${account.slice(-4)}`,{ifAvailable:true},async lock=>{if(!lock){busy();return undefined}return action()});
}
