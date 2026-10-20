const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
 const listeners=new Set(),posted=[];let receive;
 const window={addEventListener:(name,fn)=>listeners.add(fn),removeEventListener:(name,fn)=>listeners.delete(fn),postMessage:data=>posted.push(data)};
 const chrome={runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>receive=fn}}};
 const sandbox={window,chrome,location:{origin:'https://colab.research.google.com'},crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../extension/download-bridge.js'),'utf8'),sandbox);
 return {receive,posted,listeners,window,sender:{id:'test',url:chrome.runtime.getURL('popup.html')}};
}
test('only the extension popup can request tab preferences',()=>{
 const {receive,posted,sender}=setup();
 receive({channel:'preferences',action:'get'},{...sender,url:'https://example.com'},()=>{});
 receive({channel:'preferences',action:'set',key:'overwrite',value:true},{...sender,id:'another'},()=>{});
 assert.equal(posted.length,0);
});
test('popup setting response is matched by its request id and forwarded',async()=>{
 const {receive,posted,listeners,window,sender}=setup();let result;
 assert.equal(receive({channel:'preferences',action:'set',key:'overwrite',value:true},sender,value=>{result=value;}),true);
 const request=posted[0];assert.equal(request.args.key,'overwrite');
 for(const fn of listeners)await fn({source:window,origin:'https://colab.research.google.com',data:{channel:'colab-extras-preferences-result',id:'wrong',result:{overwrite:false}}});
 assert.equal(result,undefined);
 for(const fn of [...listeners])await fn({source:window,origin:'https://colab.research.google.com',data:{channel:'colab-extras-preferences-result',id:request.id,result:{overwrite:true}}});
 assert.equal(result.result.overwrite,true);
});
