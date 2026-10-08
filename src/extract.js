async function runExtract(target){
  let path;
  try{path=extractionPath(target.path);}catch(error){setStatus(target,'Extraction failed',error.message,true);return;}
  if(conflictingJob(jobs,path,'extract'))return;
  const id=crypto.randomUUID();
  const job={kind:'extract',path,view:target.view,id,dir:'/content/.colab-folder-zip-'+id,cancelled:false,terminal:null};
  jobs.set(path,job);setStatus(job,'Checking archive…');addMenuItems();
  try{
    job.ctx=context();const ctx=job.ctx;
    const file=await (await request(ctx,'/api/contents/'+encodePath(path)+'?content=0')).json();
    if(file.type!=='file')throw new Error('The selected path is not an archive file.');
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal=await openTerminal(ctx);
    await request(ctx,'/api/contents/'+encodePath(job.dir),'PUT',{type:'directory'});job.created=true;
    await put(ctx,job.dir+'/extract_archive.py',extractSource);
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal.send(`python3 ${quote(job.dir+'/extract_archive.py')} ${quote(path)} ${quote(job.dir)}\n`);
    job.started=true;
    let misses=0,cancelSent=false;
    while(true){
      await sleep(750);
      if(job.cancelled&&!cancelSent){await put(ctx,job.dir+'/cancel','cancel');cancelSent=true;}
      let response;
      try{response=await request(ctx,'/files/'+encodePath(job.dir+'/status.json')+'?t='+Date.now());}
      catch(error){
        if(error.status===404&&++misses<30)continue;
        if(error.status===404)throw new Error('Extraction did not start. This runtime needs Python 3.8 or later.');
        throw error;
      }
      const result=await response.json();
      if(['error','cancelled'].includes(result.state)){
        if(result.path!==path||result.destination!==path.slice(0,path.lastIndexOf('/')))throw new Error('Unexpected extraction status.');
        job.settled=true;job.partial=Boolean(result.partial);job.backendCancelled=result.state==='cancelled';
        throw new Error(result.error||'Extraction failed.');
      }
      validateExtraction(result,path);
      if(result.state==='extracted'){job.result=result;job.settled=true;break;}
      const fraction=result.state==='extracting'&&result.total>0?result.done/result.total:null;
      const label=result.state==='checking'?'Checking archive…':fraction===null?'Extracting…':`Extracting ${Math.round(fraction*100)}%`;
      setStatus(job,label,`Extracting into ${result.destination}`,false,fraction);
    }
    await job.terminal.close();job.terminal=null;
    try{await document.querySelector('colab-file-browser')?.currentTree?.refresh?.();}catch{}
    finishStatus(job,'Extracted',`${job.result.files} file(s) extracted into ${job.result.destination}. Archive kept.`);
  }catch(error){
    const cancelled=job.backendCancelled||(!job.started&&job.cancelled);
    let detail=error.message||'The connection to Colab was lost.';
    if(job.partial)detail+=' Some extracted files or folders remain. Existing files were not overwritten.';
    else if(job.started&&!job.settled)detail+=' Refresh Files to check for partially extracted contents before retrying.';
    if(job.settled)try{await document.querySelector('colab-file-browser')?.currentTree?.refresh?.();}catch{}
    finishStatus(job,cancelled?'Extraction cancelled':'Extraction failed',detail,!cancelled||job.partial);
  }finally{
    await job.terminal?.close();
    if(job.settled||(job.created&&!job.started))await cleanup(job);
    jobs.delete(path);addMenuItems();
  }
}
