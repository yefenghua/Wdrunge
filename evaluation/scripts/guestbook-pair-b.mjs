import {chromium} from 'playwright';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const work=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),seed=path.resolve(process.argv[4]);
const api='http://127.0.0.1:8100',web='http://127.0.0.1:15173',records=[],jobs=[];
let browser,backend;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
function start(cmd,args,cwd,env={}){const p=spawn(cmd,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});const logs=[];p.stdout.on('data',d=>logs.push(String(d)));p.stderr.on('data',d=>logs.push(String(d)));p.on('error',e=>logs.push(String(e)));const x={p,logs};jobs.push(x);return x;}
async function stop(x){if(x?.p.exitCode===null){x.p.kill('SIGTERM');await Promise.race([new Promise(r=>x.p.once('exit',r)),sleep(2000)]);if(x.p.exitCode===null)x.p.kill('SIGKILL');}}
async function ready(url){for(let i=0;i<80;i++){try{if((await fetch(url)).ok)return;}catch{}await sleep(250);}throw Error('Service startup failed: '+url);}
async function request(method,route,body){const r=await fetch(api+route,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
function startBackend(){return start(path.join(work,'backend/.venv/bin/python'),['-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8100'],path.join(work,'backend'),{WDRUNGE_DATA_DIR:path.join(out,'data')});}
async function visibleContents(page,expected){await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.message-card .message-content')].map(x=>x.textContent).sort())===JSON.stringify(expected.sort()),expected,{timeout:10000});}
async function categoryControl(page){
 const select=page.locator('form select');
 if(await select.count())return {kind:'select',element:select.first()};
 return {kind:'radio',element:page.locator('form input[type="radio"][value="general"]')};
}
async function selectCategory(page,value){
 const c=await categoryControl(page);
 if(c.kind==='select')await c.element.selectOption(value);
 else await page.locator(`form input[type="radio"][value="${value}"]`).check();
}
async function filter(page,label,expected){
 const button=page.getByRole('button',{name:label,exact:true});
 if(await button.count())await button.click();
 else {
  const control=page.locator('select').filter({has:page.locator('option[value="all"],option[value=""]')}).first();
  await control.selectOption({label});
 }
 await sleep(200);await visibleContents(page,expected);
}
try{
 await mkdir(path.join(out,'data'),{recursive:true});await copyFile(seed,path.join(out,'data/app.db'));
 const build=spawnSync('npm',['run','build'],{cwd:path.join(work,'frontend'),encoding:'utf8',timeout:60000});await writeFile(path.join(out,'build.log'),(build.stdout||'')+(build.stderr||''));check(build.status===0,'Frontend build failed');
 backend=startBackend();await ready(api+'/api/health');start('npm',['run','dev','--','--host','127.0.0.1','--port','15173','--strictPort'],path.join(work,'frontend'));await ready(web);
 records.push({group:'build_and_start',passed:true});
 let r=await request('GET','/api/messages');check(r.status===200&&Array.isArray(r.body),'List API unavailable');const old=r.body.find(x=>x.id===1);check(old?.nickname==='旧访客'&&old.content==='R2升级前留言'&&old.category==='general','Old database migration lost data or default classification');
 r=await request('POST','/api/messages',{nickname:'默认访客',content:'R2默认留言'});check(r.status>=200&&r.status<300&&r.body?.category==='general','Missing category did not default to general');const defaultId=r.body.id;
 r=await request('POST','/api/messages',{nickname:'非法分类',content:'不应保存',category:'other'});check(r.status>=400&&r.status<500,'Invalid category accepted');check((await request('GET','/api/messages')).body.length===2,'Invalid request changed database');
 records.push({group:'migration_default_invalid',passed:true});
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(web,{waitUntil:'networkidle'});
 await visibleContents(page,['R2升级前留言','R2默认留言']);const control=await categoryControl(page);check(control.kind==='select'?(await control.element.inputValue())==='general':await control.element.isChecked(),'Form default is not general');
 await filter(page,'反馈',[]);check(await page.getByText(/暂无.*留言|没有.*留言|无.*匹配|没有.*匹配/).first().isVisible(),'No-match hint missing');await filter(page,'全部',['R2升级前留言','R2默认留言']);
 await page.getByLabel('昵称',{exact:true}).fill('分类访客');await page.getByLabel('留言内容',{exact:true}).fill('R2反馈留言');await selectCategory(page,'feedback');await page.getByRole('button',{name:'发布',exact:true}).click();await visibleContents(page,['R2升级前留言','R2默认留言','R2反馈留言']);
 const feedbackCard=page.locator('.message-card').filter({has:page.locator('.message-content',{hasText:'R2反馈留言'})});check(await feedbackCard.getByText(/^(分类[:：]\s*)?反馈$/).isVisible(),'Category label wrong');
 r=await request('POST','/api/messages',{nickname:'删除访客',content:'R2待删除留言',category:'feedback'});check(r.status>=200&&r.status<300,'Feedback create failed');const removedId=r.body.id;
 await page.reload({waitUntil:'networkidle'});await visibleContents(page,['R2升级前留言','R2默认留言','R2反馈留言','R2待删除留言']);
 await filter(page,'日常',['R2升级前留言','R2默认留言']);
 await filter(page,'反馈',['R2反馈留言','R2待删除留言']);
 const deleteCard=page.locator('.message-card').filter({has:page.locator('.message-content',{hasText:'R2待删除留言'})});await deleteCard.getByRole('button',{name:'删除',exact:true}).click();await visibleContents(page,['R2反馈留言']);
 await filter(page,'全部',['R2升级前留言','R2默认留言','R2反馈留言']);await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
 records.push({group:'browser_category_filters_delete',passed:true});
 await stop(backend);backend=startBackend();await ready(api+'/api/health');await page.reload({waitUntil:'networkidle'});await visibleContents(page,['R2升级前留言','R2默认留言','R2反馈留言']);
 r=await request('GET','/api/messages');check(r.body.length===3&&!r.body.some(x=>x.id===removedId),'Deletion not persisted');check(r.body.find(x=>x.id===1)?.category==='general'&&r.body.find(x=>x.id===defaultId)?.category==='general'&&r.body.find(x=>x.content==='R2反馈留言')?.category==='feedback','Categories not persisted');
 records.push({group:'reload_restart_persistence',passed:true});
}catch(e){records.push({group:'failure',passed:false,error:String(e.stack||e)});}
finally{if(browser)await browser.close();for(const x of jobs)await stop(x);await mkdir(out,{recursive:true});const result={at:new Date().toISOString(),all_passed:records.length===4&&records.every(x=>x.passed),groups:records,service_logs:jobs.map(x=>x.logs.join(''))};await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({all_passed:result.all_passed,groups:records},null,2));if(!result.all_passed)process.exitCode=1;}
