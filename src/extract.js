async function runExtract(target){
  let path;
  try{path=extractionPath(target.path);}catch(error){setStatus(target,'Extraction failed',error.message,true);return;}
  if(jobs.size)return;
  const id=crypto.randomUUID();
  const job={kind:'extract',path,view:target.view,id,dir:'/content/.colab-folder-zip-'+id,cancelled:false,terminal:null};
  let outcome;
  jobs.set(path,job);setStatus(job,'Checking archive…');addMenuItems();
  try{
    job.ctx=context();const ctx=job.ctx;
    const file=await (await request(ctx,'/api/contents/'+encodePath(path)+'?content=0')).json();
    if(file.type!=='file')throw new Error('The selected path is not an archive file.');
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal=await openTerminal(ctx);
    await request(ctx,'/api/contents/'+encodePath(job.dir),'PUT',{type:'directory'});job.created=true;
    await put(ctx,job.dir+'/extract_archive.py',extractSource);
    await put(ctx,job.dir+'/file_operations.py',fileOperationsSource);
    if(job.cancelled)throw new Error('Cancelled.');
    job.terminal.send(`python3 -B ${quote(job.dir+'/extract_archive.py')} ${quote(path)} ${quote(job.dir)}${preferences.overwrite?' --overwrite':''}\n`);
    job.started=true;
    for await(const result of archiveJobStatuses(job)){
      if(['error','cancelled'].includes(result.state)){
        if(!matchesExtractionDestination(result,path))throw new Error('Unexpected extraction status.');
        job.settled=true;job.partial=Boolean(result.partial);job.backendCancelled=result.state==='cancelled';
        job.temporaryOriginals=Array.isArray(result.temporary_originals)?result.temporary_originals.filter(p=>typeof p==='string'):[];
        throw new Error(result.error||'Extraction failed.');
      }
      validateExtraction(result,path);
      if(result.state==='extracted'){job.result=result;job.settled=true;break;}
      const fraction=result.state==='extracting'&&result.total>0?result.done/result.total:null;
      const label=result.state==='checking'?'Checking archive…':fraction===null?'Extracting…':`Extracting ${Math.round(fraction*100)}%`;
      setStatus(job,label,result.state==='checking'?path:`Extracting into ${result.destination}`,false,fraction);
    }
    outcome={label:'Extracted',detail:`${job.result.files} file(s) extracted into ${job.result.destination}. Archive kept.`};
  }catch(error){
    if(error instanceof ArchiveStatusUnavailable){
      outcome={label:'Extraction status unknown',detail:error.message+' Refresh Files and check the extracted contents before starting again.',error:true};
      return;
    }
    const cancelled=job.backendCancelled||(!job.started&&job.cancelled);
    let detail=error.message||'The connection to Colab was lost.';
    if(job.partial){
      detail+=' Some files could not be rolled back. Check the extracted contents before retrying.';
      if(job.temporaryOriginals?.length)detail+=' Temporary originals: '+job.temporaryOriginals.join(', ');
    }
    else if(job.started&&!job.settled)detail+=' Refresh Files to check for partially extracted contents before retrying.';
    outcome={label:cancelled?'Extraction cancelled':'Extraction failed',detail,error:!cancelled||job.partial};
  }finally{
    const warning=await finishRuntimeWork(job);
    finishStatus(job,outcome.label,outcome.detail,outcome.error,warning);
  }
}
