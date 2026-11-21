const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const completion=fs.readFileSync(require('node:path').join(__dirname,'../src/completion.js'),'utf8');
const {webcrypto}=require('node:crypto');
const core=require('../src/core.cjs');
const code=['archive-status.js','extract.js'].map(file=>fs.readFileSync(require('node:path').join(__dirname,'../src',file),'utf8')).join('\n');
async function run(options={}){
  const path='/content/results/data.zip',events=[],jobs=new Map();
  const result={state:'extracted',path,destination:'/content/results/data',files:2,folders:1,done:12,total:12};
  const statuses=[...(options.statuses||[result])];
  const ctx={...core,crypto:webcrypto,jobs,extractSource:'bundled Python',fileOperationsSource:'file tools Python',preferences:{overwrite:false},
    setStatus:(job,label,detail,error,progress)=>events.push({type:'status',label,detail,error,progress}),
    finishStatus:(job,label,detail,error)=>{jobs.delete(job.path);events.push({type:'finish',label,detail,error});},
    addMenuItems:()=>{},context:()=>({runtime:'test',kernel:{runtime:'test'}}),
    request:async(ctx,url,method)=>{
      events.push({type:'request',url,method});
      if(url.includes('status.json')){
        if(options.readStatus)await options.readStatus();
        return {json:async()=>statuses.shift()};
      }
      return {json:async()=>({type:'file'})};
    },
    put:async(ctx,path,content)=>{
      events.push({type:'put',path,content});
      if(options.cancelTimeout&&path.endsWith('/cancel'))throw Error('signal timed out');
    },
    openTerminal:async()=>{
      if(options.blocked)throw new Error('Independent terminals are unavailable');
      return {send:command=>events.push({type:'send',command}),close:async()=>events.push({type:'close'})};
    },
    sleep:async()=>{if(options.cancel)jobs.get(path).cancelled=true;},
    cleanup:async()=>events.push({type:'cleanup'}),
    document:{querySelector:q=>q!=='colab-file-browser'?null:({currentTree:{refresh:async()=>events.push({type:'refresh'})}})}
  };
  vm.createContext(ctx);vm.runInContext(completion+'\n'+code,ctx);await ctx.runExtract({path});
  return {events,jobs,result};
}
test('extraction launches bundled script, refreshes files, and cleans its own job',async()=>{
  const {events,jobs}=await run();
  assert.equal(jobs.size,0);
  assert.match(events.find(e=>e.type==='send').command,/extract_archive.py.*\/content\/results\/data.zip/);
  assert.ok(events.some(e=>e.type==='put'&&e.content==='bundled Python'));
  assert.ok(events.some(e=>e.type==='refresh'));
  assert.ok(events.some(e=>e.type==='cleanup'));
  assert.match(events.find(e=>e.type==='finish').detail,/2 file\(s\).*Archive kept/);
  assert.equal(events.filter(e=>e.type==='close').length,1);
});
test('blocked terminals produce an error without starting a script',async()=>{
  const {events,jobs}=await run({blocked:true});
  assert.equal(jobs.size,0);assert.ok(!events.some(e=>e.type==='send'));
  assert.equal(events.find(e=>e.type==='finish').label,'Extraction failed');
});
test('partial extraction failures remain visible and refresh the sidebar',async()=>{
  const {events}=await run({statuses:[{state:'error',path:'/content/results/data.zip',destination:'/content/results/data',error:'CRC mismatch',partial:true}]});
  assert.match(events.find(e=>e.type==='finish').detail,/Some files could not be rolled back/);
  assert.ok(events.find(e=>e.type==='finish').error);
  assert.ok(events.some(e=>e.type==='refresh'));
  assert.ok(events.some(e=>e.type==='cleanup'));
});
test('cancellation requests use the job marker and wait for backend acknowledgement',async()=>{
  const {events}=await run({cancel:true,statuses:[{state:'cancelled',path:'/content/results/data.zip',destination:'/content/results/data',error:'Extraction cancelled',partial:false}]});
  assert.ok(events.some(e=>e.type==='put'&&e.path.endsWith('/cancel')));
  assert.equal(events.find(e=>e.type==='finish').label,'Extraction cancelled');
  assert.ok(!events.find(e=>e.type==='finish').error);
});
test('completion wins a late cancellation and retains accurate success feedback',async()=>{
  const {events}=await run({cancel:true});
  assert.equal(events.find(e=>e.type==='finish').label,'Extracted');
});
test('an unacknowledged cancellation write still reads the completed extraction result',async()=>{
  const {events}=await run({cancel:true,cancelTimeout:true});
  assert.equal(events.filter(e=>e.type==='put'&&e.path.endsWith('/cancel')).length,1);
  assert.equal(events.find(e=>e.type==='finish').label,'Extracted');
});
test('untrusted completion paths are rejected and incomplete staging is retained',async()=>{
  const {events}=await run({statuses:[{state:'extracted',path:'/wrong.zip',destination:'/wrong',files:1,folders:0,done:1,total:1}]});
  assert.equal(events.find(e=>e.type==='finish').label,'Extraction failed');
  assert.ok(!events.some(e=>e.type==='cleanup'));
});

test('a missed extraction result is reread from the same job without extracting twice',async()=>{
  let reads=0;
  const {events}=await run({readStatus:async()=>{if(++reads===1)throw new Error('signal timed out');}});
  const statusReads=events.filter(e=>e.url?.includes('status.json'));
  assert.equal(statusReads.length,2);
  assert.equal(statusReads[0].url.split('?')[0],statusReads[1].url.split('?')[0]);
  assert.equal(events.filter(e=>e.type==='send').length,1);
  assert.equal(events.find(e=>e.type==='finish').label,'Extracted');
  assert.ok(events.some(e=>e.type==='cleanup'));
});
test('unreadable extraction status retains staging and distinguishes unknown from failed',async()=>{
  for(const [status,reads] of [[503,3],[403,1]]){
    const {events}=await run({readStatus:async()=>{throw Object.assign(new Error('Unavailable'),{status});}});
    assert.equal(events.filter(e=>e.url?.includes('status.json')).length,reads);
    assert.equal(events.find(e=>e.type==='finish').label,'Extraction status unknown');
    assert.ok(!events.some(e=>e.type==='cleanup'));
  }
});
test('startup misses and recovered progress each leave room to recheck a later worker result',async()=>{
  const path='/content/results/data.zip',destination='/content/results/data';
  const checking={state:'checking',path,destination,files:0,folders:0,done:0,total:0};
  const failed={state:'error',path,destination,error:'CRC mismatch',partial:false};
  const responses=[404,404,404,504,408,200,503,503,200];
  const {events}=await run({statuses:[checking,failed],readStatus:async()=>{
    const status=responses.shift();
    if(status!==200)throw Object.assign(new Error('Unavailable'),{status});
  }});
  assert.deepEqual(responses,[]);
  const final=events.find(e=>e.type==='finish');
  assert.equal(final.label,'Extraction failed');
  assert.equal(final.detail,'CRC mismatch');
  assert.equal(events.filter(e=>e.type==='send').length,1);
  assert.ok(events.some(e=>e.type==='cleanup'));
});
