import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const workspace=path.resolve(process.argv[2]);
const output=path.resolve(process.argv[3]);
const api='http://127.0.0.1:8100', web='http://127.0.0.1:15173';
const records=[], jobs=[];
let browser;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function record(id,pass,evidence){records.push({id,pass,evidence});if(!pass)throw Error(id+': '+evidence);}
function start(cmd,args,cwd,env={}){
  const job=spawn(cmd,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  const logs=[];job.stdout.on('data',d=>logs.push(String(d)));job.stderr.on('data',d=>logs.push(String(d)));
  job.on('error',e=>logs.push(String(e)));const item={job,logs};jobs.push(item);return item;
}
async function stop(item){if(item?.job.exitCode===null){item.job.kill('SIGTERM');await Promise.race([new Promise(r=>item.job.once('exit',r)),pause(2500)]);if(item.job.exitCode===null)item.job.kill('SIGKILL');}}
async function wait(url){for(let i=0;i<80;i++){try{if((await fetch(url)).ok)return;}catch{}await pause(250);}throw Error('Service not ready: '+url);}
async function list(){return (await fetch(api+'/api/messages')).json();}
function backend(){return start(path.join(workspace,'backend/.venv/bin/python'),['-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8100'],path.join(workspace,'backend'),{WDRUNGE_DATA_DIR:path.join(output,'data')});}
try{
  await mkdir(output,{recursive:true});
  let back=backend();await wait(api+'/api/health');
  start('npm',['run','dev','--','--host','127.0.0.1','--port','15173','--strictPort'],path.join(workspace,'frontend'),{VITE_API_BASE_URL:api});await wait(web);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(web,{waitUntil:'networkidle'});
  record('heading',await page.getByRole('heading',{name:'访客留言板',exact:true}).isVisible(),'HTTP page and heading visible');
  record('initial_empty',await page.getByText('暂无留言',{exact:true}).isVisible(),'Fresh isolated database empty');
  const fields=page.getByRole('textbox');
  record('inputs',await fields.count()>=2,'Nickname and message inputs exist');
  const nickname=fields.nth(0),content=fields.nth(1),publish=page.getByRole('button',{name:/发布/}).first();
  let postCount=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/messages'))postCount++;});
  for(const [n,c] of [['','有效内容'],['   ','有效内容'],['昵称',''],['昵称','   ']]){
    await nickname.fill(n);await content.fill(c);const before=postCount;
    if(await publish.isEnabled())await publish.click();await pause(200);
    record('frontend_blank_'+records.length,postCount===before && (await list()).length===0,'Blank input prevented in browser before API request');
  }
  for(const body of [{nickname:'',content:'内容'},{nickname:'   ',content:'内容'},{nickname:'昵称',content:''},{nickname:'昵称',content:'   '}]){
    const r=await fetch(api+'/api/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    record('api_blank_'+records.length,r.status>=400&&r.status<500,'HTTP '+r.status);
  }
  await nickname.fill('  验收甲  ');await content.fill('  R1独立验收留言甲  ');await publish.click();
  await page.locator('.message-card .message-content').filter({hasText:'R1独立验收留言甲'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');
  record('publish_clear',await content.inputValue()==='','Content cleared');
  let rows=await list();record('trim',rows.some(x=>x.nickname==='验收甲'&&x.content==='R1独立验收留言甲'),'Stored strings trimmed');
  await nickname.fill('验收乙');await content.fill('R1独立验收留言乙');await publish.click();
  await page.locator('.message-card .message-content').filter({hasText:'R1独立验收留言乙'}).waitFor();
  record('two_messages',(await list()).length===2,'Two browser submissions persisted');
  const style=await page.evaluate(()=>{
    const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('发布'));
    const p=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&x.textContent.trim()==='R1独立验收留言甲');
    const card=p?.closest('article,li,.message-card,.card')||p?.parentElement;
    return {button:b?getComputedStyle(b).backgroundColor:null,body:getComputedStyle(document.body).backgroundColor,root:getComputedStyle(document.documentElement).backgroundColor,card:card?getComputedStyle(card).backgroundColor:null,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  await writeFile(path.join(output,'styles.json'),JSON.stringify(style,null,2));
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  record('desktop_no_overflow',!style.overflow,JSON.stringify(style));
  const card=page.getByText('R1独立验收留言乙',{exact:true}).locator('xpath=ancestor::*[.//button[contains(normalize-space(.), "删除")]][1]');
  await card.getByRole('button',{name:/删除/}).click();
  await page.getByText('R1独立验收留言乙',{exact:true}).waitFor({state:'detached'});
  rows=await list();record('delete_only_target',rows.length===1&&rows[0].content==='R1独立验收留言甲','Only target deleted');
  await page.reload({waitUntil:'networkidle'});await page.getByText('R1独立验收留言甲',{exact:true}).waitFor();record('reload',true,'Message retained');
  await stop(back);back=backend();await wait(api+'/api/health');
  await page.reload({waitUntil:'networkidle'});await page.getByText('R1独立验收留言甲',{exact:true}).waitFor();record('restart',true,'Retained after actual backend process restart');
  const last=page.getByText('R1独立验收留言甲',{exact:true}).locator('xpath=ancestor::*[.//button[contains(normalize-space(.), "删除")]][1]');
  await last.getByRole('button',{name:/删除/}).click();await page.getByText('暂无留言',{exact:true}).waitFor();record('final_empty',true,'Empty state restored');
  const readme=await readFile(path.join(workspace,'README.md'),'utf8');record('readme_commands_present',/npm/.test(readme)&&/python|uvicorn/.test(readme),'Frontend and backend startup commands present; actual instruction execution checked separately');
}catch(e){records.push({id:'harness_or_function_failure',pass:false,evidence:String(e.stack||e)});}
finally{
  if(browser)await browser.close();for(const j of jobs)await stop(j);
  await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'result.json'),JSON.stringify({at:new Date().toISOString(),passed:records.filter(x=>x.pass).length,total:records.length,all_passed:records.length>0&&records.every(x=>x.pass),records,service_logs:jobs.map(x=>x.logs.join(''))},null,2));
  console.log(JSON.stringify({passed:records.filter(x=>x.pass).length,total:records.length,failed:records.filter(x=>!x.pass)},null,2));
  if(records.some(x=>!x.pass))process.exitCode=1;
}
