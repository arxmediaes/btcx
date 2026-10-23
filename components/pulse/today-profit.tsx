'use client';
import {useDashboardBlock} from './dashboard-block';
import {profileSessionStorage} from '../../lib/profile-storage';
import {useEffect,useState} from 'react';
import {GripHorizontal,X,ChevronDown,Bitcoin} from 'lucide-react';
import {AccountWidget,pnlMoney,type AccountWidgetData} from './account-widget';
import {useMovablePanel} from './use-movable-panel';
import './today-profit.css';
import './floating-account.css';
export function TodayProfit({today,accountKey,updatedAt,error,now=Date.now(),widgetData,scopeKey='',label,retainLast=false,onViewBtc}:{onViewBtc?:()=>void;today:number|null;accountKey:string;updatedAt?:number;error?:string;now?:number;widgetData?:AccountWidgetData;scopeKey?:string;label?:string;retainLast?:boolean}){
 const block=useDashboardBlock('profit-notice','Burbuja Has ganado');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),key=`hyrule-profit-dismissed:${accountKey}:${day}${scopeKey?':'+scopeKey:''}`;
 const [checkedKey,setCheckedKey]=useState(''),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{let hidden=false;try{hidden=profileSessionStorage.getItem(key)==='true'}catch{}setDismissed(hidden);setCheckedKey(key)},[key]);
 useEffect(()=>{const restore=()=>{setDismissed(false);try{profileSessionStorage.removeItem(key)}catch{}};window.addEventListener('hyrule-restore-profit',restore);return()=>window.removeEventListener('hyrule-restore-profit',restore)},[key]);
 const stale=!!error||!updatedAt||now-updatedAt>90000,visible=!block.hidden&&checkedKey===key&&!dismissed&&(retainLast||!stale)&&today!==null&&Number.isFinite(today)&&today>0;
 const movable=useMovablePanel('hyrule-gain-position:'+accountKey,visible);
 const close=block.hide;
 return <aside ref={movable.ref} style={{...movable.style,...(!visible?{display:'none'}:{})}} className="hyrule-today-profit" aria-label="Ganancia total realizada"><button type="button" className="hyrule-today-profit-icon profit-drag" aria-label="Mover aviso de ganancias" title="Arrastra para mover" onPointerDown={movable.onPointerDown} onPointerMove={movable.onPointerMove} onPointerUp={movable.onPointerUp} onPointerCancel={movable.onPointerCancel} onKeyDown={movable.onKeyDown}><GripHorizontal size={23}/></button><div className="hyrule-today-profit-value"><span className="profit-title">¡Has ganado!{onViewBtc&&<button type="button" className="profit-btc" aria-label="Ver Bitcoin en el gráfico principal" title="Ver BTC" onClick={onViewBtc}><Bitcoin size={14} aria-hidden="true"/></button>}</span>{label&&<small>{label}{stale?' · última lectura':''}</small>}<strong hidden={block.collapsed} style={today!==null&&today<0?{color:'#eda69f'}:undefined}>{pnlMoney(today).replace(/^\+/,'')}</strong></div><div className="hyrule-today-profit-controls"><button type="button" onClick={block.toggle} aria-label="Plegar o desplegar burbuja" aria-expanded={!block.collapsed}><ChevronDown size={14}/></button><button type="button" onClick={close} aria-label="Cerrar aviso de ganancias acumuladas"><X size={20}/></button><AccountWidget data={widgetData??{today:null,total:today,floating:null,count:null,best:null,stale}}/></div></aside>;
}
