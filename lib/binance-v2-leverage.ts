import {eq} from 'drizzle-orm';
import {getDb} from '../db';
import {binanceConnections} from '../db/schema';
import {binanceRequest,decryptSecret} from './binance';
import {normalizeV2Brackets,V2Bracket} from './binance-v2-sizing';
const cache=new Map<string,{at:number;limits:Record<string,V2Bracket[]>}>();
export async function readV2Leverage(userId:string){
 const [connection]=await getDb().select().from(binanceConnections).where(eq(binanceConnections.userId,userId));if(!connection)throw Error('Conecta Binance con este usuario para leer su apalancamiento máximo');
 const key=`${userId}:${connection.connectedAt}`,cached=cache.get(key);if(cached&&Date.now()-cached.at<300000)return cached.limits;
 const apiKey=await decryptSecret(connection.apiKeyCipher),secret=await decryptSecret(connection.secretCipher);
 const raw=await binanceRequest<any[]>('/fapi/v1/leverageBracket',apiKey,secret),limits=normalizeV2Brackets(raw);if(cache.size>30)cache.clear();cache.set(key,{at:Date.now(),limits});return limits;
}
