import type {RealEntryEvidence} from './real-journal';
export function nextHistoryEntry(entries:RealEntryEvidence[],positions:{symbol:string;side:string}[],accountFresh:boolean,attempts:Record<string,number>){
 const pending=entries.filter(e=>!['verified','excluded','ambiguous'].includes(e.outcome?.status||''))
  .filter(e=>!(e.outcome?.status==='open'&&accountFresh&&positions.some(p=>p.symbol===e.symbol&&p.side===e.side)));
 return pending.sort((a,b)=>(a.entryMotor==='swing-inverse'?0:1)-(b.entryMotor==='swing-inverse'?0:1)||(attempts[a.id]||0)-(attempts[b.id]||0))[0];
}
