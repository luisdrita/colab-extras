// ZIP actions are immediate. Permanent deletion requires an exact-path confirmation.
if (document.querySelector('meta[name="colab-folder-zip-version"]')) return;
const marker=document.createElement('meta');
marker.name='colab-folder-zip-version';marker.content='0.6.2';document.head.append(marker);
const jobs=new Map();
let selected=null;
function context(){
  const notebook=window.colab?.global?.notebook;
  const kernel=notebook?.getKernel?.() || notebook?.kernel;
  const xhr=kernel?.getKernelXhr?.();
  if(!xhr || !kernel?.runtime)throw new Error('Connect to a Colab runtime first.');
  return {kernel,xhr,runtime:kernel.runtime};
}
function folderPath(view){
  const file=view?.getFile?.() || view?.file;
  return file?.isDirectory && typeof file.path==='string' ? '/'+file.path.replace(/^\//,'') : null;
}
function setStatus(job,label,detail=label,error=false){
  // Keep feedback with its folder, including after Colab refreshes the file tree.
  const view=job.view?.isConnected ? job.view : [...document.querySelectorAll('colab-file-view')].find(v=>folderPath(v)===job.path);
  if(!view)return;
  job.view=view;
  let badge=view.querySelector('[data-cfz-status]');
  if(!badge){
    badge=document.createElement('span');badge.dataset.cfzStatus='';
    badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');
  }
  if(error){
    badge.style.cssText='display:block;margin:3px 8px 5px 24px;font:12px/1.4 system-ui;white-space:normal;overflow-wrap:anywhere;';
    view.insertBefore(badge,view.querySelector('.child-files'));
  }else{
    badge.style.cssText='margin-left:8px;font:11px/1.4 system-ui;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;flex-shrink:1;';
    (view.querySelector('.file-title-row')||view).append(badge);
  }
  badge.textContent=error?label+': '+detail:label;badge.title=detail;badge.setAttribute('aria-label',detail);
  badge.style.color=error?'#d93025':'inherit';
  badge.dataset.cfzJob=job.id;
  job.badge=badge;
}
function finishStatus(job,label,detail,error=false){
  setStatus(job,label,detail,error);
  if(!error)setTimeout(()=>{if(job.badge?.dataset.cfzJob===job.id)job.badge.remove();},10000);
}
async function cleanup(job){
  if(!job.created)return;
  // Only job staging files are removed. The saved sibling ZIP is retained.
  const names=['archive.py','delete_folder.py','folder_details.py','status.json','status.tmp','pid','cancel','archive.partial'];
  if(job.kind==='zip')names.push(job.path.split('/').pop()+'.zip');
  for(const name of names){
    try{await request(job.ctx,'/api/contents/'+encodePath(job.dir+'/'+name),'DELETE');}
    catch(error){if(error.status!==404)return;}
  }
  try{await request(job.ctx,'/api/contents/'+encodePath(job.dir),'DELETE');}catch{}
}
async function run(target,download){
  let path;
  try{path=normalizePath(target.path);}catch(error){setStatus(target,'ZIP failed',error.message,true);return;}
  if(conflictingJob(jobs,path,'zip'))return;
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
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal.send(`python3 ${quote(job.dir+'/archive.py')} ${quote(path)} ${quote(job.dir)}\n`);
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
      if(result.state==='error')throw new Error(result.error||'Compression failed.');
      if(result.state==='cancelled')throw new Error('Cancelled.');
      if(result.state==='ready'){validateArchive(result,path);job.result=result;break;}
      if(!['scanning','compressing','saving'].includes(result.state))throw new Error('Unexpected compression status.');
      const label=result.state==='saving'?'Saving ZIP':'Zipping';
      setStatus(job,result.total>0?`${label} ${Math.round(result.done/result.total*100)}%`:`${label}…`);
    }
    await job.terminal.close();job.terminal=null;
    const tree=document.querySelector('colab-file-browser')?.currentTree;
    // Make the newly saved sibling archive appear in the Files sidebar.
    try{await tree?.refresh?.();}catch{}
    if(job.cancelled)throw new Error('Cancelled.');
    if(download){
      const files=document.querySelector('colab-file-browser')?.currentTree?.files;
      if(!files?.getFile)throw new Error('ZIP saved, but Colab file download is unavailable.');
      setStatus(job,'Downloading…',job.result.archive);
      const file=await files.getFile(job.result.archive);
      assertRuntime(ctx);
      if(job.cancelled)throw new Error('Cancelled.');
      await file.download({
        get canceled(){return job.cancelled;},
        update:n=>setStatus(job,`Downloading ${Math.round(n*100)}%`,job.result.archive)
      });
      if(job.cancelled)throw new Error('Cancelled.');
    }
    finishStatus(job,download?'Download started':'ZIP ready','Saved '+job.result.archive);
  }catch(error){
    const suffix=job.result?' ZIP remains at '+job.result.archive+'.':'';
    const label=job.cancelled?'ZIP cancelled':job.result&&download?'Download failed':'ZIP failed';
    finishStatus(job,label,(error.message||'The connection to Colab was lost.')+suffix,!job.cancelled);
  }finally{
    await job.terminal?.close();
    // Completed jobs are safe to clean. A lost connection can leave a
    // process alive, so retain incomplete staging files for diagnosis.
    if(job.result)await cleanup(job);
    jobs.delete(path);addMenuItems();
  }
}
async function runDelete(target){
  let path,ctx;
  try{path=deletionPath(target.path);ctx=context();}
  catch(error){setStatus(target,'Delete failed',error.message,true);return;}
  if(conflictingJob(jobs,path,'delete'))return;
  if(!window.confirm(`Permanently delete this folder and all its contents?\n\n${path}\n\nAll nested files and folders will be removed. This includes files on mounted drives. Nothing is moved to Trash. This cannot be undone.`))return;
  const id=crypto.randomUUID();
  const job={kind:'delete',path,view:target.view,id,ctx,dir:'/content/.colab-folder-zip-'+id,terminal:null};
  jobs.set(path,job);setStatus(job,'Deleting…');addMenuItems();
  try{
    const folder=await (await request(ctx,'/api/contents/'+encodePath(path)+'?content=0')).json();
    if(folder.type!=='directory')throw new Error('The selected path is not a folder.');
    job.terminal=await openTerminal(ctx);
    await request(ctx,'/api/contents/'+encodePath(job.dir),'PUT',{type:'directory'});job.created=true;
    await put(ctx,job.dir+'/delete_folder.py',deleteSource);
    job.terminal.send(`python3 ${quote(job.dir+'/delete_folder.py')} ${quote(path)} ${quote(job.dir)}\n`);
    let misses=0;
    while(true){
      await sleep(750);
      let response;
      try{response=await request(ctx,'/files/'+encodePath(job.dir+'/status.json')+'?t='+Date.now());}
      catch(error){
        if(error.status===404 && ++misses<30)continue;
        if(error.status===404)throw new Error('The deletion process did not report a result. Refresh Files before retrying.');
        throw error;
      }
      const result=await response.json();
      if(result.state==='error'){
        job.settled=true;
        throw new Error((result.error||'Deletion failed.')+(result.partial?' Some contents may already have been deleted.':''));
      }
      if(result.state==='deleted'){
        if(result.path!==path)throw new Error('Unexpected deletion result. Refresh Files to check the folder.');
        job.settled=true;break;
      }
      if(!['checking','deleting'].includes(result.state))throw new Error('Unexpected deletion status.');
      setStatus(job,result.state==='checking'?'Checking folder…':'Deleting…');
    }
    await job.terminal.close();job.terminal=null;
    finishStatus(job,'Folder deleted',path);
    const tree=document.querySelector('colab-file-browser')?.currentTree;
    try{await tree?.refresh?.();}catch{finishStatus(job,'Folder deleted','Refresh Files to update the folder list.');}
  }catch(error){
    finishStatus(job,'Delete failed',error.message||'Connection lost. Refresh Files to check whether deletion completed.',true);
  }finally{
    await job.terminal?.close();
    if(job.settled)await cleanup(job);
    jobs.delete(path);addMenuItems();
  }
}
function capture(event){
  if(!event.isTrusted)return;
  const view=event.composedPath().find(node=>node?.localName==='colab-file-view');
  if(!view)return;
  const path=folderPath(view);const file=view.getFile?.()||view.file;
  selected=path?{path,name:file.name,view}:null;
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
    const running=jobs.get(selected.path)?.kind==='zip';
    for(const [action,label] of [['details','Folder details'],['zip','ZIP only'],['download','ZIP and download'],['cancel','Cancel ZIP'],['delete','Delete folder and contents…']]){
      let button=menu.querySelector(`[data-cfz-action="${action}"]`);
      if(action==='cancel'&&!running){button?.remove();continue;}
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
        const launch=event=>{
          if(!event.isTrusted || button.getAttribute('aria-disabled')==='true')return;
          event.preventDefault();event.stopPropagation();
          const target={path:button.dataset.cfzPath,view:button.cfzView};
          menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
          if(action==='cancel'){
            const job=jobs.get(target.path);
            if(job){job.cancelled=true;setStatus(job,'Cancelling…');}
          }else if(action==='details')void runDetails(target);
          else if(action==='delete')void runDelete(target);
          else void run(target,action==='download');
        };
        button.addEventListener('click',launch);
        button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')launch(event);});
        menu.append(button);
      }
      button.dataset.cfzPath=selected.path;button.cfzView=selected.view;
      let reason='';
      if(action==='delete'){try{deletionPath(selected.path);}catch(error){reason=error.message;}}
      const disabled=action!=='cancel' && (Boolean(reason)||conflictingJob(jobs,selected.path,action==='delete'?'delete':action==='details'?'details':'zip'));
      button.title=reason || (disabled?'Wait for the current operation on this folder to finish.':'');
      if(action==='delete')button.style.color=disabled?'':'#d93025';
      button.setAttribute('aria-disabled',String(disabled));button.classList.toggle('goog-menuitem-disabled',disabled);
    }
  }
}
const observer=new MutationObserver(addMenuItems);
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
