import {profileFromRequest,profileOwnerKey} from '../../../lib/binance-profile';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getDb } from '../../../db';
import { workspaces } from '../../../db/schema';
import { eq, and } from 'drizzle-orm';
export async function GET(req:Request) {
 const user=await getChatGPTUser(); if(!user) return Response.json({error:'Inicia sesión para guardar.'},{status:401});
 let ownerKey:string;try{ownerKey=profileOwnerKey(user.userId,profileFromRequest(req))}catch(error){if(error instanceof Response)return error;throw error}
 const [row]=await getDb().select().from(workspaces).where(eq(workspaces.userId,ownerKey));
 return Response.json({state:row?JSON.parse(row.payload):null,revision:row?.revision??0},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request) {
 const user=await getChatGPTUser(); if(!user) return Response.json({error:'Sin sesión'},{status:401});
 let ownerKey:string;try{ownerKey=profileOwnerKey(user.userId,profileFromRequest(req))}catch(error){if(error instanceof Response)return error;throw error}
 const raw=await req.text(); if(raw.length>1500000) return Response.json({error:'Exporta tu historial antes de continuar.'},{status:413});
 let b:any;try{b=JSON.parse(raw)}catch{return Response.json({error:'Datos inválidos'},{status:400})}
 if(!b.state||!Array.isArray(b.state.trades)||!Array.isArray(b.state.experiments)||!Number.isInteger(b.revision)) return Response.json({error:'Formato inválido'},{status:400});
 const db=getDb();await db.insert(workspaces).values({userId:ownerKey,payload:'null',revision:0,updatedAt:Date.now()}).onConflictDoNothing();
 const rows=await db.update(workspaces).set({payload:JSON.stringify(b.state),revision:b.revision+1,updatedAt:Date.now()}).where(and(eq(workspaces.userId,ownerKey),eq(workspaces.revision,b.revision))).returning({revision:workspaces.revision});
 if(!rows.length)return Response.json({error:'Otra pestaña actualizó esta cuenta. Recarga para continuar.'},{status:409});
 return Response.json(rows[0]);
}
