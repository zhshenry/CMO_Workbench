// Uses only a synthetic local PIC-shaped page and an isolated Electron process.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { _electron } from 'playwright';

const require = createRequire(import.meta.url), root = process.cwd();
const output = await mkdtemp(path.join(tmpdir(), 'cmo-group-pilot-'));
const html = `<!doctype html><meta charset="utf-8"><title>PIC 群组合成验证</title>
<style>body{font:14px sans-serif;margin:16px}input,textarea,select,button{font:inherit;padding:5px}td,th{padding:6px;border:1px solid #ddd}table{border-collapse:collapse}td input{width:130px}.el-dialog{position:fixed;inset:20px;background:white;border:2px solid #456;padding:16px;z-index:10}.el-select{padding:4px;border:1px solid #aaa;cursor:pointer;min-width:100px}.el-select-dropdown,.el-autocomplete-suggestion{position:fixed;left:30px;top:100px;background:#fff;border:1px solid #567;z-index:30;max-height:400px;overflow:auto}.el-select-dropdown li,.el-autocomplete-suggestion li{padding:6px;cursor:pointer;list-style:none}.el-tag{display:inline-block;background:#dde9fa;margin:2px;padding:3px}[hidden]{display:none!important}</style>
<label><input type="radio" name="ownership" checked>产品</label><input aria-label="请选择Offering信息" readonly id="offering"><button id="add">单个添加</button>
<div class="el-table"><div class="el-table__header-wrapper"><table><thead><tr>${['选择','序号','群组名称','群组描述','群组Owner','群组成员','群组管理员','群组应用类型','有效期','操作'].map(name=>'<th>'+name+'</th>').join('')}</tr></thead></table></div><div class="el-table__body-wrapper"><table><tbody id="rows"></tbody></table></div></div>
<button id="submit">提交申请</button><div role="status" id="result"></div>
<div role="dialog" class="el-dialog" aria-label="请选择Offering信息" hidden id="offeringDialog"><h2>请选择Offering信息</h2><table><tbody>${['[Offering] PacificEng V600 11111111','[Offering R] PacificEng V600 266756442'].map(name=>'<tr><td>'+name+'</td></tr>').join('')}</tbody></table><button id="offeringOK">确定</button></div>
<ul role="listbox" class="el-select-dropdown" hidden id="choices"></ul><ul role="listbox" class="el-autocomplete-suggestion" hidden id="people"></ul>
<script>
window.counts={adds:0,submits:0,fills:0};window.events=[];document.addEventListener('click',e=>window.events.push(e.target.id||e.target.textContent.slice(0,60)),true);window.mode='success';let offeringChoice='';
const E=id=>document.getElementById(id);const close=()=>{E('choices').hidden=true;E('people').hidden=true;};document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
E('offering').onclick=()=>{E('offeringDialog').hidden=false;};for(const row of E('offeringDialog').querySelectorAll('tr'))row.onclick=()=>{offeringChoice=row.textContent;row.style.background='#def';};
E('offeringOK').onclick=()=>{E('offering').value=offeringChoice.replace(/^\\[[^\\]]+\\]\\s*/,'').replace(/\\s+\\d+$/,'');E('offeringDialog').hidden=true;};
function selectMarkup(id,values,multiple=false){return '<div class="el-select" id="'+id+'" data-values="'+values.join('|')+'" data-multiple="'+multiple+'"><span class="el-select__selected-item"></span><input readonly aria-label="'+id+'" value=""></div>';}
E('add').onclick=()=>{window.counts.adds++;const tr=document.createElement('tr');tr.innerHTML='<td></td><td>1</td><td>'+selectMarkup('prefix',['HIS','CSI'])+'<input id="name" aria-label="名称主体"></td><td><textarea id="description" aria-label="群组描述"></textarea></td>'+['owner','members','administrator'].map(id=>'<td><span id="'+id+'Tags"></span><input id="'+id+'" aria-label="'+id+'"></td>').join('')+'<td>'+selectMarkup('applications',['DBOX群组','SVN群组','海思群组','域群组','PDM群组'],true)+'</td><td>'+selectMarkup('years',['一年','两年','三年'])+'</td><td>删除</td>';E('rows').append(tr);
for(const select of tr.querySelectorAll('.el-select')){select.dataset.selected='';select.onclick=()=>{E('people').hidden=true;E('choices').innerHTML=select.dataset.values.split('|').map(value=>'<li role="option">'+value+'</li>').join('');E('choices').hidden=false;for(const li of E('choices').children)li.onclick=e=>{e.stopPropagation();const selected=select.dataset.multiple==='true'?[...new Set([...select.dataset.selected.split('|').filter(Boolean),li.textContent])]:[li.textContent];select.dataset.selected=selected.join('|');select.querySelector('.el-select__selected-item').innerHTML=select.dataset.multiple==='true'?selected.map(v=>'<span class="el-tag">'+v+'</span>').join(''):selected[0];select.querySelector('input').value=select.dataset.multiple==='true'?'':selected[0];E('choices').hidden=true;};};}
for(const id of ['owner','members','administrator']){E(id).oninput=()=>{window.counts.fills++;E('choices').hidden=true;if(id==='members'&&window.mode==='block-members'){E('people').hidden=true;return;}const ids=E(id).value.split(';').filter(Boolean);E('people').innerHTML=ids.map(value=>'<li role="option">测试员工 '+value+'</li>').join('');E('people').hidden=false;for(const li of E('people').children)li.onclick=()=>{const tag=document.createElement('span');tag.className='el-tag';tag.textContent=li.textContent;E(id+'Tags').append(tag);E(id).value='';E('people').hidden=true;};};}
};
E('submit').onclick=()=>{window.counts.submits++;if(window.mode==='unknown')return;const name=E('prefix').dataset.selected+'-'+E('name').value;E('result').textContent=window.mode==='duplicate'?'保存失败！['+name+']以上组名已存在iright,请修改':'提交成功：'+name+'，申请单号 PIC-TEST-001';};
</script>`;
const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/groups`;
let app;
const results = [];
try {
  const main = path.join(output, 'main.cjs');
  await build({ stdin: { contents: `
    import { app, BrowserWindow } from 'electron';
    import { BrowserAutomation } from './electron/browser/tasks';
    import { BrowserStore } from './electron/browser/store';
    import { buildGroupContribution } from './modules/permission/group-tools';
    app.setPath('userData', ${JSON.stringify(path.join(output, 'data'))});
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({width:1500,height:850,show:false,webPreferences:{contextIsolation:true,sandbox:true}});
      await win.loadURL(${JSON.stringify(url)});win.setOpacity(0);win.showInactive();win.setIgnoreMouseEvents(true);
      const owner=win.webContents;
      const originalSend=owner.debugger.sendCommand.bind(owner.debugger);owner.debugger.sendCommand=async(method,params,session)=>{try{return await originalSend(method,params,session);}catch(error){console.log('CDP_FAILURE',method,JSON.stringify(params),String(error));throw error;}};
      const guests={observeNavigation(){},observePopup(){},resolve(){return {guest:owner,workspace:'permission-groups'};},tabs(){return [{id:'tab1',workspace:'permission-groups',url:owner.getURL(),title:owner.getTitle(),ready:true,active:true}];},canNavigate(value){return value.startsWith(${JSON.stringify(url)});}};
      const automation=new BrowserAutomation(guests as any,new BrowserStore(${JSON.stringify(path.join(output, 'browser.json'))}));
      const task=automation.start(owner,'tab1','创建合成群组','permission-groups');
      automation.bind(owner,task.id,'chat1',new AbortController().signal);
      const state={win,automation,task,decision:'confirmed',confirms:0,tools:[] as any[],changeOnConfirm:false};
      const reset=()=>{state.tools=buildGroupContribution(automation,owner,automation.taskFor(owner,task.id),async()=>{state.confirms++;if(state.changeOnConfirm)await owner.executeJavaScript("document.getElementById('name').value='MANUAL-CHANGE'");return state.decision as any;}).buildTools();};
      reset();(globalThis as any).groupPilot={...state,reset,run:async(name:string,params:any={})=>{const tool=state.tools.find(t=>t.name===name);return JSON.parse((await tool.execute('pilot',params)).content[0].text);},decision:(value:string)=>{state.decision=value;},changeOnConfirm:(value:boolean)=>{state.changeOnConfirm=value;},stats:()=>({confirms:state.confirms}),taskState:()=>automation.taskFor(owner,task.id)};
    });
  `, resolveDir: root, loader: 'ts', sourcefile: 'group-pilot.ts' }, outfile: main, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], banner: { js: 'var import_meta_url = require("url").pathToFileURL(__filename).href;' }, define: { 'import.meta.url': 'import_meta_url' } });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: require('electron'), args: [main], env, timeout: 30000 });
  app.process().stdout?.on('data', data => process.stdout.write(data));
  const page = await app.firstWindow(); await page.waitForSelector('#offering');
  await app.evaluate(async () => { for(let i=0;i<100&&!globalThis.groupPilot;i++)await new Promise(r=>setTimeout(r,50)); });
  const run = (name, params = {}) => app.evaluate(async (_, {name,params}) => globalThis.groupPilot.run(name,params), {name,params});
  const draft = { ownership: 'product', offering: 'PacificEng V600', name: 'HIS-PACIFIC610-DBOX', description: '仅合成测试', owner: '00545972', members: ['00514659','00545972'], administrator: '00545972', applications: ['DBOX群组'] };
  let result = await run('group_fill', {name:draft.name}); assert.equal(result.status,'needs-information');
  assert.deepEqual(result.missing,['产品或部门归属','明确的 Offering 名称或编号','Owner 工号','成员工号','管理员工号','应用类型']);
  assert.equal((await page.evaluate(()=>window.counts)).adds,0);results.push('missing information performs no page writes');
  await page.evaluate(()=>window.mode='block-members');
  result=await run('group_fill',draft);assert.equal(result.status,'blocked',JSON.stringify(result));assert.equal(result.progress.field,'群组成员');
  results.push('one group_fill call validates parameters and starts filling without a preparation tool');
  assert.equal((await run('group_inspect')).status,'blocked','Typed employee IDs must not count as selected people');
  assert.equal(await page.locator('#ownerTags .el-tag').count(),1);
  await page.evaluate(()=>window.mode='success');
  result=await run('group_fill');if(result.status!=='ready'){await page.screenshot({path:path.join(output,'failure.png')});console.log(JSON.stringify({output,diagnostic:await page.evaluate(()=>({dialogHidden:document.getElementById('offeringDialog').hidden,offering:document.getElementById('offering').value,counts:window.counts,events:window.events,active:document.activeElement?.id,body:document.body.innerText.slice(0,1500)}))}));}assert.equal(result.status,'ready',JSON.stringify(result));results.push('real CDP fills and verifies the complete inline form');
  assert.equal(await page.locator('#offering').inputValue(),'PacificEng V600');
  assert.equal(await page.locator('#name').inputValue(),'PACIFIC610-DBOX');
  assert.equal(await page.locator('#applications').getAttribute('data-selected'),'DBOX群组|域群组');
  assert.equal(await page.locator('#ownerTags .el-tag').count(),1);assert.equal((await page.evaluate(()=>window.counts)).adds,1);results.push('partial personnel failure resumes the same row without duplicating selected users');
  const before=await page.evaluate(()=>window.counts);
  result=await run('group_fill',draft);assert.equal(result.status,'ready',JSON.stringify(result));
  assert.deepEqual(await page.evaluate(()=>window.counts),before);results.push('repeat fill neither adds a row nor re-enters selected personnel');
  await app.evaluate(()=>globalThis.groupPilot.decision('cancelled'));
  result=await run('group_submit');assert.equal(result.status,'cancelled',JSON.stringify(result));assert.equal((await page.evaluate(()=>window.counts)).submits,0);results.push('cancelled confirmation sends no submission');
  await app.evaluate(()=>{globalThis.groupPilot.reset();globalThis.groupPilot.decision('confirmed');globalThis.groupPilot.changeOnConfirm(true);});
  result=await run('group_submit');assert.equal(result.status,'blocked',JSON.stringify(result));assert.equal((await page.evaluate(()=>window.counts)).submits,0);results.push('a manual edit during confirmation prevents submission');
  await app.evaluate(()=>{globalThis.groupPilot.reset();globalThis.groupPilot.changeOnConfirm(false);});
  result=await run('group_fill');assert.equal(result.status,'ready',JSON.stringify(result));
  await page.evaluate(()=>window.mode='unknown');
  result=await run('group_submit');assert.equal(result.status,'unknown',JSON.stringify(result));
  result=await run('group_fill',{...draft,name:'HIS-ANOTHER'});assert.equal(result.status,'unknown');
  assert.equal(await page.locator('#name').inputValue(),'PACIFIC610-DBOX');
  result=await run('group_submit');assert.equal(result.status,'unknown');assert.equal((await page.evaluate(()=>window.counts)).submits,1);results.push('unknown result never repeats the submit click');
  await page.evaluate(()=>document.getElementById('result').textContent='提交成功：HIS-PACIFIC610-DBOX，申请单号 PIC-TEST-001');
  result=await run('group_inspect');assert.equal(result.status,'submitted',JSON.stringify(result));results.push('the observed named receipt verifies submission');
  const state=await app.evaluate(()=>globalThis.groupPilot.taskState());assert.equal(state.verification.items[0].status,'passed');
  const defs=await app.evaluate(()=>globalThis.groupPilot.tools.map(({name,description,parameters})=>({name,description,parameters})));
  assert.deepEqual(defs.map(tool=>tool.name),['group_fill','group_inspect','group_submit']);
  assert.ok(JSON.stringify(defs).length<10000);results.push('dedicated tool definitions stay below 10000 characters');
  await page.screenshot({path:path.join(output,'filled-group.png')});
  await writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:results,schemaChars:JSON.stringify(defs).length,url,limitations:['Synthetic local page and real Electron CDP; live PIC selectors and receipt layout require field calibration.']},null,2));
  console.log(JSON.stringify({status:'passed',checks:results,output}));
} finally { if(app)await app.close(); await new Promise(resolve=>server.close(resolve)); }
