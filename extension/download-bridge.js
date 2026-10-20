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
