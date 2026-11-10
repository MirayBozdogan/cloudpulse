const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, {hidden:true,textContent:'',innerHTML:'',disabled:false,handlers:{},addEventListener(e,fn){this.handlers[e]=fn;},classList:{add(){},remove(){}}}); return elements.get(id); };
  let fetcher;
  const context=vm.createContext({document:{querySelector:element,addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},URL,Date,Math,Number,JSON,String,AbortSignal,AbortController,setTimeout:()=>0,clearTimeout(){},fetch:(...args)=>fetcher(...args)});
  vm.runInContext(fs.readFileSync('app.js','utf8'),context);
  return {element,context,setFetch(fn){fetcher=fn;}};
}
const measurement={url:'https://d61mkgexvp9pd.cloudfront.net/',status:'Operational',statusCode:200,responseTimeMs:42,checkedAt:'2026-11-10T12:00:00Z'};
test('preserves measured status when history write fails',async()=>{
 const app=setup();app.setFetch(async()=>({ok:false,status:503,json:async()=>({...measurement,historySaved:false})}));
 await app.element('#refresh-button').handlers.click();
 assert.match(app.element('#monitor-rows').innerHTML,/Operational/);
 assert.match(app.element('#monitor-rows').innerHTML,/history was not saved/);
 assert.equal(app.element('#refresh-button').disabled,false);
});
test('distinguishes invalid address from network failure',async()=>{
 const app=setup();app.setFetch(async()=>({ok:false,status:400,json:async()=>({error:'Invalid public URL'})}));
 await app.element('#refresh-button').handlers.click();assert.match(app.element('#monitor-rows').innerHTML,/Invalid address/);
 app.setFetch(async()=>{throw new Error('offline');});await app.element('#refresh-button').handlers.click();
 assert.match(app.element('#monitor-rows').innerHTML,/Check failed/);assert.match(app.element('#monitor-rows').innerHTML,/check your connection/i);
});
test('history has empty and retryable error states',async()=>{
 const app=setup();app.setFetch(async()=>({ok:true,json:async()=>({items:[]})}));
 await vm.runInContext('loadHistory(cloudpulseMonitor)',app.context);
 assert.match(app.element('#history-message').textContent,/No saved checks/);
 app.setFetch(async()=>({ok:false}));await app.element('#history-retry').handlers.click();
 // The click starts an async load; wait for its microtasks.
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(app.element('#history-message').textContent,/could not be loaded/);
 assert.equal(app.element('#history-retry').disabled,false);
});
test('late history response cannot overwrite a newer selected site',async()=>{
 const app=setup();let firstResolve;
 app.setFetch(()=>new Promise(resolve=>{firstResolve=resolve;}));
 const first=vm.runInContext('loadHistory(cloudpulseMonitor)',app.context);
 app.setFetch(async()=>({ok:true,json:async()=>({items:[{...measurement,status:'Second site'}]})}));
 await vm.runInContext("loadHistory({url:'https://example.com/'})",app.context);
 firstResolve({ok:true,json:async()=>({items:[{...measurement,status:'Stale result'}]})});await first;
 assert.match(app.element('#history-rows').innerHTML,/Second site/);assert.doesNotMatch(app.element('#history-rows').innerHTML,/Stale result/);
});
