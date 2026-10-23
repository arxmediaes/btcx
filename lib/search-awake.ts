export type AwakeStatus='off'|'requesting'|'active'|'hidden'|'unsupported'|'denied'|'released';
export type ScreenLease={released:boolean;release:()=>Promise<void>;addEventListener:(type:'release',listener:()=>void)=>void};
/** Keeps only a screen wake lock, with no trading, credentials or background-execution claims. */
export function createSearchAwake(input:{request?:()=>Promise<ScreenLease>;visible:()=>boolean;status:(state:AwakeStatus)=>void}){
 let enabled=false,disposed=false,lease:ScreenLease|undefined,pending:Promise<void>|undefined,generation=0;
 const acquire=async()=>{
  if(disposed||!enabled)return;
  if(!input.visible()){const old=lease;lease=undefined;if(old)try{await old.release()}catch{}input.status('hidden');return;}
  if(!input.request){input.status('unsupported');return;}
  if(lease&&!lease.released){input.status('active');return;}
  if(pending)return pending;
  const epoch=generation;input.status('requesting');
  const task=(async()=>{try{
   const granted=await input.request!();
   if(disposed||!enabled||epoch!==generation||!input.visible()){await granted.release();return;}
   lease=granted;input.status(granted.released?'released':'active');
   granted.addEventListener('release',()=>{if(lease===granted)lease=undefined;if(!disposed&&enabled)input.status(input.visible()?'released':'hidden')});
  }catch{if(!disposed&&enabled&&epoch===generation)input.status(input.visible()?'denied':'hidden');}})();
  pending=task;try{await task}finally{if(pending===task)pending=undefined;}
 };
 return {
  async setEnabled(next:boolean){enabled=next;generation++;if(!next){const old=lease;lease=undefined;if(old)try{await old.release()}catch{}if(!disposed)input.status('off');return;}await acquire();},
  refresh:acquire,
  async dispose(){disposed=true;enabled=false;generation++;const old=lease;lease=undefined;if(old)try{await old.release()}catch{}},
 };
}
