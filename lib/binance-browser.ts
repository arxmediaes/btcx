import {normalizeRealFills} from './real-learning';
import {browserBinanceProfile} from './binance-profile';
import {profileLocalStorage,profileSessionStorage} from './profile-storage';
import {binanceExecutionQuote} from './binance-execution-quote';
import {binanceContractRules,unconfirmedBinanceRules} from './binance-contract-rules';
import {coordinatedBinanceFetch,assertBinanceReadAllowed} from './binance-read-coordinator';
import {cleanupFlatBinanceProtections} from './binance-protection-cleanup';
import {periodRoi} from './period-roi';
import {periodPnl,PNL_PERIOD_START} from './pnl-period';
import {excludedRealClose} from './real-history-exclusions';
import {collectIncomePages,verifiedIncome} from './real-income';
const API_BASE = 'https://fapi.binance.com';
const encoder = new TextEncoder();

type BrowserBinanceError = Error & { code?: number; status?: number; browserReason?: 'cors' | 'http'; endpoint?:string };

export type BinanceOrderSide = 'BUY' | 'SELL';
export type BinancePositionMode = 'ONE_WAY' | 'HEDGE';
export type BinanceMarginType = 'CROSSED' | 'ISOLATED';
export type BinanceOrderResponse = {
  orderId: number | string;
  symbol: string;
  status?: string;
  side: BinanceOrderSide;
  type: string;
  origQty?: string;
  executedQty?: string;
  avgPrice?: string;
  price?: string;
  stopPrice?: string;
  clientOrderId?: string;
};

export type BinanceAlgoOrderResponse = {
  algoId?: number;
  clientAlgoId?: string;
  algoType?: string;
  orderType?: string;
  symbol: string;
  side: BinanceOrderSide;
  positionSide?: 'BOTH' | 'LONG' | 'SHORT';
  quantity?: string;
  algoStatus?: string;
  triggerPrice?: string;
  workingType?: 'MARK_PRICE' | 'CONTRACT_PRICE';
  closePosition?: boolean;
  priceProtect?: boolean;
  reduceOnly?: boolean;
  price?: string;
  createTime?: number;
  updateTime?: number;
};

export type BinanceClosedOperation = {
  id: string;
  symbol: string;
  realizedPnl: number;
  time: number;
  tradeId: string;
};

type BinanceHistoryBaseline = {
  symbol: string;
  realizedPnl: number;
  time: number;
};

// La última operación real hecha manualmente desde el teléfono sirve como
// punto de corte. Todo lo anterior queda fuera del aprendizaje de PULSE.
const MANUAL_BASELINE_SYMBOL = 'BTCUSDT';
const MANUAL_BASELINE_PNL = -0.75;
const MANUAL_BASELINE_TOLERANCE = 0.04;
const HISTORY_BASELINE_STORAGE_KEY = 'pulse-real-history-baseline-v2';
const HISTORY_OPERATIONS_STORAGE_KEY = 'pulse-real-history-operations-v1';
// Hyrule empezó a registrar las operaciones reales el 8 de octubre de 2026.
// La fecha evita que el cambio de día reinicie el historial visible.
const HYRULE_HISTORY_START = new Date('2026-10-08T00:00:00-03:00').getTime();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function privateKeyDer(privatePem: string): Uint8Array {
  const pem = privatePem.trim().replace(/\r\n/g, '\n');
  const match = pem.match(/^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PRIVATE KEY-----$/);
  if (!match) throw new Error('La clave privada Ed25519 debe estar completa en formato PEM PKCS#8.');
  return base64ToBytes(match[1]);
}

async function signQuery(query: string, privatePem: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', privateKeyDer(privatePem), { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, encoder.encode(query));
  return bytesToBase64(new Uint8Array(signature));
}

async function requestJson<T>(path: string, headers?: Record<string, string>): Promise<T> {
  assertBinanceReadAllowed();
  let response: Response;
  try {
    response = await coordinatedBinanceFetch(`${API_BASE}${path}`, {
      method: 'GET',
      signal: AbortSignal.timeout(12000),
      headers,
      cache: 'no-store',
    });
  } catch (cause) {
    if((cause as BrowserBinanceError)?.code===-1003||(cause as {responseReason?:string})?.responseReason)throw cause;
    const error: BrowserBinanceError = new Error('Binance no permitió la lectura directa desde este navegador. Puede ser un bloqueo de red o de CORS.');
    error.browserReason = 'cors';
    error.cause = cause;
    throw error;
  }
  const raw = await response.text();
  let body: any = null;
  try { body = JSON.parse(raw.replace(/("(?:orderId|id)"\s*:\s*)(\d+)/g, '$1"$2"')); } catch { /* Binance puede devolver una página del gateway. */ }
  if (!response.ok || (body && typeof body.code === 'number' && body.code < 0)) {
    const error: BrowserBinanceError = new Error(typeof body?.msg === 'string' ? body.msg : `Binance respondió HTTP ${response.status} sin detalle de API.`);
    if((response.status===429||response.status===418||body?.code===-1003))assertBinanceReadAllowed();
    error.code = body?.code;
    error.status = response.status;
    error.browserReason = 'http';
    error.endpoint=path.split('?')[0];
    throw error;
  }
  return body as T;
}

async function signedRequest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, apiKey: string, privatePem: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  if(method==='GET')assertBinanceReadAllowed();
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  query.set('timestamp', String(Date.now()));
  query.set('recvWindow', '5000');
  query.set('signature', await signQuery(query.toString(), privatePem));
  const encoded = query.toString();
  let response: Response;
  try {
    response = await coordinatedBinanceFetch(`${API_BASE}${path}${method === 'GET' || method === 'DELETE' ? `?${encoded}` : ''}`, {
      method,
      headers: { 'X-MBX-APIKEY': apiKey, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? encoded : undefined,
      signal: method === 'GET' ? AbortSignal.timeout(12000) : undefined,
      cache: 'no-store',
    });
  } catch (cause) {
    if((cause as BrowserBinanceError)?.code===-1003||(cause as {responseReason?:string})?.responseReason)throw cause;
    const error: BrowserBinanceError = new Error('Binance no permitió la solicitud firmada desde este navegador. Puede ser un bloqueo de red o de CORS.');
    error.browserReason = 'cors';
    error.cause = cause;
    throw error;
  }
  const raw = await response.text();
  let body: any = null;
  try { body = JSON.parse(raw.replace(/("(?:orderId|id)"\s*:\s*)(\d+)/g, '$1"$2"')); } catch { /* Binance puede devolver una página del gateway. */ }
  if (!response.ok || (body && typeof body.code === 'number' && body.code < 0)) {
    const error: BrowserBinanceError = new Error(typeof body?.msg === 'string' ? body.msg : `Binance respondió HTTP ${response.status} sin detalle de API.`);
    if(method==='GET'&&(response.status===429||response.status===418||body?.code===-1003))assertBinanceReadAllowed();
    error.code = body?.code;
    error.status = response.status;
    error.browserReason = 'http';
    error.endpoint=path.split('?')[0];
    throw error;
  }
  return body as T;
}

export async function readBinancePriceInBrowser(symbol: string): Promise<number> {
  const result = await requestJson<{ price: string }>(`/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`);
  const value = Number(result?.price);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Binance no devolvió un precio válido para ${symbol}.`);
  return value;
}

export async function readBinanceMarkPriceInBrowser(symbol: string): Promise<number> {
  const result = await requestJson<{ markPrice: string }>(`/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`);
  const value = Number(result?.markPrice);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Binance no devolvió un precio de marca válido para ${symbol}.`);
  return value;
}

export async function setBinanceLeverageInBrowser(apiKey: string, privatePem: string, symbol: string, leverage: number) {
  return signedRequest<{ symbol: string; leverage: number; maxNotionalValue: string }>('POST', '/fapi/v1/leverage', apiKey, privatePem, { symbol, leverage: Math.max(1, Math.min(125, Math.round(leverage))) });
}

/**
 * Selecciona el modo de margen del símbolo antes de abrir una posición.
 * Binance aplica este ajuste por símbolo; no cambia el apalancamiento ni
 * elimina las protecciones de la operación.
 */
export async function setBinanceMarginTypeInBrowser(apiKey: string, privatePem: string, symbol: string, marginType: BinanceMarginType) {
  return signedRequest<{ code: number; msg: string }>('POST', '/fapi/v1/marginType', apiKey, privatePem, { symbol, marginType });
}

export async function placeBinanceMarketOrderInBrowser(apiKey: string, privatePem: string, input: { symbol: string; side: BinanceOrderSide; quantity: number; positionSide?: 'LONG' | 'SHORT' }) {
  return signedRequest<BinanceOrderResponse>('POST', '/fapi/v1/order', apiKey, privatePem, {
    symbol: input.symbol,
    side: input.side,
    type: 'MARKET',
    quantity: input.quantity,
    newOrderRespType: 'RESULT',
    ...(input.positionSide ? { positionSide: input.positionSide } : {}),
  });
}

async function placeBinanceCloseMarketOrderInBrowser(apiKey: string, privatePem: string, input: { symbol: string; side: BinanceOrderSide; quantity: number; positionSide?: 'LONG' | 'SHORT' }) {
  return signedRequest<BinanceOrderResponse>('POST', '/fapi/v1/order', apiKey, privatePem, {
    symbol: input.symbol,
    side: input.side,
    type: 'MARKET',
    quantity: input.quantity,
    newOrderRespType: 'RESULT',
    ...(input.positionSide ? { positionSide: input.positionSide } : { reduceOnly: 'true' }),
  });
}

export async function placeBinanceStopMarketOrderInBrowser(apiKey: string, privatePem: string, input: { symbol: string; side: BinanceOrderSide; stopPrice: number; quantity?: number; positionSide?: 'LONG' | 'SHORT'; priceProtect?: boolean }) {
  return signedRequest<BinanceAlgoOrderResponse>('POST', '/fapi/v1/algoOrder', apiKey, privatePem, {
    algoType: 'CONDITIONAL',
    symbol: input.symbol,
    side: input.side,
    type: 'STOP_MARKET',
    triggerPrice: input.stopPrice,
    ...(input.quantity ? { quantity: input.quantity, ...(!input.positionSide ? { reduceOnly: 'true' } : {}) } : { closePosition: 'true' }),
    workingType: 'MARK_PRICE',
    priceProtect: input.priceProtect===false?'FALSE':'TRUE',
    newOrderRespType: 'RESULT',
    ...(input.positionSide ? { positionSide: input.positionSide } : {}),
  });
}

export async function placeBinanceTakeProfitMarketOrderInBrowser(apiKey: string, privatePem: string, input: { symbol: string; side: BinanceOrderSide; stopPrice: number; quantity?: number; positionSide?: 'LONG' | 'SHORT' }) {
  return signedRequest<BinanceAlgoOrderResponse>('POST', '/fapi/v1/algoOrder', apiKey, privatePem, {
    algoType: 'CONDITIONAL',
    symbol: input.symbol,
    side: input.side,
    type: 'TAKE_PROFIT_MARKET',
    triggerPrice: input.stopPrice,
    ...(input.quantity ? { quantity: input.quantity, ...(!input.positionSide ? { reduceOnly: 'true' } : {}) } : { closePosition: 'true' }),
    workingType: 'MARK_PRICE',
    priceProtect: 'TRUE',
    newOrderRespType: 'RESULT',
    ...(input.positionSide ? { positionSide: input.positionSide } : {}),
  });
}

export async function cancelBinanceOrderInBrowser(apiKey: string, privatePem: string, symbol: string, orderId: number) {
  return signedRequest<BinanceOrderResponse>('DELETE', '/fapi/v1/order', apiKey, privatePem, { symbol, orderId });
}

export async function cancelBinanceAlgoOrderInBrowser(apiKey: string, privatePem: string, algoId: number) {
  return signedRequest<{ algoId: number; clientAlgoId?: string; code?: number; msg?: string }>('DELETE', '/fapi/v1/algoOrder', apiKey, privatePem, { algoId });
}

/** Lee las protecciones condicionales activas de un símbolo. Binance separa
 * estas órdenes (TP/SL) de las órdenes normales en openAlgoOrders. */
export async function readBinanceOpenAlgoOrdersInBrowser(apiKey: string, privatePem: string, symbol?: string) {
  return signedRequest<BinanceAlgoOrderResponse[]>('GET', '/fapi/v1/openAlgoOrders', apiKey, privatePem, symbol ? { symbol } : {});
}

export async function closeBinancePositionInBrowser(apiKey: string, privatePem: string, input: { symbol: string; side: BinanceOrderSide; quantity: number; positionSide?: 'LONG' | 'SHORT' }) {
  return placeBinanceCloseMarketOrderInBrowser(apiKey, privatePem, input);
}

export function executedQuantity(order: BinanceOrderResponse): number {
  const value = Number(order.executedQty || order.origQty || 0);
  return Number.isFinite(value) ? value : 0;
}

export function executedPrice(order: BinanceOrderResponse, fallback: number): number {
  const value = Number(order.avgPrice || order.price || 0);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function protectionForPosition(position: any, algoOrders: BinanceAlgoOrderResponse[]) {
  const symbol = String(position?.symbol || '').toUpperCase();
  const positionSide = String(position?.positionSide || 'BOTH').toUpperCase();
  const closeSide = Number(position?.positionAmt) > 0 ? 'SELL' : 'BUY';
  const matching = algoOrders.filter((order) => {
    if (String(order.symbol || '').toUpperCase() !== symbol) return false;
    if (order.side && String(order.side).toUpperCase() !== closeSide) return false;
    const orderPositionSide = String(order.positionSide || 'BOTH').toUpperCase();
    return orderPositionSide === 'BOTH' || positionSide === 'BOTH' || orderPositionSide === positionSide;
  });
  const stopOrder = matching.find((order) => /^(STOP|STOP_MARKET)$/.test(String(order.orderType || '').toUpperCase()));
  const targetOrder = matching.find((order) => /^(TAKE_PROFIT|TAKE_PROFIT_MARKET)$/.test(String(order.orderType || '').toUpperCase()));
  const trigger = (order?: BinanceAlgoOrderResponse) => Number(order?.triggerPrice || order?.price || 0) || 0;
  return {
    stop: trigger(stopOrder),
    target: trigger(targetOrder),
    stopOrderId: Number(stopOrder?.algoId || 0) || null,
    targetOrderId: Number(targetOrder?.algoId || 0) || null,
  };
}

function accountView(account: any, positionRiskRows: any[] = [], algoOrders: BinanceAlgoOrderResponse[] = []) {
  return {
    totalWalletBalance: Number(account.totalWalletBalance),
    availableBalance: Number(account.availableBalance),
    totalUnrealizedProfit: Number(account.totalUnrealizedProfit),
    totalMarginBalance: Number(account.totalMarginBalance),
    positions: (account.positions || [])
      .filter((position: any) => Math.abs(Number(position.positionAmt)) > 0)
      .map((position: any) => {
        const risk = positionRiskRows.find((row: any) => row.symbol === position.symbol && (row.positionSide === 'BOTH' || (Number(row.positionAmt) > 0) === (Number(position.positionAmt) > 0))) || positionRiskRows.find((row: any) => row.symbol === position.symbol);
        const leverage = Number(position.leverage ?? risk?.leverage);
        const protection = protectionForPosition(position, algoOrders);
        return {
        symbol: position.symbol,
        side: Number(position.positionAmt) > 0 ? 'LONG' : 'SHORT',
        quantity: Number(position.positionAmt),
        entryPrice: Number(position.entryPrice),
        markPrice: Number(position.markPrice),
        unrealizedProfit: Number(position.unrealizedProfit),
        leverage: Number.isFinite(leverage) && leverage > 0 ? leverage : null,
        liquidationPrice: Number(position.liquidationPrice || 0) || null,
        stop: protection.stop,
        target: protection.target,
        stopOrderId: protection.stopOrderId,
        targetOrderId: protection.targetOrderId,
        };
      }),
  };
}

function historyBaseline(result: PromiseSettledResult<unknown>, dayStart: number): BinanceHistoryBaseline | null {
  if(browserBinanceProfile()==='secondary')return null;
  try {
    const storages = [profileLocalStorage, profileSessionStorage];
    for (const storage of storages) {
      const saved = JSON.parse(storage.getItem(HISTORY_BASELINE_STORAGE_KEY) || 'null');
      if (Number(saved?.time) > 0) {
        return { symbol: String(saved.symbol || 'BTC'), realizedPnl: Number(saved.realizedPnl ?? MANUAL_BASELINE_PNL), time: Number(saved.time) };
      }
    }
  } catch { /* El almacenamiento puede no estar disponible. */ }
  if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return null;
  const match = result.value
    .filter((row: any) => String(row?.symbol || '').toUpperCase() === MANUAL_BASELINE_SYMBOL)
    .filter((row: any) => row?.incomeType === 'REALIZED_PNL' && Number(row?.time || 0) >= HYRULE_HISTORY_START)
    .filter((row: any) => Math.abs(Number(row?.income) - MANUAL_BASELINE_PNL) <= MANUAL_BASELINE_TOLERANCE)
    .sort((a: any, b: any) => Number(a?.time || 0) - Number(b?.time || 0))[0];
  if (!match) return null;
  const baseline = {
    symbol: MANUAL_BASELINE_SYMBOL.replace(/USDT$/i, ''),
    realizedPnl: Number(match.income),
    time: Number(match.time || 0),
  };
  try {
    const packed = JSON.stringify({ ...baseline, projectStart: HYRULE_HISTORY_START });
    profileLocalStorage.setItem(HISTORY_BASELINE_STORAGE_KEY, packed);
    profileSessionStorage.setItem(HISTORY_BASELINE_STORAGE_KEY, packed);
  } catch { /* La lectura sigue funcionando sin persistencia. */ }
  return baseline;
}

function closedOperations(result: PromiseSettledResult<unknown>, afterTime = 0): BinanceClosedOperation[] | null {
  const readCached = () => {
    try {
      const saved = JSON.parse(profileLocalStorage.getItem(HISTORY_OPERATIONS_STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter((row: any) => Number(row?.time || 0) > afterTime && !excludedRealClose(String(row.symbol||''),Number(row.time||0),String(row.tradeId||''))) as BinanceClosedOperation[] : [];
    } catch { return []; }
  };
  if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return readCached().length ? readCached().sort((a, b) => b.time - a.time) : null;
  const fresh = result.value
    .filter((row: any) => row?.incomeType === 'REALIZED_PNL' && (!row.asset || row.asset === 'USDT') && Number(row?.time || 0) > afterTime && !excludedRealClose(String(row.symbol||''),Number(row.time||0),String(row.tradeId||'')))
    .map((row: any, index: number) => ({
      id: `${row.symbol || 'ACCOUNT'}-${row.tranId || row.tradeId || row.time || index}`,
      symbol: String(row.symbol || '—').replace(/USDT$/i, ''),
      realizedPnl: Number.isFinite(Number(row.income)) ? Number(row.income) : 0,
      time: Number(row.time || 0),
      tradeId: String(row.tradeId || row.tranId || '—'),
    }))
    .sort((a, b) => b.time - a.time);
  const merged = new Map<string, BinanceClosedOperation>();
  for (const row of [...readCached(), ...fresh]) merged.set(row.id, row);
  const output = [...merged.values()].sort((a, b) => b.time - a.time);
  try { profileLocalStorage.setItem(HISTORY_OPERATIONS_STORAGE_KEY, JSON.stringify(output.slice(0, 1000))); } catch { /* La lectura no depende de la caché. */ }
  return output;
}

/** P&L is independent of entry checks, contract rules and protection reads. */
export async function readBinancePeriodPerformanceInBrowser(apiKey:string,privatePem:string,queryStart=PNL_PERIOD_START){
 const end=Date.now(),rows=await collectIncomePages(async page=>{
  const query=new URLSearchParams({startTime:String(queryStart),endTime:String(end),page:String(page),limit:'1000',timestamp:String(Date.now()),recvWindow:'5000'});
  query.set('signature',await signQuery(query.toString(),privatePem));
  return requestJson<unknown>(`/fapi/v1/income?${query}`,{'X-MBX-APIKEY':apiKey});
 });
 const result={status:'fulfilled' as const,value:rows};
 return {...periodPnl(result,queryStart,end),closedOperations:closedOperations(result,PNL_PERIOD_START),readAt:Date.now()};
}

export async function readBinanceSnapshotInBrowser(apiKey: string, privatePem: string, symbol = 'BTCUSDT') {
  const query = new URLSearchParams({ timestamp: String(Date.now()), recvWindow: '5000' });
  query.set('signature', await signQuery(query.toString(), privatePem));
  const account = await requestJson<any>(`/fapi/v3/account?${query.toString()}`, { 'X-MBX-APIKEY': apiKey });
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const historyStart = Math.max(Date.now() - (90 * 24 * 60 * 60 * 1000), HYRULE_HISTORY_START);
  const historyEnd = Date.now();
  const positionSymbols = [...new Set((account.positions || [])
    .filter((position: any) => Math.abs(Number(position.positionAmt)) > 0)
    .map((position: any) => String(position.symbol || '').toUpperCase())
    .filter(Boolean))];
  const openAlgoResults = await Promise.allSettled(positionSymbols.map((positionSymbol) => readBinanceOpenAlgoOrdersInBrowser(apiKey, privatePem, positionSymbol)));
  const openAlgoOrders = openAlgoResults.flatMap((result) => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);

  const [exchangeResult, commissionResult, bracketsResult, positionModeResult, positionRiskResult, incomeTodayResult, incomeHistoryResult] = await Promise.allSettled([
    requestJson<any>('/fapi/v1/exchangeInfo'),
    (async () => {
      const signed = new URLSearchParams({ symbol, timestamp: String(Date.now()), recvWindow: '5000' });
      signed.set('signature', await signQuery(signed.toString(), privatePem));
      return requestJson<any>(`/fapi/v1/commissionRate?${signed.toString()}`, { 'X-MBX-APIKEY': apiKey });
    })(),
    (async () => {
      const signed = new URLSearchParams({ symbol, timestamp: String(Date.now()), recvWindow: '5000' });
      signed.set('signature', await signQuery(signed.toString(), privatePem));
      return requestJson<any>(`/fapi/v1/leverageBracket?${signed.toString()}`, { 'X-MBX-APIKEY': apiKey });
    })(),
    (async () => {
      const signed = new URLSearchParams({ timestamp: String(Date.now()), recvWindow: '5000' });
      signed.set('signature', await signQuery(signed.toString(), privatePem));
      return requestJson<any>(`/fapi/v1/positionSide/dual?${signed.toString()}`, { 'X-MBX-APIKEY': apiKey });
    })(),
    (async () => {
      const signed = new URLSearchParams({ symbol, timestamp: String(Date.now()), recvWindow: '5000' });
      signed.set('signature', await signQuery(signed.toString(), privatePem));
      return requestJson<any>(`/fapi/v3/positionRisk?${signed.toString()}`, { 'X-MBX-APIKEY': apiKey });
    })(),
    (async () => {
      const signed = new URLSearchParams({ startTime: String(dayStart.getTime()), limit: '1000', timestamp: String(Date.now()), recvWindow: '5000' });
      signed.set('signature', await signQuery(signed.toString(), privatePem));
      return requestJson<any>(`/fapi/v1/income?${signed.toString()}`, { 'X-MBX-APIKEY': apiKey });
    })(),
    (async () => {
      return collectIncomePages(async page=>{const signed = new URLSearchParams({ startTime: String(historyStart), endTime: String(historyEnd), page:String(page), limit: '1000', timestamp: String(Date.now()), recvWindow: '5000' });
      signed.set('signature', await signQuery(signed.toString(), privatePem));
      return requestJson<any>(`/fapi/v1/income?${signed.toString()}`, { 'X-MBX-APIKEY': apiKey });});
    })(),
  ]);

  const exchange = exchangeResult.status === 'fulfilled' ? exchangeResult.value : null;
  const commission = commissionResult.status === 'fulfilled' ? commissionResult.value : null;
  const brackets = bracketsResult.status === 'fulfilled' ? bracketsResult.value : null;
  const positionMode = positionModeResult.status === 'fulfilled' ? positionModeResult.value : null;
  const positionRisk = positionRiskResult.status === 'fulfilled' && Array.isArray(positionRiskResult.value) ? positionRiskResult.value : [];
  const symbolRisk = positionRisk.find((row: any) => row?.symbol === symbol && (row?.positionSide === 'BOTH' || row?.positionSide === undefined)) || positionRisk.find((row: any) => row?.symbol === symbol);
  const marginTypeRaw = String(symbolRisk?.marginType || '').toUpperCase();
  const isolatedFlag = String(symbolRisk?.isolated ?? '').toLowerCase();
  const marginType = marginTypeRaw === 'ISOLATED' || isolatedFlag === 'true' ? 'ISOLATED' as BinanceMarginType : marginTypeRaw === 'CROSSED' || isolatedFlag === 'false' ? 'CROSSED' as BinanceMarginType : undefined;
  const tradingIncomeTypes = new Set(['REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE', 'INSURANCE_CLEAR', 'REFERRAL_KICKBACK', 'COMMISSION_REBATE', 'API_REBATE']);
  const incomeTotal = (result: PromiseSettledResult<unknown>, afterTime = 0) => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return null;
    return result.value
      .filter((row: any) => Number(row?.time || 0) > afterTime)
      .filter((row: any) => (!row.asset || row.asset === 'USDT') && (!row.incomeType || tradingIncomeTypes.has(row.incomeType)))
      .reduce((total: number, row: any) => total + (Number.isFinite(Number(row.income)) ? Number(row.income) : 0), 0);
  };
  const baseline = historyBaseline(incomeHistoryResult, HYRULE_HISTORY_START);
  const baselineTime = baseline?.time || 0;
  const realizedPnlToday = baselineTime&&incomeTodayResult.status==='fulfilled'&&Array.isArray(incomeTodayResult.value)&&incomeTodayResult.value.length<1000?incomeTotal(incomeTodayResult, baselineTime):null;
  // Un cierre reciente puede aparecer primero en la consulta de hoy y tardar
  // un poco más en aparecer en la consulta larga. Combinamos ambas lecturas
  // sin duplicar ingresos para que el panel refleje la ganancia de inmediato.
  const historyRows = incomeHistoryResult.status === 'fulfilled' && Array.isArray(incomeHistoryResult.value) ? incomeHistoryResult.value : [];
  const todayRows = incomeTodayResult.status === 'fulfilled' && Array.isArray(incomeTodayResult.value) ? incomeTodayResult.value : [];
  const incomeMap = new Map<string, any>();
  for (const row of [...historyRows, ...todayRows]) {
    const key = `${row?.incomeType || ''}:${row?.symbol || ''}:${row?.tranId || row?.tradeId || row?.time || ''}:${row?.income || ''}`;
    incomeMap.set(key, row);
  }
  const historySource: PromiseSettledResult<unknown> = incomeMap.size > 0 ? { status: 'fulfilled', value: [...incomeMap.values()] } : incomeHistoryResult;
  const historyCheck=verifiedIncome(incomeHistoryResult,baselineTime,HYRULE_HISTORY_START,historyStart);
  const realizedPnlHistorical = historyCheck.breakdown?.net??null;
  const incomeHistoryCount = incomeHistoryResult.status === 'fulfilled' && Array.isArray(incomeHistoryResult.value)
    ? incomeHistoryResult.value.filter((row: any) => Number(row?.time || 0) > baselineTime).length
    : null;
  // El listado visible conserva todo lo ocurrido desde el inicio de Hyrule y
  // excluye la operación manual usada como línea base.
  const closed = closedOperations(historySource, baselineTime);
  let contractRules;try{contractRules=binanceContractRules(exchange,brackets,symbol)}catch(error){const readError=[exchangeResult,bracketsResult].filter((r):r is PromiseRejectedResult=>r.status==='rejected').map(r=>r.reason instanceof Error?r.reason.message:String(r.reason)).join(' · ');contractRules=unconfirmedBinanceRules(symbol,readError||(error instanceof Error?error.message:'Reglas pendientes'))}
  return {
    account: accountView(account, positionRisk, openAlgoOrders),
    rules: {...contractRules,marginType},
    commission: commission ? {
      symbol: commission.symbol,
      makerRate: Number(commission.makerCommissionRate),
      takerRate: Number(commission.takerCommissionRate),
    } : null,
    positionMode: positionMode?.dualSidePosition === true ? 'HEDGE' as BinancePositionMode : positionMode?.dualSidePosition === false ? 'ONE_WAY' as BinancePositionMode : undefined,
    performance: {
      ...periodPnl(incomeHistoryResult,historyStart),
      ...periodRoi(incomeHistoryResult,historyStart,account),
      realizedPnlToday,
      realizedPnlHistorical,
      historyStatus:historyCheck.status,
      historyBreakdown:historyCheck.breakdown,
      incomeHistoryCount,
      historyWindow: 'project-start-to-now',
      closedOperationsWindow: 'project-start-since-manual',
      historyBaseline: baseline,
      closedOperations: closed,
    },
    warnings: [exchangeResult, commissionResult, bracketsResult, positionModeResult, positionRiskResult, incomeTodayResult, incomeHistoryResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => friendlyBrowserBinanceError(result.reason)),
  };
}

export function friendlyBrowserBinanceError(error: unknown): string {
  const typed = error as BrowserBinanceError;
  if(typed?.status===403&&typed.code===-1003)return typed.message;
  if(typed?.status===403)return `Binance rechazó la lectura con HTTP 403${typed.endpoint?' en '+typed.endpoint:''} (protección de acceso/WAF). No es una falta de señal ni un tamaño inválido; no se envió una nueva entrada.`;
  if (typed?.browserReason === 'cors') return 'Binance bloqueó la lectura directa desde este navegador (CORS o red). Consulta el estado de la conexión cifrada en Hyrule.';
  if (typed?.code === -2015) return 'Binance rechazó la API Key (-2015). Revisa que la clave privada Ed25519 corresponda a la clave pública registrada y que siga activa.';
  if (typed?.code === -1022) return 'Binance no aceptó la firma (-1022). La clave privada Ed25519 no coincide con la clave pública registrada.';
  if (typed?.code === -1021) return 'La hora del navegador no coincide con Binance. Activa la hora automática de Windows y vuelve a intentar.';
  if (typed?.status === 403 || typed?.status === 451) return `Binance bloqueó la conexión desde esta red (HTTP ${typed.status}). No es un diagnóstico de permisos de tu clave.`;
  if (error instanceof Error && error.message) return error.message;
  return 'No se pudo verificar la cuenta de Binance desde el navegador.';
}

export async function readRealOrderFills(apiKey:string,privatePem:string,symbol:string,orderId:string){
 return normalizeRealFills(await signedRequest<unknown>('GET','/fapi/v1/userTrades',apiKey,privatePem,{symbol,orderId,limit:1000}));
}
export async function readRealFillsAfter(apiKey:string,privatePem:string,symbol:string,fromId:string){
 return normalizeRealFills(await signedRequest<unknown>('GET','/fapi/v1/userTrades',apiKey,privatePem,{symbol,fromId,limit:1000}));
}

export async function readBinanceLiveAccount(apiKey:string,privatePem:string){
 const [account,risk]=await Promise.all([
  signedRequest<any>('GET','/fapi/v3/account',apiKey,privatePem),
  signedRequest<any[]>('GET','/fapi/v3/positionRisk',apiKey,privatePem),
 ]);
 const positions=(account.positions||[]).map((p:any)=>{const r=risk.find(x=>x.symbol===p.symbol&&x.positionSide===p.positionSide);return {...p,entryPrice:r?.entryPrice??p.entryPrice,markPrice:r?.markPrice??p.markPrice,unrealizedProfit:r?.unRealizedProfit??p.unrealizedProfit,leverage:r?.leverage??p.leverage,liquidationPrice:r?.liquidationPrice??p.liquidationPrice}});
 return accountView({...account,positions},risk);
}

export async function readBinanceTradableContractsInBrowser():Promise<Set<string>>{
 const info=await requestJson<any>('/fapi/v1/exchangeInfo');
 if(!Array.isArray(info?.symbols)||!info.symbols.length)throw Error('Binance no entregó la lista de contratos.');
 return new Set(info.symbols.filter((item:any)=>item.status==='TRADING'&&item.contractType==='PERPETUAL'&&item.quoteAsset==='USDT').map((item:any)=>item.symbol));
}

export async function cleanupBinanceProtectionsInBrowser(apiKey:string,privatePem:string,symbol?:string,knownIds:number[]=[]){
 return cleanupFlatBinanceProtections({symbol,knownIds,
  readOrders:()=>readBinanceOpenAlgoOrdersInBrowser(apiKey,privatePem,symbol),
  readPositions:async()=>{const account=await signedRequest<any>('GET','/fapi/v3/account',apiKey,privatePem);if(!Array.isArray(account?.positions)||account.positions.some((p:any)=>!p.symbol||!Number.isFinite(Number(p.positionAmt))))throw Error('Binance no confirmó una lectura completa de posiciones.');return account.positions.filter((p:any)=>Math.abs(Number(p.positionAmt))>0)},
  cancel:id=>cancelBinanceAlgoOrderInBrowser(apiKey,privatePem,id),
 });
}

// Read-only limits for the independent V2 paper simulator.
export async function readV2BracketsInBrowser(apiKey:string,privatePem:string){const raw=await signedRequest<any>('GET','/fapi/v1/leverageBracket',apiKey,privatePem);if(Array.isArray(raw))return raw;if(raw&&typeof raw.symbol==='string'&&Array.isArray(raw.brackets))return [raw];throw Error('Binance no confirmó los límites de apalancamiento')}

/** Entry preflight: no income pages, history, or per-position protection scans. */
export async function readBinanceEntryContextInBrowser(apiKey:string,privatePem:string,symbol:string){
 const named=async<T>(label:string,read:()=>Promise<T>):Promise<T>=>{try{return await read()}catch(error){throw Error(`${symbol} · ${label}: ${friendlyBrowserBinanceError(error)}`)}};
 const [account,risk,exchange,brackets,commission,mode]=await Promise.all([
  named('cuenta',()=>signedRequest<any>('GET','/fapi/v3/account',apiKey,privatePem)),
  named('posiciones',()=>signedRequest<any[]>('GET','/fapi/v3/positionRisk',apiKey,privatePem)),
  named('filtros de contrato',()=>requestJson<any>('/fapi/v1/exchangeInfo')),
  named('límites de apalancamiento',()=>readV2BracketsInBrowser(apiKey,privatePem)),
  named('comisión',()=>signedRequest<any>('GET','/fapi/v1/commissionRate',apiKey,privatePem,{symbol})),
  named('modo de posiciones',()=>signedRequest<any>('GET','/fapi/v1/positionSide/dual',apiKey,privatePem)),
 ]);
 if(!Array.isArray(account.positions)||!Array.isArray(risk))throw Error(`${symbol}: posiciones incompletas en la cuenta Binance.`);
 if(typeof mode?.dualSidePosition!=='boolean')throw Error(`${symbol}: Binance no confirmó el modo de posiciones.`);
 const takerRate=Number(commission?.takerCommissionRate),makerRate=Number(commission?.makerCommissionRate);
 if(!Number.isFinite(takerRate)||takerRate<0||!Number.isFinite(makerRate))throw Error(`${symbol}: Binance no confirmó las comisiones.`);
 const symbolRisk=risk.find((p:any)=>p.symbol===symbol&&(p.positionSide==='BOTH'||!p.positionSide))||risk.find((p:any)=>p.symbol===symbol),kind=String(symbolRisk?.marginType||'').toUpperCase(),isolated=String(symbolRisk?.isolated??'').toLowerCase();
 const marginType=kind==='ISOLATED'||isolated==='true'?'ISOLATED' as BinanceMarginType:kind==='CROSSED'||isolated==='false'?'CROSSED' as BinanceMarginType:undefined;
 const positions=account.positions.map((p:any)=>{const current=risk.find((r:any)=>r.symbol===p.symbol&&r.positionSide===p.positionSide);return {...p,entryPrice:current?.entryPrice??p.entryPrice,markPrice:current?.markPrice??p.markPrice,unrealizedProfit:current?.unRealizedProfit??p.unrealizedProfit,leverage:current?.leverage??p.leverage,liquidationPrice:current?.liquidationPrice??p.liquidationPrice}});
 return {account:accountView({...account,positions},risk),rules:{...binanceContractRules(exchange,brackets,symbol),marginType},commission:{symbol,makerRate,takerRate},positionMode:mode.dualSidePosition?'HEDGE' as BinancePositionMode:'ONE_WAY' as BinancePositionMode};
}

/** Ordinary pending orders also reserve a symbol, even while its position is flat. */
export async function readBinanceOpenOrdersInBrowser(apiKey:string,privatePem:string,symbol:string){
 const rows=await signedRequest<any[]>('GET','/fapi/v1/openOrders',apiKey,privatePem,{symbol});
 if(!Array.isArray(rows))throw Error('Órdenes pendientes sin confirmar');return rows;
}

/** Fast quote refresh; no candles, funding pages or signal rediscovery. */
export async function readSwingExecutionQuoteInBrowser(m:import('./binance-v2-swing').V2Market,side:1|-1){
 const [book,premium]=await Promise.all([requestJson<any>(`/fapi/v1/ticker/bookTicker?symbol=${m.symbol}`),requestJson<any>(`/fapi/v1/premiumIndex?symbol=${m.symbol}`)]);
 return binanceExecutionQuote(m,book,premium,side);
}
