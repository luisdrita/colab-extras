// Serve the repository at :8765. Hold actual await points in the packaged UI.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:1100}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const holdCompletion=()=>page.evaluate(()=>{
      const xhr=kernel.getKernelXhr(),fetch=xhr.fetch;
      const tree=document.querySelector('colab-file-browser').currentTree,refresh=tree.refresh;
      const wait=stage=>new Promise(resolve=>{window.held={stage,resolve};});
      const heldCleanups=new Set();
      xhr.fetch=async function(path,opts){
        if(opts.method==='DELETE'&&path.endsWith('/archive.py')&&!heldCleanups.has(path)){
          heldCleanups.add(path);await wait('cleanup');
        }
        return fetch.apply(this,arguments);
      };
      tree.refresh=async function(){
        await refresh.apply(this,arguments);
        await wait('refresh');
      };
    });
    const url='http://127.0.0.1:8765/tests/ui.html';
    await page.goto(url);await holdCompletion();
    const row=page.locator('[data-path="/content/demo.zip"] > .file-title-row');
    const menu=page.getByRole('menuitem',{name:'Extract here',exact:true});
    const rings=page.locator('[data-cfz-progress]');
    const resume=()=>page.evaluate(()=>{const held=window.held;window.held=null;held.resolve();});
    const wait=stage=>page.waitForFunction(s=>window.held?.stage===s,stage);
    await row.click({button:'right'});await menu.click();await wait('cleanup');
    await row.click({button:'right'});
    assert.equal(await menu.getAttribute('aria-disabled'),'true');
    assert.equal(await row.getByRole('progressbar',{name:'Finishing…'}).count(),1);
    await resume();await wait('refresh');
    assert.equal(await menu.getAttribute('aria-disabled'),'true');
    assert.equal(await row.getByRole('progressbar',{name:'Updating Files…'}).count(),1);
    await page.evaluate(()=>{
      const view=document.querySelector('[data-path="/content/demo.zip"]');
      const next=view.nextSibling,parent=view.parentNode;
      view.remove();
      window.restoreTestRow=()=>parent.insertBefore(view,next);
    });
    await page.locator('.file-tree-buttons').getByRole('progressbar',{name:'Updating Files…'}).waitFor();
    await page.evaluate(()=>window.restoreTestRow());
    await row.getByRole('progressbar',{name:'Updating Files…'}).waitFor();
    await resume();
    await page.waitForFunction(()=>document.querySelector('[data-cfz-action="extract"]')?.getAttribute('aria-disabled')==='false');
    assert.equal(await rings.count(),0);
    // A subsequent refresh failure must also release the lock and explain what failed.
    await page.evaluate(()=>{
      document.querySelector('colab-file-browser').currentTree.refresh=async()=>{throw Error('test refresh failure');};
    });
    await menu.click();await wait('cleanup');await resume();
    await page.getByText(/The Files sidebar could not be updated/).waitFor();
    assert.equal(await rings.count(),0);
    await row.click({button:'right'});
    assert.equal(await menu.getAttribute('aria-disabled'),'false');
    assert.deepEqual(errors,[]);
    console.log('PASS ring and lock survive cleanup, refresh and row removal, then release together; refresh errors allow retry');

    await page.goto(url);await holdCompletion();
    const paths=['/content/demo.zip','/content/notes.txt','/content/results'];
    const batchRows=paths.map(path=>page.locator(`[data-path="${path}"] > .file-title-row`));
    const modifier=await page.evaluate(()=>/Mac/i.test(navigator.userAgentData?.platform||navigator.platform)?'Meta':'Control');
    for(const batchRow of batchRows)await batchRow.locator('.file-tree-name').last().click({modifiers:[modifier]});
    const checkRowRings=async(label)=>{
      for(const batchRow of batchRows)assert.equal(await batchRow.getByRole('progressbar',label?{name:label}:{}).isVisible(),true);
    };
    const zip=page.getByRole('menuitem',{name:'Download selected as ZIP (3)'});
    const remove=page.getByRole('menuitem',{name:'Delete selected items (3)'});
    const scenario=page.locator('#scenario');
    await scenario.selectOption('download-slow');
    await row.click({button:'right'});await zip.click();
    await row.getByRole('progressbar',{name:'Downloading 40%'}).waitFor();
    await checkRowRings('Downloading 40%');
    // Change only the simulated runtime response, leaving the group selected.
    await scenario.selectOption('normal');await wait('cleanup');await checkRowRings('Finishing…');
    await row.click({button:'right'});
    assert.equal(await zip.isEnabled(),false);assert.equal(await remove.isEnabled(),false);
    await resume();await wait('refresh');await checkRowRings('Updating Files…');
    assert.equal(await remove.isEnabled(),false);
    await resume();await page.waitForFunction(()=>!document.querySelector('[data-cfz-progress]'));
    assert.equal(await zip.isEnabled(),true);assert.equal(await remove.isEnabled(),true);
    console.log('PASS all three group ZIP rings cover transfer, cleanup and Files refresh, then both actions unlock');

    await scenario.selectOption('bulk-first-complete');
    await remove.click();
    await page.getByRole('progressbar',{name:'Finishing batch…'}).first().waitFor();
    await checkRowRings();
    await scenario.selectOption('normal');await wait('cleanup');await checkRowRings('Finishing…');
    await resume();await wait('refresh');
    for(const batchRow of batchRows)assert.equal(await batchRow.count(),0);
    await page.locator('.file-tree-buttons').getByRole('progressbar',{name:'Updating Files…'}).waitFor();
    const sibling=page.locator('[data-path="/content/other-folder"] > .file-title-row');
    await sibling.click({button:'right'});
    const details=page.getByRole('menuitem',{name:'Folder details',exact:true});
    assert.equal(await details.isEnabled(),false);
    await resume();await page.waitForFunction(()=>!document.querySelector('[data-cfz-progress]'));
    assert.equal(await details.isEnabled(),true);
    assert.deepEqual(errors,[]);
    console.log('PASS three-item delete keeps early finishers visible, then keeps the toolbar ring until Files is ready');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
