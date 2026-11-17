import { db, json } from "./server";
import type { AvailabilitySnapshot } from "../packages/contracts/availability";
export async function claimAvailability() {
 const token=crypto.randomUUID(),now=Date.now();
 const row=await db().prepare("UPDATE availability SET state='RUNNING',token=?,updated=? WHERE key=(SELECT key FROM availability WHERE state='WAITING' ORDER BY updated LIMIT 1) AND state='WAITING' RETURNING key,date,quantity").bind(token,now).first<{key:string;date:string;quantity:number}>();
 return row?{...row,token}:null;
}
export async function reportAvailability(key:string,token:string,snapshot:AvailabilitySnapshot|null) {
 const now=Date.now();
 const result=await db().prepare("UPDATE availability SET state=?,snapshot=?,updated=? WHERE key=? AND token=? AND state='RUNNING' AND (? IS NULL OR (date=? AND quantity=?))")
 .bind(snapshot?"SUCCESS":"FAILURE",snapshot?JSON.stringify({...snapshot,checkedAt:now}):null,now,key,token,snapshot?1:null,snapshot?.date??null,snapshot?.quantity??null).run();
 return json({accepted:result.meta.changes===1},result.meta.changes===1?200:409);
}
