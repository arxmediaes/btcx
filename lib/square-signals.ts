export type SquareProfile={name:string;slug:string|null;aliases?:string[]};
export const SQUARE_PROFILES:SquareProfile[]=[
 {name:'BullishBanter',slug:'bullish_banter'},
 {name:'MuhammadSaqib00',slug:null},
 {name:'Top Traders',slug:'top_traders'},
 {name:'TRADER TOPPER',slug:'trading_king_'},
 {name:'PhoenixTraderpro',slug:'square-creator-777b6835947e3'},
 {name:'Cryptorphic',slug:'aly_madhavji'},
 {name:'ZEM TRADERS',slug:null,aliases:['zeemtraders']},
 {name:'TF_BTC',slug:'bckraken'},
 {name:'BlockchainSignals',slug:'square-creator-fc9621c4f4ea0'},
 {name:'TradeSetups',slug:'1square-creator-bae4c73c4c4a1'},
];
export type SquareSignal={id:string;creator:string;symbol:string;side:1|-1;publishedAt:number;url:string;excerpt:string;entry:number;stop:number;target:number};
export type SquareProfileRead={name:string;url:string|null;status:'ok'|'unresolved'|'error';message:string;checkedAt:number;posts:number;signals:SquareSignal[];coins:string[]};
export type SquareConsensus={symbol:string;side:1|-1;creators:number;opposing:number;signals:SquareSignal[];tradable:boolean;latestAt:number};
export type SquareFeed={checkedAt:number;profiles:SquareProfileRead[];consensus:SquareConsensus[];marketError?:string};
const norm=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
export function profileSlug(url:string){try{const u=new URL(url);const m=u.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?)\/square\/profile\/([a-zA-Z0-9_-]+)\/?$/);return u.protocol==='https:'&&u.hostname==='www.binance.com'&&m?m[1]:null}catch{return null}}
export function parseProfile(html:string,profile:SquareProfile,now=Date.now()):{signals:SquareSignal[];posts:number;coins:string[]}{
 const match=html.match(/<script[^>]*id=["']__APP_DATA["'][^>]*>([\s\S]*?)<\/script>/);
 if(!match)throw Error('Binance no entregó publicaciones públicas legibles.');
 const data=JSON.parse(match[1]);let owner:any=null;const contents:any[]=[];
 const walk=(o:any)=>{if(!o||typeof o!=='object')return;if(o.kolInfo?.displayName)owner=o.kolInfo;if(Array.isArray(o.contents))contents.push(...o.contents);for(const value of Object.values(o))if(value&&typeof value==='object')walk(value)};walk(data);
 if(!owner||![profile.name,...profile.aliases||[]].some(name=>norm(name)===norm(owner.displayName)))throw Error('El nombre del perfil no coincide con el creador solicitado.');
 const seen=new Set<string>(),signals:SquareSignal[]=[],coins=new Set<string>();let posts=0;
 for(const post of contents){const id=String(post.id||''),text=String(post.bodyTextOnly||'');if(!id||seen.has(id)||post.squareUid!==owner.squareUid||!text)continue;seen.add(id);posts++;
 const publishedAt=Number(post.createTime);if(!Number.isFinite(publishedAt)||publishedAt>now+60000||now-publishedAt>6*3600000)continue;
 // Only the headline's primary asset counts; promotional tags and quoted replies do not.
 const head=text.slice(0,200),asset=head.match(/(?:\$([A-Z0-9]{2,15})\b|\b([A-Z0-9]{2,15})\s*\/?USDT\b)/);if(!asset)continue;const symbol=(asset[1]||asset[2]).replace(/USDT$/,'');if(!symbol||symbol==='USDT')continue;coins.add(symbol);
 const long=/\bLONG\b/i.test(head),short=/\bSHORT\b/i.test(head);if(long===short)continue;
 if(/\b(hit|achieved|closed|invalidated|cancelled|update|profit booked|if|wait for|once|upon)\b|TP\s*\d?\s*(?:hit|done)|target\s*(?:hit|reached)/i.test(text))continue;
 const number=(label:RegExp)=>{const m=text.match(label);return m?Number(m[1].replace(/,/g,'')):0};
 const entry=number(/(?:entry(?: zone| price)?|entrada)\s*[:：=]?\s*\$?([\d,]+(?:\.\d+)?)/i),stop=number(/(?:stop loss|stop-loss|SL)\s*[:：=]?\s*\$?([\d,]+(?:\.\d+)?)/i),target=number(/(?:TP\s*1|target\s*1|take profit|target|targets)\s*[:：=]?\s*\$?([\d,]+(?:\.\d+)?)/i);
 if(!(entry>0&&stop>0&&target>0))continue;const side=long?1:-1;if(side===1?!(stop<entry&&target>entry):!(stop>entry&&target<entry))continue;
 signals.push({id,creator:profile.name,symbol,side,publishedAt,url:`https://www.binance.com/en/square/post/${id}`,excerpt:head.slice(0,100),entry,stop,target});
 }return{signals,posts,coins:[...coins]};
}
export function buildConsensus(profiles:SquareProfileRead[],contracts:Set<string>):SquareConsensus[]{
 const latest=new Map<string,SquareSignal>();for(const p of profiles)for(const s of p.signals){const key=p.name+':'+s.symbol;if(!latest.has(key)||latest.get(key)!.publishedAt<s.publishedAt)latest.set(key,s)}
 const groups=new Map<string,SquareSignal[]>();for(const s of latest.values()){const g=groups.get(s.symbol)||[];g.push(s);groups.set(s.symbol,g)}
 return [...groups].map(([symbol,rows])=>{const longs=rows.filter(s=>s.side===1),shorts=rows.filter(s=>s.side===-1),winners=longs.length>=shorts.length?longs:shorts;return{symbol,side:winners[0].side,creators:winners.length,opposing:rows.length-winners.length,signals:rows,tradable:contracts.has(symbol+'USDT'),latestAt:Math.max(...rows.map(s=>s.publishedAt))}}).sort((a,b)=>(b.creators-b.opposing)-(a.creators-a.opposing)||b.latestAt-a.latestAt);
}
