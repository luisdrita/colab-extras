let queue=Promise.resolve();
chrome.runtime.onMessage.addListener((args,sender,reply)=>{
  queue=queue.then(async()=>{
    const fromPopup=sender.url===chrome.runtime.getURL('popup.html');
    const fromColab=sender.tab&&new URL(sender.url).origin==='https://colab.research.google.com';
    if(!fromPopup&&!fromColab)throw new Error('Unrecognised download request.');
    const granted=await chrome.permissions.contains({permissions:['downloads']});
    if(args.action==='permission')return {granted};
    if(!granted)throw new Error('Enable download management in the extension popup.');
    const {downloads:records=[]}=await chrome.storage.local.get('downloads');
    if(args.action==='download'&&fromColab){
      if(typeof args.url!=='string'||!args.url.startsWith('blob:https://colab.research.google.com/')||
        typeof args.name!=='string'||/[\\/]/.test(args.name)||!args.name.endsWith('.zip')||
        typeof args.operation!=='string'||!/^[a-f0-9-]{36}$/.test(args.operation))throw new Error('Invalid managed download.');
      const id=await chrome.downloads.download({url:args.url,filename:args.name,conflictAction:'uniquify'});
      records.push({id,operation:args.operation,name:args.name,time:Date.now()});
      await chrome.storage.local.set({downloads:records});
      return {id};
    }
    if(!fromPopup)throw new Error('Manage local files from the extension popup.');
    if(args.action==='list'){
      const list=[];
      for(const record of records){
        const [item]=await chrome.downloads.search({id:record.id});
        if(item?.byExtensionId===chrome.runtime.id)list.push({...record,state:item.state,exists:item.exists,filename:item.filename});
      }
      return {downloads:list.reverse()};
    }
    const record=records.find(item=>item.id===args.id);
    const [item]=record?await chrome.downloads.search({id:record.id}):[];
    if(!item||item.byExtensionId!==chrome.runtime.id)throw new Error('This download is not managed by Colab Extras.');
    if(args.action==='cancel')await chrome.downloads.cancel(record.id);
    else if(args.action==='remove'){
      if(item.state!=='complete'||!item.exists)throw new Error('The downloaded file is unavailable.');
      await chrome.downloads.removeFile(record.id);
    }else throw new Error('Unknown action.');
    return {done:true};
  }).then(result=>reply({result}),error=>reply({error:error.message}));
  return true;
});
