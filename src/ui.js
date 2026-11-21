// File tools operate only when requested from the sidebar.
if (document.querySelector('meta[name="colab-folder-zip-version"]')) return;
const marker=document.createElement('meta');
marker.name='colab-folder-zip-version';marker.content='0.11.3';document.head.append(marker);
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
  if(job.zipRows){
    for(const row of job.zipRows.values()){
      if(job.ctx.runtime!==job.ctx.kernel.runtime){row.badge?.remove();continue;}
      row.finished=job.finished;
      setRowStatus(row,label,detail,error,progress);
    }
  }else setRowStatus(job,label,detail,error,progress);
}
function setRowStatus(job,label,detail,error,progress){
  // Keep feedback with its folder, including after Colab refreshes the file tree.
  if(job.view?.isConnected&&filePath(job.view)!==job.path){job.badge?.remove();job.badge=null;job.view=null;}
  const view=job.view?.isConnected ? job.view : [...document.querySelectorAll('colab-file-view')].find(v=>filePath(v)===job.path);
  if(!view)return;
  job.view=view;
  // A parent folder must never reuse a nested child's status badge.
  let badge=[...view.querySelectorAll('[data-cfz-status]')].find(node=>node.closest('colab-file-view')===view);
  if(job.finished&&!error){badge?.remove();job.badge=null;return;}
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
  const owner=job.batch||job;
  const busy=!error&&!job.finished&&!owner.finished&&jobs.get(owner.path)===owner;
  // Ordinary actions show only the ring and leave no completion badge.
  // Error details remain visible so failures cannot look like success.
  text.hidden=!error;
  if(busy){
    if(!badge.cfzProgress){badge.cfzProgress=createProgress(label);badge.prepend(badge.cfzProgress.element);}
    badge.cfzProgress.update(label,progress);
  }else if(badge.cfzProgress){badge.cfzProgress.element.remove();badge.cfzProgress=null;}
  badge.dataset.cfzJob=job.id;
  job.badge=badge;
}
function finishStatus(job,label,detail,error=false,warning=''){
  jobs.delete(job.path);
  job.finished=true;
  setStatus(job,label,warning?detail+' '+warning:detail,error||Boolean(warning));
  job.fallback?.element.remove();
  addMenuItems();
}
async function cleanup(job){
  if(!job.created)return;
  // Only job staging files are removed. The saved sibling ZIP is retained.
  const names=['archive.py','extract_archive.py','delete_folder.py','folder_details.py','file_operations.py','args.json','status.json','status.tmp','pid','cancel','archive.partial'];
  for(const name of names){
    try{await request(job.ctx,'/api/contents/'+encodePath(job.dir+'/'+name),'DELETE');}
    catch(error){if(error.status!==404)throw error;}
  }
  try{await request(job.ctx,'/api/contents/'+encodePath(job.dir),'DELETE');}catch(error){if(error.status!==404)throw error;}
}
async function run(target,download,selection=null){
  if(jobs.size)return;
  let ctx,path,plan;
  try{
    ctx=context();path=deletionPath(target.path);
    if(selection){
      if(selection.runtime!==ctx.runtime)throw new Error('The runtime changed. Select the files again.');
      plan=planSelection([...selection.items.values()]);
      if(plan.length<2||!plan.some(item=>item.path===path))throw new Error('Select two or more files or folders.');
    }
  }catch(error){setStatus(target,'ZIP failed',error.message,true);return;}
  const id=crypto.randomUUID();
  const job={kind:'zip',path,ctx,view:target.view,id,dir:'/content/.colab-folder-zip-'+id,cancelled:false,terminal:null};
  if(plan)job.zipRows=new Map(plan.map(item=>[item.path,{path:item.path,id,batch:job}]));
  if(download)job.downloadPermission=downloadPermission();
  let outcome;
  jobs.set(path,job);setStatus(job,'Zipping…');addMenuItems();
  try{
    if(!plan){
      const folder=await (await request(ctx,'/api/contents/'+encodePath(path)+'?content=0')).json();
      if(folder.type!=='directory')throw new Error('The selected path is not a folder.');
    }
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal=await openTerminal(ctx);
    await request(ctx,'/api/contents/'+encodePath(job.dir),'PUT',{type:'directory'});job.created=true;
    await put(ctx,job.dir+'/archive.py',archiveSource);
    if(plan)await put(ctx,job.dir+'/args.json',JSON.stringify(plan));
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal.send(`python3 -B ${quote(job.dir+'/archive.py')} ${plan?'--selection':quote(path)} ${quote(job.dir)}\n`);
    job.started=true;
    for await(const result of archiveJobStatuses(job)){
      if(result.state==='error'){job.settled=true;throw new Error(result.error||'Compression failed.');}
      if(result.state==='cancelled'){job.settled=true;throw new Error('Cancelled.');}
      if(result.state==='ready'){validateArchive(result,plan?'/content/selected-files':path);job.result=result;job.settled=true;break;}
      if(!['scanning','compressing','saving'].includes(result.state))throw new Error('Unexpected compression status.');
      const label=result.state==='saving'?'Saving ZIP':'Zipping';
      const fraction=Number.isFinite(result.done)&&Number.isFinite(result.total)&&result.total>0?Math.min(1,Math.max(0,result.done/result.total)):null;
      setStatus(job,fraction!==null?`${label} ${Math.round(fraction*100)}%`:`${label}…`,undefined,false,fraction);
    }
    if(job.cancelled)throw new Error('Cancelled.');
    if(download){
      await downloadArchive(job);
      if(job.cancelled)throw new Error('Cancelled.');
    }
    outcome={label:download?'Download started':'ZIP ready',detail:'Saved '+job.result.archive};
  }catch(error){
    if(error instanceof ArchiveStatusUnavailable){
      outcome={label:'ZIP status unknown',detail:error.message+' Refresh Files and check for the ZIP before starting again.',error:true};
    }else{
      const suffix=job.result?' ZIP remains at '+job.result.archive+'.':'';
      const label=job.cancelled?'ZIP cancelled':job.result&&download?'Download failed':'ZIP failed';
      outcome={label,detail:(error.message||'The connection to Colab was lost.')+suffix,error:!job.cancelled};
    }
  }finally{
    const warning=await finishRuntimeWork(job);
    finishStatus(job,outcome.label,outcome.detail,outcome.error,warning);
  }
}
function jobForPath(path){
  return jobs.get(path)||[...jobs.values()].find(job=>job.zipRows?.has(path));
}
function cancelJob(path){
  const job=jobForPath(path);
  // Cleanup keeps the operation lock, but a completed result must not
  // accept a stale Cancel click or replace its final status.
  if(!job||job.finished||job.finalizing)return;
  job.cancelled=true;setStatus(job,'Cancelling…');
}
async function runDelete(target){
  await runBulkDelete([{path:target.path,isDirectory:true}]);
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
function addMenuItems(updateSelection=true){
  if(updateSelection)refreshSelection();
  if(!selected)return;
  const menus=[...document.querySelectorAll('[role="menu"][aria-label]')].filter(menu=>
    menu.getBoundingClientRect().width>0 && (menu.getAttribute('aria-label')||'').endsWith(': '+selected.name));
  for(const menu of menus){
    if(!menu.cfzKeyboardFocus){
      menu.cfzKeyboardFocus=true;
      // Keep Closure's menu open when keyboard focus enters an added action.
      menu.addEventListener('blur',event=>{
        const next=event.relatedTarget;
        if(next?.closest?.('[data-cfz-action],[data-cfz-delete]')?.parentElement===menu)event.stopImmediatePropagation();
      },true);
    }
    const bulk=hasBulkSelection(selected.path),nativeDelete=syncDeleteMenu(menu,selected);
    const currentJob=jobForPath(selected.path);
    const running=currentJob?.finalizing?null:currentJob?.kind;
    const actions=bulk
      ? [['bulk-download',`Download selected as ZIP (${selectionState.items.size})`],...(nativeDelete?[]:[['bulk-delete',`Delete selected items (${selectionState.items.size})`]])]
      : selected.isDirectory
      ? [['details','Folder details'],['zip','ZIP only'],['download','ZIP and download'],...(nativeDelete?[]:[['delete','Delete folder and contents']])]
      : [...(isExtractable(selected.path)?[['extract','Extract here']]:[]),...(running==='extract'?[['cancel','Cancel extraction']]:[])];
    if(running==='zip')actions.push(['cancel','Cancel ZIP']);
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
          activateMenuItem(menu,button);
        };
        button.addEventListener('click',launch);
        button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')launch(event);});
        const deleteItem=action==='bulk-download'&&menu.querySelector('[data-cfz-bulk-delete],[data-cfz-action="bulk-delete"]');
        if(deleteItem)deleteItem.before(button);
        else menu.append(button);
      }
      button.dataset.cfzPath=selected.path;button.cfzView=selected.view;
      const content=button.querySelector('.goog-menuitem-content');if(content.textContent!==label)content.textContent=label;
      let reason='';
      if(action==='delete'){try{deletionPath(selected.path);}catch(error){reason=error.message;}}
      if(action==='extract'){try{extractionPath(selected.path);}catch(error){reason=error.message;}}
      const disabled=action!=='cancel' && (Boolean(reason)||jobs.size>0);
      button.title=reason || (disabled?'Wait for the current operation in this location to finish.':action==='extract'?'Extract into a folder named after this archive.':'');
      if(action==='delete')button.style.color=disabled?'':'#d93025';
      button.setAttribute('aria-disabled',String(disabled));button.classList.toggle('goog-menuitem-disabled',disabled);
    }
    syncBulkMenuActions(menu,bulk);
  }
}
const observer=new MutationObserver(records=>{
  addMenuItems(false);
  const filesChanged=selectionMutations(records);
  syncContentShortcut();
  // Colab replaces rows during refresh. Restore an active ring even while
  // waiting for a backend request that is not producing progress callbacks.
  for(const job of jobs.values()){
    if(job.rows){if(filesChanged)updateBatchStatuses(job);}
    else if(job.zipRows){
      if(filesChanged&&!job.finished&&job.status){
        const {label,detail,error,progress}=job.status;setStatus(job,label,detail,error,progress);
      }
    }
    else if(!job.finished&&job.status&&!job.badge?.isConnected){
      const {label,detail,error,progress}=job.status;setStatus(job,label,detail,error,progress);
    }
    syncProgressFallback(job);
  }
});
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
