const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const core=require('../src/core.cjs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/ui.js'),'utf8');
const code=source.slice(source.indexOf('async function run(target,download)'),source.indexOf('function capture(event)'));
async function run(download,managed=false,cancel=false,conflict=false,cancelDuringCleanup=false,cancelBeforeStart=false){
  const events=[],runtime={};
  const ctx={runtime,kernel:{runtime}};
  const sandbox={...core,crypto:require('node:crypto').webcrypto,jobs:new Map(),
    archiveSource:'archive',context:()=>ctx,
    setStatus:(job,label)=>events.push({status:label}),addMenuItems:()=>{},
    sleep:async()=>{if(cancel)sandbox.jobs.get('/content/folder').cancelled=true;},
    cleanup:async()=>{
      if(cancelDuringCleanup)sandbox.cancelJob('/content/folder');
      events.push({cleaned:true,cancelled:sandbox.jobs.get('/content/folder').cancelled});
    },
    finishStatus:(job,label,detail,error)=>{job.finished=true;events.push({label,detail,error});},
    request:async(ctx,url)=>({json:async()=>url.includes('status.json')
      ?{state:'ready',archive:'/content/folder.zip',size:42}
      :{type:'directory'}}),
    put:async()=>{
      if(cancelBeforeStart)sandbox.cancelJob('/content/folder');
    },openTerminal:async()=>({send(){events.push({started:true});},close:async()=>{events.push({terminalClosed:true});}}),
    downloadPermission:async()=>managed,
    downloadArchive:async job=>events.push(await job.downloadPermission?{managed:true}:{native:true}),
    document:{querySelector:()=>({currentTree:{refresh:async()=>{events.push({sidebarRefreshed:true});},files:{getFile:async()=>({
      download:async()=>events.push({native:true})})}}})}};
  vm.createContext(sandbox);vm.runInContext(code,sandbox);
  await sandbox.run({path:'/content/folder'},download);
  return events;
}
test('ZIP only leaves the archive without starting a download',async()=>{
  const events=await run(false);
  assert.equal(events.find(e=>e.label).label,'ZIP ready');
  assert.ok(!events.some(e=>e.native||e.managed));
});
test('normal ZIP and download calls Colab download once',async()=>{
  const events=await run(true);
  assert.equal(events.filter(e=>e.native).length,1);
  assert.equal(events.find(e=>e.label).label,'Download started');
});
test('managed ZIP and download calls only the tracked helper',async()=>{
  const events=await run(true,true);
  assert.equal(events.filter(e=>e.managed).length,1);
  assert.ok(!events.some(e=>e.native));
  assert.equal(events.find(e=>e.label).label,'Download started');
});
test('download starts before terminal cleanup or sidebar refresh',async()=>{
  const events=await run(true);
  const start=events.findIndex(e=>e.native);
  assert.ok(start>=0&&start<events.findIndex(e=>e.terminalClosed));
  assert.ok(start<events.findIndex(e=>e.sidebarRefreshed));
});
test('late ZIP cancellation retains the completed archive and cleans staging',async()=>{
  const events=await run(false,false,true);
  assert.ok(events.some(e=>e.cleaned));
  const result=events.find(e=>e.label);
  assert.equal(result.label,'ZIP cancelled');
  assert.match(result.detail,/ZIP remains at \/content\/folder.zip/);
  assert.equal(Boolean(result.error),false);
});
test('a stale Cancel click during cleanup preserves the completed ZIP status',async()=>{
  const events=await run(false,false,false,false,true);
  assert.equal(events.find(e=>e.label).label,'ZIP ready');
  assert.ok(!events.some(e=>e.status==='Cancelling…'||e.rollback));
  assert.equal(events.find(e=>e.cleaned).cancelled,false);
});
test('cancellation before the worker starts cleans created staging',async()=>{
  const events=await run(false,false,false,false,false,true);
  assert.ok(events.some(e=>e.label==='ZIP cancelled'));
  assert.ok(events.some(e=>e.cleaned));
  assert.ok(!events.some(e=>e.started||e.rollback));
});
