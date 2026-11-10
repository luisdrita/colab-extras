// Serve the repository at :8765. Uses the generated extension in isolated Chrome.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const errors=[],dialogs=[];
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});
  await page.goto('http://127.0.0.1:8765/tests/ui.html');
  // Reproduce the inspected native tree API and parent-link container.
  await page.evaluate(()=>{
   const browser=document.querySelector('colab-file-browser');
   window.navigationTest={calls:0,mode:'normal',pending:[]};
   window.installTree=(path='content')=>{
    const tree=document.createElement('colab-file-tree'),host=document.createElement('div'),root=document.createElement('div');
    host.className='parent-link';root.className='files-root';tree.append(host,root);
    tree.files={rootPath:path};
    const render=()=>{
     host.querySelector('[data-native-parent]')?.remove();
     if(tree.files.rootPath){
      const parent=document.createElement('button');parent.dataset.nativeParent='';parent.textContent='..';
      parent.addEventListener('click',()=>{const parts=tree.files.rootPath.split('/');parts.pop();tree.files.rootPath=parts.join('/');void tree.refresh();});host.append(parent);
     }
     root.textContent='Current folder: /'+tree.files.rootPath;
    };
    tree.refresh=async()=>{
     navigationTest.calls++;
     if(navigationTest.mode==='slow')await new Promise((resolve,reject)=>navigationTest.pending.push({resolve,reject}));
     if(navigationTest.mode==='error')throw Error('Connection lost');
     render();
    };
    browser.currentTree=tree;browser.replaceChildren(tree);render();return tree;
   };
   installTree();
  });
  const shortcut=page.locator('[data-cfz-content-shortcut]');
  const button=page.getByRole('button',{name:'Back to /content',exact:true});
  const rootPath=()=>page.evaluate(()=>document.querySelector('colab-file-browser').currentTree.files.rootPath);
  const navigate=async path=>{await page.evaluate(async path=>{const tree=document.querySelector('colab-file-browser').currentTree;tree.files.rootPath=path;await tree.refresh();},path);};
  assert.equal(await shortcut.count(),0);
  await navigate('content/results');assert.equal(await shortcut.count(),0);
  await page.locator('[data-native-parent]').click();assert.equal(await rootPath(),'content');assert.equal(await shortcut.count(),0);
  await page.locator('[data-native-parent]').click();await button.waitFor();assert.equal(await rootPath(),'');
  assert.equal(await shortcut.evaluate(node=>node.parentElement.className),'parent-link');
  await button.click();await shortcut.waitFor({state:'detached'});assert.equal(await rootPath(),'content');
  console.log('PASS native parent navigation reveals the shortcut at /; mouse click returns to /content and hides it');

  for(const path of ['/','tmp','content-other','/content-other','content-copy/sub']){
   await navigate(path);await button.waitFor();assert.equal(await shortcut.count(),1);
  }
  for(const path of ['content','/content/','content/results','/content/results/']){
   await navigate(path);await shortcut.waitFor({state:'detached'});
  }
  await navigate('usr/local');await button.waitFor();
  assert.equal(await shortcut.evaluate(node=>node.nextElementSibling?.dataset.nativeParent),'');
  await page.locator('colab-file-view[data-path="/content/notes.txt"] .file-tree-name').last().click();
  assert.equal(await page.locator('[data-cfz-selected]').count(),1);
  await button.focus();await page.keyboard.press('Enter');await shortcut.waitFor({state:'detached'});
  assert.equal(await rootPath(),'content');assert.equal(await page.locator('[data-cfz-selected]').count(),0);
  console.log('PASS nested content stays uncluttered; sibling paths remain eligible; keyboard navigation clears the old selection');

  await navigate('');await button.waitFor();
  await page.evaluate(()=>{navigationTest.mode='slow';navigationTest.calls=0;});
  await button.click();await page.waitForFunction(()=>navigationTest.pending.length===1);
  assert.equal(await page.getByRole('button',{name:'Opening /content…'}).isDisabled(),true);
  await page.evaluate(()=>document.querySelector('[data-cfz-content-shortcut] button').click());
  assert.equal(await page.evaluate(()=>navigationTest.calls),1);
  await page.evaluate(()=>{navigationTest.mode='normal';navigationTest.pending.shift().resolve();});
  await shortcut.waitFor({state:'detached'});assert.equal(await rootPath(),'content');
  console.log('PASS delayed refresh keeps feedback visible and prevents duplicate requests');

  await navigate('tmp');await button.waitFor();await page.evaluate(()=>navigationTest.mode='error');
  await button.click();await page.getByRole('status').filter({hasText:'Connection lost'}).waitFor();
  assert.equal(await rootPath(),'tmp');assert.equal(await button.isEnabled(),true);
  await page.evaluate(()=>navigationTest.mode='normal');await button.click();await shortcut.waitFor({state:'detached'});
  assert.equal(await rootPath(),'content');
  console.log('PASS failed refresh restores the prior location, reports an inline error and permits retry');

  await navigate('');await button.waitFor();await page.evaluate(()=>navigationTest.mode='slow');
  await button.click();await page.waitForFunction(()=>navigationTest.pending.length===1);
  await page.evaluate(()=>{kernel.runtime={};installTree('tmp');});await button.waitFor();
  await page.evaluate(()=>navigationTest.pending.shift().reject(Error('Old connection lost')));
  assert.equal(await rootPath(),'tmp');assert.equal(await page.locator('[data-cfz-content-error]:visible').count(),0);
  await page.evaluate(()=>{navigationTest.mode='normal';});await button.click();await shortcut.waitFor({state:'detached'});
  console.log('PASS replacing the runtime/tree isolates callbacks and preserves the new location');

  await navigate('');await button.waitFor();await page.evaluate(()=>navigationTest.mode='slow');
  await button.click();await page.waitForFunction(()=>navigationTest.pending.length===1);
  await page.evaluate(()=>{navigationTest.mode='normal';});await navigate('usr');await button.waitFor();
  await page.evaluate(()=>navigationTest.pending.shift().reject(Error('Superseded')));
  assert.equal(await rootPath(),'usr');assert.equal(await page.locator('[data-cfz-content-error]:visible').count(),0);
  await page.evaluate(()=>{document.querySelector('colab-file-browser .parent-link').replaceChildren();});await button.waitFor();
  assert.equal(await shortcut.count(),1);
  console.log('PASS a newer native navigation wins over an older failure; rerender restores exactly one shortcut');

  if(process.env.UI_SCREENSHOTS){
   fs.mkdirSync(process.env.UI_SCREENSHOTS,{recursive:true});
   for(const theme of ['light','dark']){
    await page.locator('#theme').selectOption(theme);
    await page.locator('aside').screenshot({path:process.env.UI_SCREENSHOTS+'/Content_Shortcut_'+theme+'.png'});
   }
   await page.setViewportSize({width:390,height:844});await page.locator('aside').screenshot({path:process.env.UI_SCREENSHOTS+'/Content_Shortcut_narrow.png'});
  }
  await page.evaluate(()=>{kernel.runtime=null;document.querySelector('colab-file-browser').append(document.createElement('div'));});
  await shortcut.waitFor({state:'detached'});assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS disconnect hides the shortcut; no page errors or confirmation dialogs');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
