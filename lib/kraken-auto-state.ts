export function krakenAuthFailure(message:string){
 return /authenticationError|invalid.?api.?key|invalid.?auth|permission.?denied|sesión.*renovarse|Inicia sesión/i.test(message);
}
/** Analysis cannot send orders. Execution may continue only on an explicit pre-send rejection. */
export function keepKrakenAuto(phase:'analysis'|'execution',error:unknown){
 const message=error instanceof Error?error.message:String(error);
 if(krakenAuthFailure(message))return false;
 return phase==='analysis'||(error as {retryable?:boolean})?.retryable===true;
}
