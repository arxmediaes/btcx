import {eq} from 'drizzle-orm';
import {workspaces} from '../db/schema';
type HistoryRef={key:string;kind:'trades'|'decisions';count:number};
// Each durable row stays small; round-specific references are only read under the authenticated workspace key.
export async function hydrateV2(db:any,key:string,r:any,withDecisions=false){
 const archivedTrades:any[]=[],archivedDecisions:any[]=[];
 for(const ref of (r.historyRefs||[]) as HistoryRef[]){
  if(!ref.key.startsWith(`${key}:history:${r.id}:`))throw Error('Referencia de historial inválida');
  if(ref.kind==='decisions'&&!withDecisions)continue;
  const [row]=await db.select().from(workspaces).where(eq(workspaces.userId,ref.key));if(!row)throw Error('Historial pendiente de recuperar');
  const entries=JSON.parse(row.payload);if(!Array.isArray(entries)||entries.length!==ref.count)throw Error('Historial incompleto');
  (ref.kind==='trades'?archivedTrades:archivedDecisions).push(...entries);
 }
 r.trades=[...archivedTrades,...r.trades];r.hydratedTrades=archivedTrades.length;
 return {round:r,archivedDecisions};
}
export async function compactV2(db:any,key:string,r:any){
 const refs:HistoryRef[]=r.historyRefs||[];
 const archive=async(kind:HistoryRef['kind'],entries:any[])=>{for(let i=0;i<entries.length;i+=200){const chunk=entries.slice(i,i+200),archiveKey=`${key}:history:${r.id}:${kind}:${crypto.randomUUID()}`;await db.insert(workspaces).values({userId:archiveKey,payload:JSON.stringify(chunk),revision:1,updatedAt:Date.now()}).onConflictDoNothing();if(!refs.some(x=>x.key===archiveKey))refs.push({key:archiveKey,kind,count:chunk.length})}};
 r.trades=r.trades.slice(r.hydratedTrades||0);delete r.hydratedTrades;
 const resolved=r.trades.filter((t:any)=>t.status==='closed'||t.status==='skipped');
 if(resolved.length>400){const old=resolved.slice(0,resolved.length-200);await archive('trades',old);const ids=new Set(old.map((t:any)=>t.id));r.trades=r.trades.filter((t:any)=>!ids.has(t.id))}
 if(r.decisions.length>1000){const old=r.decisions.slice(0,-400);await archive('decisions',old);r.decisions=r.decisions.slice(-400)}
 r.historyRefs=refs;
}
export function resumeSizePause(r:any){if(!r.running&&r.lastError?.includes('Ronda pausada por tamaño; exporta el historial.')){r.running=true;r.lastError='';return true}return false}
