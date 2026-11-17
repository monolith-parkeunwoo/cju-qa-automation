import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base='http://127.0.0.1:5173',id='e63ee084-de82-44ef-938d-ce8e1c79d09b';
let Cookie='';
async function req(path,body,extra={}){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie,Origin:base,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});}
assert.equal((await req(`/api/runs/${id}/race`,{})).status,403);
const login=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});Cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
const before=await(await req('/api/runs')).json();const run=before.runs.find(r=>r.id===id);const state=JSON.parse(run.raceState);
assert.equal(run.raceStatus,'BLOCKED');assert.equal(run.raceReason,'TICKET.10104');assert.deepEqual(state.completed,[]);assert.equal(state.workflowId,undefined);
const body={key:state.requestKey,step:0,input:state.input};
assert.equal((await req(`/api/runs/${id}/race`,body,{Origin:'https://untrusted.invalid'})).status,403);
const repeated=await req(`/api/runs/${id}/race`,body);assert.equal(repeated.status,200);assert.equal((await repeated.json()).status,'BLOCKED');
assert.equal((await req(`/api/runs/${id}/race`,{...body,key:crypto.randomUUID(),step:1})).status,409);
assert.equal((await req(`/api/runs/${id}/race`,{...body,key:crypto.randomUUID(),input:{...state.input,wearableId:'1'}})).status,409);
const token=(await readFile(new URL('../.dev.vars',import.meta.url),'utf8')).match(/^QA_RUNNER_TOKEN=(.+)$/m)[1];
assert.equal((await req('/api/runner',{action:'raceReport',id,token:crypto.randomUUID(),report:{status:'RUNNING',step:0,state}},{'x-qa-runner-token':token})).status,409);
const after=await(await req('/api/runs')).json();assert.deepEqual(after.runs.find(r=>r.id===id),run);assert.ok(!JSON.stringify(after).includes(token));
console.log('PASS: real time block persisted; authorization, CSRF, idempotency, step order, ticket ownership and stale report checks; no race mutations sent');
