import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {krakenConnections,krakenExecutions,krakenLocks} from '../../../db/schema';
import {krakenSettings} from '../../../lib/kraken-core';
import {previewKrakenTp,executeKrakenTp,previewKrakenDca,executeKrakenDca,connectKraken,krakenMarket,krakenCandles,krakenSnapshot,prepareKraken,executeKraken,closeKraken,removeKrakenStop,krakenOwner,krakenRequest,repairKraken,krakenHistory,krakenAccount} from '../../../lib/kraken';
const headers={'Cache-Control':'no-store, private'};
async function owner(){const user=await getChatGPTUser();if(!user)throw Response.json({error:'Inicia sesión para usar Kraken Futures.'},{status:401});return user.userId;}
function fail(error:unknown){return error instanceof Response?error:Response.json({error:error instanceof Error?error.message:'No se pudo consultar Kraken.',retryable:(error as {retryable?:boolean})?.retryable===true},{status:400,headers});}
export async function GET(request:Request){try{const userId=await owner(),q=new URL(request.url).searchParams,action=q.get('action');if(action==='market')return Response.json(await krakenMarket(),{headers});if(action==='candles')return Response.json({bars:await krakenCandles(q.get('symbol')||'PF_XBTUSD',q.get('tf')||'3m')},{headers});if(action==='history')return Response.json(await krakenHistory(userId),{headers});const [row]=await getDb().select().from(krakenConnections).where(eq(krakenConnections.userId,userId));if(!row)return Response.json({connected:false},{headers});try{return Response.json(await krakenSnapshot(userId),{headers})}catch(error){return Response.json({connected:true,apiKeyLast4:row.apiKeyLast4,settings:krakenSettings(JSON.parse(row.settings)),error:error instanceof Error?error.message:'Lectura no disponible.'},{headers})}}catch(error){return fail(error)}}
export async function POST(request:Request){try{
 const userId=await owner();const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origen inválido.'},{status:403});
 const raw=await request.text();if(raw.length>12000)throw Error('Solicitud demasiado grande.');let body:any;try{body=JSON.parse(raw)}catch{throw Error('Datos inválidos.');}
 let data:any;
 if(body.action==='connect')data=await connectKraken(userId,body);
 else if(body.action==='settings'){const settings=krakenSettings(body.settings);await getDb().update(krakenConnections).set({settings:JSON.stringify(settings)}).where(eq(krakenConnections.userId,userId));data={settings};}
 else if(body.action==='prepare')data=await prepareKraken(userId,body);
 else if(body.action==='execute'&&typeof body.id==='string')data=await executeKraken(userId,body.id);
 else if(body.action==='remove-stop'&&typeof body.symbol==='string')data=await removeKrakenStop(userId,body.symbol);
 else if(body.action==='close'&&typeof body.symbol==='string')data=await closeKraken(userId,body.symbol);
 else if(body.action==='tp-preview')data=await previewKrakenTp(userId,body.symbol,Number(body.percent));
 else if(body.action==='tp-execute'&&typeof body.id==='string')data=await executeKrakenTp(userId,body.id);
 else if(body.action==='dca-preview')data=await previewKrakenDca(userId,body.symbol,Number(body.fraction));
 else if(body.action==='dca-execute'&&typeof body.id==='string')data=await executeKrakenDca(userId,body.id);
 else if(body.action==='repair')data=await repairKraken(userId);
 else if(body.action==='disconnect'){const {credentials}=await krakenOwner(userId),snapshot=await krakenAccount(credentials);const [lock]=await getDb().select().from(krakenLocks).where(eq(krakenLocks.userId,userId));if(lock||snapshot.positions.length||snapshot.orders.length)throw Error('Hay posiciones o una ejecución pendiente. Adminístralas antes de desconectar.');await getDb().delete(krakenConnections).where(eq(krakenConnections.userId,userId));data={connected:false};}
 else throw Error('Acción inválida.');return Response.json(data,{headers});
}catch(error){return fail(error)}}
