'use client';
import {useEffect,useRef,useState} from 'react';
import {createSearchAwake,type AwakeStatus,type ScreenLease} from '../../lib/search-awake';
export function useSearchAwake(active:boolean,onResume:()=>void){
 const [status,setStatus]=useState<AwakeStatus>('off'),[visible,setVisible]=useState(true),[online,setOnline]=useState(true);
 const callback=useRef(onResume);callback.current=onResume;
 const controller=useRef<ReturnType<typeof createSearchAwake>|null>(null);
 useEffect(()=>{
  const api=(navigator as Navigator&{wakeLock?:{request:(type:'screen')=>Promise<ScreenLease>}}).wakeLock;
  const current=createSearchAwake({request:api?()=>api.request('screen'):undefined,visible:()=>document.visibilityState==='visible',status:setStatus});controller.current=current;
  setVisible(document.visibilityState==='visible');setOnline(navigator.onLine);
  void current.setEnabled(active);
  const resume=()=>{setVisible(document.visibilityState==='visible');setOnline(navigator.onLine);if(document.visibilityState==='visible'){void current.refresh();callback.current();}};
  const visibility=()=>{setVisible(document.visibilityState==='visible');if(document.visibilityState==='visible')resume();else void current.refresh();};
  const offline=()=>setOnline(false);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);window.addEventListener('online',resume);window.addEventListener('offline',offline);
  const retry=window.setInterval(()=>{if(active&&document.visibilityState==='visible')void current.refresh()},30000);
  return()=>{controller.current=null;void current.dispose();clearInterval(retry);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);window.removeEventListener('online',resume);window.removeEventListener('offline',offline);};
 },[active]);
 return {status,visible,online,retry:()=>void controller.current?.refresh()};
}
