import type {BinanceProfile} from './binance-profile';
import {binanceContractRules,unconfirmedBinanceRules} from './binance-contract-rules';
import {periodRoi} from './period-roi';
import {periodPnl} from './pnl-period';
import {excludedRealClose} from './real-history-exclusions';
import {collectIncomePages,verifiedIncome} from './real-income';
import { env } from 'cloudflare:workers';

const API_BASE = 'https://fapi.binance.com';
const encoder = new TextEncoder();

type BinanceError = Error & { code?: number; status?: number };

function runtimeSecret(): string {
  const value = (env as unknown as Record<string, unknown>).PULSE_ENCRYPTION_KEY;
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error('Falta la clave interna de cifrado del sitio.');
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function cryptoKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(runtimeSecret()));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(), encoder.encode(value));
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return bytesToBase64(packed);
}

export async function decryptSecret(value: string): Promise<string> {
  const packed = base64ToBytes(value);
  if (packed.length <= 12) throw new Error('Credencial cifrada inválida.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, await cryptoKey(), packed.slice(12));
  return new TextDecoder().decode(plain);
}

export async function signQuery(query: string, secret: string): Promise<string> {
  // Binance Ed25519 keys are stored as a PKCS#8 PEM. The same encrypted DB
  // column continues to support legacy HMAC secrets without a migration.
  if (/^-----BEGIN PRIVATE KEY-----/.test(secret.trim())) {
    const pem = secret.trim().replace(/\r\n/g, '\n');
    const match = pem.match(/^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PRIVATE KEY-----$/);
    if (!match) throw new Error('La clave privada Ed25519 debe estar completa en formato PEM PKCS#8.');
    const der = base64ToBytes(match[1].replace(/\s/g, ''));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, encoder.encode(query));
    return bytesToBase64(new Uint8Array(signature));
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(query));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function binanceRequest<T>(path: string, apiKey?: string, secret?: string, params: Record<string, string | number> = {}): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  if (apiKey && secret) {
    query.set('timestamp', String(Date.now()));
    query.set('recvWindow', '5000');
    query.set('signature', await signQuery(query.toString(), secret));
  }
  const url = `${API_BASE}${path}${query.toString() ? `?${query.toString()}` : ''}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: apiKey ? { 'X-MBX-APIKEY': apiKey } : undefined,
    signal: AbortSignal.timeout(9000),
  });
  const rawBody = await response.text();
  let body: any = null;
  try { body = JSON.parse(rawBody); } catch { /* Binance may answer with an HTML gateway page. */ }
  if (!response.ok || (body && typeof body.code === 'number' && body.code < 0)) {
    const error: BinanceError = new Error(typeof body?.msg === 'string' ? body.msg : `Binance respondió HTTP ${response.status} sin detalle de API.`);
    error.code = body?.code;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export function friendlyBinanceError(error: unknown): string {
  const code = (error as BinanceError)?.code;
  if (code === -2015) return 'Binance rechazó la API Key (-2015). Revisa que la clave privada Ed25519 corresponda a la clave pública registrada y que la clave siga activa.';
  if (code === -1022) return 'Binance no aceptó la firma (-1022). La clave privada Ed25519 no coincide con la clave pública registrada.';
  if (code === -1021) return 'La hora del servidor no coincide con Binance. Intenta de nuevo en unos segundos.';
  if (code === -2014) return 'La clave API tiene un formato inválido.';
  if ((error as BinanceError)?.status === 403) return 'Binance devolvió HTTP 403 sin un código claro de API. La conexión fue bloqueada antes de leer la cuenta; este mensaje por sí solo no confirma un problema de IP o permisos.';
  if (error instanceof Error && error.message) return error.message;
  return 'No se pudo verificar la cuenta de Binance.';
}

export type BinanceAccount = {
  assets?:Array<{asset:string;walletBalance:string}>;
  totalWalletBalance: string;
  availableBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  positions: Array<{ symbol: string; positionAmt: string; entryPrice: string; markPrice: string; unrealizedProfit: string; leverage: string; liquidationPrice?: string }>;
};

export type BinanceExchangeInfo = {
  symbols: Array<{ symbol: string; status: string; quoteAsset: string; filters: Array<{ filterType: string; minQty?: string; stepSize?: string; minNotional?: string; notional?: string }> }>;
};

export type BinanceCommission = { symbol: string; makerCommissionRate: string; takerCommissionRate: string };
type BinanceAlgoOrder = { algoId?: number; orderType?: string; symbol?: string; side?: string; positionSide?: string; triggerPrice?: string; price?: string };

type BinanceHistoryBaseline = {
  symbol: string;
  realizedPnl: number;
  time: number;
};

// Último cierre manual del teléfono informado por el usuario. PULSE no debe
// mezclarlo ni mezclar operaciones anteriores con sus propios resultados.
const MANUAL_BASELINE_SYMBOL = 'BTCUSDT';
const MANUAL_BASELINE_PNL = -0.75;
const MANUAL_BASELINE_TOLERANCE = 0.04;
// Hyrule empezó a registrar las operaciones reales el 8 de octubre de 2026.
const HYRULE_HISTORY_START = new Date('2026-10-08T00:00:00-03:00').getTime();

const TRADING_INCOME_TYPES = new Set([
  'REALIZED_PNL',
  'COMMISSION',
  'FUNDING_FEE',
  'INSURANCE_CLEAR',
  'REFERRAL_KICKBACK',
  'COMMISSION_REBATE',
  'API_REBATE',
]);

function historyBaseline(result: PromiseSettledResult<unknown>, dayStart: number): BinanceHistoryBaseline | null {
  if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return null;
  const match = result.value
    .filter((row: any) => String(row?.symbol || '').toUpperCase() === MANUAL_BASELINE_SYMBOL)
    .filter((row: any) => row?.incomeType === 'REALIZED_PNL' && Number(row?.time || 0) >= HYRULE_HISTORY_START)
    .filter((row: any) => Math.abs(Number(row?.income) - MANUAL_BASELINE_PNL) <= MANUAL_BASELINE_TOLERANCE)
    .sort((a: any, b: any) => Number(a?.time || 0) - Number(b?.time || 0))[0];
  if (!match) return null;
  return {
    symbol: MANUAL_BASELINE_SYMBOL.replace(/USDT$/i, ''),
    realizedPnl: Number(match.income),
    time: Number(match.time || 0),
  };
}

function closedOperations(result: PromiseSettledResult<unknown>, afterTime = 0,profile:BinanceProfile='primary') {
  if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return null;
  return result.value
    .filter((row: any) => row?.incomeType === 'REALIZED_PNL' && (!row.asset || row.asset === 'USDT') && Number(row?.time || 0) > afterTime && (profile==='secondary'||!excludedRealClose(String(row.symbol||''),Number(row.time||0),String(row.tradeId||''))))
    .map((row: any, index: number) => ({
      id: `${row.symbol || 'ACCOUNT'}-${row.tranId || row.tradeId || row.time || index}`,
      symbol: String(row.symbol || '—').replace(/USDT$/i, ''),
      realizedPnl: Number.isFinite(Number(row.income)) ? Number(row.income) : 0,
      time: Number(row.time || 0),
      tradeId: String(row.tradeId || row.tranId || '—'),
    }))
    .sort((a: any, b: any) => b.time - a.time);
}

function incomeTotal(result: PromiseSettledResult<unknown>): number | null {
  if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return null;
  return result.value
    .filter((row: any) => (!row.asset || row.asset === 'USDT') && (!row.incomeType || TRADING_INCOME_TYPES.has(row.incomeType)))
    .reduce((total: number, row: any) => total + (Number.isFinite(Number(row.income)) ? Number(row.income) : 0), 0);
}

function incomeTotalAfter(result: PromiseSettledResult<unknown>, afterTime: number): number | null {
  if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return null;
  return result.value
    .filter((row: any) => Number(row?.time || 0) > afterTime)
    .filter((row: any) => (!row.asset || row.asset === 'USDT') && (!row.incomeType || TRADING_INCOME_TYPES.has(row.incomeType)))
    .reduce((total: number, row: any) => total + (Number.isFinite(Number(row.income)) ? Number(row.income) : 0), 0);
}

function protectionForPosition(position: BinanceAccount['positions'][number], algoOrders: BinanceAlgoOrder[]) {
  const symbol = String(position?.symbol || '').toUpperCase();
  const positionSide = String((position as any)?.positionSide || 'BOTH').toUpperCase();
  const closeSide = Number(position?.positionAmt) > 0 ? 'SELL' : 'BUY';
  const matching = algoOrders.filter((order) => {
    if (String(order.symbol || '').toUpperCase() !== symbol) return false;
    if (order.side && String(order.side).toUpperCase() !== closeSide) return false;
    const orderPositionSide = String(order.positionSide || 'BOTH').toUpperCase();
    return orderPositionSide === 'BOTH' || positionSide === 'BOTH' || orderPositionSide === positionSide;
  });
  const stopOrder = matching.find((order) => /^(STOP|STOP_MARKET)$/.test(String(order.orderType || '').toUpperCase()));
  const targetOrder = matching.find((order) => /^(TAKE_PROFIT|TAKE_PROFIT_MARKET)$/.test(String(order.orderType || '').toUpperCase()));
  const trigger = (order?: BinanceAlgoOrder) => Number(order?.triggerPrice || order?.price || 0) || 0;
  return { stop: trigger(stopOrder), target: trigger(targetOrder), stopOrderId: Number(stopOrder?.algoId || 0) || null, targetOrderId: Number(targetOrder?.algoId || 0) || null };
}

export async function readBinanceSnapshot(apiKey: string, secret: string, symbol = 'BTCUSDT',profile:BinanceProfile='primary') {
  // La cuenta es la validación imprescindible. Las reglas, comisiones y
  // apalancamiento son lecturas auxiliares: algunas claves pueden leer la
  // cuenta de Futuros pero no exponer todavía alguno de esos endpoints.
  const account = await binanceRequest<BinanceAccount>('/fapi/v3/account', apiKey, secret);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const historyStart = Math.max(Date.now() - (90 * 24 * 60 * 60 * 1000), HYRULE_HISTORY_START);
  const historyEnd = Date.now();
  const positionSymbols = [...new Set((account.positions || [])
    .filter((position) => Math.abs(Number(position.positionAmt)) > 0)
    .map((position) => String(position.symbol || '').toUpperCase())
    .filter(Boolean))];
  const openAlgoResults = await Promise.allSettled(positionSymbols.map((positionSymbol) => binanceRequest<BinanceAlgoOrder[]>('/fapi/v1/openAlgoOrders', apiKey, secret, { symbol: positionSymbol })));
  const openAlgoOrders = openAlgoResults.flatMap((result) => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
  const [exchangeResult, commissionResult, bracketsResult, incomeTodayResult, incomeHistoryResult] = await Promise.allSettled([
    binanceRequest<BinanceExchangeInfo>('/fapi/v1/exchangeInfo'),
    binanceRequest<BinanceCommission>('/fapi/v1/commissionRate', apiKey, secret, { symbol }),
    binanceRequest<any[]>('/fapi/v1/leverageBracket', apiKey, secret, { symbol }),
    binanceRequest<any[]>('/fapi/v1/income', apiKey, secret, { startTime: dayStart.getTime(), limit: 1000 }),
    collectIncomePages(page=>binanceRequest<any[]>('/fapi/v1/income', apiKey, secret, { startTime: historyStart, endTime: historyEnd, page, limit: 1000 })),
  ]);
  const exchange = exchangeResult.status === 'fulfilled' ? exchangeResult.value : null;
  const commission = commissionResult.status === 'fulfilled' ? commissionResult.value : null;
  const brackets = bracketsResult.status === 'fulfilled' ? bracketsResult.value : null;
  const baseline = profile==='primary'?historyBaseline(incomeHistoryResult, HYRULE_HISTORY_START):null;
  const baselineTime = baseline?.time || 0;
  const historyCheck=verifiedIncome(incomeHistoryResult,baselineTime,HYRULE_HISTORY_START,historyStart);
  const historyRows = incomeHistoryResult.status === 'fulfilled' && Array.isArray(incomeHistoryResult.value) ? incomeHistoryResult.value : [];
  const todayRows = incomeTodayResult.status === 'fulfilled' && Array.isArray(incomeTodayResult.value) ? incomeTodayResult.value : [];
  const incomeMap = new Map<string, any>();
  for (const row of [...historyRows, ...todayRows]) {
    const key = `${row?.incomeType || ''}:${row?.symbol || ''}:${row?.tranId || row?.tradeId || row?.time || ''}:${row?.income || ''}`;
    incomeMap.set(key, row);
  }
  const historySource: PromiseSettledResult<unknown> = incomeMap.size > 0 ? { status: 'fulfilled', value: [...incomeMap.values()] } : incomeHistoryResult;
  let contractRules;try{contractRules=binanceContractRules(exchange,brackets,symbol)}catch(error){const readError=[exchangeResult,bracketsResult].filter((r):r is PromiseRejectedResult=>r.status==='rejected').map(r=>r.reason instanceof Error?r.reason.message:String(r.reason)).join(' · ');contractRules=unconfirmedBinanceRules(symbol,readError||(error instanceof Error?error.message:'Reglas pendientes'))}
  return {
    account: {
      totalWalletBalance: Number(account.totalWalletBalance),
      availableBalance: Number(account.availableBalance),
      totalUnrealizedProfit: Number(account.totalUnrealizedProfit),
      totalMarginBalance: Number(account.totalMarginBalance),
      positions: (account.positions || []).filter((position) => Math.abs(Number(position.positionAmt)) > 0).map((position) => ({
        ...(() => { const protection = protectionForPosition(position, openAlgoOrders); return protection; })(),
        symbol: position.symbol,
        side: Number(position.positionAmt) > 0 ? 'LONG' : 'SHORT',
        quantity: Number(position.positionAmt),
        entryPrice: Number(position.entryPrice),
        markPrice: Number(position.markPrice),
        unrealizedProfit: Number(position.unrealizedProfit),
        leverage: Number(position.leverage),
        liquidationPrice: Number(position.liquidationPrice || 0) || null,
      })),
    },
    rules: contractRules,
    commission: commission ? {
      symbol: commission.symbol,
      makerRate: Number(commission.makerCommissionRate),
      takerRate: Number(commission.takerCommissionRate),
    } : null,
    performance: {
      ...periodPnl(incomeHistoryResult,historyStart),
      ...periodRoi(incomeHistoryResult,historyStart,account),
      realizedPnlToday: baselineTime&&incomeTodayResult.status==='fulfilled'&&Array.isArray(incomeTodayResult.value)&&incomeTodayResult.value.length<1000?incomeTotalAfter(incomeTodayResult, baselineTime):null,
      realizedPnlHistorical: historyCheck.breakdown?.net??null,
      historyStatus:historyCheck.status,
      historyBreakdown:historyCheck.breakdown,
      incomeHistoryCount: incomeHistoryResult.status === 'fulfilled' && Array.isArray(incomeHistoryResult.value)
        ? incomeHistoryResult.value.filter((row: any) => Number(row?.time || 0) > baselineTime).length
        : null,
      historyWindow: 'project-start-to-now',
      closedOperationsWindow: 'project-start-since-manual',
      historyBaseline: baseline,
      closedOperations: closedOperations(historySource, baselineTime,profile),
    },
    warnings: [exchangeResult, commissionResult, bracketsResult, incomeTodayResult, incomeHistoryResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => friendlyBinanceError(result.reason)),
  };
}
