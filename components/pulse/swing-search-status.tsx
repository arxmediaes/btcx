'use client';
import {useEffect,useState} from 'react';
import {Activity,RefreshCw,MonitorCheck,TriangleAlert} from 'lucide-react';
import {searchActivityLabel,type SearchActivity} from '../../lib/search-activity';
import type {AwakeStatus} from '../../lib/search-awake';
const screenLabel:Record<AwakeStatus,string>={off:'Pantalla libre',requesting:'Solicitando pantalla activa…',active:'Pantalla activa confirmada',hidden:'Pantalla activa liberada · página oculta',unsupported:'Este navegador no permite mantener la pantalla activa',denied:'El navegador no permitió mantener la pantalla activa',released:'El sistema liberó la pantalla activa'};
export function SwingSearchStatus({activity,active,ready,awake,visible,online,onRetry}:{activity:SearchActivity;active:boolean;ready:boolean;awake:AwakeStatus;visible:boolean;online:boolean;onRetry:()=>void}){
 const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const status=searchActivityLabel(activity,active,ready,online,visible,now),progress=activity.total?Math.round(activity.completed/activity.total*100):0;
 return <section className={`panel swing-search-status ${status.tone}`} aria-label="Estado de búsqueda Swing">
  <div className="swing-search-top"><div className="swing-search-title"><i className="swing-search-dot"/><div><strong role="status">{status.title}</strong><p>{status.detail}</p></div></div><span className="swing-search-cycle">Ciclo {activity.cycle}</span></div>
  <div className="swing-search-meta"><span><Activity size={13}/>Últimos datos válidos: {activity.lastSuccessAt?`${Math.max(0,Math.floor((now-activity.lastSuccessAt)/1000))} s`:'esperando primera lectura'}</span><span>Radar {activity.radarCursor} / {activity.radarTotal||'—'}</span><span>Lote {activity.completed} / {activity.total}</span></div>
  {!!activity.reads.length&&<><div className="swing-search-track" role="progressbar" aria-label="Lectura del lote" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{width:progress+'%'}}/></div><div className="swing-search-coins">{activity.reads.map(read=><span key={read.symbol} className={read.state} title={read.reason}><i/>{read.symbol.replace('USDT','')}<small>{read.state==='reading'?'leyendo':read.state==='ok'?'leída':'error'}</small></span>)}</div></>}
  <div className="swing-awake-line"><span className={awake==='active'?'green':active?'amber':'muted'}><MonitorCheck size={15}/>{screenLabel[awake]}</span>{active&&awake!=='active'&&awake!=='requesting'&&<button className="outline small" onClick={onRetry}><RefreshCw size={12}/>Reintentar pantalla activa</button>}</div>

  {activity.recoveredAt&&<p className="tiny"><RefreshCw size={11}/> Página recuperada a las {new Date(activity.recoveredAt).toLocaleTimeString('es-CL')}{activity.gapMs?` tras ${Math.round(activity.gapMs/1000)} s sin actividad`:''}. Se descartan entradas antiguas.</p>}
  {activity.phase==='error'&&activity.lastError&&<p className="red tiny"><TriangleAlert size={12}/> {activity.lastError}</p>}
 </section>;
}
