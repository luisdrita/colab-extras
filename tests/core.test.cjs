const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {normalizePath,deletionPath,conflictingJob,encodePath,quote,request,put,openTerminal,validateArchive,formatBytes,validateDetails}=require('../src/core.cjs');
function setup(fail=false){
  const calls=[];
  const runtime={};
  const socket={connect:async()=>{if(fail)throw new Error('socket failed');},stop:()=>calls.push(['stop']),sendString:x=>calls.push(['send',JSON.parse(x)])};
  const ctx={runtime,kernel:{runtime,runtimeProxy:{createSocket:path=>{calls.push(['socket',path]);return socket;}}},xhr:{fetch:async(path,opts)=>{calls.push([opts.method,path,opts.body]);return new Response(JSON.stringify({name:'cfz-test'}),{status:200});}}};
  return {ctx,calls};
}
test('paths keep spaces/unicode, reject traversal/control/root',()=>{
  assert.equal(normalizePath('/content//hello café/'),'/content/hello café');
  assert.equal(normalizePath('/content/ name '),'/content/ name ');
  for(const s of ['/','relative','/content/../root','/content/./a','/a\nb','/a\0b','/content/.colab-folder-zip-x'])assert.throws(()=>normalizePath(s));
  assert.equal(encodePath('/content/a #?.csv'),'content/a%20%23%3F.csv');
});
test('shell quoting round-trips executable-looking folder names as literal text',()=>{
  const s="a ' `nope` $(nope) ; café";
  const result=execFileSync('/bin/sh',['-c','printf %s '+quote(s)],{encoding:'utf8'});
  assert.equal(result,s);
});
test('deletion protects runtime and Drive roots, while allowing ordinary folders',()=>{
  for(const path of ['/', '/content', '/tmp/data', '/content/drive', '/content/drive/MyDrive', '/content/drive/Shareddrives', '/content/drive/Shareddrives/Team', '/content/.colab-folder-zip-id/sub'])assert.throws(()=>deletionPath(path));
  for(const path of ['/content/results', '/content/drive/MyDrive/results', '/content/drive/Shareddrives/Team/results'])assert.equal(deletionPath(path),path);
});
test('deletion cannot overlap a ZIP on a parent or child; unrelated folders remain available',()=>{
  const jobs=new Map([['a',{kind:'zip',path:'/content/results/sub'}]]);
  assert.ok(conflictingJob(jobs,'/content/results','delete'));
  assert.ok(conflictingJob(jobs,'/content/results/sub/child','delete'));
  assert.ok(conflictingJob(jobs,'/content/results/sub','zip'));
  assert.equal(conflictingJob(jobs,'/content/results','zip'),false);
  assert.equal(conflictingJob(jobs,'/content/results2','delete'),false);
});
test('a deletion blocks new ZIPs or deletes on overlapping folders',()=>{
  const jobs=new Map([['a',{kind:'delete',path:'/content/results'}]]);
  for(const kind of ['zip','delete']){
    for(const path of ['/content/results','/content/results/sub','/content'])assert.ok(conflictingJob(jobs,path,kind));
    assert.equal(conflictingJob(jobs,'/content/results2',kind),false);
  }
});
test('Contents upload sends text as JSON, with no shell interpolation',async()=>{
  const {ctx,calls}=setup();await put(ctx,'/content/a #.py','print("hi")');
  assert.deepEqual(calls[0].slice(0,2),['PUT','/api/contents/content/a%20%23.py']);
  assert.deepEqual(JSON.parse(calls[0][2]),{type:'file',format:'text',content:'print("hi")'});
});
test('runtime replacement aborts requests without using new runtime',async()=>{
  const {ctx,calls}=setup();ctx.kernel.runtime={};
  await assert.rejects(()=>request(ctx,'/api/contents/a'),/runtime changed/);
  assert.equal(calls.length,0);
});
test('terminal uses a newly created session, standard protocol, idempotent cleanup',async()=>{
  const {ctx,calls}=setup();const t=await openTerminal(ctx);t.send('hello\n');await t.close();await t.close();
  assert.deepEqual(calls.map(c=>c.slice(0,2)),[
    ['POST','/api/terminals'],['socket','/terminals/websocket/cfz-test'],['send',['stdin','hello\n']],['stop'],['DELETE','/api/terminals/cfz-test']
  ]);
  assert.ok(!JSON.stringify(calls).includes('/colab/tty'));
});
test('failed socket connection removes only its own newly-created terminal',async()=>{
  const {ctx,calls}=setup(true);await assert.rejects(()=>openTerminal(ctx),/socket failed/);
  assert.equal(calls.filter(c=>c[0]==='DELETE').length,1);
  assert.equal(calls.at(-1)[1],'/api/terminals/cfz-test');
});
test('missing terminal support fails without a notebook fallback',async()=>{
  const {ctx,calls}=setup();delete ctx.kernel.runtimeProxy;
  await assert.rejects(()=>openTerminal(ctx),/isolated terminal/);assert.equal(calls.length,0);
});
test('terminal permission failure explains compatibility limit',async()=>{
  const {ctx}=setup();ctx.xhr.fetch=async()=>new Response('',{status:403});
  await assert.rejects(()=>openTerminal(ctx),/No notebook code was executed/);
});
test('archive must be the source sibling ZIP or a numbered collision-safe ZIP',()=>{
  const r={archive:'/content/results.zip',size:22};
  assert.equal(validateArchive(r,'/content/results'),r.archive);
  assert.equal(validateArchive({...r,archive:'/content/results (12).zip'},'/content/results'),'/content/results (12).zip');
  for(const archive of ['/content/sensitive.zip','/content/results/../sensitive.zip','/content/results (0).zip','/content/results (1)/file.zip']){
    assert.throws(()=>validateArchive({...r,archive},'/content/results'));
  }
  assert.throws(()=>validateArchive({...r,size:NaN},'/content/results'));
});
test('details and deletion block overlapping paths in either direction',()=>{
  for(const [existing,next] of [['details','delete'],['delete','details']]){
    const jobs=new Map([['a',{kind:existing,path:'/content/results/sub'}]]);
    for(const path of ['/content/results','/content/results/sub','/content/results/sub/child'])assert.ok(conflictingJob(jobs,path,next));
    assert.equal(conflictingJob(jobs,'/content/results2',next),false);
  }
});
test('details use binary units and keep zero and large files readable',()=>{
  assert.equal(formatBytes(0),'0 B');assert.equal(formatBytes(1024),'1 KiB');
  assert.equal(formatBytes(1024**3),'1 GiB');assert.equal(formatBytes(1024**5),'1 PiB');
});
test('details reject unrelated paths, invalid totals, unbounded lists, and unsafe relative paths',()=>{
  const good={state:'details',path:'/content/results',bytes:10,files:1,folders:2,links:0,special:0,skipped:0,excluded:0,largest:[{path:'nested/<literal>.txt',size:10}],errors:[]};
  assert.equal(validateDetails(good,good.path),good);
  for(const bad of [null,{...good,path:'/other'},{...good,bytes:-1},{...good,files:NaN},{...good,bytes:Infinity},
      {...good,largest:Array(11).fill(good.largest[0])},{...good,largest:[{path:'../secret',size:10}]},
      {...good,largest:[{path:'/absolute',size:10}]},{...good,largest:[{path:'file',size:11}]},
      {...good,state:'ready'},{...good,errors:[{path:'x',error:'bad'}]}])assert.throws(()=>validateDetails(bad,good.path));
});
