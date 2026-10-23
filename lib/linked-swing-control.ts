import type {SwingSourceRound} from './swing-normal-source';
/** One explicit authorization state for both discovery and real copying. */
export function linkedSwingState(enabled:boolean){return {normalSearching:enabled,realCopying:enabled}}
/** Pause only unfilled virtual reservations; open trades and all history remain intact. */
export function pauseSwingSource(round:SwingSourceRound,reason:string){
 round.running=false;
 for(const trade of round.trades)if(trade.status==='pending'){trade.status='skipped';trade.reason=reason;}
 return round;
}
