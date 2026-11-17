import test from "node:test";
import assert from "node:assert/strict";
import { availabilityQuerySchema, normalizeSlots, canReserveSlot, kstDate } from "../packages/contracts/availability.ts";
const query={date:"2026-10-13",quantity:1};
const now=Date.parse("2026-10-13T05:00:00Z");
const snapshot={...query,productId:"116" as const,price:123500,checkedAt:now,slots:[{time:"19:00",enabled:true},{time:"14:20",enabled:false}]};
test("availability preserves API eligibility, sorts and normalizes times",()=>{
 assert.deepEqual(normalizeSlots([{timeSlot:"19:20:00",enabled:true},{timeSlot:"14:20",enabled:false},{timeSlot:"19:00",enabled:true}]),[{time:"14:20",enabled:false},{time:"19:00",enabled:true},{time:"19:20",enabled:true}]);
 assert.throws(()=>normalizeSlots([{timeSlot:"25:00",enabled:true}]));
 assert.throws(()=>normalizeSlots([{timeSlot:"19:00",enabled:true},{timeSlot:"19:00:00",enabled:false}]));
});
test("booking requires fresh availability matching date, quantity, product and price",()=>{
 const input={...query,time:"19:00"};
 assert.equal(canReserveSlot(snapshot,input,123500,now),true);
 for(const value of [{...input,date:"2026-10-14"},{...input,quantity:2},{...input,time:"14:20"}]) assert.equal(canReserveSlot(snapshot,value,123500,now),false);
 assert.equal(canReserveSlot(snapshot,input,100,now),false);
 assert.equal(canReserveSlot(snapshot,input,123500,now+60001),false);
 assert.equal(canReserveSlot({...snapshot,checkedAt:now+1},input,123500,now),false);
});
test("Korean date and invalid date or quantity are handled",()=>{
 assert.equal(kstDate(new Date("2026-10-13T15:01:00Z")),"2026-10-14");
 assert.equal(availabilityQuerySchema.safeParse({...query,date:"2026-02-30"}).success,false);
 assert.equal(availabilityQuerySchema.safeParse({...query,quantity:0}).success,false);
});
