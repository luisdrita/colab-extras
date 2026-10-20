// File mutations retain runtime-local recovery data.
if (document.querySelector('meta[name="colab-folder-zip-version"]')) return;
const marker=document.createElement('meta');
marker.name='colab-folder-zip-version';marker.content='0.9.3';document.head.append(marker);
const jobs=new Map();
let selected=null;
function context(){
  const notebook=window.colab?.global?.notebook;
  const kernel=notebook?.getKernel?.() || notebook?.kernel;
  const xhr=kernel?.getKernelXhr?.();
  if(!xhr || !kernel?.runtime)throw new Error('Connect to a Colab runtime first.');
  return {kernel,xhr,runtime:kernel.runtime};
}
function filePath(view){
  const file=view?.getFile?.() || view?.file;
  return typeof file?.path==='string' ? '/'+file.path.replace(/^\//,'') : null;
}
function folderPath(view){
  const file=view?.getFile?.() || view?.file;
  return file?.isDirectory ? filePath(view) : null;
}
function setStatus(job,label,detail=label,error=false,progress=null){
  job.status={label,detail,error,progress};
  // Keep feedback with its folder, including after Colab refreshes the file tree.
  const view=job.view?.isConnected ? job.view : [...document.querySelectorAll('colab-file-view')].find(v=>filePath(v)===job.path);
  if(!view)return;
  job.view=view;
  // A parent folder must never reuse a nested child's status badge.
  let badge=[...view.querySelectorAll('[data-cfz-status]')].find(node=>node.closest('colab-file-view')===view);
  if(!badge){
    badge=document.createElement('span');badge.dataset.cfzStatus='';
    const text=document.createElement('span');text.dataset.cfzStatusText='';
    text.setAttribute('role','status');text.setAttribute('aria-live','polite');
    text.style.cssText='min-width:0;overflow:hidden;text-overflow:ellipsis;';badge.append(text);
  }
  if(error){
    badge.style.cssText='display:block;margin:3px 8px 5px 24px;font-size:12px;line-height:1.4;font-family:inherit;white-space:normal;overflow-wrap:anywhere;';
    const children=[...view.children].find(node=>node.classList.contains('child-files'));
    if(badge.parentElement!==view)view.insertBefore(badge,children||null);
  }else{
    badge.style.cssText='display:inline-flex;align-items:center;gap:6px;margin-left:8px;font-size:12px;line-height:18px;font-family:inherit;white-space:nowrap;max-width:160px;min-width:18px;flex:0 1 auto;';
    const row=[...view.children].find(node=>node.classList.contains('file-title-row'))||view;
    if(badge.parentElement!==row)row.append(badge);
  }
  const text=badge.querySelector('[data-cfz-status-text]'),value=error?label+': '+detail:label;
  if(text.textContent!==value)text.textContent=value;
  badge.title=detail;
  badge.style.color=error?'var(--colab-error-color,#b3261e)':'var(--colab-secondary-text-color,inherit)';
  const busy=!error&&!job.finished&&jobs.get(job.path)===job;
  // Running actions show only the ring; its accessible label and the tooltip
  // retain the operation detail. Final results and errors stay readable.
  text.hidden=busy;
  if(busy){
    if(!badge.cfzProgress){badge.cfzProgress=createProgress(label);badge.prepend(badge.cfzProgress.element);}
    badge.cfzProgress.update(label,progress);
  }else if(badge.cfzProgress){badge.cfzProgress.element.remove();badge.cfzProgress=null;}
  badge.dataset.cfzJob=job.id;
  job.badge=badge;
}
function finishStatus(job,label,detail,error=false){
  job.finished=true;
  setStatus(job,label,detail,error);
  addMenuItems();
  if(!error)setTimeout(()=>{if(job.badge?.dataset.cfzJob===job.id)job.badge.remove();},10000);
}
async function cleanup(job){
  if(!job.created)return;
  // Only job staging files are removed. The saved sibling ZIP is retained.
  const names=['archive.py','extract_archive.py','delete_folder.py','folder_details.py','recovery.py','status.json','status.tmp','pid','cancel','archive.partial'];
  if(job.kind==='zip')names.push(job.path.split('/').pop()+'.zip');
  for(const name of names){
    try{await request(job.ctx,'/api/contents/'+encodePath(job.dir+'/'+name),'DELETE');}
    catch(error){if(error.status!==404)return;}
  }
  try{await request(job.ctx,'/api/contents/'+encodePath(job.dir),'DELETE');}catch{}
}
async function run(target,download){
  let path;
  try{path=deletionPath(target.path);}catch(error){setStatus(target,'ZIP failed',error.message,true);return;}
  if(jobs.size||undoBusy)return;
  const id=crypto.randomUUID();
  const job={kind:'zip',path,view:target.view,id,dir:'/content/.colab-folder-zip-'+id,cancelled:false,terminal:null};
  jobs.set(path,job);setStatus(job,'Zipping…');addMenuItems();
  try{
    job.ctx=context();const ctx=job.ctx;
    const folder=await (await request(ctx,'/api/contents/'+encodePath(path)+'?content=0')).json();
    if(folder.type!=='directory')throw new Error('The selected path is not a folder.');
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal=await openTerminal(ctx);
    await request(ctx,'/api/contents/'+encodePath(job.dir),'PUT',{type:'directory'});job.created=true;
    await put(ctx,job.dir+'/archive.py',archiveSource);
    await put(ctx,job.dir+'/recovery.py',recoverySource);
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal.send(`python3 -B ${quote(job.dir+'/archive.py')} ${quote(path)} ${quote(job.dir)} --undo\n`);
    job.started=true;
    let misses=0,cancelSent=false;
    while(true){
      await sleep(750);
      if(job.cancelled && !cancelSent){await put(ctx,job.dir+'/cancel','cancel');cancelSent=true;}
      let response;
      try{response=await request(ctx,'/files/'+encodePath(job.dir+'/status.json')+'?t='+Date.now());}
      catch(error){
        if(error.status===404 && ++misses<30)continue;
        if(error.status===404)throw new Error('Compression did not start. This runtime needs Python 3.8 or later.');
        throw error;
      }
      const result=await response.json();
      if(result.state==='error'){job.settled=true;throw new Error(result.error||'Compression failed.');}
      if(result.state==='cancelled'){job.settled=true;throw new Error('Cancelled.');}
      if(result.state==='ready'){validateArchive(result,path);job.result=result;job.settled=true;break;}
      if(!['scanning','compressing','saving'].includes(result.state))throw new Error('Unexpected compression status.');
      const label=result.state==='saving'?'Saving ZIP':'Zipping';
      const fraction=Number.isFinite(result.done)&&Number.isFinite(result.total)&&result.total>0?Math.min(1,Math.max(0,result.done/result.total)):null;
      setStatus(job,fraction!==null?`${label} ${Math.round(fraction*100)}%`:`${label}…`,undefined,false,fraction);
    }
    await job.terminal.close();job.terminal=null;
    const tree=document.querySelector('colab-file-browser')?.currentTree;
    // Make the newly saved sibling archive appear in the Files sidebar.
    try{await tree?.refresh?.();}catch{}
    if(job.cancelled)throw new Error('Cancelled.');
    if(download){
      if(undoPreferences.managedDownloads){
        setStatus(job,'Starting tracked download…',job.result.archive);
        await managedDownload(job);
      }else{
        const files=document.querySelector('colab-file-browser')?.currentTree?.files;
        if(!files?.getFile)throw new Error('ZIP saved, but Colab file download is unavailable.');
        setStatus(job,'Downloading…',job.result.archive);
        const file=await files.getFile(job.result.archive);
        assertRuntime(ctx);
        if(job.cancelled)throw new Error('Cancelled.');
        await file.download({
          get canceled(){return job.cancelled;},
          update:n=>{
            const fraction=Number.isFinite(n)?Math.min(1,Math.max(0,n)):null;
            setStatus(job,fraction!==null?`Downloading ${Math.round(fraction*100)}%`:'Downloading…',job.result.archive,false,fraction);
          }
        });
      }
      if(job.cancelled)throw new Error('Cancelled.');
    }
    finishStatus(job,download?'Download started':'ZIP ready','Saved '+job.result.archive);
  }catch(error){
    let rollbackDetail='';
    if(job.cancelled&&job.result?.undo){
      try{
        const recovered=await recoveryCall({action:'undo',id:job.result.undo},job.ctx);
        if(recovered.conflicts.length)rollbackDetail=' Later changes were preserved; resolve the conflict and click Undo again.';
        else job.result=null;
      }catch(rollbackError){rollbackDetail=' Recovery could not finish: '+rollbackError.message;}
    }
    const suffix=job.result?' ZIP remains at '+job.result.archive+'. Use Undo to remove it.':'';
    const label=job.cancelled?'ZIP cancelled':job.result&&download?'Download failed':'ZIP failed';
    finishStatus(job,label,(error.message||'The connection to Colab was lost.')+suffix+rollbackDetail,!job.cancelled||Boolean(rollbackDetail));
  }finally{
    await job.terminal?.close();
    // Completed jobs are safe to clean. A lost connection can leave a
    // process alive, so retain incomplete staging files for diagnosis.
    if(job.result||job.settled||(job.created&&!job.started))await cleanup(job);
    jobs.delete(path);markUndoHistoryDirty();addMenuItems();
  }
}
function cancelJob(path){
  const job=jobs.get(path);
  // Cleanup keeps the operation lock, but a completed result must not
  // accept a stale Cancel click or replace its final status.
  if(!job||job.finished)return;
  job.cancelled=true;setStatus(job,'Cancelling…');
}
function capture(event){
  if(!event.isTrusted)return;
  const view=event.composedPath().find(node=>node?.localName==='colab-file-view');
  if(!view)return;
  const path=filePath(view);const file=view.getFile?.()||view.file;
  selected=path?{path,name:file.name,view,isDirectory:Boolean(file.isDirectory)}:null;
  if(!selected)document.querySelectorAll('[data-cfz-action]').forEach(item=>item.remove());
  setTimeout(addMenuItems,0);
}
document.addEventListener('contextmenu',capture,true);
document.addEventListener('click',event=>{
  if(event.composedPath().some(node=>node?.classList?.contains('menu-button')))capture(event);
},true);
function addMenuItems(){
  if(!selected)return;
  const menus=[...document.querySelectorAll('[role="menu"][aria-label]')].filter(menu=>
    menu.getBoundingClientRect().width>0 && (menu.getAttribute('aria-label')||'').endsWith(': '+selected.name));
  for(const menu of menus){
    if(!menu.cfzKeyboardFocus){
      menu.cfzKeyboardFocus=true;
      // Keep Closure's menu open when keyboard focus enters an added action.
      menu.addEventListener('blur',event=>{
        const next=event.relatedTarget;
        if(next?.closest?.('[data-cfz-action]')?.parentElement===menu)event.stopImmediatePropagation();
      },true);
    }
    const currentJob=jobs.get(selected.path);
    const running=currentJob?.finished?null:currentJob?.kind;
    const actions=selected.isDirectory
      ? [['details','Folder details'],['zip','ZIP only'],['download','ZIP and download'],...(running==='zip'?[['cancel','Cancel ZIP']]:[]),['delete','Delete folder and contents…']]
      : [...(isExtractable(selected.path)?[['extract','Extract here']]:[]),...(running==='extract'?[['cancel','Cancel extraction']]:[])];
    actions.push(['move','Move…'],['copy','Copy…']);
    for(const old of menu.querySelectorAll('[data-cfz-action]'))if(!actions.some(([action])=>action===old.dataset.cfzAction))old.remove();
    for(const [action,label] of actions){
      let button=menu.querySelector(`[data-cfz-action="${action}"]`);
      if(!button){
        button=document.createElement('div');button.dataset.cfzAction=action;
        button.setAttribute('role','menuitem');button.tabIndex=0;button.className='goog-menuitem';
        const content=document.createElement('div');content.className='goog-menuitem-content';content.textContent=label;button.append(content);
        button.style.cursor='pointer';
        if(action==='delete'){button.style.borderTop='1px solid #dadce0';button.style.marginTop='4px';}
        button.addEventListener('mouseenter',()=>button.classList.add('goog-menuitem-highlight'));
        button.addEventListener('mouseleave',()=>button.classList.remove('goog-menuitem-highlight'));
        // Colab's Closure popup disposes itself on blur. Its own menu items
        // suppress focus transfer on mouse-down, but our added DOM items did
        // not. Prevent it before the compatibility mouse event so the item
        // survives until click. No job starts from a hover or a right-click.
        const keepMenuFocused=event=>{
          if(event.button!==0)return;
          event.preventDefault();event.stopPropagation();
        };
        button.addEventListener('pointerdown',keepMenuFocused);
        button.addEventListener('mousedown',keepMenuFocused);
        button.addEventListener('blur',event=>{
          if(!menu.contains(event.relatedTarget))menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
        });
        const launch=event=>{
          if(!event.isTrusted || button.getAttribute('aria-disabled')==='true')return;
          event.preventDefault();event.stopPropagation();
          const target={path:button.dataset.cfzPath,view:button.cfzView};
          menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
          if(action==='cancel'){
            cancelJob(target.path);
          }else if(action==='details')void runDetails(target);
          else if(action==='delete')void runRecoverableDelete(target);
          else if(['rename','move','copy','newfolder'].includes(action))void runFileAction(target,action);
          else if(action==='extract')void runExtract(target);
          else void run(target,action==='download');
        };
        button.addEventListener('click',launch);
        button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')launch(event);});
        menu.append(button);
      }
      button.dataset.cfzPath=selected.path;button.cfzView=selected.view;
      const content=button.querySelector('.goog-menuitem-content');if(content.textContent!==label)content.textContent=label;
      let reason='';
      if(action==='delete'){try{deletionPath(selected.path);}catch(error){reason=error.message;}}
      if(action==='extract'){try{extractionPath(selected.path);}catch(error){reason=error.message;}}
      const disabled=action!=='cancel' && (Boolean(reason)||jobs.size>0||undoBusy);
      button.title=reason || (disabled?'Wait for the current operation in this location to finish.':action==='extract'?'Extract beside this archive. Replacement follows your extraction settings.':'');
      if(action==='delete')button.style.color=disabled?'':'#d93025';
      button.setAttribute('aria-disabled',String(disabled));button.classList.toggle('goog-menuitem-disabled',disabled);
    }
  }
}
const observer=new MutationObserver(()=>{
  addMenuItems();
  // Colab replaces rows during refresh. Restore an active ring even while
  // waiting for a backend request that is not producing progress callbacks.
  for(const job of jobs.values())if(!job.finished&&job.status&&!job.badge?.isConnected){
    const {label,detail,error,progress}=job.status;setStatus(job,label,detail,error,progress);
  }
});
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
