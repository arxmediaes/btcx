import {profileFromRequest,profileOwnerKey} from '../../../../lib/binance-profile';
import { eq } from 'drizzle-orm';
import { getChatGPTUser } from '../../../../app/chatgpt-auth';
import { getDb } from '../../../../db';
import { binanceConnections } from '../../../../db/schema';
import { binanceRequest, decryptSecret, encryptSecret, friendlyBinanceError, readBinanceSnapshot } from '../../../../lib/binance';

const symbols = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'LINKUSDT', 'AVAXUSDT', 'ADAUSDT', 'SUIUSDT', 'TAOUSDT', 'HBARUSDT']);

function selectedSymbol(request: Request): string {
  const raw = new URL(request.url).searchParams.get('symbol') || 'BTCUSDT';
  return symbols.has(raw) ? raw : 'BTCUSDT';
}

async function userOrError() {
  const user = await getChatGPTUser();
  if (!user) throw Response.json({ error: 'Inicia sesión para conectar tu cuenta.' }, { status: 401 });
  return user;
}

export async function GET(request: Request) {
  try {
    const user = await userOrError();
    const profile=profileFromRequest(request),ownerKey=profileOwnerKey(user.userId,profile);
    const [row] = await getDb().select().from(binanceConnections).where(eq(binanceConnections.userId, ownerKey));
    if (!row) return Response.json({ connected: false, environment: 'futures_live', realOrdersEnabled: false });
    const secret = await decryptSecret(row.secretCipher);
    const apiKey = await decryptSecret(row.apiKeyCipher);
    const sessionCredentials = { apiKey, privateKey: secret };
    try {
      const snapshot = await readBinanceSnapshot(apiKey, secret, selectedSymbol(request),profile);
      await getDb().update(binanceConnections).set({ lastCheckedAt: Date.now(), status: 'connected', lastError: null }).where(eq(binanceConnections.userId, ownerKey));
      return Response.json({ connected: true, credentialsSaved: true, environment: row.environment, apiKeyLast4: row.apiKeyLast4, connectedAt: row.connectedAt, lastCheckedAt: Date.now(), realOrdersEnabled: false, sessionCredentials, ...snapshot }, { headers: { 'Cache-Control': 'no-store, private' } });
    } catch (error) {
      const message = friendlyBinanceError(error);
      await getDb().update(binanceConnections).set({ status: 'error', lastError: message, lastCheckedAt: Date.now() }).where(eq(binanceConnections.userId, ownerKey));
      return Response.json({ connected: true, credentialsSaved: true, environment: row.environment, apiKeyLast4: row.apiKeyLast4, connectedAt: row.connectedAt, lastCheckedAt: Date.now(), realOrdersEnabled: false, sessionCredentials, error: message }, { status: 200, headers: { 'Cache-Control': 'no-store, private' } });
    }
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo leer la conexión.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await userOrError();
    const profile=profileFromRequest(request),ownerKey=profileOwnerKey(user.userId,profile);
    const raw = await request.text();
    if (raw.length > 10000) return Response.json({ error: 'Datos de conexión inválidos.' }, { status: 413 });
    let body: any;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Datos de conexión inválidos.' }, { status: 400 }); }
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const apiSecret = typeof body.apiSecret === 'string' ? body.apiSecret.trim().replace(/\r\n/g, '\n') : '';
    const keyType = body.keyType === 'ed25519' ? 'ed25519' : 'hmac';
    const validEd25519 = keyType === 'ed25519' && apiSecret.length <= 2048 && /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(apiSecret);
    const validHmac = keyType === 'hmac' && apiSecret.length >= 20 && apiSecret.length <= 160;
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(apiKey) || (!validEd25519 && !validHmac)) return Response.json({ error: keyType === 'ed25519' ? 'Pega la clave privada Ed25519 completa en formato PEM PKCS#8.' : 'Revisa la API Key y el API Secret.' }, { status: 400 });
    const db = getDb();
    const [other]=await db.select().from(binanceConnections).where(eq(binanceConnections.userId,profileOwnerKey(user.userId,profile==='primary'?'secondary':'primary')));
    if(other&&await decryptSecret(other.apiKeyCipher)===apiKey)return Response.json({error:'Esta API ya está conectada al otro perfil. Usa las credenciales de la otra cuenta Binance.'},{status:409});
    const now = Date.now();
    await db.insert(binanceConnections).values({ userId: ownerKey, apiKeyCipher: await encryptSecret(apiKey), secretCipher: await encryptSecret(apiSecret), environment: 'futures_live', apiKeyLast4: apiKey.slice(-4), connectedAt: now, lastCheckedAt: now, status: 'checking', lastError: null }).onConflictDoUpdate({ target: binanceConnections.userId, set: { apiKeyCipher: await encryptSecret(apiKey), secretCipher: await encryptSecret(apiSecret), environment: 'futures_live', apiKeyLast4: apiKey.slice(-4), connectedAt: now, lastCheckedAt: now, status: 'checking', lastError: null } });
    const sessionCredentials = { apiKey, privateKey: apiSecret };
    try {
      const snapshot = await readBinanceSnapshot(apiKey, apiSecret, 'BTCUSDT',profile);
      await db.update(binanceConnections).set({ status: 'connected', lastError: null, lastCheckedAt: Date.now() }).where(eq(binanceConnections.userId, ownerKey));
      return Response.json({ connected: true, credentialsSaved: true, environment: 'futures_live', apiKeyLast4: apiKey.slice(-4), connectedAt: now, lastCheckedAt: Date.now(), realOrdersEnabled: false, sessionCredentials, ...snapshot }, { headers: { 'Cache-Control': 'no-store, private' } });
    } catch (error) {
      const message = friendlyBinanceError(error);
      await db.update(binanceConnections).set({ status: 'error', lastError: message, lastCheckedAt: Date.now() }).where(eq(binanceConnections.userId, ownerKey));
      return Response.json({ connected: true, credentialsSaved: true, environment: 'futures_live', apiKeyLast4: apiKey.slice(-4), connectedAt: now, lastCheckedAt: Date.now(), realOrdersEnabled: false, sessionCredentials, error: `API guardada. No se pudo leer Binance: ${message}` }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo guardar la conexión.' }, { status: 500 });
  }
}

export async function DELETE(request:Request) {
  try {
    const user = await userOrError();
    const profile=profileFromRequest(request),ownerKey=profileOwnerKey(user.userId,profile);
    await getDb().delete(binanceConnections).where(eq(binanceConnections.userId, ownerKey));
    return Response.json({ connected: false, realOrdersEnabled: false });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo desconectar.' }, { status: 500 });
  }
}
