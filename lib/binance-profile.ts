export type BinanceProfile='primary'|'secondary';
export function profileFromRequest(request:Request):BinanceProfile{
 const profile=new URL(request.url).searchParams.get('profile');
 if(profile===null||profile==='primary')return 'primary';
 if(profile==='secondary')return profile;
 throw Response.json({error:'Perfil Binance inválido.'},{status:400});
}
export function profileOwnerKey(userId:string,profile:BinanceProfile){return profile==='primary'?userId:`${userId}:binance-profile:secondary`;}
export function browserBinanceProfile():BinanceProfile{return typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('profile')==='secondary'?'secondary':'primary';}
export function profileStorageKey(key:string,profile:BinanceProfile=browserBinanceProfile()){return profile==='primary'?key:`${key}:binance-profile:secondary`;}
export function profileApiUrl(path:string,profile:BinanceProfile){return profile==='primary'?path:`${path}${path.includes('?')?'&':'?'}profile=secondary`;}
