import { z } from "zod";
import { inputSchema } from "./index.ts";
import type { ReservationInput } from "./index.ts";
export const availabilityQuerySchema = inputSchema.pick({date:true,quantity:true});
export const slotSchema=z.object({time:inputSchema.shape.time,enabled:z.boolean()}).strict();
export const availabilitySnapshotSchema=availabilityQuerySchema.extend({
 productId:z.literal("116"),price:z.number().positive(),checkedAt:z.number().int().positive(),
 slots:z.array(slotSchema).max(200),
}).strict().refine(s=>new Set(s.slots.map(v=>v.time)).size===s.slots.length);
export type AvailabilitySnapshot=z.infer<typeof availabilitySnapshotSchema>;
export type AvailabilityQuery=z.infer<typeof availabilityQuerySchema>;
export type AvailabilityJob=AvailabilityQuery & {key:string;token:string};
export function kstDate(now=new Date()) {return now.toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});}
export function normalizeSlots(value:unknown) {
 const rows=z.array(z.object({timeSlot:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/),enabled:z.boolean()})).max(200).parse(value);
 const slots=rows.map(s=>({time:s.timeSlot.slice(0,5),enabled:s.enabled})).sort((a,b)=>a.time.localeCompare(b.time));
 if(new Set(slots.map(s=>s.time)).size!==slots.length) throw Error("Duplicate slots");
 return slots;
}
export function canReserveSlot(snapshot:AvailabilitySnapshot,input:ReservationInput,price:number,now=Date.now()) {
 return snapshot.productId==="116" && snapshot.date===input.date && snapshot.quantity===input.quantity && snapshot.price===price && now>=snapshot.checkedAt && now-snapshot.checkedAt<=60000 && snapshot.slots.some(s=>s.time===input.time&&s.enabled);
}
