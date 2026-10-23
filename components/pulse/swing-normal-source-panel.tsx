'use client';
import {useEffect,useState} from 'react';
import {v2Metrics} from '../../lib/binance-v2-swing';
import type {SwingSourceRound} from '../../lib/swing-normal-source';
const quote=(n?:number)=>n==null?'—':Number(n.toPrecision(10)).toLocaleString('en-US',{maximumFractionDigits:10});
const money=(n:number)=>`${n<0?'−':'+'}$${Math.abs(n).toFixed(3)}`;
const label={waiting:'Esperando ejecución',submitted:'Enviada · verificar',opened:'Inversa real abierta',skipped:'Inversa omitida',error:'Revisión necesaria'};
export function SwingNormalSourcePanel({round,enabled}:{round?:SwingSourceRound;enabled:boolean}){
 const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const metrics=round?v2Metrics(round,'normal'):null,trades=round?.trades.filter(t=>t.arm==='normal')||[],active=trades.filter(t=>t.status==='pending'||t.status==='open'),copies=Object.values(round?.copies||{}).sort((a,b)=>b.time-a.time),scanner=Object.values(round?.scanner||{}).sort((a,b)=>b.time-a.time).slice(0,9);
 return <section className="panel swing-normal-source" aria-label="Swing normal solo simulación">
  <div className="panel-title"><div><span className="eyebrow">SOLO SIMULACIÓN · FUENTE DE ENTRADAS</span><h2>Swing normal</h2></div><span className={enabled?'pill':'pill neutral'}>{enabled?'Fuente conectada a inversa real':'Fuente y copia pausadas'}</span></div>
  <></>
  <div className="swing-source-stats"><div><span>Abiertas / reservadas</span><b>{metrics?.open??0} / {metrics?.pending??0}</b></div><div><span>P&L virtual cerrado</span><b className={(metrics?.pnl??0)>=0?'green':'red'}>{money(metrics?.pnl??0)}</b></div><div><span>P&L virtual flotante</span><b>{money(metrics?.floating??0)}</b></div></div>
  <p className="tiny" role="status">{enabled?'Buscando señales normales':'Fuente pausada'} · {round?.lastTick?`Última lectura ${new Date(round.lastTick).toLocaleTimeString('es-CL')}`:'Sin lecturas todavía'} · {round?.config.maxPositions??5} plazas virtuales</p>
  {round?.lastError&&<p className="red tiny">Lectura pendiente: {round.lastError}</p>}
  <h3>Entradas normales simuladas</h3>
  {active.length?active.map(t=><article className="swing-source-position" key={t.id}><div className="panel-title"><strong>{t.symbol} · {t.side===1?'LONG':'SHORT'}</strong><b>{t.status==='pending'?'Reservada':'Abierta virtual'}</b></div><p className="tiny">{t.strategy} · {t.status==='pending'?`Entrada programada ${new Date(t.scheduledAt).toLocaleTimeString('es-CL')} · ${Math.max(0,Math.ceil((t.scheduledAt-now)/1000))} s`:`Entrada ${quote(t.entry)} · cantidad ${quote(t.qty)} · ${t.leverage}×`}</p><></><p className="tiny">{round?.copies?.[t.id]?label[round.copies[t.id].status]:'Esperando aceptación de la normal'}{round?.copies?.[t.id]?` · ${round.copies[t.id].reason}`:''}</p></article>):null}
  <details open={copies.length>0} className="swing-source-log"><summary>Seguimiento normal → inversa · {copies.length}</summary>{copies.length?copies.slice(0,50).map(e=><article key={e.sourceId}><div><strong>{e.symbol}</strong><span className={e.status==='opened'?'green':e.status==='error'?'red':'muted'}>{label[e.status]}</span></div><p>{e.reason}</p>{e.lastFailure&&e.status==='waiting'&&<p className="red">Último bloqueo: {e.lastFailure}</p>}<small>{e.stage?`Etapa: ${e.stage} · `:''}{e.attempts?`${e.attempts} intento(s) · `:''}{e.elapsedMs!=null?`${Math.round(e.elapsedMs/1000)} s desde la entrada · `:''}{new Date(e.time).toLocaleString('es-CL')} · origen {e.sourceId}{e.orderId?` · orden real ${String(e.orderId)}`:''}</small></article>):null}</details>
  <details><summary>Radar y filtros del Swing normal</summary>{scanner.length?scanner.map(e=><p className="tiny" key={e.symbol+e.strategy}><b>{e.symbol} · {e.strategy}</b><br/>{e.reason}</p>):null}</details>
  <details className="swing-source-history"><summary>Historial normal simulado · {trades.length}</summary><div className="table-scroll"><table><thead><tr><th>ACTIVO / FECHA</th><th>ESTADO</th><th>P&L VIRTUAL</th></tr></thead><tbody>{[...trades].reverse().map(t=><tr key={t.id}><td>{t.symbol} · {t.side===1?'LONG':'SHORT'}<small className="block">{new Date(t.createdAt).toLocaleString('es-CL')}</small></td><td>{t.status==='closed'?'Cerrada':t.status==='open'?'Abierta':t.status==='pending'?'Reservada':'Omitida'}<small className="block">{t.reason}</small></td><td>{t.net!=null?money(t.net):'—'}</td></tr>)}</tbody></table></div></details>
 </section>;
}
