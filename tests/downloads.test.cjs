const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function harness({granted=true,owner='extension-id'}={}){
  let callback,records=[],next=1;
  const calls=[];
  const items=new Map();
  const chrome={
    runtime:{id:'extension-id',getURL:p=>'chrome-extension://extension-id/'+p,onMessage:{addListener:f=>callback=f}},
    permissions:{contains:async()=>granted},
    storage:{local:{get:async()=>({downloads:records}),set:async v=>records=v.downloads}},
    downloads:{
      download:async args=>{calls.push(['download',args]);const id=next++;items.set(id,{id,byExtensionId:owner,state:'complete',exists:true,filename:args.filename});return id;},
      search:async({id})=>items.has(id)?[items.get(id)]:[],
      cancel:async id=>calls.push(['cancel',id]),removeFile:async id=>calls.push(['remove',id])
    }
  };
  const sandbox={chrome,URL};vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/downloads.js'),'utf8'),sandbox);
  const send=(args,popup=false)=>new Promise(resolve=>callback(args,popup?
    {url:chrome.runtime.getURL('popup.html')}:{url:'https://colab.research.google.com/drive/test',tab:{id:1}},resolve));
  return {send,calls};
}
const download={action:'download',url:'blob:https://colab.research.google.com/abc',name:'test.zip',operation:'11111111-1111-4111-8111-111111111111'};
test('managed downloads retain an exact operation association',async()=>{
  const {send}=harness();
  const response=await send(download);
  assert.equal(response.result.id,1);
  const list=await send({action:'list'},true);
  assert.equal(list.result.downloads[0].operation,download.operation);
});
test('a webpage cannot remove a local download',async()=>{
  const {send,calls}=harness();await send(download);
  const result=await send({action:'remove',id:1});
  assert.match(result.error,/popup/);
  assert.equal(calls.filter(c=>c[0]==='remove').length,0);
});
test('untracked or other-extension downloads cannot be removed',async()=>{
  const {send,calls}=harness({owner:'another-extension'});await send(download);
  assert.match((await send({action:'remove',id:1},true)).error,/not managed/);
  assert.match((await send({action:'remove',id:99},true)).error,/not managed/);
  assert.equal(calls.filter(c=>c[0]==='remove').length,0);
});
test('permission is optional and missing permission does not start a download',async()=>{
  const {send,calls}=harness({granted:false});
  assert.equal((await send({action:'permission'})).result.granted,false);
  assert.ok((await send(download)).error);
  assert.equal(calls.length,0);
});
test('only Colab blob ZIP downloads are accepted',async()=>{
  const {send,calls}=harness();
  assert.ok((await send({...download,url:'https://example.com/file'})).error);
  assert.ok((await send({...download,name:'../file.zip'})).error);
  assert.equal(calls.length,0);
});
