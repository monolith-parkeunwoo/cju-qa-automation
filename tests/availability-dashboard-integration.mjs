import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const base='http://127.0.0.1:5173';let Cookie='';
async function request(path,body,extra={}){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie,Origin:base,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});}
assert.equal((await request('/api/availability',{date:'2026-10-13',quantity:1})).status,403);
const login=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});Cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
const before=await(await request('/api/runs')).json();
const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
assert.equal((await request('/api/availability',{date,quantity:1},{Origin:'https://untrusted.invalid'})).status,403);
assert.equal((await request('/api/availability',{date,quantity:0})).status,400);
assert.equal((await request('/api/availability',{date:'2026-02-30',quantity:1})).status,400);
assert.equal((await request('/api/availability',{date:'2000-01-01',quantity:1})).status,400);
async function slots(input){
 for(let i=0;i<25;i++){
  const response=await request('/api/availability',input);assert.equal(response.status,200);
  const data=await response.json();
  if(data.state==='SUCCESS'){assert.equal(data.snapshot.date,input.date);assert.equal(data.snapshot.quantity,input.quantity);assert.equal(data.snapshot.productId,'116');assert.ok(Date.now()-data.snapshot.checkedAt<60000);return data.snapshot;}
  assert.notEqual(data.state,'FAILURE');await delay(2000);
 }throw Error('availability runner timed out');
}
const today=await slots({date,quantity:1});
const two=await slots({date,quantity:2});
const next=new Date(date+'T12:00:00+09:00');next.setUTCDate(next.getUTCDate()+1);
const tomorrow=await slots({date:next.toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),quantity:1});
const blocked=today.slots.find(s=>!s.enabled);
if(blocked){assert.equal((await request('/api/runs',{key:crypto.randomUUID(),profileVersion:before.profile.version,input:{date,time:blocked.time,quantity:1}})).status,409);}
assert.equal((await request('/api/runs',{key:crypto.randomUUID(),profileVersion:before.profile.version,input:{date:'2000-01-01',time:'19:00',quantity:1}})).status,409);
assert.equal((await request('/api/runner',{action:'availabilityReport',key:date+':1',token:crypto.randomUUID(),snapshot:today})).status,403);
const after=await(await request('/api/runs')).json();assert.deepEqual(after.runs,before.runs);
console.log(JSON.stringify({result:'PASS',today:today.slots.filter(s=>s.enabled),quantityTwo:two.slots.filter(s=>s.enabled),tomorrow:tomorrow.slots.filter(s=>s.enabled),checks:'date/quantity-specific live reads; member and origin auth; invalid dates; disabled slot rejection; no reservations created'}));
