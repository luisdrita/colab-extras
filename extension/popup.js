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
  status.textContent=result.downloads.length?'These downloads are tracked separately from runtime Undo.':'No managed downloads yet. Enable tracking in the settings above.';
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

const preferencesStatus=document.querySelector('#preferences-status');
async function preferences(args){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab)throw new Error('Open a Colab notebook to change these settings.');
  const response=await chrome.tabs.sendMessage(tab.id,{channel:'preferences',...args});
  if(response.error)throw new Error(response.error);
  for(const input of document.querySelectorAll('[data-preference]')){
    input.checked=Boolean(response.result[input.dataset.preference]);input.disabled=false;
  }
}
for(const input of document.querySelectorAll('[data-preference]'))input.addEventListener('change',async()=>{
  input.disabled=true;
  try{await preferences({action:'set',key:input.dataset.preference,value:input.checked});preferencesStatus.textContent='Setting saved. The sidebar Undo button can reverse this change.';}
  catch(error){input.checked=!input.checked;input.disabled=false;preferencesStatus.textContent=error.message;}
});
preferences({action:'get'}).catch(()=>{preferencesStatus.textContent='Open or refresh a Colab notebook to change these settings.';});
