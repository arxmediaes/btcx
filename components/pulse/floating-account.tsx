'use client';
import {useDashboardBlock} from './dashboard-block';
import {profileLocalStorage} from '../../lib/profile-storage';
import {useEffect,useState} from 'react';
import {ChartNoAxesCombined,Wallet,GripHorizontal,ChevronDown,X} from 'lucide-react';
import {readFuturesRadar} from '../../lib/real-radar';
import {summarizeOpenPnl,type OpenPnlPosition} from '../../lib/floating-pnl';
import {useMovablePanel} from './use-movable-panel';
import {AccountWidget} from './account-widget';
import './floating-account.css';
const preference='hyrule-floating-account-view-v1';
const money=(value:number|null)=>value===null||!Number.isFinite(value)?'—':`${value<0?'−':value>0?'+':''}US$${Math.abs(value).toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const tone=(value:number|null)=>value===null||value===0?'':value>0?'is-positive':'is-negative';
type Point={t:number;c:number};
export function FloatingAccount({today,total,floating,positions,accountKey='binance',updatedAt,pnlUpdatedAt,pnlError,now=Date.now(),label='BINANCE · P&L',note}:{today:number|null;total:number|null;floating:number|null;positions?:OpenPnlPosition[];accountKey?:string;updatedAt?:number;pnlUpdatedAt?:number;pnlError?:string;now?:number;label?:string;note?:string}){
 const block=useDashboardBlock('floating-account','Widget de P&L');
 const summary=summarizeOpenPnl(positions),movable=useMovablePanel('hyrule-pnl-position:'+accountKey);
 const [view,setView]=useState<'pnl'|'btc'>('pnl'),[points,setPoints]=useState<Point[]>([]),[btcAt,setBtcAt]=useState(0),[btcError,setBtcError]=useState(false);
 useEffect(()=>{try{if(profileLocalStorage.getItem(preference)==='btc')setView('btc')}catch{}},[]);
 useEffect(()=>{
  if(view!=='btc')return;let active=true,reading=false;
  const read=async()=>{if(reading||document.visibilityState==='hidden')return;reading=true;try{const raw=await readFuturesRadar('BTCUSDT','1m',160),rows=raw.map(r=>({t:Number(r[0]),c:Number(r[4])})).filter(p=>Number.isFinite(p.c)&&p.c>0&&Number.isFinite(p.t)).slice(-60);if(rows.length<2||rows.at(-1)!.t>Date.now()||Date.now()-rows.at(-1)!.t>150000)throw Error('BTC incompleto o antiguo');if(active){setPoints(rows);setBtcAt(Date.now());setBtcError(false)}}catch{if(active)setBtcError(true)}finally{reading=false}};
  void read();const timer=setInterval(()=>void read(),15000),resume=()=>void read();window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume)};
 },[view]);
 const toggle=()=>setView(current=>{const next=current==='pnl'?'btc':'pnl';try{profileLocalStorage.setItem(preference,next)}catch{}return next});
 const pnlAt=pnlUpdatedAt??updatedAt,stale=!!pnlError||!pnlAt||now-pnlAt>90000,btcStale=btcError||!btcAt||now-btcAt>90000,first=points[0]?.c,last=points.at(-1)?.c,change=first&&last?(last/first-1)*100:0;
 const values=points.map(p=>p.c),lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||1,path=points.map((p,i)=>`${i?'L':'M'}${(4+i*208/Math.max(1,points.length-1)).toFixed(2)},${(6+(hi-p.c)/range*36).toFixed(2)}`).join(' ');
 const at=view==='pnl'?pnlAt:btcAt;
 return <section ref={movable.ref} hidden={block.hidden} style={{...movable.style,...(block.hidden?{display:'none'}:{})}} className={`hyrule-float ${view==='btc'?'is-btc':''}`} aria-label={view==='pnl'?`${label}: P&L de hoy ${money(today)}, total ${money(total)}, flotante ${money(floating)}. Pulsa para ver el minigráfico de Bitcoin.`:`Bitcoin ${last?last.toLocaleString('es-CL')+' dólares':'pendiente de lectura'}. Pulsa para volver al resumen de P&L.`} title={view==='pnl'&&pnlError?`P&L pendiente: ${pnlError}`:view==='pnl'?note||'Total: P&L realizado neto desde el reinicio. Flotante: P&L abierto de Binance, antes de costes de cierre. Pulsa para ver Bitcoin.':'Binance Futures · últimas 60 velas de 1 minuto. Pulsa para volver al P&L.'}>
  <div className="hyrule-float-head"><button type="button" className="hyrule-float-drag" aria-label="Mover resumen de P&L; usa las flechas o arrastra" title="Arrastra para mover · Inicio restaura la posición" onPointerDown={movable.onPointerDown} onPointerMove={movable.onPointerMove} onPointerUp={movable.onPointerUp} onPointerCancel={movable.onPointerCancel} onKeyDown={movable.onKeyDown}><GripHorizontal size={13}/><i className={(view==='pnl'?stale:btcStale)?'is-stale':''}/>{view==='pnl'?label:'₿ BITCOIN'}</button><button type="button" className="dashboard-block-close" aria-label="Plegar o desplegar widget" aria-expanded={!block.collapsed} onClick={block.toggle}><ChevronDown size={13}/></button><button type="button" className="dashboard-block-close" aria-label="Ocultar widget de P&L" onClick={block.hide}><X size={13}/></button><AccountWidget data={{today,total,floating,label,note,count:summary.count,best:summary.best,stale:stale||!updatedAt||now-updatedAt>90000}}/></div>
  <div hidden={block.collapsed}><button type="button" className="hyrule-float-content" onClick={toggle} aria-label={view==='pnl'?'Ver gráfico de Bitcoin':'Volver al resumen de P&L'}>

  {view==='pnl'?<span className="hyrule-float-metrics">{[{label:'Hoy',value:today},{label:'Total',value:total},{label:'Flotante',value:floating}].map(item=><span key={item.label}><span>{item.label}</span><strong className={tone(item.value)}>{money(item.value)}</strong></span>)}</span>:<span className="hyrule-float-btc"><span className="hyrule-float-price"><strong>{last?`US$${last.toLocaleString('es-CL',{maximumFractionDigits:2,minimumFractionDigits:2})}`:'Leyendo BTC…'}</strong><small className={tone(change)}>{last?`${change>=0?'+':''}${change.toFixed(2).replace('.',',')}% · 1h`:'Futuros · 1m'}</small></span>{points.length>1?<svg viewBox="0 0 216 48" role="img" aria-label="Precio de Bitcoin en las últimas 60 velas de un minuto"><path d={`${path} L212,48 L4,48 Z`} fill={change>=0?'#bdd69414':'#e3949414'}/><path d={path} fill="none" stroke={change>=0?'#bdd694':'#e39494'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>:<span className="hyrule-float-loading">Esperando cotización de Binance</span>}</span>}
  </button>
  <div className="hyrule-float-extra"><span title="P&L actual de la mejor posición abierta, antes de costes de cierre">Mejor{summary.best?` · ${summary.best.symbol}`:''} <strong className={tone(summary.best?.pnl??null)}>{money(summary.best?.pnl??null)}</strong></span><span>Abiertas <strong>{summary.count??'—'}</strong></span></div>
  <span className="hyrule-float-foot"><span>{(view==='pnl'?stale:btcStale)?(view==='pnl'&&pnlError?'P&L pendiente':'Lectura pendiente'):at?new Date(at).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}):'Sin lectura'}</span><span>{view==='pnl'?'Toca para ver BTC':'Toca para ver P&L'}</span></span>
 </div></section>;
}
