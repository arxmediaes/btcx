'use client';
import {DashboardBlock} from './dashboard-block';
import {useEffect,useState} from 'react';
import {RefreshCw,ShieldCheck,Clock3} from 'lucide-react';
import type {Candle} from '../../lib/engine';
import type {RealEntryEvidence} from '../../lib/real-journal';
import {entryEconomics} from '../../lib/real-journal';
import {swingSummary,type SwingLivePosition} from '../../lib/swing-position-view';
import {santiagoDayStart} from '../../lib/pnl-period';
import {readFuturesRadar} from '../../lib/real-radar';
import {readBinanceOpenAlgoOrdersInBrowser,friendlyBrowserBinanceError} from '../../lib/binance-browser';
import {RealCandleChart,PositionMeter} from './real-trading-desk';
import {RealExport} from './real-export';
const quote=(n:number|undefined|null)=>n==null||!Number.isFinite(n)?'—':Number(n.toPrecision(10)).toLocaleString('en-US',{maximumFractionDigits:10});
const money=(n:number)=>`${n<0?'−':'+'}$${Math.abs(n).toFixed(3)}`;
const elapsed=(opened:number,now:number)=>{const minutes=Math.max(0,Math.floor((now-opened)/60000));return minutes>=60?`${Math.floor(minutes/60)}h ${minutes%60}m`:`${minutes}m`};
type Props={visible:boolean;ready:boolean;apiKey:string;privateKey:string;entries:RealEntryEvidence[];positions:SwingLivePosition[];updatedAt?:number;busy?:boolean;onRefresh:()=>void;onClose?:(p:SwingLivePosition)=>void};
export function SwingInverseDesk(p:Props){
 const [now,setNow]=useState(Date.now()),[selected,setSelected]=useState(''),[tf,setTf]=useState('1h'),[bars,setBars]=useState<Candle[]>([]),[chartError,setChartError]=useState(''),[refresh,setRefresh]=useState(0),[protection,setProtection]=useState<{at:number;orders:any[];error?:string}>({at:0,orders:[]});
 const stats=swingSummary(p.entries,p.positions,santiagoDayStart(now)),active=stats.open.find(r=>r.position.symbol===selected)??stats.open[0],coin=active?.position.symbol??selected??'',stale=!p.updatedAt||now-p.updatedAt>90000;
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const symbols=stats.open.map(r=>r.position.symbol).sort().join(',');
 useEffect(()=>{if(!p.visible||!p.ready||!symbols)return;let stopped=false,reading=false;
  const read=async()=>{if(reading)return;reading=true;try{const orders=await readBinanceOpenAlgoOrdersInBrowser(p.apiKey,p.privateKey);if(!stopped)setProtection({at:Date.now(),orders})}catch(error){if(!stopped)setProtection({at:0,orders:[],error:friendlyBrowserBinanceError(error)})}finally{reading=false}};
  void read();const timer=setInterval(()=>void read(),15000);return()=>{stopped=true;clearInterval(timer)};
 },[p.visible,p.ready,p.apiKey,p.privateKey,symbols,refresh]);
 useEffect(()=>{setBars([]);setChartError('');if(!p.visible||!coin)return;let stopped=false,reading=false;
  const read=async()=>{if(reading)return;reading=true;try{const raw=await readFuturesRadar(coin,tf,300),rows=raw.map(r=>({t:Number(r[0]),o:Number(r[1]),h:Number(r[2]),l:Number(r[3]),c:Number(r[4]),v:Number(r[5])}));if(!rows.length||rows.some(row=>!Object.values(row).every(Number.isFinite)))throw Error('Velas incompletas');if(!stopped){setBars(rows);setChartError('')}}catch(error){if(!stopped)setChartError(friendlyBrowserBinanceError(error))}finally{reading=false}};
  void read();const timer=setInterval(()=>void read(),15000);return()=>{stopped=true;clearInterval(timer)};
 },[coin,tf,p.visible,refresh]);
 const protectedLevel=(entry:RealEntryEvidence,position:SwingLivePosition,type:string,price:number)=>protection.at>0&&now-protection.at<45000&&protection.orders.some(o=>o.symbol===entry.symbol&&o.orderType===type&&o.side===(entry.side==='LONG'?'SELL':'BUY')&&(!o.positionSide||o.positionSide==='BOTH'||o.positionSide===entry.side)&&Number(o.triggerPrice)===price&&(o.closePosition===true||Math.abs(Number(o.quantity)-Math.abs(position.quantity))<1e-8)&&o.workingType==='MARK_PRICE');
 const verifiedSL=active?protectedLevel(active.entry,active.position,'STOP_MARKET',active.entry.plannedStop):false,verifiedTP=active?protectedLevel(active.entry,active.position,'TAKE_PROFIT_MARKET',active.entry.plannedTarget):false;
 return <div className="swing-inverse-desk">
  <div className="swing-desk-toolbar"><span className="tiny">{p.updatedAt?`Lectura ${new Date(p.updatedAt).toLocaleTimeString('es-CL')}`:'Lectura pendiente'}{stale?' · datos pendientes de actualizar':''}</span><button className="outline small" disabled={p.busy} onClick={()=>{setRefresh(v=>v+1);p.onRefresh()}}><RefreshCw size={13}/>Actualizar</button></div>
  <DashboardBlock id="swing-metrics" label="Swing · resumen de resultados"><div className="stats-grid swing-stats">
   <div className="panel stat-card"><span>Posiciones inversas</span><strong>{stats.open.length}</strong><small>{stats.open.filter(r=>r.partial).length?'Incluye cierres parciales':'Separadas del scalp'}</small></div>
   <div className="panel stat-card"><span>P&L flotante</span><strong className={stats.floating>=0?'green':'red'}>{money(stats.floating)}</strong><small>{stale?'Lectura pendiente':'Posiciones atribuidas al bot'}</small></div>
   <div className="panel stat-card"><span>P&L cerrado hoy</span><strong className={stats.today>=0?'green':'red'}>{money(stats.today)}</strong><small>Comisiones descontadas</small></div>
   <div className="panel stat-card"><span>Acumulado verificado</span><strong className={stats.net>=0?'green':'red'}>{money(stats.net)}</strong><small>{stats.closed.length} cierres · {stats.closed.length?`${Math.round(stats.wins/stats.closed.length*100)}% positivos`:'Sin cierres'}</small></div>
  </div>
  </DashboardBlock><DashboardBlock id="swing-positions" label="Swing · posiciones"><div className="panel-title"><h3>Posiciones Swing Inversa</h3></div>
  {!stats.open.length?<div className="swing-empty"><ShieldCheck size={22}/><div><strong>Sin posiciones Swing Inversa abiertas</strong><></></div></div>:<div className="swing-position-grid">{stats.open.map(({position,entry,attribution,partial})=>{
   const sl=protectedLevel(entry,position,'STOP_MARKET',entry.plannedStop),tp=protectedLevel(entry,position,'TAKE_PROFIT_MARKET',entry.plannedTarget),economics=entryEconomics({...entry,quantity:Math.abs(position.quantity)}),live={...position,markPrice:position.markPrice??0,stop:entry.plannedStop,target:entry.plannedTarget};
   return <article className={`panel swing-position-card ${active?.entry.id===entry.id?'selected':''}`} key={entry.id}>
    <div className="panel-title"><button className="text-button" onClick={()=>setSelected(position.symbol)}><strong>{position.symbol.replace('USDT','')}</strong><span className={entry.side==='LONG'?'green':'red'}>{entry.side}</span></button><b className={position.unrealizedProfit>=0?'green':'red'}>{attribution?money(position.unrealizedProfit):'Atribución pendiente'}</b></div>
    <div className="swing-position-meta"><span><Clock3 size={12}/>{elapsed(entry.openedAt,now)}</span><span>{position.leverage??entry.leverage}× · {entry.marginType==='CROSSED'?'Cruzado':entry.marginType==='ISOLATED'?'Aislado':'Margen sin registrar'}</span><span>{partial?'Cierre parcial':entry.strategy==='adx'?'Impulso':entry.strategy==='rsi'?'RSI':'Barrida'} · inversa</span></div>
    {!attribution&&null}
    <div className="swing-level-grid"><div><span>Entrada real</span><b>{quote(position.entryPrice)}</b></div><div><span>Precio de marca</span><b>{quote(position.markPrice)}</b></div><div><span>Stop-loss</span><b className="red">{quote(entry.plannedStop)}</b><small>{sl?'Confirmado en Binance':'Nivel planeado · verificar'}</small></div><div><span>Take-profit</span><b className="green">{quote(entry.plannedTarget)}</b><small>{tp?'Confirmado en Binance':'Nivel planeado · verificar'}</small></div><div><span>Cantidad actual</span><b>{quote(Math.abs(position.quantity))}</b></div><div><span>Notional / margen estimado</span><b>${quote(Math.abs(position.quantity)*position.entryPrice)} / ${quote(Math.abs(position.quantity)*position.entryPrice/(position.leverage??entry.leverage))}</b></div></div>
    <PositionMeter position={live} venue="Binance" advisory={false}/>
    <div className="swing-position-meta"><span>TP neto {money(economics.netTarget)}</span><span>SL {money(-economics.netRisk)}</span><span>Liquidación {quote(position.liquidationPrice)}</span></div>
    <div className="swing-position-actions"><button className="outline small" onClick={()=>setSelected(position.symbol)}>Ver gráfico</button>{p.onClose&&<button className="outline small danger-outline" disabled={p.busy||!attribution||stale} onClick={()=>p.onClose?.(position)}>Cerrar posición</button>}</div>
   </article>;
  })}</div>}
  </DashboardBlock><DashboardBlock id="swing-chart" label="Swing · gráfico">{active&&<div className="panel swing-chart"><div className="panel-title"><h3>{coin.replace('USDT','')} · Swing Inversa</h3><div className="swing-chart-tabs">{['15m','1h','4h'].map(frame=><button className={tf===frame?'primary small':'outline small'} key={frame} onClick={()=>setTf(frame)}>{frame}</button>)}</div></div><></>{chartError&&<p className="red tiny">{chartError}</p>}<RealCandleChart symbol={coin.replace('USDT','')} bars={bars} tf={tf} lines now={now} showRoute={false} position={{...active.position,markPrice:active.position.markPrice??0,stop:active.entry.plannedStop,target:active.entry.plannedTarget}}/></div>}
  </DashboardBlock>{protection.error&&<p className="red tiny">Lectura de protecciones pendiente: {protection.error}</p>}
  <DashboardBlock id="swing-history" label="Swing · historial verificado"><details className="panel swing-history"><summary>Historial Swing Inversa · {stats.rows.length}</summary><RealExport text={JSON.stringify({type:'swing-inverse',entries:stats.rows},null,2)} filename="hyrule-swing-inversa.json" disabled={!stats.rows.length}/><div className="table-scroll"><table><thead><tr><th>FECHA / ACTIVO</th><th>LADO / TAMAÑO</th><th>ENTRADA / SALIDA</th><th>SL / TP</th><th>COMISIÓN</th><th>P&L / ESTADO</th></tr></thead><tbody>{[...stats.rows].reverse().map(e=>{const result=e.outcome,exit=result?.gross!=null&&e.quantity>0?e.entry+(e.side==='LONG'?1:-1)*result.gross/e.quantity:undefined;return <tr key={e.id}><td>{new Date(e.openedAt).toLocaleString('es-CL')}<strong className="block">{e.symbol}</strong><small>ID {String(e.orderId)}</small></td><td>{e.side}<span className="tiny block">{quote(e.quantity)} · {e.leverage}×</span></td><td>{quote(result?.confirmedEntry??e.entry)}<span className="tiny block">{exit?`Salida media estimada ${quote(exit)}`:'Salida pendiente'}</span></td><td>{quote(e.plannedStop)}<span className="tiny block">{quote(e.plannedTarget)}</span></td><td>{result?.commission!=null?`$${quote(result.commission)}`:'Pendiente'}</td><td>{result?.status==='verified'?<b className={(result.net??0)>=0?'green':'red'}>{money(result.net??0)}</b>:result?.status==='open'?'Abierta':result?.status==='ambiguous'?'Revisar atribución':'Verificando cierre'}{result?.closedAt&&<small className="block">{new Date(result.closedAt).toLocaleString('es-CL')}</small>}</td></tr>})}</tbody></table></div><></></details></DashboardBlock>
 </div>;
}
