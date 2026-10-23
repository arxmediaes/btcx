import {hydrateV2,compactV2,resumeSizePause} from '../../../lib/binance-v2-archive';
import {eq,and} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {workspaces,binanceConnections} from '../../../db/schema';
import {createV2Round,processV2Market,V2Round,V2_VERSION} from '../../../lib/binance-v2-strategies';
import {readV2Market,v2MarketPlan,validateV2BrowserMarket} from '../../../lib/binance-v2-market';
import {normalizeV2Brackets} from '../../../lib/binance-v2-sizing';
import {readV2Leverage} from '../../../lib/binance-v2-leverage';
const headers={'Cache-Control':'no-store, private'};
async function context(){const user=await getChatGPTUser();if(!user)throw Response.json({error:'Inicia sesión con el mismo usuario de Hyrule.'},{status:401,headers});const db=getDb(),key=`${user.userId}:binance-v2:strategies-1`,[row]=await db.select().from(workspaces).where(eq(workspaces.userId,key));return {user,db,key,row}}
export async function GET(req?:Request){try{const {user,db,key,row}=await context();if(row){const prior=JSON.parse(row.payload) as V2Round;if(prior.version!==V2_VERSION){await db.insert(workspaces).values({userId:`${key}:archive:${prior.id}`,payload:JSON.stringify(prior),revision:1,updatedAt:Date.now()}).onConflictDoNothing();const fresh=createV2Round({boost:[0,20,50].includes(prior.config?.boost)?prior.config.boost:0});fresh.running=true;await db.update(workspaces).set({payload:JSON.stringify(fresh),revision:row.revision+1,updatedAt:Date.now()}).where(and(eq(workspaces.userId,key),eq(workspaces.revision,row.revision)));return GET(req)}if(resumeSizePause(prior)){await db.update(workspaces).set({payload:JSON.stringify(prior),revision:row.revision+1,updatedAt:Date.now()}).where(and(eq(workspaces.userId,key),eq(workspaces.revision,row.revision)));return GET(req)}}const history=row?await hydrateV2(db,key,JSON.parse(row.payload),!!req&&new URL(req.url).searchParams.get('history')==='1'):{round:null,archivedDecisions:[]};const [connection]=await db.select({apiKeyLast4:binanceConnections.apiKeyLast4,status:binanceConnections.status}).from(binanceConnections).where(eq(binanceConnections.userId,user.userId));return Response.json({...history,revision:row?.revision??0,connection:connection?{...connection,name:user.displayName}:null},{headers})}catch(e){return failure(e)}}
function failure(e:unknown){return e instanceof Response?e:Response.json({error:e instanceof Error?e.message:'V2 no disponible'},{status:400,headers})}
export async function POST(){return Response.json({error:'Ronda finalizada y archivada. Recarga para abrir la nueva competencia.'},{status:409,headers})}
