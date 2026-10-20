const status=document.querySelector('#status'),list=document.querySelector('#downloads');
async function message(args){
  const response=await chrome.runtime.sendMessage(args);
  if(response.error)throw new Error(response.error);
  return response.result;
}
async function refresh(){
  const {granted}=await message({action:'permission'});
  document.querySelector('#enable-downloads').hidden=granted;
  if(!granted)return;
  const result=await message({action:'list'});
  list.replaceChildren();
  status.textContent=result.downloads.length?'These downloads are tracked separately from runtime Undo.':'No managed downloads yet. Enable tracking in the sidebar Undo settings.';
  for(const item of result.downloads){
    const row=document.createElement('p'),label=document.createElement('span');
    label.textContent=item.name+' · '+item.state;row.append(label);
    const action=item.state==='in_progress'?'cancel':item.state==='complete'&&item.exists?'remove':null;
    if(action){
      const button=document.createElement('button');
      button.textContent=action==='cancel'?'Cancel download':'Delete local copy';
      button.addEventListener('click',async event=>{
        if(!event.isTrusted)return;
        if(action==='remove'&&!confirm('Permanently delete this downloaded file?\n\n'+item.filename+'\n\nCopies elsewhere are unaffected.'))return;
        try{await message({action,id:item.id});await refresh();}catch(error){status.textContent=error.message;}
      });
      row.append(button);
    }
    list.append(row);
  }
}
document.querySelector('#enable-downloads').addEventListener('click',async()=>{
  try{
    await chrome.permissions.request({permissions:['downloads']});
    await refresh();
  }catch(error){status.textContent=error.message;}
});
refresh().catch(error=>status.textContent=error.message);
