'use client';
import {useEffect,useRef,useState} from 'react';
import {Moon} from 'lucide-react';
import {ClosedResult,LossPause,lossPauseStatus} from '../../lib/loss-pause';
export function useLossPause(rows:ClosedResult[],stored:LossPause|undefined,ready:boolean,onChange:(next:LossPause)=>void,enabled=true){
 const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const {current,guard,blocked,remaining}=lossPauseStatus(rows,stored,now,ready,enabled),blockedRef=useRef(blocked);blockedRef.current=blocked;
 useEffect(()=>{if(enabled&&ready&&(guard.until!==current.until||guard.consumedThrough!==current.consumedThrough))onChange(guard)},[enabled,ready,guard.until,guard.consumedThrough,current.until,current.consumedThrough,onChange]);
 return {guard,blocked,blockedRef,remaining,unlock:()=>{const latest=rows.reduce((t,r)=>Math.max(t,r.closedAt||0),guard.consumedThrough);onChange({until:0,consumedThrough:latest});}};
}
export function NightLossPauseToggle({enabled,onToggle,disabled=false}:{enabled:boolean;onToggle:()=>void;disabled?:boolean}){
 return <div className="night-loss-pause"><span>{enabled?'Modo noche · pausa 1 h tras 3 pérdidas seguidas':'Pausa por pérdidas desactivada'}</span><button type="button" className={enabled?'night-loss-toggle active':'night-loss-toggle'} aria-pressed={enabled} aria-label={enabled?'Desactivar modo noche y su bloqueo por pérdidas':'Activar modo noche: pausar una hora tras tres pérdidas seguidas'} title="Modo noche · empieza a contar pérdidas desde que lo activas" onClick={onToggle} disabled={disabled}><Moon size={18}/></button></div>;
}
export function LossPauseNotice({pause}:{pause:ReturnType<typeof useLossPause>}){const [pin,setPin]=useState(''),[error,setError]=useState('');if(!pause.remaining)return null;const seconds=Math.ceil(pause.remaining/1000),minutes=Math.floor(seconds/60);return <div className="loss-pause-notice" role="status"><b>MultiAuto pausado · 3 pérdidas seguidas</b><p>Podrás activarlo en {minutes}:{String(seconds%60).padStart(2,'0')}. Las posiciones abiertas siguen con sus órdenes actuales.</p><form onSubmit={e=>{e.preventDefault();if(pin==='182365'){pause.unlock();setPin('');setError('')}else setError('Clave incorrecta. El bloqueo continúa.')}}><input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" aria-label="Clave para desbloquear MultiAuto" placeholder="Clave" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/><button type="submit" className="outline small">Desbloquear</button></form>{error&&<small className="red">{error}</small>}</div>}
