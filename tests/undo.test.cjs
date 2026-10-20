const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const core=require('../src/core.cjs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../src/undo.js'),'utf8').split('const undoObserver=')[0];
function setup(options={}){
  const calls=[],raw=[],feedback=[],saved=[];
  const clock={now:100000};
  class TestDate extends Date{static now(){return clock.now;}}
  const runtime={};
  const xhr={fetch:async(url,options)=>{raw.push({url,options});return new Response('{}');}};
  const ctx={kernel:{runtime},runtime,xhr};
  const tree={files:{rootPath:'content',write(){},getFile:async()=>({isDirectory:true})},refresh:async()=>{}};
  const sandbox={...core,crypto:webcrypto,URL,Response,Headers,AbortSignal,Uint8Array,btoa,
    window:{addEventListener(){}},queueMicrotask,Date:TestDate,setTimeout,clearTimeout,location:{origin:'https://colab.research.google.com'},
    localStorage:{getItem:()=>null,setItem:(key,value)=>saved.push({key,value})},jobs:new Map(),
    document:{querySelector:selector=>selector==='colab-file-browser'?{currentTree:tree}:null},
    context:()=>({...ctx,runtime:ctx.kernel.runtime}),
    fakeFeedback:(text,error)=>feedback.push({text,error}),
    fakeRecovery:async args=>{
      calls.push(args);
      if(args.action==='list'){
        if(options.listError)throw new Error(options.listError);
        await options.beforeList?.();
        return {records:options.records||[],server_time:options.serverTime??clock.now/1000,receivedAt:clock.now};
      }
      return {id:args.id||'test-id',state:args.body?.chunk>0?'pending':'ready',path:args.path,conflicts:options.conflicts||[]};
    }};
  vm.createContext(sandbox);
  vm.runInContext(code+'\nrecoveryCall=fakeRecovery;undoFeedback=fakeFeedback;',sandbox);
  sandbox.hookNativeFiles();
  return {sandbox,tree,ctx,calls,raw,feedback,saved,clock};
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
test('one click undoes only the latest file action, even with unordered history',async()=>{
  const {sandbox,calls,feedback}=setup({records:[
    {id:'older',time:80,label:'Older file'}, {id:'latest',time:90,label:'Latest file'}
  ]});
  await sandbox.undoLastAction();
  assert.deepEqual(calls.filter(c=>c.action==='undo').map(c=>c.id),['latest']);
  assert.equal(feedback.at(-1).text,'Undone: Latest file.');
});
test('a newer settings change is undone before a file change',async()=>{
  const {sandbox,calls,saved,clock}=setup({records:[{id:'file',time:90,label:'File'}]});
  sandbox.changeUndoPreference('overwrite',true);
  clock.now=101000;
  await sandbox.undoLastAction();
  assert.equal(calls.filter(c=>c.action==='undo').length,0);
  assert.equal(JSON.parse(saved.at(-1).value).overwrite,false);
  await sandbox.undoLastAction();
  assert.equal(calls.at(-1).id,'file');
});
test('sidebar navigation participates in the same last-action order',async()=>{
  const {sandbox,tree,calls,clock}=setup({records:[{id:'file',time:90,label:'File'}]});
  sandbox.observeLocation();tree.files.rootPath='content/subfolder';sandbox.observeLocation();
  clock.now=101000;
  await sandbox.undoLastAction();
  assert.equal(tree.files.rootPath,'content');
  assert.equal(calls.filter(c=>c.action==='undo').length,0);
  await sandbox.undoLastAction();
  assert.equal(calls.at(-1).id,'file');
});
test('runtime clock differences do not put an older file ahead of newer navigation',async()=>{
  const {sandbox,tree,clock,calls}=setup({serverTime:1000,records:[{id:'file',time:980,label:'File'}]});
  sandbox.observeLocation();tree.files.rootPath='content/subfolder';sandbox.observeLocation();
  clock.now=101000;
  await sandbox.undoLastAction();
  assert.equal(tree.files.rootPath,'content');
  assert.equal(calls.filter(c=>c.action==='undo').length,0);
});
test('a newer file is undone before an older settings change',async()=>{
  const {sandbox,calls,clock,saved}=setup({records:[{id:'file',time:95,label:'File'}]});
  clock.now=90000;sandbox.changeUndoPreference('overwrite',true);clock.now=100000;
  await sandbox.undoLastAction();
  assert.equal(calls.at(-1).id,'file');
  assert.equal(JSON.parse(saved.at(-1).value).overwrite,true);
});
test('conflicts stop at the latest action without undoing older files',async()=>{
  const {sandbox,calls,feedback}=setup({records:[
    {id:'latest',time:90,label:'Latest file'}, {id:'older',time:80,label:'Older file'}
  ],conflicts:[{path:'/content/edited',reason:'Changed after creation'}]});
  await sandbox.undoLastAction();
  assert.deepEqual(calls.filter(c=>c.action==='undo').map(c=>c.id),['latest']);
  assert.match(feedback.at(-1).text,/Later changes were preserved/);
  assert.equal(feedback.at(-1).error,true);
});
test('empty history reports nothing to undo without creating a dialog',async()=>{
  const {sandbox,calls,feedback}=setup();
  sandbox.document.createElement=()=>{throw Error('No modal may be created');};
  await sandbox.undoLastAction();
  assert.equal(calls.filter(c=>c.action==='undo').length,0);
  assert.equal(feedback.at(-1).text,'Nothing to undo.');
});
test('history lookup failure does not fall back to an older local action',async()=>{
  const {sandbox,saved,feedback}=setup({listError:'Runtime unavailable'});
  sandbox.changeUndoPreference('overwrite',true);
  await sandbox.undoLastAction();
  assert.equal(JSON.parse(saved.at(-1).value).overwrite,true);
  assert.equal(feedback.at(-1).text,'Runtime unavailable');
});
test('a rapid second click cannot undo a second action',async()=>{
  let releaseList;
  const gate=new Promise(resolve=>{releaseList=resolve;});
  const {sandbox,calls}=setup({records:[{id:'file',time:90,label:'File'}],beforeList:()=>gate});
  const first=sandbox.undoLastAction();
  await sandbox.undoLastAction();
  releaseList();await first;
  assert.equal(calls.filter(c=>c.action==='undo').length,1);
});
test('the toolbar click invokes direct Undo and never opens history',async()=>{
  const {sandbox,calls}=setup({records:[{id:'file',time:90,label:'File'}]});
  let installed;
  const refresh={after:button=>{installed=button;}};
  sandbox.document.querySelector=selector=>selector==='.file-tree-refresh'?refresh:
    selector==='colab-file-browser'?{currentTree:{files:{rootPath:'content'},refresh:async()=>{}}}:
    selector==='[data-cfz-undo-button]'?installed:null;
  sandbox.document.createElement=()=>({dataset:{},style:{},handlers:{},
    setAttribute(){},getAttribute(){return 'false';},removeAttribute(){},append(){},addEventListener(name,handler){this.handlers[name]=handler;}});
  vm.runInContext('showUndo=()=>{throw new Error("History must not open");};',sandbox);
  sandbox.installUndoButton();
  await installed.handlers.click({isTrusted:true});
  assert.equal(calls.filter(c=>c.action==='undo').length,1);
});
function attachButton(sandbox){
  const attributes=new Map();
  const button={style:{},setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k),getAttribute:k=>attributes.get(k)};
  const previous=sandbox.document.querySelector;
  sandbox.document.querySelector=selector=>selector==='[data-cfz-undo-button]'?button:previous(selector);
  return {button,attributes};
}
function folderFixture(sandbox){
  const visible=new Map();
  function folder(path,open=false,parent=null){
    const classes=new Set(open?[]:['collapsed']);
    const descendants=[];
    const container={classList:{contains:name=>name==='child-files'},replaceChildren(){for(const child of descendants)visible.delete(child.file.path);descendants.length=0;}};
    const view={file:{path,isDirectory:true},isConnected:true,children:[container],childViews:descendants,
      classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},
      querySelectorAll:()=>descendants,refresh:async()=>{},closest:()=>view};
    const row={closest:()=>view};
    const target={closest:selector=>selector==='.file-title-row'?row:null};
    visible.set(path,view);if(parent)parent.childViews.push(view);
    return {view,event:{type:'click',isTrusted:true,target}};
  }
  sandbox.document.querySelectorAll=()=>[...visible.values()];
  async function toggle(item){
    sandbox.captureFolderAction(item.event);
    await Promise.resolve(); // Native input may drain microtasks before target listeners.
    await sandbox.setFolderOpen(item.view,item.view.classList.contains('collapsed'));
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  return {folder,toggle,visible};
}
test('empty history greys and disables the button; navigation enables it; Undo disables it again',async()=>{
  const {sandbox,tree}=setup();const {button,attributes}=attachButton(sandbox);
  await sandbox.refreshUndoAvailability();
  assert.equal(button.disabled,true);assert.equal(attributes.get('aria-disabled'),'true');assert.equal(button.style.opacity,'0.38');
  sandbox.observeLocation();tree.files.rootPath='content/subfolder';sandbox.observeLocation();
  assert.equal(button.disabled,false);
  await sandbox.undoLastAction();assert.equal(button.disabled,true);
});
test('persisted runtime history enables Undo after loading and the final file Undo greys it',async()=>{
  const {sandbox}=setup({records:[{id:'file',time:90,label:'File'}]});
  const {button}=attachButton(sandbox);
  await sandbox.refreshUndoAvailability();assert.equal(button.disabled,false);
  await sandbox.undoLastAction();assert.equal(button.disabled,true);
});
test('opening a folder is the latest action and Undo closes it without changing files',async()=>{
  const {sandbox,calls,feedback}=setup();const {folder,toggle}=folderFixture(sandbox);
  const item=folder('content/results');await sandbox.refreshUndoAvailability();
  await toggle(item);assert.equal(item.view.classList.contains('collapsed'),false);
  const requests=calls.length;await sandbox.undoLastAction();
  assert.equal(item.view.classList.contains('collapsed'),true);
  assert.equal(calls.length,requests);assert.match(feedback.at(-1).text,/Closed:/);
  await sandbox.undoLastAction();assert.equal(feedback.at(-1).text,'Nothing to undo.');
});
test('undoing a folder close restores the parent and previously expanded children',async()=>{
  const {sandbox}=setup();const {folder,toggle,visible}=folderFixture(sandbox);
  const parent=folder('content/results',true),child=folder('content/results/nested',true,parent.view);
  parent.view.refresh=async()=>{if(!visible.has(child.view.file.path))folder(child.view.file.path,false,parent.view);};
  await toggle(parent);assert.equal(parent.view.classList.contains('collapsed'),true);assert.equal(visible.has(child.view.file.path),false);
  await sandbox.undoLastAction();
  assert.equal(parent.view.classList.contains('collapsed'),false);
  assert.equal(visible.get(child.view.file.path).classList.contains('collapsed'),false);
});
test('folder open and close are undone individually in reverse order',async()=>{
  const {sandbox,clock}=setup();const {folder,toggle}=folderFixture(sandbox);const item=folder('content/results');
  await toggle(item);clock.now++;await toggle(item);
  await sandbox.undoLastAction();assert.equal(item.view.classList.contains('collapsed'),false);
  await sandbox.undoLastAction();assert.equal(item.view.classList.contains('collapsed'),true);
});
test('Undo finds a replacement folder row by path',async()=>{
  const {sandbox}=setup();const {folder,toggle}=folderFixture(sandbox);
  const original=folder('content/results');await toggle(original);
  original.view.isConnected=false;const replacement=folder('content/results',true);
  await sandbox.undoLastAction();assert.equal(replacement.view.classList.contains('collapsed'),true);
});
test('missing folders retain their action and do not fall through to an older file',async()=>{
  const {sandbox,calls,feedback}=setup({records:[{id:'old',time:90,label:'Old file'}]});
  const {folder,toggle,visible}=folderFixture(sandbox);await toggle(folder('content/results'));visible.clear();
  await sandbox.undoLastAction();assert.match(feedback.at(-1).text,/no longer visible/);
  assert.equal(calls.filter(c=>c.action==='undo').length,0);
});
test('menu clicks and programmatic refreshes do not add folder Undo actions',async()=>{
  const {sandbox,feedback}=setup();const {folder}=folderFixture(sandbox);const item=folder('content/results');
  sandbox.captureFolderAction({...item.event,isTrusted:false});await sandbox.setFolderOpen(item.view,true);await Promise.resolve();
  await sandbox.undoLastAction();assert.equal(feedback.at(-1).text,'Nothing to undo.');
});
test('popup preferences are validated and remain undoable',async()=>{
  const {sandbox}=setup();
  assert.equal(sandbox.preferencesRequest({action:'set',key:'overwrite',value:true}).overwrite,true);
  assert.throws(()=>sandbox.preferencesRequest({action:'set',key:'other',value:true}),/Unknown/);
  await sandbox.undoLastAction();assert.equal(sandbox.preferencesRequest({action:'get'}).overwrite,false);
});
test('right-click menus have no Undo or history commands',()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/ui.js'),'utf8');
  const menus=source.slice(source.indexOf('function addMenuItems'));
  assert.doesNotMatch(menus,/with Undo|\['history'|showUndo\(/);
});

test('keyboard activation followed by its click creates only one folder action',async()=>{
  const {sandbox,feedback}=setup();const {folder}=folderFixture(sandbox);const item=folder('content/results');
  sandbox.captureFolderAction({...item.event,type:'keydown',key:'Enter'});
  sandbox.captureFolderAction(item.event);await sandbox.setFolderOpen(item.view,true);
  await new Promise(resolve=>setTimeout(resolve,5));
  await sandbox.undoLastAction();assert.equal(item.view.classList.contains('collapsed'),true);
  await sandbox.undoLastAction();assert.equal(feedback.at(-1).text,'Nothing to undo.');
});
