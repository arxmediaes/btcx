'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {ChevronDown,X} from 'lucide-react';
import {profileLocalStorage} from '../../lib/profile-storage';
import './dashboard-block.css';
const key='hyrule-dashboard-visibility-v1',eventName='hyrule-dashboard-visibility';
type Layout=Record<string,{label:string;hidden?:boolean;collapsed?:boolean}>;
const retiredIds=new Set(['swing-size','swing-search','swing-normal','swing-real','swing-metrics','swing-positions','swing-chart','swing-history','pulse-real-dock-v3-0']);
function read():Layout{try{const value=JSON.parse(profileLocalStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}}
function update(id:string,value:Layout[string]){const layout=read();layout[id]={...layout[id],...value};try{profileLocalStorage.setItem(key,JSON.stringify(layout))}catch{}window.dispatchEvent(new CustomEvent(eventName,{detail:layout}));}
export function revealDashboardBlocks(blocks:Array<{id:string;label:string}>){for(const block of blocks)update(block.id,{label:block.label,hidden:false,collapsed:false});}
function useLayout(){const [layout,setLayout]=useState<Layout>({});useEffect(()=>{setLayout(read());const refresh=(event:Event)=>setLayout((event as CustomEvent<Layout>).detail??read());window.addEventListener(eventName,refresh);return()=>window.removeEventListener(eventName,refresh)},[]);return layout;}
export function useDashboardBlock(id:string,label:string){const layout=useLayout();useEffect(()=>{if(read()[id]?.label!==label)update(id,{label})},[id,label]);return {hidden:!!layout[id]?.hidden,collapsed:!!layout[id]?.collapsed,hide:()=>update(id,{label,hidden:true}),toggle:()=>update(id,{label,collapsed:!layout[id]?.collapsed})};}
/** Visual hiding only: children always remain mounted, including live bot supervisors. */
export function DashboardBlock({id,label,children,grip,defaultCollapsed=false}:{id:string;label:string;children:ReactNode;grip?:ReactNode;defaultCollapsed?:boolean}){
 const layout=useLayout(),state=layout[id],collapsed=state?.collapsed??defaultCollapsed;
 useEffect(()=>{if(read()[id]?.label!==label)update(id,{label})},[id,label]);
 return <section hidden={!!state?.hidden} className={`dashboard-block ${collapsed?'is-folded':''}`} data-dashboard-block={id}>
 <div className="dashboard-block-heading">{grip}<button type="button" className="dashboard-block-toggle" aria-expanded={!collapsed} aria-controls={`block-${id}`} onClick={()=>update(id,{label,collapsed:!collapsed})}><span>{label}</span><ChevronDown size={14}/></button><button type="button" className="dashboard-block-close" aria-label={`Ocultar ${label}`} title="Ocultar bloque de la vista" onClick={()=>update(id,{label,hidden:true})}><X size={13}/></button></div>
 <div id={`block-${id}`} hidden={collapsed} className="dashboard-block-content">{children}</div>
 </section>;
}
export function DashboardBlocksMenu(){const layout=useLayout(),items=Object.entries(layout).filter(([id])=>!retiredIds.has(id));return <details className="dashboard-blocks-menu"><summary>Mostrar bloques{items.some(([,v])=>v.hidden)?` · ${items.filter(([,v])=>v.hidden).length} ocultos`:''}</summary><div><></>{items.map(([id,value])=><label key={id}><input type="checkbox" checked={!value.hidden} onChange={e=>update(id,{label:value.label,hidden:!e.target.checked})}/>{value.label}</label>)}<button type="button" className="outline small" onClick={()=>{for(const [id,value] of items)update(id,{label:value.label,hidden:false,collapsed:false});window.dispatchEvent(new Event('hyrule-restore-profit'));}}>Mostrar y desplegar todo</button></div></details>}
