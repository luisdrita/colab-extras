// Preferences persist without tracking settings or sidebar activity.
const preferencesKey='colab-extras-preferences-v1';
const preferenceDefaults={overwrite:false};
let preferences={...preferenceDefaults};
try{
  const saved=JSON.parse(localStorage.getItem(preferencesKey)||'{}');
  for(const key of Object.keys(preferenceDefaults))if(typeof saved?.[key]==='boolean')preferences[key]=saved[key];
}catch{}
function preferencesRequest(args){
  if(args.action==='set'){
    if(jobs.size)throw new Error('Wait for the active operation to finish.');
    if(!Object.hasOwn(preferenceDefaults,args.key)||typeof args.value!=='boolean')throw new Error('Unknown setting.');
    const next={...preferences,[args.key]:args.value};
    localStorage.setItem(preferencesKey,JSON.stringify(next));preferences=next;
  }else if(args.action!=='get')throw new Error('Unknown settings request.');
  return {...preferences};
}
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='colab-extras-preferences')return;
  const {id,args}=event.data;if(typeof id!=='string')return;
  try{window.postMessage({channel:'colab-extras-preferences-result',id,result:preferencesRequest(args)},location.origin);}
  catch(error){window.postMessage({channel:'colab-extras-preferences-result',id,error:error.message},location.origin);}
});
function bridgeDownload(args,timeoutMs=30000){
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const listener=event=>{
      if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='colab-extras-isolated'||event.data.id!==id)return;
      window.removeEventListener('message',listener);clearTimeout(timer);
      event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);
    };
    const timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(new Error('Download helper unavailable.'));},timeoutMs);
    window.addEventListener('message',listener);
    window.postMessage({channel:'colab-extras-main',id,args},location.origin);
  });
}
async function downloadPermission(){
  // Probe while the ZIP is being prepared. Optional tracking must never
  // make the ordinary download depend on a permission or popup setting.
  try{return (await bridgeDownload({action:'permission'},1000)).granted===true;}
  catch{return false;}
}
async function downloadArchive(job){
  const tracked=await (job.downloadPermission||downloadPermission());
  assertRuntime(job.ctx);
  if(job.cancelled)throw new Error('Cancelled.');
  setStatus(job,'Downloading…',job.result.archive);
  if(tracked){
    // Once a download request is dispatched, do not retry through another
    // route: an uncertain response could otherwise create duplicate files.
    await managedDownload(job);
    return;
  }
  const files=document.querySelector('colab-file-browser')?.currentTree?.files;
  if(!files?.getFile)throw new Error('ZIP saved, but Colab file download is unavailable. Refresh Colab and try again.');
  const file=await files.getFile(job.result.archive);
  assertRuntime(job.ctx);
  if(job.cancelled)throw new Error('Cancelled.');
  await file.download({
    get canceled(){return job.cancelled;},
    update:n=>{
      const fraction=Number.isFinite(n)?Math.min(1,Math.max(0,n)):null;
      setStatus(job,fraction!==null?`Downloading ${Math.round(fraction*100)}%`:'Downloading…',job.result.archive,false,fraction);
    }
  });
}
async function managedDownload(job){
  const response=await request(job.ctx,'/files/'+encodePath(job.result.archive));
  const blob=await response.blob();
  if(job.cancelled)throw new Error('Cancelled.');
  const url=URL.createObjectURL(blob);
  try{
    const result=await bridgeDownload({action:'download',url,name:job.result.archive.split('/').pop(),operation:job.id});
    job.downloadId=result.id;
  }finally{
    // downloads.download resolves when Chrome has accepted the request.
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
}
