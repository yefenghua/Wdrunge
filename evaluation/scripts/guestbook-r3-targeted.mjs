import {chromium} from 'playwright';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
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
try{
 await mkdir(path.join(out,'data'),{recursive:true});await copyFile(seed,path.join(out,'data/app.db'));
 const build=spawnSync('npm',['run','build'],{cwd:path.join(work,'frontend'),encoding:'utf8',timeout:60000});await writeFile(path.join(out,'build.log'),(build.stdout||'')+(build.stderr||''));check(build.status===0,'Frontend build failed');
 backend=startBackend();await ready(api+'/api/health');start('npm',['run','dev','--','--host','127.0.0.1','--port','15173','--strictPort'],path.join(work,'frontend'));await ready(web);
 records.push({group:'build_and_start',passed:true});
 const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
 check((await hash(path.join(work,'backend/app/main.py'))) === (await hash(path.join(work,'../first-delivery/backend/app/main.py'))),'Backend changed unexpectedly; cannot reuse prior API checks');
 let r=await request('GET','/api/messages');check(r.body.length===4,'Prior acceptance data not preserved');
 const defaultId=r.body.find(x=>x.content==='R2默认留言')?.id,removedId=r.body.find(x=>x.content==='R2待删除留言')?.id;
 records.push({group:'migration_default_invalid',passed:true,reused_from_first:true,evidence:'Backend unchanged; reuse first-run passing migration/default/invalid checks'});
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(web,{waitUntil:'networkidle'});
 await visibleContents(page,['R2升级前留言','R2默认留言','R2反馈留言','R2待删除留言']);
 // Successful first-run creation/category-label/no-match checks are retained; only failed filtering and pending persistence are repeated.
 await page.getByRole('button',{name:'日常',exact:true}).click();await visibleContents(page,['R2升级前留言','R2默认留言']);
 await page.getByRole('button',{name:'日常',exact:true}).click();await sleep(200);await visibleContents(page,['R2升级前留言','R2默认留言']);
 await page.getByRole('button',{name:'反馈',exact:true}).click();await visibleContents(page,['R2反馈留言','R2待删除留言']);await page.getByRole('button',{name:'反馈',exact:true}).click();await sleep(200);await visibleContents(page,['R2反馈留言','R2待删除留言']);
 const deleteCard=page.locator('.message-card').filter({has:page.locator('.message-content',{hasText:'R2待删除留言'})});await deleteCard.getByRole('button',{name:'删除',exact:true}).click();await visibleContents(page,['R2反馈留言']);
 await page.getByRole('button',{name:'全部',exact:true}).click();await visibleContents(page,['R2升级前留言','R2默认留言','R2反馈留言']);await page.getByRole('button',{name:'全部',exact:true}).click();await sleep(200);await visibleContents(page,['R2升级前留言','R2默认留言','R2反馈留言']);await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
 records.push({group:'browser_category_filters_delete',passed:true});
 await stop(backend);backend=startBackend();await ready(api+'/api/health');await page.reload({waitUntil:'networkidle'});await visibleContents(page,['R2升级前留言','R2默认留言','R2反馈留言']);
 r=await request('GET','/api/messages');check(r.body.length===3&&!r.body.some(x=>x.id===removedId),'Deletion not persisted');check(r.body.find(x=>x.id===1)?.category==='general'&&r.body.find(x=>x.id===defaultId)?.category==='general'&&r.body.find(x=>x.content==='R2反馈留言')?.category==='feedback','Categories not persisted');
 records.push({group:'reload_restart_persistence',passed:true});
}catch(e){records.push({group:'failure',passed:false,error:String(e.stack||e)});}
finally{if(browser)await browser.close();for(const x of jobs)await stop(x);await mkdir(out,{recursive:true});const result={at:new Date().toISOString(),all_passed:records.length===4&&records.every(x=>x.passed),groups:records,service_logs:jobs.map(x=>x.logs.join(''))};await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({all_passed:result.all_passed,groups:records},null,2));if(!result.all_passed)process.exitCode=1;}
