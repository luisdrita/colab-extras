// Selection stays in memory and is scoped to the connected runtime.
var selectionState={items:new Map(),runtime:null,busy:false,message:'',error:false};
const selectionPlatform=()=>navigator.userAgentData?.platform||navigator.platform||'';
const selectionModifier=event=>/Mac|iPhone|iPad|iPod/i.test(selectionPlatform())?event.metaKey&&!event.ctrlKey:event.ctrlKey&&!event.metaKey;
const selectionStyle=document.createElement('style');
selectionStyle.textContent='colab-file-view > .file-title-row[data-cfz-selected]{background-color:var(--colab-highlighted-surface-color,rgba(128,128,128,.12))!important}[data-cfz-bulk-hidden]{display:none!important}';
document.head.append(selectionStyle);
function selectionMutations(records){
  if(!selectionState)return;
  let runtime=null;try{runtime=context().runtime;}catch{}
  const selector='colab-file-view,colab-file-browser';
  const changed=(selectionState.runtime&&selectionState.runtime!==runtime)||records.some(record=>
    record.target.closest?.(selector)||[...record.addedNodes,...record.removedNodes].some(node=>
      node.matches?.(selector)||node.querySelector?.(selector)));
  if(changed)refreshSelection();
  return Boolean(changed);
}
function selectionMessage(message,error=false,errorTarget=null){
  selectionState.message=message;selectionState.error=error;
  const job=[...jobs.values()].find(item=>item.kind==='bulk-delete');
  if(error&&(!job||job.ctx.kernel.runtime===job.ctx.runtime)){
    const target=errorTarget||selectionState.items.values().next().value||job;
    if(target)setStatus({...target,finished:true},'Delete failed',message,true);
  }else if(job?.rows)updateBatchStatuses(job);
  refreshSelection();
}
function forgetDeletedSelection(path){
  for(const selectedPath of selectionState.items.keys()){
    if(selectedPath===path||selectedPath.startsWith(path+'/'))selectionState.items.delete(selectedPath);
  }
}
function clearSelection(){selectionState.items.clear();refreshSelection();}
function setSelection(view,mode='only'){
  if(selectionState.busy||jobs.size)return;
  try{
    const ctx=context();
    if(selectionState.runtime!==ctx.runtime)selectionState.items.clear();
    selectionState.runtime=ctx.runtime;
    const file=view.getFile?.()||view.file,path=deletionPath(filePath(view));
    if(file.name==='..')return;
    const wasSelected=selectionState.items.has(path);
    if(mode==='context'&&wasSelected)return;
    if(mode!=='toggle')selectionState.items.clear();
    if(mode==='toggle'&&wasSelected)selectionState.items.delete(path);
    else{
      // Opening a folder selects its row. Choosing contents must replace
      // that ancestor selection, or recursive deletion would include every
      // sibling. Conversely, explicitly choosing a folder replaces children.
      for(const [selectedPath,item] of selectionState.items){
        if((item.isDirectory&&path.startsWith(selectedPath+'/'))||
            (file.isDirectory&&selectedPath.startsWith(path+'/')))selectionState.items.delete(selectedPath);
      }
      selectionState.items.set(path,{path,isDirectory:Boolean(file.isDirectory)});
    }
    selectionState.message='';selectionState.error=false;refreshSelection();
  }catch{if(mode!=='toggle')clearSelection();}
}
function refreshSelection(){
  if(!selectionState)return;
  let runtime=null;try{runtime=context().runtime;}catch{}
  if(selectionState.runtime&&selectionState.runtime!==runtime){
    selectionState.items.clear();selectionState.message='';selectionState.runtime=null;
  }
  for(const view of document.querySelectorAll('colab-file-view')){
    const row=[...view.children].find(node=>node.classList.contains('file-title-row'));
    if(!row)continue;
    const path=filePath(view),file=view.getFile?.()||view.file;
    if(selectionState.items.has(path)&&selectionState.items.get(path).isDirectory!==Boolean(file?.isDirectory))selectionState.items.delete(path);
    row.toggleAttribute('data-cfz-selected',selectionState.items.has(path));
  }
}
function selectionRow(event){
  const path=event.composedPath();
  const row=path.find(node=>node?.classList?.contains('file-title-row'));
  if(!row||path.some(node=>node?.matches?.('input,textarea,select,[contenteditable="true"],button,md-icon-button,.menu-button,.directory-icon,.file-item-action-button')))return null;
  return row;
}
function selectionPointer(event){
  if(!event.isTrusted||event.button!==0)return;
  const row=selectionRow(event);if(!row)return;
  if(selectionModifier(event)){
    // Capture before Colab's row handlers: selecting must not expand folders,
    // open files, start a drag, or clear the other selected rows.
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='click'){
      setSelection(row.closest('colab-file-view'),'toggle');
      if(!row.hasAttribute('tabindex'))row.tabIndex=-1;
      row.focus({preventScroll:true});
    }
  }else if(event.type==='click'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){
    setSelection(row.closest('colab-file-view'));
  }
}
for(const type of ['pointerdown','mousedown','mouseup','click','dblclick'])document.addEventListener(type,selectionPointer,true);
document.addEventListener('contextmenu',event=>{
  if(!event.isTrusted)return;
  // Preserve a selected group for its menu; other rows use their own menu.
  const row=event.composedPath().find(node=>node?.classList?.contains('file-title-row'));
  if(row)setSelection(row.closest('colab-file-view'),'context');
},true);
document.addEventListener('click',event=>{
  if(!event.isTrusted||event.button!==0)return;
  const path=event.composedPath();
  // A menu action belongs to the selection; preserve its target snapshot.
  if(path.some(node=>node?.matches?.('[role="menu"]')))return;
  const row=path.find(node=>node?.classList?.contains('file-title-row'));
  if(!row||!selectionState.items.has(filePath(row.closest('colab-file-view')))){
    clearSelection();addMenuItems(false);
  }
},true);
document.addEventListener('click',event=>{
  if(!event.isTrusted||!event.composedPath().some(node=>node?.classList?.contains('menu-button')))return;
  const view=event.composedPath().find(node=>node?.localName==='colab-file-view');
  if(view)setSelection(view,'context');
},true);
document.addEventListener('keydown',event=>{
  if(!event.isTrusted)return;
  const row=selectionRow(event);if(!row)return;
  const deleting=event.key==='Delete'||(event.key==='Backspace'&&/Mac|iPhone|iPad|iPod/i.test(selectionPlatform())&&selectionModifier(event));
  if(selectionState.busy||jobs.size){
    if(deleting){event.preventDefault();event.stopImmediatePropagation();}
    return;
  }
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();clearSelection();}
  if(deleting){
    if(!selectionState.items.size)return;
    event.preventDefault();event.stopImmediatePropagation();void runBulkDelete();
  }
},true);
function hasBulkSelection(path){return selectionState.items.size>1&&selectionState.items.has(path);}
function syncDeleteMenu(menu,target){
  const bulk=hasBulkSelection(target.path),handled=bulk||target.isDirectory;
  const items=[...menu.querySelectorAll('[role="menuitem"]')].filter(item=>!item.dataset.cfzAction);
  const item=items.find(item=>item.cfzOriginalDelete||/^Delete(?: (?:file|folder))?(?:…|\.\.\.)?$/i.test(item.textContent.trim()));
  if(!item)return false;
  const content=item.querySelector('.goog-menuitem-content')||item;
  if(handled){
    if(!item.cfzOriginalDelete)item.cfzOriginalDelete={text:content.textContent,disabled:item.getAttribute('aria-disabled'),classDisabled:item.classList.contains('goog-menuitem-disabled'),tabIndex:item.getAttribute('tabindex'),title:item.getAttribute('title')};
    item.dataset.cfzDelete='';item.toggleAttribute('data-cfz-bulk-delete',bulk);
    // Single-folder deletion uses the menu's target, even if an earlier
    // selection was cleared. Groups keep the runtime-scoped selection plan.
    item.cfzDeleteTarget=bulk?null:{path:target.path,view:target.view};
    item.tabIndex=0;
    const label=bulk?`Delete selected items (${selectionState.items.size})`:item.cfzOriginalDelete.text.replace(/(?:…|\.\.\.)$/,'');
    if(content.textContent!==label)content.textContent=label;
    let reason='';try{deletionPath(target.path);}catch(error){reason=error.message;}
    const disabled=Boolean(reason)||selectionState.busy||jobs.size>0;
    item.title=reason||(disabled?'Wait for the current operation to finish.':'');
    item.setAttribute('aria-disabled',String(disabled));item.classList.toggle('goog-menuitem-disabled',disabled);
  }else if(item.cfzOriginalDelete){
    const original=item.cfzOriginalDelete;
    content.textContent=original.text;
    if(original.disabled===null)item.removeAttribute('aria-disabled');else item.setAttribute('aria-disabled',original.disabled);
    item.classList.toggle('goog-menuitem-disabled',original.classDisabled);
    if(original.tabIndex===null)item.removeAttribute('tabindex');else item.setAttribute('tabindex',original.tabIndex);
    if(original.title===null)item.removeAttribute('title');else item.setAttribute('title',original.title);
    delete item.dataset.cfzDelete;delete item.dataset.cfzBulkDelete;delete item.cfzDeleteTarget;delete item.cfzOriginalDelete;
  }
  return handled;
}
function syncBulkMenuActions(menu,bulk){
  menu.toggleAttribute('data-cfz-bulk-menu',bulk);
  for(const item of menu.querySelectorAll('.goog-menuitem,[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],.goog-menuseparator,[role="separator"]')){
    const allowed=item.hasAttribute('data-cfz-bulk-delete')||item.dataset.cfzAction==='bulk-delete';
    if(bulk&&!allowed){
      if(!item.cfzHiddenAction)item.cfzHiddenAction={ariaHidden:item.getAttribute('aria-hidden'),inert:item.hasAttribute('inert')};
      item.setAttribute('data-cfz-bulk-hidden','');item.setAttribute('aria-hidden','true');item.inert=true;
      item.classList.remove('goog-menuitem-highlight');
    }else if(item.cfzHiddenAction){
      const original=item.cfzHiddenAction;
      item.removeAttribute('data-cfz-bulk-hidden');item.inert=original.inert;
      if(original.ariaHidden===null)item.removeAttribute('aria-hidden');else item.setAttribute('aria-hidden',original.ariaHidden);
      delete item.cfzHiddenAction;
    }
  }
}
function bulkMenuEvent(event){
  if(!event.isTrusted)return;
  const path=event.composedPath(),menu=path.find(node=>node?.getAttribute?.('role')==='menu');
  if(!menu)return;
  const keyboard=event.type==='keydown'||event.type==='keyup';
  const grouped=menu.hasAttribute('data-cfz-bulk-menu');
  let item=path.find(node=>node?.hasAttribute?.('data-cfz-delete')||node?.dataset?.cfzAction==='bulk-delete')||
    (keyboard?menu.querySelector('[data-cfz-delete].goog-menuitem-highlight'):null);
  if(grouped&&keyboard){
    if(event.key==='Escape')return;
    // CSS alone does not change Closure's internal list of actions. Own
    // keyboard navigation too, so hidden single-item commands cannot run.
    event.preventDefault();event.stopImmediatePropagation();
    item=menu.querySelector('[data-cfz-delete],[data-cfz-action="bulk-delete"]');
    if(event.type==='keyup')return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){item?.focus();return;}
    if(event.key==='Tab'){menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));return;}
    if(!['Enter',' '].includes(event.key))return;
  }else if(keyboard&&!['Enter',' '].includes(event.key))return;
  if(grouped&&!item){event.preventDefault();event.stopImmediatePropagation();return;}
  if(!item)return;
  // Closure can activate a native item on mouse-up, before click. Suppress
  // every activation phase so its original single-item delete never runs.
  event.preventDefault();event.stopImmediatePropagation();
  if(event.type!=='click'&&event.type!=='keydown')return;
  if(item.getAttribute('aria-disabled')==='true'||selectionState.busy||jobs.size)return;
  const target=item.cfzDeleteTarget;
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
  if(target)void runDelete(target);else void runBulkDelete();
}
for(const type of ['pointerdown','mousedown','pointerup','mouseup','click','keydown','keyup'])document.addEventListener(type,bulkMenuEvent,true);
function batchRoot(job,path){
  return job.plan.find(item=>path===item.path||(item.isDirectory&&path.startsWith(item.path+'/')));
}
function updateBatchStatuses(job){
  // Do not carry a previous runtime's progress into a new runtime's rows.
  if(job.ctx.kernel.runtime!==job.ctx.runtime){
    for(const row of job.rows.values()){row.badge?.remove();row.badge=null;}
    return;
  }
  const paths=new Set([...job.targets,...job.plan].map(item=>item.path));
  for(const view of document.querySelectorAll('colab-file-view')){
    const path=filePath(view);if(path&&batchRoot(job,path))paths.add(path);
  }
  const results=new Map(job.results.map(item=>[item.path,item]));
  for(const path of paths){
    const root=batchRoot(job,path);if(!root)continue;
    let row=job.rows.get(path);
    if(!row){row={path,id:job.id,batch:job};job.rows.set(path,row);}
    const result=results.get(root.path);
    row.finished=Boolean(result)||Boolean(job.finished);
    if(result){
      const failed=!result.deleted&&path===root.path;
      setStatus(row,failed?'Delete failed':'Deleted',failed?result.error+(result.partial?' Some contents may already be deleted.':''):path,failed);
    }else if(job.finished){
      const failed=Boolean(job.failure)&&path===root.path;
      setStatus(row,failed?'Delete failed':'Finished',failed?job.failure:path,failed);
    }else{
      setStatus(row,'Deleting…',path);
    }
  }
}
function finishBatchStatuses(job,error=null){
  job.finished=true;job.failure=error;updateBatchStatuses(job);
}
async function runBulkDelete(explicitTargets=null){
  if(selectionState.busy||jobs.size)return;
  const targets=explicitTargets||[...selectionState.items.values()];
  if(!targets.length)return;
  let ctx,plan;
  try{
    ctx=context();
    if(!explicitTargets&&ctx.runtime!==selectionState.runtime)throw new Error('The runtime changed. Select the files again.');
    plan=planDeletion(targets);assertRuntime(ctx);
  }catch(error){selectionMessage(error.message,true);return;}
  const id=crypto.randomUUID();
  const job={kind:'bulk-delete',path:plan[0].path,id,ctx,plan,targets:targets.map(item=>({...item})),rows:new Map(),dir:'/content/.colab-folder-zip-'+id,terminal:null,results:[]};
  // Snapshot the targets, lock the batch and draw every ring before any
  // asynchronous runtime work. There is no confirmation or success dialog.
  selectionState.busy=true;jobs.set(job.path,job);
  updateBatchStatuses(job);addMenuItems();
  try{
    job.terminal=await openTerminal(ctx);
    await request(ctx,'/api/contents/'+encodePath(job.dir),'PUT',{type:'directory'});job.created=true;
    await put(ctx,job.dir+'/delete_folder.py',deleteSource);
    await put(ctx,job.dir+'/args.json',JSON.stringify(plan));
    assertRuntime(ctx);
    job.terminal.send(`python3 -B ${quote(job.dir+'/delete_folder.py')} --batch ${quote(job.dir+'/args.json')} ${quote(job.dir)}\n`);job.started=true;
    let misses=0;
    while(true){
      await sleep(500);
      let response;
      try{response=await request(ctx,'/files/'+encodePath(job.dir+'/status.json')+'?t='+Date.now());}
      catch(error){
        if(error.status===404&&++misses<30)continue;
        throw error;
      }
      const result=await response.json();
      if(result.state==='error'){job.settled=true;throw new Error(result.error||'Deletion failed.');}
      validateDeletionStatus(result,plan);
      if(result.completed<job.results.length)throw new Error('Deletion status moved backwards.');
      job.results=result.results;
      for(const item of result.results)if(item.deleted)forgetDeletedSelection(item.path);
      updateBatchStatuses(job);
      if(result.state==='complete'){job.settled=true;break;}
      selectionMessage(`Deleting ${result.completed} of ${plan.length}…`);
    }
    finishBatchStatuses(job);
    const failed=job.results.filter(item=>!item.deleted),deleted=job.results.length-failed.length;
    selectionMessage(`${deleted} item${deleted===1?'':'s'} deleted.`+(failed.length?` ${failed.length} failed.\n`+failed.map(item=>item.path+': '+item.error+(item.partial?' Some contents may already be deleted.':'')).join('\n'):''),failed.length>0,failed[0]);
  }catch(error){
    const deleted=job.results.filter(item=>item.deleted).length;
    const uncertain=job.started&&!job.settled;
    const message=(error.message||'Connection lost.')+(uncertain?' The result for remaining items is unknown. Refresh Files before retrying.':'');
    finishBatchStatuses(job,message);
    selectionMessage(`${deleted?deleted+' item(s) confirmed deleted. ':''}${message}`,true,plan.find(item=>!job.results.some(result=>result.path===item.path&&result.deleted)));
  }finally{
    try{await job.terminal?.close();}catch{}
    if(job.settled||(job.created&&!job.started))await cleanup(job);
    if(job.started){try{await document.querySelector('colab-file-browser')?.currentTree?.refresh?.();}catch{selectionMessage('Refresh Files to update the list.',true);}}
    updateBatchStatuses(job);
    jobs.delete(job.path);selectionState.busy=false;addMenuItems();refreshSelection();
  }
}
refreshSelection();
