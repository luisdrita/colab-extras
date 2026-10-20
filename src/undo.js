// File recovery is runtime-scoped; navigation and preferences are tab-scoped.
const undoPreferencesKey='colab-extras-preferences-v1';
const undoDefaults={overwrite:false,managedDownloads:false};
let undoPreferences={...undoDefaults};
try{Object.assign(undoPreferences,JSON.parse(localStorage.getItem(undoPreferencesKey)||'{}'));}catch{}
const settingHistory=[];
let undoQueue=Promise.resolve(),undoBusy=false,undoDialog=null,undoRuntime=null;
let undoClickPending=false,undoFeedbackTimer=null;
const uploadTransactions=new Map();
const locationHistory=[];
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
      if(args.action==='list')result.receivedAt=Date.now();
      return result;
    }
  }finally{
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
    undoRuntime=ctx.runtime;uploadTransactions.clear();locationHistory.length=0;currentLocation=null;
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
  const next={...undoPreferences,[key]:Boolean(value)};
  localStorage.setItem(undoPreferencesKey,JSON.stringify(next));
  settingHistory.push({before:{...undoPreferences},time:Date.now()});
  undoPreferences=next;
}
function restoreUndoSettings(){
  const previous=settingHistory[settingHistory.length-1];
  if(!previous)throw new Error('No settings changes to undo in this tab.');
  localStorage.setItem(undoPreferencesKey,JSON.stringify(previous.before));
  undoPreferences=previous.before;settingHistory.pop();
}
function undoFeedback(text,error=false){
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
  const button=document.querySelector('[data-cfz-undo-button]');
  button?.setAttribute('disabled','');button?.setAttribute('aria-busy','true');
  undoFeedback('Undoing the last action…');
  try{
    hookNativeFiles();
    observeLocation();
    const setting=settingHistory[settingHistory.length-1],location=locationHistory[locationHistory.length-1];
    const localActions=[];
    if(setting)localActions.push({kind:'setting',entry:setting,time:setting.time});
    if(location)localActions.push({kind:'location',entry:location,time:location.time});
    await serialUndo(async()=>{
      if(jobs.size)throw new Error('Wait for the active operation to finish.');
      undoBusy=true;
      const ctx=context();
      const history=await recoveryCall({action:'list'},ctx);
      assertRuntime(ctx);
      const latest=newestUndoAction(history.records,localActions,history.server_time,history.receivedAt??Date.now());
      if(!latest){undoFeedback('Nothing to undo.');return;}
      if(latest.kind==='setting'){
        if(settingHistory[settingHistory.length-1]!==latest.entry)throw new Error('Settings changed. Click Undo again.');
        restoreUndoSettings();undoFeedback('Undone: settings change.');
      }else if(latest.kind==='location'){
        if(locationHistory[locationHistory.length-1]!==latest.entry)throw new Error('The sidebar location changed. Click Undo again.');
        await previousLocation();undoFeedback('Returned to '+currentLocation.path+'.');
      }else{
        const result=await recoveryCall({action:'undo',id:latest.record.id},ctx);
        try{await document.querySelector('colab-file-browser')?.currentTree?.refresh?.();}catch{}
        if(result.conflicts.length){
          undoFeedback('Could not fully undo '+latest.record.label+'. Later changes were preserved: '+result.conflicts.map(c=>c.path+' — '+c.reason).join('; '),true);
        }else undoFeedback('Undone: '+latest.record.label+'.');
      }
    });
  }catch(error){undoFeedback(error.message||'Undo could not finish.',true);}
  finally{
    undoBusy=false;undoClickPending=false;
    button?.removeAttribute('disabled');button?.removeAttribute('aria-busy');
  }
}
function element(tag,text){
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  return node;
}
function undoMessage(dialog,text){
  dialog.querySelector('[data-cfz-undo-message]').textContent=text;
}
async function showUndo(){
  if(undoDialog?.isConnected){undoDialog.focus();return;}
  const dialog=element('dialog');undoDialog=dialog;
  dialog.style.cssText='background:var(--colab-primary-surface-color,#fff);color:var(--colab-primary-text-color,#202124);border:1px solid var(--colab-border-color,#dadce0);border-radius:16px;max-width:560px;width:calc(100vw - 64px);max-height:75vh;padding:24px;font:14px/1.5 Roboto,Arial,sans-serif;';
  dialog.setAttribute('aria-label','Colab Extras history and settings');
  dialog.append(element('h2','History and settings'));
  dialog.append(element('p','Restore file changes made while Colab Extras is active. Recovery data stays in this runtime and uses disk space. Later edits are preserved.'));
  const message=element('p','Loading recovery history…');message.dataset.cfzUndoMessage='';message.setAttribute('role','status');dialog.append(message);
  const list=element('div');list.dataset.cfzUndoList='';dialog.append(list);
  const button=(label,handler)=>{
    const b=element('button',label);b.type='button';
    b.style.cssText='font:inherit;padding:8px 12px;border:1px solid var(--colab-border-color,#dadce0);border-radius:8px;background:transparent;color:inherit;cursor:pointer;margin:4px;';
    b.addEventListener('click',async event=>{
      if(!event.isTrusted)return;
      b.disabled=true;
      try{await handler();}catch(error){undoMessage(dialog,error.message);}
      finally{b.disabled=false;}
    });return b;
  };
  const reload=async()=>{
    if(jobs.size||undoBusy){undoMessage(dialog,'Wait for the active operation to finish, then reopen history.');return;}
    const result=await serialUndo(()=>recoveryCall({action:'list'}));
    list.replaceChildren();
    undoMessage(dialog,result.records.length?'Choose an action to undo. Conflicting files are kept.':'No recoverable file changes in this runtime.');
    for(const record of result.records){
      const row=element('div');row.style.cssText='border-top:1px solid var(--colab-border-color,#dadce0);padding:8px 0;overflow-wrap:anywhere;';
      row.append(element('div',record.label),element('small',new Date(record.time*1000).toLocaleString()+' · '+record.state));
      for(const path of record.paths||[])row.append(element('div',path));
      if(record.count>5)row.append(element('small',`and ${record.count-5} more paths`));
      row.append(button('Undo this action',async()=>{
        if(jobs.size||undoBusy)throw new Error('Wait for the active operation.');
        undoBusy=true;
        undoMessage(dialog,'Checking files and restoring the previous state…');
        let result;
        try{
          result=await serialUndo(()=>recoveryCall({action:'undo',id:record.id}));
          await document.querySelector('colab-file-browser')?.currentTree?.refresh?.();
        }finally{undoBusy=false;}
        await reload();
        undoMessage(dialog,result.conflicts.length?'Preserved later changes: '+result.conflicts.map(c=>c.path+' — '+c.reason).join('; '):'Action undone. Browser downloads are managed separately in the extension popup.');
      }));
      list.append(row);
    }
  };
  dialog.append(button('Previous sidebar location',async()=>{await previousLocation();undoMessage(dialog,'Returned to '+currentLocation.path);}));
  const preferences=element('fieldset');preferences.append(element('legend','Colab Extras settings'));
  for(const [key,label] of [['overwrite','Allow extraction to replace existing files (originals are retained)'],['managedDownloads','Track downloads for optional cancellation/removal in the extension popup']]){
    const line=element('label');line.style.display='block';
    const input=element('input');input.type='checkbox';input.checked=Boolean(undoPreferences[key]);
    input.addEventListener('change',event=>{
      if(!event.isTrusted)return;
      try{changeUndoPreference(key,input.checked);}
      catch(error){input.checked=Boolean(undoPreferences[key]);undoMessage(dialog,error.message);}
    });
    line.append(input,document.createTextNode(' '+label));preferences.append(line);
  }
  preferences.append(button('Undo last settings change',async()=>{
    restoreUndoSettings();
    [...preferences.querySelectorAll('input')].forEach((input,i)=>input.checked=Boolean(undoPreferences[['overwrite','managedDownloads'][i]]));
    undoMessage(dialog,'Settings restored.');
  }));
  dialog.append(preferences,button('Close',async()=>dialog.close()));
  dialog.addEventListener('close',()=>{dialog.remove();undoDialog=null;});
  document.body.append(dialog);dialog.showModal();
  try{await reload();}catch(error){undoMessage(dialog,error.message);}
}
function installUndoButton(){
  const refresh=document.querySelector('.file-tree-refresh');
  if(!refresh||document.querySelector('[data-cfz-undo-button]'))return;
  const button=document.createElement('md-icon-button');
  button.dataset.cfzUndoButton='';button.className='cfz-undo-button';
  button.setAttribute('touch-target','none');button.setAttribute('title','Undo last action');
  button.setAttribute('data-aria-label','Undo last action');
  const icon=document.createElement('md-icon');icon.setAttribute('aria-hidden','true');
  icon.textContent='refresh';icon.style.transform='scaleX(-1)';button.append(icon);
  button.addEventListener('click',async event=>{if(event.isTrusted)await undoLastAction();});
  refresh.after(button);
}
const undoObserver=new MutationObserver(()=>{installUndoButton();hookNativeFiles();observeLocation();});
undoObserver.observe(document.body,{childList:true,subtree:true});
installUndoButton();hookNativeFiles();observeLocation();
const undoTimer=setInterval(()=>{hookNativeFiles();observeLocation();},1500);
window.addEventListener('pagehide',()=>{undoObserver.disconnect();clearInterval(undoTimer);},{once:true});
