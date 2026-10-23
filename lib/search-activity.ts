export type SearchPhase='idle'|'limits'|'reading'|'evaluating'|'copying'|'waiting'|'error';
export type SearchRead={symbol:string;state:'reading'|'ok'|'error';reason?:string};
export type SearchActivity={phase:SearchPhase;lastActivityAt:number;lastSuccessAt?:number;startedAt?:number;cycle:number;completed:number;total:number;reads:SearchRead[];radarCursor:number;radarTotal:number;nextAttemptAt?:number;lastError?:string;recoveredAt?:number;gapMs?:number};
export function initialSearchActivity():SearchActivity{return {phase:'idle',lastActivityAt:0,cycle:0,completed:0,total:0,reads:[],radarCursor:0,radarTotal:0}}
export const searchInterrupted=(lastBeat:number,now:number)=>lastBeat>0&&now-lastBeat>15000;
export function searchActivityLabel(a:SearchActivity,active:boolean,ready:boolean,online:boolean,visible:boolean,now:number){
 if(!active)return {tone:'muted',title:'Búsqueda apagada',detail:'Activa la simulación normal o la copia inversa para comenzar.'};
 if(!ready)return {tone:'warn',title:'Esperando conexión Binance',detail:'La búsqueda necesita una lectura de cuenta confirmada.'};
 if(!online)return {tone:'warn',title:'Sin conexión · esperando red',detail:'Se reintentará al recuperar la conexión. No se repiten entradas antiguas.'};
 if(!visible)return {tone:'warn',title:'Pestaña en segundo plano',detail:'El navegador puede suspenderla. Vuelve a esta página para mantener la búsqueda.'};
 if(a.phase==='error'&&a.nextAttemptAt&&a.nextAttemptAt>now)return {tone:'warn',title:'Lectura en espera · reintento programado',detail:`${a.lastError||'Esperando a Binance.'} Próximo intento en ${Math.ceil((a.nextAttemptAt-now)/1000)} s.`};
 if(a.lastActivityAt&&now-a.lastActivityAt>45000)return {tone:'warn',title:'Esperando respuesta del motor',detail:`Sin avance confirmado desde hace ${Math.floor((now-a.lastActivityAt)/1000)} s. No se enviará otra orden si hay una solicitud pendiente.`};
 const messages:Record<SearchPhase,[string,string]>={
  idle:['Iniciando búsqueda','Preparando la primera lectura de mercado.'],
  limits:['Comprobando contratos','Leyendo límites y apalancamiento confirmado de Binance.'],
  reading:['Buscando entradas',`Leyendo ${a.completed}/${a.total} monedas de este lote.`],
  evaluating:['Evaluando Swing normal','Aplicando los mismos filtros de 1h, 4h y diario del simulador.'],
  copying:['Preparando copia inversa real','Comprobando cuenta, cantidad, SL/TP y ausencia de posiciones u órdenes en la moneda.'],
  waiting:['Búsqueda activa',a.nextAttemptAt&&a.nextAttemptAt>now?`Próxima lectura en ${Math.ceil((a.nextAttemptAt-now)/1000)} s.`:'Preparando la siguiente lectura.'],
  error:['Lectura pendiente · reintentando',a.lastError||'Binance no confirmó los datos. Se volverá a intentar.'],
 };
 const [title,detail]=messages[a.phase];return {tone:a.phase==='error'?'warn':'active',title,detail};
}
