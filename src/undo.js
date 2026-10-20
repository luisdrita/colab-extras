// File recovery is runtime-scoped; navigation and preferences are tab-scoped.
const undoPreferencesKey='colab-extras-preferences-v1';
const undoDefaults={overwrite:false,managedDownloads:false};
let undoPreferences={...undoDefaults};
try{Object.assign(undoPreferences,JSON.parse(localStorage.getItem(undoPreferencesKey)||'{}'));}catch{}
const settingHistory=[];
let undoQueue=Promise.resolve(),undoBusy=false,undoRuntime=null;
let undoClickPending=false,undoFeedbackTimer=null;
const uploadTransactions=new Map();
const locationHistory=[],folderHistory=[];
let runtimeHistory=null,historyDirty=true,historyLoading=false,nextHistoryCheck=0;
let restoringFolder=false;
const pendingFolderActions=new WeakSet();
let currentLocation=null,navigatingBack=false;
const internalRequest=Symbol('Colab Extras internal request');
function serialUndo(task){
  const result=undoQueue.then(task,task);
  undoQueue=result.catch(()=>{});
  return result;
}
async function recoveryCall(args,ctx=context()){
  assertRuntime(ctx);
  const dir='/content/.colab-folder-zip-'+crypto.randomUUID();
  let terminal;
  try{
    await request(ctx,'/api/contents/'+encodePath(dir),'PUT',{type:'directory'});
    await put(ctx,dir+'/recovery.py',recoverySource);
    await put(ctx,dir+'/args.json',JSON.stringify(args));
    terminal=await openTerminal(ctx);
    terminal.send(`python3 -B ${quote(dir+'/recovery.py')} ${quote(dir+'/args.json')} ${quote(dir+'/result.json')}\n`);
    // Hashing a large dataset can take minutes. Never abandon a live worker
    // merely because it has not yet produced its final result.
    let misses=0;
    while(true){
      await sleep(500);
      let response;
      try{response=await request(ctx,'/files/'+encodePath(dir+'/result.json')+'?t='+Date.now());}
      catch(error){if(error.status===404&&++misses<60)continue;throw error;}
      const result=await response.json();
      if(result.running)continue;
      if(!result.ok)throw new Error(result.error||'Recovery failed.');
      assertRuntime(ctx);
      if(args.action==='list'){
        result.receivedAt=Date.now();
        runtimeHistory=result;historyDirty=false;
      }else if(args.action==='native')markUndoHistoryDirty();
      else if(args.action==='undo'&&runtimeHistory&&!result.conflicts.length){
        runtimeHistory.records=runtimeHistory.records.filter(record=>record.id!==args.id);
      }
      updateUndoButton();
      return result;
    }
  }finally{
    if(args.action==='native')markUndoHistoryDirty();
    await terminal?.close();
    // The journal and recovery copies are outside this disposable job directory.
    for(const name of ['recovery.py','args.json','result.json']){
      try{await request(ctx,'/api/contents/'+encodePath(dir+'/'+name),'DELETE');}catch{}
    }
    try{await request(ctx,'/api/contents/'+encodePath(dir),'DELETE');}catch{}
  }
}
function bridgeDownload(args){
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const listener=event=>{
      if(event.source!==window||event.data?.channel!=='colab-extras-isolated'||event.data.id!==id)return;
      window.removeEventListener('message',listener);clearTimeout(timer);
      event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);
    };
    const timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(new Error('Download helper unavailable.'));},30000);
    window.addEventListener('message',listener);
    window.postMessage({channel:'colab-extras-main',id,args},location.origin);
  });
}
async function managedDownload(job){
  const permission=await bridgeDownload({action:'permission'});
  if(!permission.granted)throw new Error('Enable managed downloads in the Colab Extras extension popup first.');
  const response=await request(job.ctx,'/files/'+encodePath(job.result.archive));
  const blob=await response.blob();
  if(job.cancelled)throw new Error('Cancelled.');
  const url=URL.createObjectURL(blob);
  try{
    const result=await bridgeDownload({action:'download',url,name:job.result.archive.split('/').pop(),operation:job.result.undo});
    job.downloadId=result.id;
  }finally{
    // downloads.download resolves when Chrome has accepted the request.
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
}
function nativeBody(options){
  if(options.body===undefined)return {};
  if(typeof options.body!=='string')throw new Error('This file operation cannot be protected by Undo. No changes were made.');
  return JSON.parse(options.body);
}
function hookNativeFiles(){
  let ctx;
  try{ctx=context();}catch{return;}
  if(undoRuntime!==ctx.runtime){
    undoRuntime=ctx.runtime;uploadTransactions.clear();locationHistory.length=0;folderHistory.length=0;currentLocation=null;runtimeHistory=null;historyDirty=true;nextHistoryCheck=0;
  }
  const files=document.querySelector('colab-file-browser')?.currentTree?.files;
  if(files&&files.cfzUndoWrite!==ctx.runtime&&typeof files.write==='function'){
    files.cfzUndoWrite=ctx.runtime;
    // Colab's current writer sends numbered chunks with no final -1 marker.
    // Own this complete call so completion/cancellation cannot be guessed.
    files.write=(parent,name,buffer,progress)=>serialUndo(async()=>{
      if(jobs.size)throw new Error('Wait for the active Colab Extras operation.');
      const path=deletionPath('/'+[parent,name].filter(Boolean).join('/').replace(/^\/+/,''));
      let id;
      undoBusy=true;
      try{
        const bytes=new Uint8Array(buffer);
        const count=Math.max(1,Math.ceil(bytes.length/1048576));
        for(let i=0;i<count;i++){
          if(progress?.canceled)throw new Error('Upload cancelled.');
          const slice=bytes.subarray(i*1048576,(i+1)*1048576);
          let binary='';
          for(let offset=0;offset<slice.length;offset+=8192)binary+=String.fromCharCode(...slice.subarray(offset,offset+8192));
          const result=await recoveryCall({action:'native',method:'PUT',path,id,
            label:'Upload / replace: '+name,
            body:{type:'file',format:'base64',content:btoa(binary),...(count>1?{chunk:i===0?1:i===count-1?-1:i+1}:{})}},ctx);
          id=result.id;
          progress?.update?.((i+1)/count);
        }
        if(progress?.canceled)throw new Error('Upload cancelled.');
        return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});
      }catch(error){
        if(id)try{await recoveryCall({action:'undo',id},ctx);}catch{}
        throw error;
      }finally{undoBusy=false;}
    });
  }
  if(ctx.xhr.cfzUndoRuntime===ctx.runtime)return;
  const original=ctx.xhr.cfzOriginalFetch||ctx.xhr.fetch.bind(ctx.xhr);
  ctx.xhr.cfzUndoRuntime=ctx.runtime;
  ctx.xhr.cfzOriginalFetch=original;
  ctx.xhr.fetch=function(url,options={}){
    const method=(options.method||'GET').toUpperCase();
    if(options[internalRequest]||!['PUT','POST','PATCH','DELETE'].includes(method)||typeof url!=='string')return original(url,options);
    let path;
    try{
      const parsed=new URL(url,location.origin);
      if(!parsed.pathname.startsWith('/api/contents/'))return original(url,options);
      path='/'+decodeURIComponent(parsed.pathname.slice('/api/contents/'.length));
      if(path!=='/content'&&!path.startsWith('/content/'))return original(url,options);
      if(method==='POST'){
        normalizePath(path);
        if(path.split('/').some(p=>p.startsWith('.colab-folder-zip-')))throw new Error('Recovery folders are protected.');
      }else deletionPath(path);
    }catch(error){return Promise.reject(error);}
    return serialUndo(async()=>{
      assertRuntime(ctx);
      if(jobs.size)throw new Error('Wait for the active Colab Extras operation before changing files.');
      undoBusy=true;
      try{
        const body=nativeBody(options);
        const key=path;
        if(body.chunk===1&&uploadTransactions.has(key))throw new Error('An upload is already active for this path.');
        const prior=body.chunk!==undefined&&body.chunk!==1?uploadTransactions.get(key):undefined;
        if(body.chunk!==undefined&&body.chunk!==1&&!prior)throw new Error('Upload history is unavailable; restart the upload.');
        const label=method==='DELETE'?'Delete: ':method==='PATCH'?'Rename / move: ':body.copy_from?'Copy: ':body.type==='directory'?'Create folder: ':'Upload / replace: ';
        const result=await recoveryCall({action:'native',method,path,body,id:prior,label:label+path.split('/').pop()},ctx);
        if(result.state==='pending')uploadTransactions.set(key,result.id);else uploadTransactions.delete(key);
        if(method==='DELETE')return new Response(null,{status:204});
        if(result.state==='pending'){
          return new Response(JSON.stringify({name:path.split('/').pop(),path:path.slice(1),type:body.type||'file',
            format:null,content:null,writable:true,created:new Date().toISOString(),last_modified:new Date().toISOString(),size:0}),
            {status:200,headers:{'Content-Type':'application/json'}});
        }
        return original('/api/contents/'+encodePath(result.path)+'?content=0',{method:'GET'});
      }finally{undoBusy=false;}
    });
  };
}
async function runRecoverableDelete(target){
  let path;
  try{path=deletionPath(target.path);}catch(error){window.alert(error.message);return;}
  if(jobs.size||undoBusy)return;
  if(!window.confirm(`Move this folder and its contents to Colab Extras recovery storage?\n\n${path}\n\nUndo can restore it while this runtime and its recovery data remain available. Retained files still use disk space.`))return;
  const job={kind:'delete',path,view:target.view,id:crypto.randomUUID()};
  jobs.set(path,job);setStatus(job,'Moving to recovery…');
  try{
    await serialUndo(()=>recoveryCall({action:'native',method:'DELETE',path,label:'Delete folder: '+path.split('/').pop()}));
    finishStatus(job,'Folder recoverable','Use Undo beside Refresh to restore it.');
    await document.querySelector('colab-file-browser')?.currentTree?.refresh?.();
  }catch(error){finishStatus(job,'Delete failed',error.message,true);}
  finally{jobs.delete(path);addMenuItems();}
}
async function runFileAction(target,action){
  let path,body,method='PATCH';
  try{
    path=deletionPath(target.path);
    if(jobs.size||undoBusy)throw new Error('Wait for the active operation to finish.');
    if(action==='newfolder'){
      const name=window.prompt('New folder name:');
      if(name===null)return;
      if(!name||/[\\/]/.test(name)||name==='.'||name==='..')throw new Error('Enter a folder name, without a path.');
      method='POST';body={type:'directory',name};
    }else{
      const destination=window.prompt(action==='copy'?'Copy into this existing folder:':action==='rename'?'New name:':'Move to this full destination path:',action==='rename'?path.split('/').pop():path.slice(0,path.lastIndexOf('/')));
      if(destination===null)return;
      if(action==='copy'){
        body={copy_from:path.slice(1)};path=normalizePath(destination);method='POST';
      }else{
        const dest=action==='rename'?path.slice(0,path.lastIndexOf('/')+1)+destination:destination;
        body={path:deletionPath(dest).slice(1)};
      }
    }
    undoBusy=true;
    await serialUndo(()=>recoveryCall({action:'native',method,path,body,label:action+': '+target.path.split('/').pop()}));
    await document.querySelector('colab-file-browser')?.currentTree?.refresh?.();
  }catch(error){window.alert(error.message);}
  finally{undoBusy=false;}
}
function observeLocation(){
  const browser=document.querySelector('colab-file-browser');
  const tree=browser?.currentTree;
  // Colab versions expose the displayed tree root on one of these properties.
  const candidate=tree?.files?.rootPath;
  if(typeof candidate!=='string')return;
  const path='/'+candidate.replace(/^\/+/,'');
  if(currentLocation&&currentLocation.path!==path&&!navigatingBack){
    locationHistory.push({...currentLocation,time:Date.now()});
    if(locationHistory.length>100)locationHistory.shift();
  }
  currentLocation={path};
  updateUndoButton();
}
async function previousLocation(){
  const previous=locationHistory[locationHistory.length-1];
  const browser=document.querySelector('colab-file-browser');
  if(!previous)throw new Error('No previous sidebar location in this tab.');
  const tree=browser?.currentTree;
  if(!tree?.files?.getFile||!tree.refresh)throw new Error('The Files sidebar is unavailable.');
  const startingPath=tree.files.rootPath;
  const folder=await tree.files.getFile(previous.path);
  if(!folder.isDirectory)throw new Error('The previous folder is no longer available.');
  if(locationHistory[locationHistory.length-1]!==previous||tree.files.rootPath!==startingPath)throw new Error('The sidebar location changed. Click Undo again.');
  navigatingBack=true;
  try{tree.files.rootPath=previous.path.slice(1);await tree.refresh();locationHistory.pop();currentLocation={path:previous.path};}
  finally{navigatingBack=false;}
}
function changeUndoPreference(key,value){
  if(jobs.size||undoBusy)throw new Error('Wait for the active operation to finish.');
  if(!Object.hasOwn(undoDefaults,key)||typeof value!=='boolean')throw new Error('Unknown setting.');
  if(undoPreferences[key]===value)return;
  const next={...undoPreferences,[key]:value};
  localStorage.setItem(undoPreferencesKey,JSON.stringify(next));
  settingHistory.push({before:{...undoPreferences},time:Date.now()});
  undoPreferences=next;updateUndoButton();
}
function restoreUndoSettings(){
  const previous=settingHistory[settingHistory.length-1];
  if(!previous)throw new Error('No settings changes to undo in this tab.');
  localStorage.setItem(undoPreferencesKey,JSON.stringify(previous.before));
  undoPreferences=previous.before;settingHistory.pop();
}
function undoFeedback(text,error=false){
  if(!error){
    clearTimeout(undoFeedbackTimer);
    const previous=document.querySelector('[data-cfz-undo-feedback]');
    if(previous)previous.hidden=true;
    return;
  }
  const button=document.querySelector('[data-cfz-undo-button]');
  if(!button)return;
  let message=document.querySelector('[data-cfz-undo-feedback]');
  if(!message){
    message=element('div');message.dataset.cfzUndoFeedback='';
    message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    message.style.cssText='font:12px/1.5 Roboto,Arial,sans-serif;margin:6px 12px;overflow-wrap:anywhere;';
    button.parentElement.after(message);
  }
  clearTimeout(undoFeedbackTimer);message.hidden=false;message.textContent=text;
  message.style.color=error?'var(--colab-error-color,#b3261e)':'var(--colab-secondary-text-color,inherit)';
  if(error)undoFeedbackTimer=null;
  else undoFeedbackTimer=setTimeout(()=>{message.hidden=true;},10000);
}
function newestUndoAction(records,localActions,serverTime,receivedAt){
  // Compare runtime journal times with tab actions without relying on the
  // runtime and laptop clocks being identical.
  const offset=Number.isFinite(serverTime)?receivedAt-serverTime*1000:0;
  const actions=records.map(record=>({kind:'file',record,time:record.time*1000+offset}));
  actions.push(...localActions);
  return actions.sort((a,b)=>b.time-a.time)[0];
}
async function undoLastAction(){
  if(undoClickPending)return;
  if(jobs.size||undoBusy){undoFeedback('Wait for the active operation to finish.');return;}
  undoClickPending=true;undoBusy=true;
  updateUndoButton();
  undoFeedback('Undoing the last action…');
  try{
    hookNativeFiles();
    observeLocation();
    const setting=settingHistory[settingHistory.length-1],location=locationHistory[locationHistory.length-1],folder=folderHistory[folderHistory.length-1];
    const localActions=[];
    if(setting)localActions.push({kind:'setting',entry:setting,time:setting.time});
    if(location)localActions.push({kind:'location',entry:location,time:location.time});
    if(folder)localActions.push({kind:'folder',entry:folder,time:folder.time});
    await serialUndo(async()=>{
      if(jobs.size)throw new Error('Wait for the active operation to finish.');
      undoBusy=true;
      const ctx=context();
      let history=runtimeHistory;
      // A folder toggle needs no runtime round trip once file history is known.
      if(!history||historyDirty)history=await recoveryCall({action:'list'},ctx);
      else{
        const candidate=newestUndoAction(history.records,localActions,history.server_time,history.receivedAt);
        if(candidate?.kind==='file')history=await recoveryCall({action:'list'},ctx);
      }
      runtimeHistory=history;historyDirty=false;
      assertRuntime(ctx);
      const latest=newestUndoAction(history.records,localActions,history.server_time,history.receivedAt??Date.now());
      if(!latest){undoFeedback('Nothing to undo.');return;}
      if(latest.kind==='setting'){
        if(settingHistory[settingHistory.length-1]!==latest.entry)throw new Error('Settings changed. Click Undo again.');
        restoreUndoSettings();undoFeedback('Undone: settings change.');
      }else if(latest.kind==='location'){
        if(locationHistory[locationHistory.length-1]!==latest.entry)throw new Error('The sidebar location changed. Click Undo again.');
        await previousLocation();undoFeedback('Returned to '+currentLocation.path+'.');
      }else if(latest.kind==='folder'){
        await restoreFolderAction(latest.entry);
        undoFeedback((latest.entry.before?'Reopened: ':'Closed: ')+latest.entry.path+'.');
      }else{
        const result=await recoveryCall({action:'undo',id:latest.record.id},ctx);
        if(!result.conflicts.length)runtimeHistory.records=runtimeHistory.records.filter(record=>record.id!==latest.record.id);
        try{await document.querySelector('colab-file-browser')?.currentTree?.refresh?.();}catch{}
        if(result.conflicts.length){
          undoFeedback('Could not fully undo '+latest.record.label+'. Later changes were preserved: '+result.conflicts.map(c=>c.path+' — '+c.reason).join('; '),true);
        }else undoFeedback('Undone: '+latest.record.label+'.');
      }
    });
  }catch(error){undoFeedback(error.message||'Undo could not finish.',true);}
  finally{
    undoBusy=false;undoClickPending=false;
    updateUndoButton();
  }
}
function element(tag,text){
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  return node;
}
function installUndoButton(){
  const refresh=document.querySelector('.file-tree-refresh');
  if(!refresh||document.querySelector('[data-cfz-undo-button]'))return;
  const button=document.createElement('md-icon-button');
  button.dataset.cfzUndoButton='';button.className='cfz-undo-button';
  button.setAttribute('touch-target','none');button.setAttribute('title','Undo last action');
  button.setAttribute('data-aria-label','Undo last action');
  const style=document.createElement('style');style.textContent=`
    [data-cfz-undo-button][aria-busy="true"] > md-icon{animation:cfz-undo-rotate .9s linear infinite;transform-origin:center}
    @keyframes cfz-undo-rotate{from{transform:rotate(0deg) scaleX(-1)}to{transform:rotate(-360deg) scaleX(-1)}}
    @media(prefers-reduced-motion:reduce){[data-cfz-undo-button][aria-busy="true"] > md-icon{animation:none}}
  `;
  const icon=document.createElement('md-icon');icon.setAttribute('aria-hidden','true');
  icon.textContent='refresh';icon.style.transform='scaleX(-1)';button.append(style,icon);
  button.addEventListener('click',async event=>{if(event.isTrusted&&button.getAttribute('aria-disabled')!=='true')await undoLastAction();});
  refresh.after(button);updateUndoButton();
}
function markUndoHistoryDirty(){historyDirty=true;nextHistoryCheck=0;updateUndoButton();}
function updateUndoButton(){
  const button=document.querySelector('[data-cfz-undo-button]');
  if(!button)return;
  const hasHistory=Boolean(settingHistory.length||locationHistory.length||folderHistory.length||runtimeHistory?.records.length);
  const disabled=!hasHistory||undoBusy||undoClickPending||jobs.size>0||historyLoading;
  // Follow the actual Undo click, not unrelated file work or history checks.
  // Recreated toolbar buttons also inherit the current animation state.
  if(undoClickPending)button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy');
  button.disabled=Boolean(disabled);
  if(disabled)button.setAttribute('disabled','');else button.removeAttribute('disabled');
  button.setAttribute('aria-disabled',String(Boolean(disabled)));
  button.style.color=undoClickPending?'var(--colab-primary-color,#1a73e8)':disabled?'var(--colab-secondary-text-color,#9aa0a6)':'';
  button.style.opacity=disabled&&!undoClickPending?'0.38':'1';
  button.style.cursor=disabled?'default':'pointer';
  button.title=undoClickPending?'Undoing the last action…':undoBusy||jobs.size?'Undo unavailable while an operation is running':
    historyLoading?'Checking Undo history':hasHistory?'Undo last action':'Nothing to undo';
}
async function refreshUndoAvailability(){
  if(historyLoading||!historyDirty||undoBusy||jobs.size||Date.now()<nextHistoryCheck)return;
  let ctx;try{ctx=context();}catch{return;}
  historyLoading=true;updateUndoButton();
  try{await serialUndo(async()=>{
    if(jobs.size||undoBusy)return;
    const history=await recoveryCall({action:'list'},ctx);
    assertRuntime(ctx);runtimeHistory=history;historyDirty=false;
  });}catch{nextHistoryCheck=Date.now()+15000;}
  finally{historyLoading=false;updateUndoButton();}
}
function folderViewPath(view){
  const file=view?.getFile?.()||view?.file;
  return file?.isDirectory&&typeof file.path==='string'?'/'+file.path.replace(/^\/+/,''):null;
}
function openFolderPaths(view){
  return [...view.querySelectorAll('colab-file-view')].filter(child=>folderViewPath(child)&&!child.classList.contains('collapsed')).map(folderViewPath);
}
function captureFolderAction(event){
  if(!event.isTrusted||restoringFolder)return;
  if(event.type==='keydown'&&!['Enter',' ','ArrowLeft','ArrowRight'].includes(event.key))return;
  const target=event.target;
  const row=target.closest?.('.file-title-row'),view=row?.closest('colab-file-view');
  if(!view||row.closest('colab-file-view')!==view||target.closest('button,md-icon-button,input,.menu-button,[data-cfz-status]'))return;
  const path=folderViewPath(view);if(!path||pendingFolderActions.has(view))return;
  if(undoBusy||undoClickPending){event.preventDefault();event.stopImmediatePropagation();return;}
  const before=!view.classList.contains('collapsed'),expanded=openFolderPaths(view),time=Date.now();
  pendingFolderActions.add(view);
  // Browser microtasks may run between capture and target listeners. Defer to
  // the next task so Colab has toggled its class before comparing the state.
  setTimeout(()=>{
    pendingFolderActions.delete(view);
    if(!view.isConnected||restoringFolder)return;
    const after=!view.classList.contains('collapsed');
    if(before===after)return;
    folderHistory.push({path,before,after,expanded,time});
    if(folderHistory.length>100)folderHistory.shift();
    updateUndoButton();
  },0);
}
function findFolderView(path){
  return [...document.querySelectorAll('colab-file-view')].find(view=>folderViewPath(view)===path);
}
async function setFolderOpen(view,open){
  if(!view||typeof view.refresh!=='function')throw new Error('This folder is no longer available in the sidebar.');
  if(open){view.classList.remove('collapsed');await view.refresh();}
  else{
    view.classList.add('collapsed');
    const children=[...view.children].find(child=>child.classList.contains('child-files'));
    children?.replaceChildren();view.childViews=[];
  }
}
async function restoreFolderAction(action){
  if(folderHistory[folderHistory.length-1]!==action)throw new Error('The folder state changed. Click Undo again.');
  const view=findFolderView(action.path);
  if(!view)throw new Error('This folder is no longer visible. Its Undo action was retained.');
  restoringFolder=true;
  try{
    await setFolderOpen(view,action.before);
    if(action.before)for(const path of [...action.expanded].sort((a,b)=>a.split('/').length-b.split('/').length)){
      const child=findFolderView(path);
      if(!child)throw new Error('A previously open subfolder is no longer available: '+path);
      await setFolderOpen(child,true);
    }
    folderHistory.pop();
  }finally{restoringFolder=false;}
}
function preferencesRequest(args){
  if(args.action==='set')changeUndoPreference(args.key,args.value);
  else if(args.action!=='get')throw new Error('Unknown settings request.');
  return {...undoPreferences};
}
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='colab-extras-preferences')return;
  const {id,args}=event.data;if(typeof id!=='string')return;
  try{window.postMessage({channel:'colab-extras-preferences-result',id,result:preferencesRequest(args)},location.origin);}
  catch(error){window.postMessage({channel:'colab-extras-preferences-result',id,error:error.message},location.origin);}
});
const undoObserver=new MutationObserver(()=>{installUndoButton();hookNativeFiles();observeLocation();updateUndoButton();});
undoObserver.observe(document.body,{childList:true,subtree:true});
document.addEventListener('click',captureFolderAction,true);
document.addEventListener('keydown',captureFolderAction,true);
installUndoButton();hookNativeFiles();observeLocation();void refreshUndoAvailability();
const undoTimer=setInterval(()=>{hookNativeFiles();observeLocation();updateUndoButton();void refreshUndoAvailability();},1500);
window.addEventListener('pagehide',()=>{undoObserver.disconnect();clearInterval(undoTimer);document.removeEventListener('click',captureFolderAction,true);document.removeEventListener('keydown',captureFolderAction,true);},{once:true});
