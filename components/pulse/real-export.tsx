'use client';
import {useEffect,useRef,useState} from 'react';

/** Native links work in mobile browsers; copying always has a visible fallback. */
export function RealExport({text,filename,label='historial',disabled=false}:{text:string;filename:string;label?:string;disabled?:boolean}){
 const [url,setUrl]=useState(''),[message,setMessage]=useState(''),[showText,setShowText]=useState(false);
 const textarea=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{
  try{const next=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));setUrl(next);return()=>URL.revokeObjectURL(next)}
  catch{setUrl('');setShowText(true);setMessage('No se pudo preparar la descarga. Puedes copiar los datos de abajo.')}
 },[text]);
 const copy=async()=>{
  try{await navigator.clipboard.writeText(text);setMessage('Copiado. Ya puedes pegarlo en el chat.');setShowText(false)}
  catch{setShowText(true);setMessage('El navegador bloqueó la copia automática. Mantén pulsado el texto de abajo para copiarlo.')}
 };
 useEffect(()=>{if(showText)textarea.current?.select()},[showText]);
 return <div style={{margin:'12px 0'}} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   {!disabled&&url?<a className="outline small" href={url} download={filename} target="_blank" rel="noopener" onClick={()=>setMessage('Archivo preparado. Si tu navegador lo abre, utiliza Compartir → Guardar en Archivos. También puedes copiarlo.')}>Descargar {label}</a>:<button type="button" className="outline small" disabled>Descargar {label}</button>}
   <button type="button" className="outline small" disabled={disabled} onClick={()=>void copy()}>Copiar {label}</button>
   <button type="button" className="outline small" disabled={disabled} onClick={()=>setShowText(value=>!value)}>{showText?'Ocultar datos':'Ver datos para copiar'}</button>
  </div>
  {message&&<p className="tiny" role="status">{message}</p>}
  {showText&&!disabled&&<textarea ref={textarea} readOnly aria-label={`Datos de ${label} para copiar`} value={text} onFocus={event=>event.currentTarget.select()} style={{width:'100%',minHeight:160,marginTop:8,fontSize:12,fontFamily:'monospace'}}/>}
 </div>;
}
