// Optional isolated browser smoke suite. Serve this repository at :8765.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const errors=[],dialogs=[];
 try{
  for(const [platform,modifier] of [['MacIntel','Meta'],['Win32','Control']]){
   const page=await browser.newPage({viewport:{width:1100,height:1000}});
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss();});
   const emulateControl=platform==='Win32'&&process.platform==='darwin',inputModifier=emulateControl?'Meta':modifier;
   // macOS turns physical Ctrl-click into a context click. Deliver equivalent
   // Windows event fields on this host without changing the extension code.
   await page.addInitScript(({platform,emulateControl})=>{
    Object.defineProperty(navigator,'platform',{value:platform});Object.defineProperty(navigator,'userAgentData',{value:undefined});
    if(emulateControl)for(const type of ['pointerdown','mousedown','mouseup','click','dblclick'])window.addEventListener(type,event=>{
     if(event.metaKey){Object.defineProperty(event,'metaKey',{value:false});Object.defineProperty(event,'ctrlKey',{value:true});}
    },true);
   },{platform,emulateControl});
   const view=path=>page.locator(`colab-file-view[data-path="${path}"]`);
   const row=path=>view(path).locator(':scope > .file-title-row');
   const progress=path=>row(path).locator('[data-cfz-progress]');
   const chosen=async()=>page.locator('.file-title-row[data-cfz-selected]').evaluateAll(rows=>rows.map(r=>r.parentElement.dataset.path).sort());
   const select=async path=>row(path).locator('.file-tree-name').last().click({modifiers:[inputModifier]});
   const menu=page.getByRole('menu');
   const log=async()=>page.locator('#events').innerText();
   const load=async(scenario='normal',nestedFiles=false)=>{await page.goto('http://127.0.0.1:8765/tests/ui.html'+(nestedFiles?'?nested-files=1':''));await row('/content/results').waitFor();await page.locator('#scenario').selectOption(scenario);};
   const pair=async()=>{await select('/content/results');await select('/content/notes.txt');};
   const start=async(path='/content/results',keyboard=false)=>{
    await row(path).click({button:'right'});
    assert.equal(await menu.getByRole('menuitem').count(),1);assert.equal(await menu.getByRole('separator').count(),0);
    if(keyboard){await menu.press('ArrowDown');await page.keyboard.press('ArrowUp');await page.keyboard.press('r');await page.keyboard.press('Enter');}
    else await menu.getByRole('menuitem',{name:/Delete selected items/}).click();
    await page.waitForFunction(()=>document.getElementById('events').textContent.includes('Started delete'));
    assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(dialogs,[]);
   };
   const done=async()=>{await page.waitForFunction(()=>document.getElementById('events').textContent.includes('Files sidebar refreshed'));await page.waitForFunction(()=>!document.querySelector('[data-cfz-progress]'));};
   const refresh=async()=>page.evaluate(()=>document.getElementById('refresh-rows').click());

   await load();await pair();
   assert.equal(await page.locator('[data-cfz-select],[data-cfz-selection]').count(),0);
   assert.deepEqual(await chosen(),['/content/notes.txt','/content/results']);
   await row('/content/results').click({button:'right'});
   assert.equal(await menu.getByRole('menuitem').count(),1);await menu.press('Escape');
   await page.locator('h1').click({button:'right'});assert.equal((await chosen()).length,2);
   await page.keyboard.press('Escape');await page.locator('h1').click();assert.deepEqual(await chosen(),[]);
   await pair();await row('/content/other-folder').click({button:'right'});
   assert.deepEqual(await chosen(),['/content/other-folder']);assert.equal(await menu.getByRole('menuitem',{name:'Folder details',exact:true}).count(),1);await menu.press('Escape');
   console.log(`PASS ${platform}: modifier selection, outside left-click, right-click preservation and group-only menus`);

   await load('delete-slow',true);await row('/content/results').click();
   await select('/content/results/first.txt');await select('/content/results/second.txt');
   const selectedChildren=['/content/results/first.txt','/content/results/second.txt'];
   assert.deepEqual(await chosen(),selectedChildren);
   await start(selectedChildren[0]);
   assert.deepEqual(await page.evaluate(()=>fileActionArgs.get(state.job.path)),selectedChildren.map(path=>({path,isDirectory:false})));
   const busyPaths=()=>page.locator('[data-cfz-progress]').evaluateAll(rings=>rings.map(ring=>ring.closest('colab-file-view').dataset.path).sort());
   assert.deepEqual(await busyPaths(),selectedChildren);
   await refresh();assert.equal(await progress('/content/results').count(),0);
   await row('/content/results').locator('.directory-icon').click();await progress(selectedChildren[0]).waitFor();
   assert.deepEqual(await busyPaths(),selectedChildren);
   await page.locator('#theme').selectOption('dark');
   if(process.env.UI_SCREENSHOTS){fs.mkdirSync(process.env.UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.UI_SCREENSHOTS+'/Selected_Children_'+platform+'.png'});}
   await page.locator('#scenario').selectOption('normal');await done();
   for(const path of selectedChildren)assert.equal(await view(path).count(),0);
   for(const path of ['/content/results','/content/results/nested','/content/results/keep.txt','/content/notes.txt'])assert.equal(await view(path).count(),1);
   await row('/content/results').locator('.directory-icon').click();await row('/content/results').locator('.directory-icon').click();
   for(const path of selectedChildren)assert.equal(await view(path).count(),0);
   assert.equal(await view('/content/results/keep.txt').count(),1);
   console.log(`PASS ${platform}: deleting two selected child files preserves their parent and all siblings; only those two rows show circles across refresh`);

   await load('delete-slow',true);await row('/content/results').click();
   await select('/content/results/nested');await select('/content/results/first.txt');
   assert.deepEqual(await chosen(),['/content/results/first.txt','/content/results/nested']);
   await start('/content/results/nested');
   assert.deepEqual(await page.evaluate(()=>fileActionArgs.get(state.job.path)),[{path:'/content/results/nested',isDirectory:true},{path:'/content/results/first.txt',isDirectory:false}]);
   assert.deepEqual(await busyPaths(),['/content/results/first.txt','/content/results/nested']);
   await page.locator('#scenario').selectOption('normal');await done();
   for(const path of ['/content/results','/content/results/second.txt','/content/results/keep.txt'])assert.equal(await view(path).count(),1);
   console.log(`PASS ${platform}: mixed child file/folder deletion never promotes the enclosing folder into the plan`);

   await load('delete-slow',true);await row('/content/results').click();
   await select('/content/results/first.txt');await select('/content/results/second.txt');await select('/content/results');
   assert.deepEqual(await chosen(),['/content/results']);
   await row('/content/results').press(platform==='MacIntel'?'Meta+Backspace':'Delete');
   await page.waitForFunction(()=>document.getElementById('events').textContent.includes('Started delete'));
   assert.deepEqual(await page.evaluate(()=>fileActionArgs.get(state.job.path)),[{path:'/content/results',isDirectory:true}]);
   await page.locator('#scenario').selectOption('normal');await done();
   assert.equal(await view('/content/results').count(),0);assert.equal(await view('/content/notes.txt').count(),1);
   console.log(`PASS ${platform}: explicitly selecting the parent replaces its children and still allows whole-folder deletion`);

   await load('delete-slow');await pair();await start();
   for(const path of ['/content/results','/content/notes.txt']){
    assert.equal(await progress(path).count(),1);
    assert.equal(await row(path).evaluate(el=>{
     const name=el.querySelector('.file-tree-name').getBoundingClientRect();
     const ring=el.querySelector('[data-cfz-progress]').getBoundingClientRect();
     return ring.left>=name.right&&ring.top<name.bottom&&ring.bottom>name.top;
    }),true);
    assert.equal(await progress(path).evaluate(el=>getComputedStyle(el.shadowRoot.querySelector('svg')).animationName),'cfz-rotate');
   }
   assert.equal(await progress('/content/other-folder').count(),0);
   await page.locator('h1').click();assert.deepEqual(await chosen(),[]);assert.equal(await page.locator('[data-cfz-progress]').count(),2);
   await refresh();assert.equal(await page.locator('[data-cfz-progress]').count(),2);
   await row('/content/results').locator('.directory-icon').click();
   await progress('/content/results/nested').waitFor();assert.equal(await page.locator('[data-cfz-progress]').count(),3);
   await row('/content/results').locator('.directory-icon').click();await row('/content/results').locator('.directory-icon').click();await progress('/content/results/nested').waitFor();
   await page.locator('#theme').selectOption('dark');
   if(process.env.UI_SCREENSHOTS){fs.mkdirSync(process.env.UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.UI_SCREENSHOTS+'/Batch_Progress_'+platform+'.png'});}
   console.log(`PASS ${platform}: immediate execution, no dialogs, animated rings to the right of file names on all targets and newly visible descendants, refresh and deselection`);
   await page.locator('#scenario').selectOption('bulk-first-complete');
   await progress('/content/results').waitFor({state:'detached'});assert.equal(await progress('/content/results/nested').count(),0);assert.equal(await progress('/content/notes.txt').count(),1);
   await refresh();assert.equal(await progress('/content/results').count(),0);assert.equal(await progress('/content/notes.txt').count(),1);
   await page.locator('#scenario').selectOption('normal');await done();
   assert.equal(await view('/content/results').count(),0);assert.equal(await view('/content/notes.txt').count(),0);assert.equal(await view('/content/other-folder').count(),1);
   assert.equal((await log()).match(/Started delete/g).length,1);assert.ok(!(await log()).includes('NATIVE SINGLE DELETE'));
   console.log(`PASS ${platform}: each completed item stops its ring while pending items remain busy, with quiet successful completion`);

   await load('delete-slow');await row('/content/results').click();await select('/content/results/nested');await select('/content/notes.txt');await start('/content/results/nested',true);
   assert.equal(await page.locator('[data-cfz-progress]').count(),2);
   assert.equal(await progress('/content/results').count(),0);
   assert.deepEqual(await page.evaluate(()=>fileActionArgs.get(state.job.path).map(item=>item.path)),['/content/results/nested','/content/notes.txt']);
   assert.ok(!(await log()).includes('NATIVE NAVIGATION'));
   await select('/content/other-folder');assert.equal((await chosen()).length,2);
   await page.locator('#scenario').selectOption('normal');await done();assert.deepEqual(await chosen(),[]);
   assert.equal(await view('/content/results').count(),1);assert.equal(await view('/content/results/nested').count(),0);
   console.log(`PASS ${platform}: selecting a child excludes its parent from deletion and progress; keyboard menu activation starts once`);

   await load('bulk-partial');await pair();await start();await done();
   assert.deepEqual(await chosen(),['/content/results']);assert.match(await view('/content/results').innerText(),/Permission denied.*Some contents/s);
   assert.equal(await progress('/content/results').count(),0);assert.equal(await view('/content/notes.txt').count(),0);
   console.log(`PASS ${platform}: failed item rings stop and errors remain inline while successful items are removed`);

   await load('bulk-disconnect');await pair();await start();await done();
   assert.deepEqual(await chosen(),['/content/notes.txt']);assert.match(await view('/content/notes.txt').innerText(),/remaining items is unknown/);
   assert.equal((await log()).match(/Started delete/g).length,1);
   console.log(`PASS ${platform}: connection loss clears every ring and reports remaining items without retrying`);

   await load('blocked');await pair();await row('/content/results').click({button:'right'});await menu.getByRole('menuitem',{name:/Delete selected items/}).click();
   await view('/content/results').getByText(/Delete failed:/).waitFor();
   assert.equal(await page.locator('[data-cfz-progress]').count(),0);assert.ok(!(await log()).includes('Started delete'));assert.equal((await chosen()).length,2);
   console.log(`PASS ${platform}: startup failures leave no stuck rings or confirmation dialogs`);

   await load('delete-slow');await row('/content/results').click();await row('/content/results').click({button:'right'});
   assert.equal(await menu.getByRole('menuitem',{name:/^Delete/}).count(),1);
   await menu.getByRole('menuitem',{name:'Delete folder',exact:true}).click();
   assert.ok(!(await log()).includes('NATIVE SINGLE DELETE'),'Non-empty folders must use recursive deletion, not Colab’s empty-folder-only action');
   await progress('/content/results').waitFor();assert.equal(await page.getByRole('dialog').count(),0);
   assert.equal(await progress('/content/results/nested').count(),1);
   await page.waitForFunction(()=>document.getElementById('events').textContent.includes('Started delete'));
   assert.deepEqual(await page.evaluate(()=>fileActionArgs.get(state.job.path).map(item=>item.path)),['/content/results']);
   await page.locator('#scenario').selectOption('normal');await done();assert.equal(await view('/content/notes.txt').count(),1);
   console.log(`PASS ${platform}: ordinary Delete folder uses recursive deletion with child progress and no confirmation`);

   await load('delete-slow');await pair();await row('/content/other-folder').locator('.menu-button').click();
   assert.deepEqual(await chosen(),['/content/other-folder']);
   await menu.getByRole('menuitem',{name:'Delete folder',exact:true}).press('Enter');
   await progress('/content/other-folder').waitFor();
   await page.waitForFunction(()=>document.getElementById('events').textContent.includes('Started delete'));
   assert.deepEqual(await page.evaluate(()=>fileActionArgs.get(state.job.path)),[{path:'/content/other-folder',isDirectory:true}]);
   assert.ok(!(await log()).includes('NATIVE SINGLE DELETE'));
   await page.locator('#scenario').selectOption('normal');await done();
   assert.equal(await view('/content/results').count(),1);assert.equal(await view('/content/notes.txt').count(),1);
   console.log(`PASS ${platform}: folder menu button and keyboard activation delete only the current folder, not a stale selection`);

   await load();await row('/content').click({button:'right'});
   const protectedDelete=menu.getByRole('menuitem',{name:'Delete folder',exact:true});
   assert.equal(await protectedDelete.getAttribute('aria-disabled'),'true');
   await protectedDelete.press('Enter');
   assert.ok(!(await log()).includes('Started delete'));assert.ok(!(await log()).includes('NATIVE SINGLE DELETE'));
   await menu.press('Escape');await row('/content/demo.zip').click({button:'right'});
   assert.equal(await menu.getByRole('menuitem',{name:'Delete file',exact:true}).getAttribute('data-cfz-delete'),null);
   assert.equal(await menu.getByRole('menuitem',{name:'Extract here',exact:true}).count(),1);
   await menu.press('Escape');
   console.log(`PASS ${platform}: protected folders stay disabled and ordinary single-file commands remain available`);

   await load('delete-slow');await row('/content/results').click({button:'right'});
   await menu.getByRole('menuitem',{name:'Delete folder',exact:true}).evaluate(el=>el.remove());
   await menu.getByRole('menuitem',{name:'Delete folder and contents',exact:true}).click();
   await progress('/content/results').waitFor();
   await page.waitForFunction(()=>document.getElementById('events').textContent.includes('Started delete'));
   assert.ok(!(await log()).includes('NATIVE SINGLE DELETE'));
   await page.locator('#scenario').selectOption('normal');await done();
   assert.equal(await view('/content/results').count(),0);
   console.log(`PASS ${platform}: recursive deletion remains available when the native menu entry is absent`);

   await load('delete-slow');await pair();await row('/content/notes.txt').press(platform==='MacIntel'?'Meta+Backspace':'Delete');
   await progress('/content/notes.txt').waitFor();await page.keyboard.press('Delete');await page.keyboard.press('Delete');
   await page.waitForFunction(()=>document.getElementById('events').textContent.includes('Started delete'));
   assert.equal((await log()).match(/Started delete/g).length,1);assert.ok(!(await log()).includes('NATIVE FILE DELETE KEY'));
   await page.locator('#scenario').selectOption('normal');await done();
   console.log(`PASS ${platform}: deletion shortcut starts directly and repeated keys cannot launch native duplicate deletion`);

   await load('delete-slow');await pair();await start();
   await page.evaluate(()=>{kernel.runtime={};document.body.append(document.createElement('span'));});await done();
   assert.deepEqual(await chosen(),[]);assert.equal(await page.locator('[data-cfz-progress]').count(),0);
   console.log(`PASS ${platform}: runtime changes remove old progress instead of attaching it to new-runtime files`);

   await load();await select('/content/demo.zip');await select('/content/demo.tar.gz');await row('/content/demo.zip').click({button:'right'});
   assert.equal(await menu.getByRole('menuitem').count(),1);assert.equal(await menu.getByRole('menuitem',{name:'Extract here',exact:true}).count(),0);await menu.press('Escape');
   await row('/content/demo.zip').click();await row('/content/demo.zip').click({button:'right'});assert.equal(await menu.getByRole('menuitem',{name:'Extract here',exact:true}).count(),1);
   await menu.press('Escape');await page.close();
   console.log(`PASS ${platform}: single-item actions remain hidden for groups and restored for one file`);
  }
  assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);console.log('PASS no confirmation dialogs or page errors under Trusted Types');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
