const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../src/core.cjs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/selection.js'),'utf8');
const file=path=>({path,isDirectory:false});
const folder=path=>({path,isDirectory:true});
test('deletion plan collapses parents and duplicates but preserves siblings',()=>{
  assert.deepEqual(core.planDeletion([file('/content/a/x'),folder('/content/a'),folder('/content/a'),file('/content/a2')]),[folder('/content/a'),file('/content/a2')]);
});
test('plan rejects empty, unsafe, conflicting, and malformed selections',()=>{
  for(const items of [[],[file('/content')],[file('/etc/a')],[file('/content/drive/MyDrive')],
    [file('/content/a'),folder('/content/a')],[{path:'/content/a',isDirectory:'false'}]])assert.throws(()=>core.planDeletion(items));
});
test('batch response validation requires exact paths and complete terminal results',()=>{
  const plan=[file('/content/a'),folder('/content/b')];
  const result={state:'complete',total:2,completed:2,results:[{path:'/content/a',deleted:true},{path:'/content/b',deleted:false,error:'denied',partial:false}]};
  assert.equal(core.validateDeletionStatus(result,plan),result);
  assert.throws(()=>core.validateDeletionStatus({...result,results:[...result.results].reverse()},plan));
  assert.throws(()=>core.validateDeletionStatus({...result,completed:1,results:result.results.slice(0,1)},plan));
  assert.throws(()=>core.validateDeletionStatus({...result,total:3},plan));
});
async function run(options={}){
  const events=[],runtime={},ctx={runtime,kernel:{runtime}};
  const targets=options.targets||[folder('/content/a'),file('/content/b'),file('/content/a/child')];
  const plan=core.planDeletion(targets);
  const selectionState={items:new Map(targets.map(item=>[item.path,item])),runtime,busy:false};
  let poll=0;
  const results=options.results||plan.map(item=>({path:item.path,deleted:true}));
  const sandbox={...core,selectionState,jobs:new Map(),crypto:require('node:crypto').webcrypto,
    context:()=>ctx,refreshSelection:()=>{},addMenuItems:()=>{},
    setStatus:(job,label,detail,error)=>events.push({path:job.path,label,detail,error,finished:job.finished}),
    selectionMessage:(message,error)=>events.push({message,error}),
    window:{confirm:()=>{throw Error('Unexpected confirmation');}},
    openTerminal:async()=>{
      events.push({terminal:true});if(options.changedDuringStart)ctx.kernel.runtime={};
      return {send:command=>events.push({command}),close:async()=>events.push({closed:true})};
    },
    request:async(ctx,url,method)=>{
      core.assertRuntime(ctx);
      if(!url.includes('status.json'))return {json:async()=>({})};
      poll++;
      if(options.networkFailure&&poll>1)throw Error('Connection lost');
      return {json:async()=>({state:options.networkFailure?'deleting':'complete',total:plan.length,completed:options.networkFailure?1:plan.length,results:options.networkFailure?results.slice(0,1):results})};
    },put:async(ctx,path,content)=>events.push({put:path,content}),sleep:async()=>{},deleteSource:'worker',
    cleanup:async()=>events.push({cleaned:true}),filePath:view=>view.path,
    document:{querySelectorAll:()=>options.visible||[],querySelector:()=>({currentTree:{refresh:async()=>events.push({refreshed:true})}})}};
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('function forgetDeletedSelection'),source.indexOf('function setSelection'))+source.slice(source.indexOf('function batchRoot'),source.lastIndexOf('refreshSelection();')),sandbox);
  if(options.changedRuntime)ctx.kernel.runtime={};
  await sandbox.runBulkDelete(options.explicit?targets:null);
  return {events,selectionState,jobs:sandbox.jobs};
}
test('bulk delete starts directly and draws progress for every selected path before runtime work',async()=>{
  const {events}=await run();
  assert.ok(!source.includes('confirmBulkDelete'));
  const beforeTerminal=events.slice(0,events.findIndex(e=>e.terminal));
  for(const path of ['/content/a','/content/a/child','/content/b'])assert.ok(beforeTerminal.some(e=>e.path===path&&!e.finished));
  assert.equal(events.filter(e=>e.command).length,1);
});
test('mixed bulk delete stages exact deduplicated plan and clears successful selections and progress',async()=>{
  const {events,selectionState,jobs}=await run();
  assert.deepEqual(JSON.parse(events.find(e=>e.put?.endsWith('/args.json')).content),[folder('/content/a'),file('/content/b')]);
  assert.match(events.find(e=>e.command).command,/python3 -B .* --batch /);
  assert.equal(selectionState.items.size,0);assert.equal(jobs.size,0);assert.equal(selectionState.busy,false);
  for(const path of ['/content/a','/content/a/child','/content/b'])assert.equal(events.filter(e=>e.path===path).at(-1).finished,true);
  assert.ok(events.some(e=>e.cleaned));assert.ok(events.some(e=>e.refreshed));
});
test('visible affected descendants receive progress but unselected siblings do not',async()=>{
  const {events}=await run({visible:[{path:'/content/a/deep/data.csv'},{path:'/content/another'}]});
  assert.ok(events.some(e=>e.path==='/content/a/deep/data.csv'&&!e.finished));
  assert.ok(!events.some(e=>e.path==='/content/another'));
});
test('partial failures stop all affected progress and retain failed selections',async()=>{
  const {events,selectionState}=await run({results:[{path:'/content/a',deleted:false,error:'denied',partial:true},{path:'/content/b',deleted:true}]});
  assert.deepEqual([...selectionState.items.keys()],['/content/a','/content/a/child']);
  assert.match(events.find(e=>e.error&&e.message).message,/\/content\/a: denied.*Some contents/);
  assert.ok(events.some(e=>e.path==='/content/a'&&e.finished&&e.error));
  assert.ok(events.some(e=>e.path==='/content/b'&&e.finished&&!e.error));
});
test('connection loss stops pending progress without retrying or changing completed rows into errors',async()=>{
  const {events,selectionState}=await run({networkFailure:true});
  assert.deepEqual([...selectionState.items.keys()],['/content/b']);
  assert.match(events.find(e=>e.error&&e.message).message,/remaining items is unknown/);
  assert.equal(events.filter(e=>e.command).length,1);assert.ok(!events.some(e=>e.cleaned));
  assert.equal(events.filter(e=>e.path==='/content/b').at(-1).finished,true);
  assert.ok(!events.some(e=>e.path==='/content/a'&&e.error));
});
test('runtime changes before or during startup prevent worker execution',async()=>{
  for(const options of [{changedRuntime:true},{changedDuringStart:true}]){
    const {events,selectionState,jobs}=await run(options);
    assert.ok(!events.some(e=>e.command));assert.equal(selectionState.items.size,3);assert.equal(selectionState.busy,false);assert.equal(jobs.size,0);
  }
});
test('unrelated results cannot clear selections or masquerade as completion',async()=>{
  const {events,selectionState}=await run({results:[{path:'/content/wrong',deleted:true},{path:'/content/b',deleted:true}]});
  assert.equal(selectionState.items.size,3);assert.ok(events.some(e=>e.error));assert.ok(!events.some(e=>e.cleaned));
});
test('the single-folder extension command uses the same immediate batch worker',async()=>{
  const {events}=await run({targets:[folder('/content/a')],explicit:true});
  assert.equal(events.filter(e=>e.command).length,1);
  assert.deepEqual(JSON.parse(events.find(e=>e.put?.endsWith('/args.json')).content),[folder('/content/a')]);
});

test('Command on Mac and Ctrl on Windows/Linux are the selection modifiers',()=>{
  const code=source.slice(source.indexOf('const selectionPlatform'),source.indexOf('const selectionStyle'));
  for(const platform of ['MacIntel','macOS','Win32','Windows','Linux x86_64']){
    const mac=/Mac|macOS/.test(platform);
    const sandbox={navigator:{platform}};vm.createContext(sandbox);vm.runInContext(code,sandbox);
    for(const [metaKey,ctrlKey,expected] of [[true,false,mac],[false,true,!mac],[false,false,false],[true,true,false]]){
      sandbox.event={metaKey,ctrlKey};assert.equal(vm.runInContext('selectionModifier(event)',sandbox),expected,platform);
    }
  }
});

test('selecting children replaces selected ancestors without adding unselected siblings',()=>{
  const runtime={},items=new Map();
  const sandbox={...core,selectionState:{items,runtime,busy:false},jobs:new Map(),
    context:()=>({runtime}),refreshSelection:()=>{},clearSelection:()=>items.clear(),filePath:view=>view.file.path};
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('function setSelection'),source.indexOf('function refreshSelection')),sandbox);
  const choose=(path,isDirectory,mode='toggle')=>sandbox.setSelection({file:{path,isDirectory,name:path.split('/').pop()}},mode);
  choose('/content/results',true,'only'); // Opening the parent folder.
  choose('/content/results/first.txt',false);
  choose('/content/results/second.txt',false);
  assert.deepEqual([...items.keys()],['/content/results/first.txt','/content/results/second.txt']);
  choose('/content/results-extra',true);
  choose('/content/results',true); // Explicitly selecting the whole folder replaces its children.
  assert.deepEqual([...items.keys()],['/content/results-extra','/content/results']);
  choose('/content/results/nested',true);
  choose('/content/results/nested/deep.txt',false);
  assert.deepEqual([...items.keys()],['/content/results-extra','/content/results/nested/deep.txt']);
  choose('/content/results/nested/deep.txt',false);
  assert.deepEqual([...items.keys()],['/content/results-extra']);
});
