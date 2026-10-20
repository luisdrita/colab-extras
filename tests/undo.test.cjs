const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const core=require('../src/core.cjs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../src/undo.js'),'utf8').split('const undoObserver=')[0];
function setup(){
  const calls=[],raw=[];
  const runtime={};
  const xhr={fetch:async(url,options)=>{raw.push({url,options});return new Response('{}');}};
  const ctx={kernel:{runtime},runtime,xhr};
  const tree={files:{rootPath:'content',write(){},getFile:async()=>({isDirectory:true})},refresh:async()=>{}};
  const sandbox={...core,crypto:webcrypto,URL,Response,Headers,AbortSignal,Uint8Array,btoa,
    setTimeout,clearTimeout,location:{origin:'https://colab.research.google.com'},
    localStorage:{getItem:()=>null},jobs:new Map(),
    document:{querySelector:()=>({currentTree:tree})},
    context:()=>({...ctx,runtime:ctx.kernel.runtime}),
    fakeRecovery:async args=>{calls.push(args);return {id:args.id||'test-id',state:args.body?.chunk>0?'pending':'ready',path:args.path,conflicts:[]};}};
  vm.createContext(sandbox);
  vm.runInContext(code+'\nrecoveryCall=fakeRecovery;',sandbox);
  sandbox.hookNativeFiles();
  return {sandbox,tree,ctx,calls,raw};
}
test('native rename and root folder creation are protected',async()=>{
  const {ctx,calls,raw}=setup();
  await ctx.xhr.fetch('/api/contents/content/a',{method:'PATCH',body:JSON.stringify({path:'content/b'})});
  await ctx.xhr.fetch('/api/contents/content',{method:'POST',body:JSON.stringify({type:'directory'})});
  assert.equal(calls[0].method,'PATCH');
  assert.equal(calls[1].method,'POST');
  assert.ok(raw.every(x=>x.options.method==='GET'));
});
test('internal requests bypass native interception',async()=>{
  const {ctx,calls,raw}=setup();
  await core.request(ctx,'/api/contents/content/.colab-folder-zip-job','PUT',{type:'directory'});
  assert.equal(calls.length,0);assert.equal(raw.length,1);
});
test('full Colab upload call uses explicit final chunk and one operation id',async()=>{
  const {tree,calls}=setup();
  const progress=[];
  await tree.files.write('content','file.bin',new Uint8Array(2100000).buffer,{update:n=>progress.push(n)});
  assert.deepEqual(calls.map(c=>c.body.chunk),[1,2,-1]);
  assert.equal(calls[1].id,'test-id');
  assert.equal(calls[2].id,'test-id');
  assert.equal(progress.at(-1),1);
});
test('cancelled upload rolls back its pending operation',async()=>{
  const {tree,calls}=setup();
  const progress={canceled:false,update:()=>{progress.canceled=true;}};
  await assert.rejects(tree.files.write('content','file',new Uint8Array(2100000).buffer,progress),/cancelled/);
  assert.equal(calls.at(-1).action,'undo');
});
test('empty uploads are handled as complete operations',async()=>{
  const {tree,calls}=setup();
  await tree.files.write('content','empty',new ArrayBuffer(0),{update(){}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.content,'');
  assert.equal(calls[0].body.chunk,undefined);
});
test('back navigation changes only the sidebar root',async()=>{
  const {tree,sandbox}=setup();
  sandbox.observeLocation();
  tree.files.rootPath='content/subfolder';sandbox.observeLocation();
  await sandbox.previousLocation();
  assert.equal(tree.files.rootPath,'content');
  await assert.rejects(sandbox.previousLocation(),/No previous/);
});
test('protected runtime and recovery roots are rejected',async()=>{
  const {ctx,calls}=setup();
  await assert.rejects(ctx.xhr.fetch('/api/contents/content',{method:'DELETE'}),/inside/);
  await assert.rejects(ctx.xhr.fetch('/api/contents/content/.colab-folder-zip-undo',{method:'DELETE'}),/staging/);
  assert.equal(calls.length,0);
});
test('reconnecting the runtime renews the native hook without nesting wrappers',async()=>{
  const {ctx,sandbox,calls}=setup();
  ctx.kernel.runtime={};
  sandbox.hookNativeFiles();
  await ctx.xhr.fetch('/api/contents/content/a',{method:'DELETE'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'DELETE');
});
