window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='colab-extras-main')return;
  const {id,args}=event.data;
  if(typeof id!=='string'||!['permission','download'].includes(args?.action))return;
  try{
    const result=await chrome.runtime.sendMessage(args);
    window.postMessage({channel:'colab-extras-isolated',id,...result},location.origin);
  }catch(error){
    window.postMessage({channel:'colab-extras-isolated',id,error:error.message},location.origin);
  }
});

// Settings are requested only by this extension's popup and applied in the
// active Colab tab, so they remain part of that tab's Undo history.
chrome.runtime.onMessage.addListener((args,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html')||args.channel!=='preferences')return;
  const id=crypto.randomUUID();
  const listener=event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='colab-extras-preferences-result'||event.data.id!==id)return;
    clearTimeout(timer);window.removeEventListener('message',listener);
    reply({result:event.data.result,error:event.data.error});
  };
  const timer=setTimeout(()=>{window.removeEventListener('message',listener);reply({error:'Refresh the Colab tab to load its settings.'});},5000);
  window.addEventListener('message',listener);
  window.postMessage({channel:'colab-extras-preferences',id,args},location.origin);
  return true;
});
