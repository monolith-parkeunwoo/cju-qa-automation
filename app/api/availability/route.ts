import { availabilityQuerySchema, kstDate } from "../../../packages/contracts/availability";
import { member,sameOrigin,body,json,db,readiness } from "../../../lib/server";
export async function POST(r:Request) {
 if(!await member() || !sameOrigin(r)) return json({error:"FORBIDDEN"},403);
 let input;
 try {input=availabilityQuerySchema.parse(await body(r));}catch{return json({error:"INVALID_INPUT"},400);}
 const now=Date.now();
 if(input.date<kstDate()) return json({error:"PAST_DATE"},400);
 const {connected,profile}=await readiness();
 if(!connected || !profile?.ready) return json({error:"RUNNER_UNAVAILABLE"},409);
 const key=`${input.date}:${input.quantity}`;
 // Only read-only stock queries can be requeued after a lost runner response.
 await db().prepare("INSERT INTO availability(key,date,quantity,state,updated) VALUES(?,?,?,'WAITING',?) ON CONFLICT(key) DO UPDATE SET state='WAITING',token=NULL,snapshot=NULL,updated=excluded.updated WHERE (availability.state='SUCCESS' AND availability.updated<?) OR (availability.state IN ('WAITING','RUNNING','FAILURE') AND availability.updated<?)")
 .bind(key,input.date,input.quantity,now,now-60000,now-30000).run();
 const row=await db().prepare("SELECT state,snapshot FROM availability WHERE key=?").bind(key).first<{state:string;snapshot:string|null}>();
 return json({state:row?.state,snapshot:row?.snapshot?JSON.parse(row.snapshot):null});
}
