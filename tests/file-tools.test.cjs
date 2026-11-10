const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/file-tools.js'),'utf8');
function setup(saved='{}'){
  const stored=[],calls=[];
  const sandbox={jobs:new Map(),localStorage:{getItem:()=>saved,setItem:(k,v)=>stored.push([k,JSON.parse(v)])},
    window:{addEventListener:()=>{}},location:{origin:'https://colab.research.google.com'}};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  return {sandbox,stored,calls};
}
test('existing operation preferences survive without recording changes',()=>{
  const {sandbox,stored}=setup('{"overwrite":true,"managedDownloads":true,"ignored":123}');
  assert.equal(sandbox.preferencesRequest({action:'get'}).overwrite,true);
  const result=sandbox.preferencesRequest({action:'set',key:'overwrite',value:false});
  assert.equal(result.overwrite,false);assert.equal(result.managedDownloads,undefined);
  assert.deepEqual(stored[0][1],{overwrite:false});
  assert.throws(()=>sandbox.preferencesRequest({action:'set',key:'unknown',value:true}));
  sandbox.jobs.set('active',{});
  assert.throws(()=>sandbox.preferencesRequest({action:'set',key:'overwrite',value:true}),/active operation/);
});
test('malformed saved preferences use defaults',()=>{
  for(const saved of ['null','broken','{"overwrite":"false"}']){
    assert.equal(setup(saved).sandbox.preferencesRequest({action:'get'}).overwrite,false);
  }
});
test('managed downloads use the job id without a recovery result',async()=>{
  const {sandbox}=setup();const calls=[];
  Object.assign(sandbox,{bridgeDownload:async args=>{calls.push(args);return {granted:true,id:42};},
    request:async()=>({blob:async()=>({})}),encodePath:p=>p.slice(1),
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},setTimeout:()=>{}});
  const job={id:'job-uuid',ctx:{},result:{archive:'/content/results.zip'}};
  await sandbox.managedDownload(job);
  assert.equal(calls[0].operation,job.id);assert.equal(job.downloadId,42);
});
function automaticDownload({permission=false,saved='{}',managedError=null,cancelled=false}={}){
  const {sandbox}=setup(saved),events=[],runtime={};
  const job={id:'job-uuid',ctx:{runtime,kernel:{runtime}},cancelled,result:{archive:'/content/results.zip'}};
  Object.assign(sandbox,{
    bridgeDownload:async(args,timeout)=>{
      events.push({permission:true,timeout});
      if(permission instanceof Error)throw permission;
      return {granted:permission};
    },
    assertRuntime:require('../src/core.cjs').assertRuntime,
    setStatus:(job,label)=>events.push({status:label}),
    managedDownload:async()=>{events.push({managed:true});if(managedError)throw managedError;},
    document:{querySelector:()=>({currentTree:{files:{getFile:async archive=>{
      events.push({archive});return {download:async progress=>{events.push({native:true});progress.update(1);}};
    }}}})}
  });
  return {sandbox,events,job};
}
test('ZIP download works without permission, irrespective of the previous tracking setting',async()=>{
  for(const previous of [undefined,false,true]){
    const {sandbox,events,job}=automaticDownload({saved:JSON.stringify({managedDownloads:previous})});
    await sandbox.downloadArchive(job);
    assert.equal(events.filter(e=>e.native).length,1);
    assert.equal(events.filter(e=>e.managed).length,0);
    assert.equal(events.find(e=>e.archive).archive,job.result.archive);
  }
});
test('an unavailable optional helper falls back to Colab download',async()=>{
  const {sandbox,events,job}=automaticDownload({permission:new Error('helper unavailable')});
  await sandbox.downloadArchive(job);
  assert.equal(events.filter(e=>e.native).length,1);
  assert.equal(events.find(e=>e.permission).timeout,1000);
});
test('permission already granted enables tracked downloads without a settings toggle',async()=>{
  const {sandbox,events,job}=automaticDownload({permission:true,saved:'{"managedDownloads":false}'});
  job.downloadPermission=sandbox.downloadPermission();
  await sandbox.downloadArchive(job);
  assert.equal(events.filter(e=>e.permission).length,1);
  assert.equal(events.filter(e=>e.managed).length,1);
  assert.equal(events.filter(e=>e.native).length,0);
});
test('an uncertain managed download response cannot create a duplicate native download',async()=>{
  const {sandbox,events,job}=automaticDownload({permission:true,managedError:new Error('response lost')});
  await assert.rejects(()=>sandbox.downloadArchive(job),/response lost/);
  assert.equal(events.filter(e=>e.managed).length,1);
  assert.equal(events.filter(e=>e.native).length,0);
});
test('cancelled ZIP download does not dispatch either download route',async()=>{
  const {sandbox,events,job}=automaticDownload({cancelled:true});
  await assert.rejects(()=>sandbox.downloadArchive(job),/Cancelled/);
  assert.equal(events.filter(e=>e.managed||e.native).length,0);
});
test('a missing helper times out quickly without preventing ordinary downloads',async()=>{
  const {sandbox}=setup();let timeout;
  Object.assign(sandbox,{
    crypto:require('node:crypto').webcrypto,
    setTimeout:(fn,ms)=>{timeout=ms;queueMicrotask(fn);return 1;},clearTimeout:()=>{},
    window:{addEventListener:()=>{},removeEventListener:()=>{},postMessage:()=>{}}
  });
  assert.equal(await sandbox.downloadPermission(),false);
  assert.equal(timeout,1000);
});
test('starting the generated bundle leaves native file APIs untouched and starts no history work',()=>{
  const callbacks=[],fetch=()=>{},write=()=>{};
  const files={write},xhr={fetch},kernel={runtime:{},getKernelXhr:()=>xhr};
  const sandbox={window:{colab:{global:{notebook:{getKernel:()=>kernel}}},addEventListener:()=>{}},
    document:{querySelector:q=>q==='colab-file-browser'?{currentTree:{files}}:null,
      querySelectorAll:()=>[],
      createElement:()=>({}),head:{append:()=>{}},body:{},addEventListener:()=>{}},
    MutationObserver:class{constructor(fn){callbacks.push(fn);}observe(){}},
    localStorage:{getItem:()=>null},setInterval:()=>{throw Error('Unexpected background polling');}};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/colab-zip.js'),'utf8'),sandbox);
  assert.equal(files.write,write);assert.equal(xhr.fetch,fetch);
  assert.equal(callbacks.length,1); // Menus, progress and selection; no history.
});
