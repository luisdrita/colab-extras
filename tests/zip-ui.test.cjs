const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const completion=fs.readFileSync(require('node:path').join(__dirname,'../src/completion.js'),'utf8');
const core=require('../src/core.cjs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/ui.js'),'utf8');
const polling=fs.readFileSync(require('node:path').join(__dirname,'../src/archive-status.js'),'utf8');
const code=polling+'\n'+source.slice(source.indexOf('async function run(target,download,'),source.indexOf('function capture(event)'));
async function run(download,{managed=false,cancel=false,cancelDuringCleanup=false,cancelBeforeStart=false,group=false,readStatus}={}){
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
    finishStatus:(job,label,detail,error)=>{sandbox.jobs.delete(job.path);job.finished=true;events.push({label,detail,error});},
    request:async(ctx,url)=>{
      if(!url.includes('status.json'))return {json:async()=>({type:'directory'})};
      events.push({read:url.split('?')[0]});
      if(readStatus)return readStatus(ctx);
      return {json:async()=>({state:'ready',archive:'/content/folder.zip',size:42})};
    },
    put:async(ctx,path)=>{
      events.push({put:path});
      if(cancelBeforeStart)sandbox.cancelJob('/content/folder');
    },openTerminal:async()=>({send(){events.push({started:true});},close:async()=>{events.push({terminalClosed:true});}}),
    downloadPermission:async()=>managed,
    downloadArchive:async job=>events.push(await job.downloadPermission?{managed:true}:{native:true}),
    document:{querySelector:q=>q!=='colab-file-browser'?null:({currentTree:{refresh:async()=>{events.push({sidebarRefreshed:true});},files:{getFile:async()=>({
      download:async()=>events.push({native:true})})}}})}};
  vm.createContext(sandbox);vm.runInContext(completion+'\n'+code,sandbox);
  const items=[{path:'/content/folder',isDirectory:true},{path:'/content/notes.txt',isDirectory:false}];
  await sandbox.run(items[0],download,group?{runtime,items:new Map(items.map(i=>[i.path,i]))}:null);
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
  const events=await run(true,{managed:true});
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
  const events=await run(false,{cancel:true});
  assert.ok(events.some(e=>e.cleaned));
  const result=events.find(e=>e.label);
  assert.equal(result.label,'ZIP cancelled');
  assert.match(result.detail,/ZIP remains at \/content\/folder.zip/);
  assert.equal(Boolean(result.error),false);
});
test('a stale Cancel click during cleanup preserves the completed ZIP status',async()=>{
  const events=await run(false,{cancelDuringCleanup:true});
  assert.equal(events.find(e=>e.label).label,'ZIP ready');
  assert.ok(!events.some(e=>e.status==='Cancelling…'||e.rollback));
  assert.equal(events.find(e=>e.cleaned).cancelled,false);
});
test('cancellation before the worker starts cleans created staging',async()=>{
  const events=await run(false,{cancelBeforeStart:true});
  assert.ok(events.some(e=>e.label==='ZIP cancelled'));
  assert.ok(events.some(e=>e.cleaned));
  assert.ok(!events.some(e=>e.started||e.rollback));
});

test('selected ZIP refuses a stale selection or an unexpected archive path',async()=>{
  for(const stale of [true,false]){
    const runtime={},ctx={runtime,kernel:{runtime}},events=[];
    const items=['/content/a','/content/b'].map(path=>({path,isDirectory:false}));
    const selection={runtime:stale?{}:runtime,items:new Map(items.map(item=>[item.path,item]))};
    const sandbox={...core,archiveSource:'worker',context:()=>ctx,jobs:new Map(),crypto:require('node:crypto').webcrypto,
      setStatus:(job,label,detail)=>events.push(detail),finishStatus:(job,label,detail)=>{sandbox.jobs.delete(job.path);events.push(detail)},
      addMenuItems:()=>{},downloadPermission:async()=>false,sleep:async()=>{},put:async()=>{},cleanup:async()=>{},
      openTerminal:async()=>({send:()=>events.push('started'),close:async()=>{}}),document:{querySelector:()=>null},
      request:async()=>({json:async()=>({state:'ready',archive:'/content/unrelated.zip',size:10})}),
      downloadArchive:async()=>events.push('downloaded')};
    vm.createContext(sandbox);vm.runInContext(completion+'\n'+code,sandbox);
    await sandbox.run({path:items[0].path},true,selection);
    assert.equal(events.includes('started'),!stale);
    assert.equal(events.includes('downloaded'),false);
    assert.match(events.at(-1),stale?/runtime changed/:/Unexpected archive result/);
    assert.equal(sandbox.jobs.size,0);
    assert.equal(selection.items.size,2);
  }
});

test('folder and selected ZIPs recover missed completion reads and download exactly once',async()=>{
  for(const group of [false,true]){
    let reads=0;
    const events=await run(true,{group,readStatus:async()=>{
      if(++reads===1)throw new DOMException('signal timed out','TimeoutError');
      if(reads===2)return {json:async()=>{throw new TypeError('Interrupted response body');}};
      return {json:async()=>({state:'ready',archive:group?'/content/selected-files (1).zip':'/content/folder.zip',size:42})};
    }});
    assert.equal(reads,3);
    assert.equal(new Set(events.filter(e=>e.read).map(e=>e.read)).size,1);
    assert.equal(events.filter(e=>e.started).length,1);
    assert.equal(events.filter(e=>e.native).length,1);
    assert.equal(events.find(e=>e.label).label,'Download started');
    assert.ok(events.some(e=>e.cleaned));
  }
});
test('persistent status loss is unknown even if cancellation was requested',async()=>{
  const events=await run(true,{group:true,cancel:true,readStatus:async()=>{throw Error('signal timed out');}});
  assert.equal(events.filter(e=>e.read).length,3);
  assert.equal(events.filter(e=>e.put?.endsWith('/cancel')).length,1);
  assert.equal(events.find(e=>e.label).label,'ZIP status unknown');
  assert.ok(events.find(e=>e.label).error);
  assert.ok(!events.some(e=>e.native||e.cleaned));
});
test('a ready response from a replaced runtime cannot start a download',async()=>{
  const events=await run(true,{group:true,readStatus:async ctx=>({json:async()=>{
    ctx.kernel.runtime={};
    return {state:'ready',archive:'/content/selected-files.zip',size:42};
  }})});
  assert.equal(events.filter(e=>e.read).length,1);
  assert.equal(events.find(e=>e.label).label,'ZIP status unknown');
  assert.ok(!events.some(e=>e.native||e.cleaned));
});
