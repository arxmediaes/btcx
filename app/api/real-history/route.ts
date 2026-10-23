import {env} from 'cloudflare:workers';
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {binanceConnections} from '../../../db/schema';
import {profileFromRequest,profileOwnerKey} from '../../../lib/binance-profile';
import {historyRecoveryFor} from '../../../lib/real-history-ledger';
export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sin sesión.'},{status:401});
 try{
  const profile=profileFromRequest(request),[connection]=await getDb().select({apiKeyLast4:binanceConnections.apiKeyLast4}).from(binanceConnections).where(eq(binanceConnections.userId,profileOwnerKey(user.userId,profile)));
  const recovery=connection?historyRecoveryFor((env as unknown as Record<string,unknown>).HYRULE_REAL_HISTORY_RECOVERY,user.userId,profile,connection.apiKeyLast4):null;
  return Response.json({recovery},{headers:{'Cache-Control':'no-store, private','Vary':'Cookie'}});
 }catch(error){if(error instanceof Response)return error;return Response.json({error:'No se pudo recuperar el historial.'},{status:500,headers:{'Cache-Control':'no-store, private'}})}
}
