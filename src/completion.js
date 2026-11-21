// Keep a visible indicator when Colab replaces or removes the last affected row.
function syncProgressFallback(job){
  const rows=job.rows||job.zipRows;
  const visible=row=>row.badge?.cfzProgress?.element.getClientRects().length>0;
  const hasRow=rows?[...rows.values()].some(visible):visible(job);
  if(job.finished||hasRow||(job.ctx&&job.ctx.kernel.runtime!==job.ctx.runtime)){
    job.fallback?.element.remove();
    return;
  }
  const toolbar=document.querySelector('.file-tree-buttons');
  if(!toolbar)return;
  const label=job.phase||job.status?.label||'Deleting…';
  if(!job.fallback)job.fallback=createProgress(label);
  job.fallback.update(label);
  job.fallback.element.title=label;
  if(job.fallback.element.parentNode!==toolbar)toolbar.append(job.fallback.element);
}

async function refreshJobFiles(job){
  const tree=document.querySelector('colab-file-browser')?.currentTree;
  if(!tree)return; // A closed Files pane loads its listing when reopened.
  await tree.refresh();
  // Colab's root refresh can schedule child listings without awaiting them.
  const affected=job.plan?.map(item=>item.path)||[job.result?.archive||job.path];
  if(job.kind==='extract'&&job.result)affected.push(job.result.destination+'/');
  const parents=new Set(affected.map(path=>path.slice(0,path.lastIndexOf('/'))));
  for(const path of parents){
    if(document.querySelector('colab-file-browser')?.currentTree!==tree)break;
    const view=[...tree.querySelectorAll?.('colab-file-view')||[]].find(v=>filePath(v)===path);
    if(view&&view!==tree.root&&view.isOpen?.())await view.refresh();
  }
}

async function finishRuntimeWork(job){
  job.finalizing=true;
  const phase=label=>{
    job.phase=label;
    if(job.rows)updateBatchStatuses(job);
    else setStatus(job,label);
    syncProgressFallback(job);
  };
  const warnings=[];
  phase('Finishing…');
  addMenuItems();
  try{await job.terminal?.close();}catch{warnings.push('The job terminal could not be closed.');}
  if(job.settled||(job.created&&!job.started)){
    try{await cleanup(job);}catch{warnings.push('Some temporary job files could not be removed.');}
  }
  if(job.started&&job.kind!=='details'&&job.ctx.kernel.runtime===job.ctx.runtime){
    phase('Updating Files…');
    try{await refreshJobFiles(job);}catch{warnings.push('The Files sidebar could not be updated. Refresh Files.');}
  }
  return warnings.join(' ');
}
