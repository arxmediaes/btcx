'use client';
import {profileLocalStorage} from '../../lib/profile-storage';
import {useEffect,useRef,useState,type PointerEvent,type KeyboardEvent} from 'react';
import {clampPanel} from '../../lib/floating-pnl';
export function useMovablePanel(storageKey:string,active=true){
 const ref=useRef<HTMLElement|null>(null),[position,setPosition]=useState<{x:number;y:number}|null>(null),drag=useRef<{pointer:number;x:number;y:number;left:number;top:number}|null>(null),current=useRef(position);current.current=position;
 const place=(x:number,y:number)=>{const box=ref.current?.getBoundingClientRect();if(!box)return null;const next=clampPanel(x,y,box.width,box.height,window.innerWidth,window.innerHeight);current.current=next;setPosition(next);return next};
 const save=()=>{const p=current.current,box=ref.current?.getBoundingClientRect();if(!p||!box)return;try{profileLocalStorage.setItem(storageKey,JSON.stringify({x:p.x/Math.max(1,window.innerWidth-box.width),y:p.y/Math.max(1,window.innerHeight-box.height)}))}catch{}};
 useEffect(()=>{if(!active)return;const restore=()=>{try{const saved=JSON.parse(profileLocalStorage.getItem(storageKey)||'null'),box=ref.current?.getBoundingClientRect();if(saved&&box&&[saved.x,saved.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))place(saved.x*Math.max(1,window.innerWidth-box.width),saved.y*Math.max(1,window.innerHeight-box.height));else if(current.current)place(current.current.x,current.current.y)}catch{}};current.current=null;setPosition(null);restore();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(restore):null;if(ref.current)observer?.observe(ref.current);window.addEventListener('resize',restore);return()=>{observer?.disconnect();window.removeEventListener('resize',restore)}},[storageKey,active]);
 return {ref,style:position?{left:position.x,top:position.y,right:'auto',bottom:'auto',transform:'none'}:undefined,
  onPointerDown:(e:PointerEvent<HTMLElement>)=>{if(e.button!==0)return;const box=ref.current?.getBoundingClientRect();if(!box)return;drag.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,left:box.left,top:box.top};e.currentTarget.setPointerCapture(e.pointerId)},
  onPointerMove:(e:PointerEvent<HTMLElement>)=>{const d=drag.current;if(d&&d.pointer===e.pointerId)place(d.left+e.clientX-d.x,d.top+e.clientY-d.y)},
  onPointerUp:(e:PointerEvent<HTMLElement>)=>{if(drag.current?.pointer!==e.pointerId)return;drag.current=null;save();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)},
  onPointerCancel:()=>{drag.current=null;save()},
  onKeyDown:(e:KeyboardEvent<HTMLElement>)=>{const box=ref.current?.getBoundingClientRect();if(!box)return;const delta=e.shiftKey?24:8,moves:Record<string,[number,number]>={ArrowLeft:[-delta,0],ArrowRight:[delta,0],ArrowUp:[0,-delta],ArrowDown:[0,delta]};if(e.key==='Home'){e.preventDefault();setPosition(null);current.current=null;try{profileLocalStorage.removeItem(storageKey)}catch{}return}if(moves[e.key]){e.preventDefault();place(box.left+moves[e.key][0],box.top+moves[e.key][1]);save()}}
 };
}
