/** Never expose raw responses: an upstream page can contain account/session data. */
export async function readKrakenResponse(response:Response):Promise<any>{
 const raw=await response.text(),html=/^\s*</.test(raw),session=response.status===401||response.status===403||response.redirected&&html;
 if(session){if(typeof window!=='undefined')window.dispatchEvent(new Event('hyrule-session-expired'));throw Object.assign(Error('La sesión de Hyrule venció. Intentando recuperar la conexión; si continúa, renueva la sesión con ChatGPT.'),{sessionExpired:true});}
 if(!raw.trim())throw Error(`Kraken recibió una respuesta vacía del sitio (HTTP ${response.status}). Recarga e inténtalo de nuevo.`);
 if(html)throw Error(`El sitio devolvió una página en lugar de datos de Kraken (HTTP ${response.status}). Abre el sitio completo y vuelve a intentarlo.`);
 let data:any;try{data=JSON.parse(raw)}catch{throw Error(`La respuesta de Kraken no pudo leerse (HTTP ${response.status}). Vuelve a intentarlo.`)}
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('El sitio devolvió datos de Kraken incompletos.');
 if(!response.ok)throw Object.assign(Error(typeof data.error==='string'?data.error:`Kraken no respondió (HTTP ${response.status}).`),{retryable:data.retryable===true});
 return data;
}
