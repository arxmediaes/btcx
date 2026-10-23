// V2 only: bounded JSON responses and WebView transport fallback. Never logs credentials/body.
export async function v2ReadJson(response:Response,label:string){
 if(response.status===401)throw Object.assign(Error('La sesión necesita renovarse. Pulsa Reanudar sesión para continuar con los mismos saldos e historiales.'),{status:401});
 if(response.status===423)throw Object.assign(Error('El acceso está bloqueado. Desbloquea Hyrule para continuar sin reiniciar.'),{status:423});
 const body=await response.text();let data:any;
 try{data=JSON.parse(body)}catch{throw Error(`${label}: respuesta ${response.status} sin JSON válido. Reintentando en la siguiente lectura.`)}
 if(!response.ok)throw Object.assign(Error(`${label}: ${typeof data?.error==='string'?data.error:`HTTP ${response.status}`}`),{status:response.status});
 if(!data||typeof data!=='object')throw Error(`${label}: respuesta incompleta`);return data;
}
export async function v2Http(path:string,init:RequestInit={},label='V2'){
 const url=new URL(path,window.location.origin).href,requestHeaders=new Headers(init.headers);requestHeaders.set('Accept','application/json');if(typeof init.body==='string'&&!requestHeaders.has('Content-Type'))requestHeaders.set('Content-Type','application/json');
 try{return await v2ReadJson(await boundedV2Fetch(url,{...init,headers:requestHeaders,cache:'no-store',credentials:'same-origin'}),label)}catch(error){
  if((error as any)?.status)throw error;
  // Some iOS embedded browsers reject fetch/response decoding with a generic SyntaxError.
  // Retrying a V2 mutation is guarded by the server's revision comparison.
  return await new Promise<any>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open(init.method||'GET',url,true);xhr.withCredentials=true;xhr.timeout=25000;requestHeaders.forEach((value,key)=>xhr.setRequestHeader(key,value));xhr.onload=()=>{void v2ReadJson(new Response(xhr.responseText,{status:xhr.status||502}),label).then(resolve,reject)};xhr.onerror=()=>reject(Error(`${label}: no se pudo conectar desde el navegador. Se reintentará automáticamente.`));xhr.ontimeout=()=>reject(Error(`${label}: la conexión agotó el tiempo de espera.`));xhr.send(typeof init.body==='string'?init.body:null)});
 }
}

async function boundedV2Fetch(url:string,init:RequestInit):Promise<Response>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Tiempo de espera agotado; el ciclo volverá a intentar.'))},20000)});
 try{return await Promise.race([fetch(url,{...init,signal:controller.signal}),deadline])}finally{clearTimeout(timer!)}
}
