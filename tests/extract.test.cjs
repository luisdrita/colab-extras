const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const core=require('../src/core.cjs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../src/extract.js'),'utf8');
async function run(options={}){
  const path='/content/results/data.zip',events=[],jobs=new Map();
  const result={state:'extracted',path,destination:'/content/results',files:2,folders:1,done:12,total:12};
  const statuses=[...(options.statuses||[result])];
  const ctx={...core,crypto:webcrypto,jobs,extractSource:'bundled Python',recoverySource:'recovery Python',undoBusy:false,undoPreferences:{overwrite:false},
    setStatus:(job,label,detail,error,progress)=>events.push({type:'status',label,detail,error,progress}),
    finishStatus:(job,label,detail,error)=>events.push({type:'finish',label,detail,error}),
    addMenuItems:()=>{},context:()=>({}),
    request:async(ctx,url,method)=>{
      events.push({type:'request',url,method});
      if(url.includes('status.json'))return {json:async()=>statuses.shift()};
      return {json:async()=>({type:'file'})};
    },
    put:async(ctx,path,content)=>events.push({type:'put',path,content}),
    openTerminal:async()=>{
      if(options.blocked)throw new Error('Independent terminals are unavailable');
      return {send:command=>events.push({type:'send',command}),close:async()=>events.push({type:'close'})};
    },
    sleep:async()=>{if(options.cancel)jobs.get(path).cancelled=true;},
    cleanup:async()=>events.push({type:'cleanup'}),
    document:{querySelector:()=>({currentTree:{refresh:async()=>events.push({type:'refresh'})}})}
  };
  vm.createContext(ctx);vm.runInContext(code,ctx);await ctx.runExtract({path});
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
  const {events}=await run({statuses:[{state:'error',path:'/content/results/data.zip',destination:'/content/results',error:'CRC mismatch',partial:true}]});
  assert.match(events.find(e=>e.type==='finish').detail,/Later changes were preserved/);
  assert.ok(events.find(e=>e.type==='finish').error);
  assert.ok(events.some(e=>e.type==='refresh'));
  assert.ok(events.some(e=>e.type==='cleanup'));
});
test('cancellation requests use the job marker and wait for backend acknowledgement',async()=>{
  const {events}=await run({cancel:true,statuses:[{state:'cancelled',path:'/content/results/data.zip',destination:'/content/results',error:'Extraction cancelled',partial:false}]});
  assert.ok(events.some(e=>e.type==='put'&&e.path.endsWith('/cancel')));
  assert.equal(events.find(e=>e.type==='finish').label,'Extraction cancelled');
  assert.ok(!events.find(e=>e.type==='finish').error);
});
test('completion wins a late cancellation and retains accurate success feedback',async()=>{
  const {events}=await run({cancel:true});
  assert.equal(events.find(e=>e.type==='finish').label,'Extracted');
});
test('untrusted completion paths are rejected and incomplete staging is retained',async()=>{
  const {events}=await run({statuses:[{state:'extracted',path:'/wrong.zip',destination:'/wrong',files:1,folders:0,done:1,total:1}]});
  assert.equal(events.find(e=>e.type==='finish').label,'Extraction failed');
  assert.ok(!events.some(e=>e.type==='cleanup'));
});
