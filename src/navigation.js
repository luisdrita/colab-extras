// A shortcut based on the current Files location only; no navigation history.
let contentShortcut=null;
function contentNavigation(){
  const tree=document.querySelector('colab-file-browser')?.currentTree;
  const files=tree?.files,host=tree?.querySelector?.('.parent-link');
  if(!tree?.isConnected||!host||typeof files?.rootPath!=='string'||typeof tree.refresh!=='function')return null;
  let ctx;try{ctx=context();}catch{return null;}
  return {tree,files,host,runtime:ctx.runtime,path:files.rootPath.replace(/^\/+|\/+$/g,'')};
}
function sameContentNavigation(shortcut,location){
  return shortcut&&location&&['tree','files','host','runtime'].every(key=>shortcut[key]===location[key]);
}
function syncContentShortcut(){
  const location=contentNavigation();
  // Discard callbacks belonging to a replaced tree/runtime or a newer navigation.
  if(contentShortcut&&(!sameContentNavigation(contentShortcut,location)||
      (contentShortcut.busy&&location.path!=='content'))){
    contentShortcut.element.remove();contentShortcut=null;
  }
  const inContent=location&&(location.path==='content'||location.path.startsWith('content/'));
  if(!location||(inContent&&!contentShortcut?.busy)){
    contentShortcut?.element.remove();contentShortcut=null;return;
  }
  if(!contentShortcut){
    const element=document.createElement('div');element.dataset.cfzContentShortcut='';
    const style=document.createElement('style');
    style.textContent='[data-cfz-content-shortcut]{margin:4px 8px;color:var(--colab-primary-text-color,inherit);font:inherit}[data-cfz-content-shortcut] button{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}[data-cfz-content-shortcut] button:hover{background:var(--colab-highlighted-surface-color,rgba(128,128,128,.12))}[data-cfz-content-shortcut] button:focus-visible{outline:2px solid var(--colab-primary-color,#1a73e8);outline-offset:-2px}[data-cfz-content-shortcut] button:disabled{cursor:wait;opacity:.65}[data-cfz-content-error]{margin:2px 12px 6px;font-size:12px;overflow-wrap:anywhere;color:var(--colab-error-color,#b3261e)}';
    const button=document.createElement('button');button.type='button';button.title='Return to your session folder';
    const icon=document.createElement('span');icon.textContent='↳';icon.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.textContent='Back to /content';button.append(icon,label);
    const error=document.createElement('div');error.dataset.cfzContentError='';error.hidden=true;error.setAttribute('role','status');
    element.append(style,button,error);
    const shortcut={...location,element,button,label,error,busy:false};contentShortcut=shortcut;
    button.addEventListener('click',event=>{
      if(!event.isTrusted)return;
      event.preventDefault();event.stopPropagation();void returnToContent(shortcut);
    });
  }
  // Colab owns the native '..' row. Keep it untouched and place our shortcut above it.
  if(contentShortcut.element.parentElement!==location.host)location.host.prepend(contentShortcut.element);
}
async function returnToContent(shortcut){
  if(contentShortcut!==shortcut||shortcut.busy||!sameContentNavigation(shortcut,contentNavigation()))return;
  const previous=shortcut.files.rootPath;
  shortcut.busy=true;shortcut.button.disabled=true;shortcut.button.setAttribute('aria-busy','true');
  shortcut.label.textContent='Opening /content…';shortcut.error.hidden=true;shortcut.error.textContent='';
  clearSelection();selected=null;
  // Match Colab's native parent-row navigation, including its awaitable refresh.
  shortcut.files.rootPath='content';
  try{await shortcut.tree.refresh();}
  catch(error){
    if(contentShortcut===shortcut&&sameContentNavigation(shortcut,contentNavigation())&&shortcut.files.rootPath==='content'){
      shortcut.files.rootPath=previous;
      shortcut.error.textContent='Could not open /content: '+(error?.message||'Refresh Files and try again.');shortcut.error.hidden=false;
    }
  }finally{
    if(contentShortcut===shortcut){
      shortcut.busy=false;shortcut.button.disabled=false;shortcut.button.removeAttribute('aria-busy');
      shortcut.label.textContent='Back to /content';syncContentShortcut();
    }
  }
}
syncContentShortcut();
