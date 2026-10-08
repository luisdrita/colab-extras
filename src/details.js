let detailsDialog=null;
function showDetailsDialog(job){
  detailsDialog?.close();
  const host=document.createElement('div');host.dataset.colabExtrasDetails='';
  const shadow=host.attachShadow({mode:'open'});
  // DOM construction also works on pages enforcing Trusted Types.
  const node=(tag,attributes={},...children)=>{
    const element=document.createElement(tag);
    for(const [name,value] of Object.entries(attributes))element.setAttribute(name,value);
    element.append(...children);return element;
  };
  const style=node('style');style.textContent=`
    :host{all:initial}*{box-sizing:border-box}
    dialog{--surface:var(--colab-primary-surface-color,#fff);--text:var(--colab-primary-text-color,#1f1f1f);--secondary:var(--colab-secondary-text-color,#444746);--divider:var(--colab-divider-color,#dadce0);--accent:var(--colab-primary-color,#0b57d0);--hover:var(--colab-highlighted-surface-color,#1f1f1f0a);width:560px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 48px);margin:auto;padding:0;border:0;border-radius:4px;background:var(--surface);color:var(--text);font:14px/1.5 var(--colab-chrome-font-family,'Google Sans Text','Google Sans',Roboto,Arial,sans-serif);box-shadow:0 11px 15px -7px #0003,0 24px 38px 3px #0002,0 9px 46px 8px #0002;overflow:hidden}
    dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#0006}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 16px 16px 24px;border-bottom:1px solid var(--divider);flex-shrink:0}
    h2{font:400 20px/28px var(--colab-google-sans-font-family,'Google Sans',Roboto,Arial,sans-serif);margin:0}h3{font-size:14px;font-weight:500;margin:24px 0 8px}
    button{font-family:inherit;font-size:14px;font-weight:500;line-height:20px;border:0;border-radius:4px;background:transparent;color:var(--accent);min-height:36px;padding:8px 16px;cursor:pointer}button:hover,summary:hover{background:var(--hover)}button:focus-visible,summary:focus-visible{outline:2px solid var(--colab-focus-ring-color,var(--accent));outline-offset:2px}
    header button{display:grid;place-items:center;min-height:32px;width:32px;padding:0;font:24px/1 Arial,sans-serif;color:var(--secondary);border-radius:50%}
    .content{padding:20px 24px;overflow:auto;min-height:0}p{margin:0}.path{font:13px/20px var(--colab-code-font-family,monospace);overflow-wrap:anywhere;color:var(--secondary)}.status-row{display:flex;align-items:center;gap:8px;margin-top:8px}.status{font-size:12px;color:var(--secondary)}#scan-progress{display:inline-flex}.muted{font-size:12px;color:var(--secondary)}.error{color:var(--colab-error-color,#b3261e)}.warning{margin-top:16px;padding:12px;border-radius:4px;background:var(--colab-warning-container-color,#fff2cc);color:var(--colab-on-warning-container-color,#5f4100);font-size:12px;overflow-wrap:anywhere}
    dl{margin:20px 0 0;padding-bottom:16px;border-bottom:1px solid var(--divider)}dl>div{display:grid;grid-template-columns:160px minmax(0,1fr);gap:16px;padding:6px 0}dt{color:var(--secondary)}dd{margin:0;font-variant-numeric:tabular-nums}#size{font-weight:500}#exact{display:block;font-size:12px;font-weight:400;color:var(--secondary);overflow-wrap:anywhere}
    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}th{text-align:left;color:var(--secondary);font-size:12px;font-weight:400}td,th{padding:8px 0;border-bottom:1px solid var(--divider)}td:first-child{overflow-wrap:anywhere;padding-right:16px}td:last-child,th:last-child{width:96px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}tbody tr:last-child td{border-bottom:0}
    details{margin-top:16px;font-size:12px;color:var(--secondary)}summary{width:fit-content;padding:4px 0;cursor:pointer;border-radius:2px}#notes{margin-top:8px}footer{display:flex;justify-content:flex-end;padding:8px 16px;border-top:1px solid var(--divider);flex-shrink:0}[hidden]{display:none!important}
    @media(max-width:420px){header{padding-left:20px}.content{padding:16px 20px}dl>div{grid-template-columns:125px minmax(0,1fr);gap:12px}}
  `;
  const metric=(label,id)=>node('div',{},node('dt',{},label),node('dd',{id}));
  const sizeMetric=node('div',{},node('dt',{},'Total file size'),node('dd',{},node('span',{id:'size'}),node('span',{id:'exact'})));
  const dialog=node('dialog',{'aria-labelledby':'title','aria-describedby':'folder-path'},
    node('header',{},node('h2',{id:'title'},'Folder details'),node('button',{id:'close','aria-label':'Close folder details'},'×')),
    node('div',{class:'content'},node('p',{class:'path',id:'folder-path'}),node('div',{class:'status-row'},node('span',{id:'scan-progress'}),node('p',{class:'status',id:'status',role:'status','aria-live':'polite'},'Scanning folder…')),
    node('div',{id:'result',hidden:''},node('div',{id:'warning',class:'warning',hidden:''}),
      node('dl',{},sizeMetric,metric('Files','files'),metric('Subfolders','folders'),metric('Symbolic links','links')),
      node('h3',{},'Largest files'),node('p',{id:'empty',class:'muted',hidden:''},'No regular files found.'),
      node('table',{id:'largest'},node('thead',{},node('tr',{},node('th',{scope:'col'},'File · relative path'),node('th',{scope:'col'},'Size'))),node('tbody')),
      node('details',{},node('summary',{},'About this scan'),node('p',{id:'notes'})))),node('footer',{},node('button',{id:'done'},'Cancel scan')));
  shadow.append(style,dialog);
  const get=id=>shadow.getElementById(id);
  const progress=createProgress('Scanning folder…');get('scan-progress').append(progress.element);
  get('folder-path').textContent=job.path;
  const previous=job.view?.querySelector('.menu-button')||document.activeElement;
  const view={closed:false,settled:false,close(){
    if(view.closed)return;
    view.closed=true;
    if(!view.settled){job.cancelled=true;setStatus(job,'Cancelling scan…');}
    dialog.close();host.remove();
    if(detailsDialog===view)detailsDialog=null;
    if(previous?.isConnected)previous.focus?.();
  },progress(result){
    if(view.closed)return;
    get('status').textContent=`Scanning… ${result.files.toLocaleString()} files · ${result.folders.toLocaleString()} subfolders found`;
    progress.update(get('status').textContent);
  },error(message){
    view.settled=true;if(view.closed)return;
    get('scan-progress').hidden=true;progress.element.remove();
    get('status').textContent=message;get('status').classList.add('error');get('done').textContent='Close';
  },render(result){
    view.settled=true;if(view.closed)return;
    get('scan-progress').hidden=true;progress.element.remove();
    get('status').textContent=result.skipped?'Scan finished with unreadable or changed items.':'Scan complete';
    get('result').hidden=false;get('done').textContent='Close';
    get('size').textContent=formatBytes(result.bytes);get('exact').textContent=result.bytes.toLocaleString()+' bytes';
    for(const key of ['files','folders','links'])get(key).textContent=result[key].toLocaleString();
    if(result.skipped){
      get('warning').hidden=false;
      get('warning').textContent=`Incomplete totals: ${result.skipped.toLocaleString()} item${result.skipped===1?'':'s'} could not be fully scanned. `+result.errors.map(item=>item.path+': '+item.error).join(' · ');
    }
    const body=shadow.querySelector('tbody');
    for(const file of result.largest){
      const row=document.createElement('tr'), name=document.createElement('td'), size=document.createElement('td');
      name.textContent=file.path;size.textContent=formatBytes(file.size);size.title=file.size.toLocaleString()+' bytes';row.append(name,size);body.append(row);
    }
    get('empty').hidden=result.largest.length!==0;get('largest').hidden=result.largest.length===0;
    get('notes').textContent='Hidden files included. Size is logical file bytes, not disk space; symbolic-link targets are not followed. Each file path is counted, including hard links. The selected folder itself is not counted as a subfolder. Live scan, not a snapshot.'+
      (result.excluded?` ${result.excluded} temporary extension folder${result.excluded===1?'':'s'} excluded.`:'')+
      (result.special?` ${result.special} special files excluded from file count and size.`:'');
  }};
  get('close').addEventListener('click',()=>view.close());get('done').addEventListener('click',()=>view.close());
  dialog.addEventListener('cancel',event=>{event.preventDefault();view.close();});
  document.body.append(host);dialog.showModal();detailsDialog=view;
  return view;
}
async function runDetails(target){
  let path;
  try{path=normalizePath(target.path);}catch(error){setStatus(target,'Details failed',error.message,true);return;}
  if(conflictingJob(jobs,path,'details'))return;
  const id=crypto.randomUUID();
  const job={kind:'details',path,view:target.view,id,dir:'/content/.colab-folder-zip-'+id,cancelled:false,terminal:null};
  const view=showDetailsDialog(job);
  jobs.set(path,job);setStatus(job,'Scanning…');addMenuItems();
  try{
    job.ctx=context();const ctx=job.ctx;
    const folder=await (await request(ctx,'/api/contents/'+encodePath(path)+'?content=0')).json();
    if(folder.type!=='directory')throw new Error('The selected path is not a folder.');
    if(job.cancelled){job.settled=true;return;}
    job.terminal=await openTerminal(ctx);
    await request(ctx,'/api/contents/'+encodePath(job.dir),'PUT',{type:'directory'});job.created=true;
    await put(ctx,job.dir+'/folder_details.py',detailsSource);
    if(job.cancelled){job.settled=true;return;}
    job.terminal.send(`python3 ${quote(job.dir+'/folder_details.py')} ${quote(path)} ${quote(job.dir)}\n`);
    let misses=0,cancelSent=false;
    while(true){
      await sleep(500);
      if(job.cancelled&&!cancelSent){await put(ctx,job.dir+'/cancel','cancel');cancelSent=true;}
      let response;
      try{response=await request(ctx,'/files/'+encodePath(job.dir+'/status.json')+'?t='+Date.now());}
      catch(error){
        if(error.status===404&&++misses<30)continue;
        if(error.status===404)throw new Error('The scan did not start. This runtime needs Python 3.8 or later.');
        throw error;
      }
      const result=await response.json();
      if(result.state==='cancelled'){job.cancelled=true;job.settled=true;break;}
      if(result.state==='error'){job.settled=true;throw new Error(result.error||'Folder scan failed.');}
      validateDetails(result,path);
      if(result.state==='details'){
        job.settled=true;
        if(!job.cancelled)view.render(result);
        break;
      }
      view.progress(result);
    }
    if(job.cancelled)view.error('Scan cancelled.');
    finishStatus(job,job.cancelled?'Scan cancelled':'Details ready',path);
  }catch(error){
    const message=error.message||'Connection to Colab was lost.';
    view.error(message);finishStatus(job,job.cancelled?'Scan cancelled':'Details failed',message,!job.cancelled);
  }finally{
    await job.terminal?.close();
    if(job.settled)await cleanup(job);
    jobs.delete(path);addMenuItems();
    if(job.cancelled)finishStatus(job,'Scan cancelled',path);
  }
}
