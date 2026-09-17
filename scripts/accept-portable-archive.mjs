import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
if (!process.argv.includes('--disposable')) throw Error('Use an isolated acceptance profile with --disposable');
const url=process.env.DSH_ACCEPTANCE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1') throw Error('DSH_ACCEPTANCE_URL must be the isolated local test server');
const output=process.env.DSH_ACCEPTANCE_EVIDENCE_ROOT;
if (!output) throw Error('DSH_ACCEPTANCE_EVIDENCE_ROOT is required');
const browser=await chromium.launch({headless:true,channel:process.env.DSH_TEST_BROWSER_CHANNEL || undefined});
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[],deletes=[];let navigations=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname==='/plugins/dsh-session-delete/delete')deletes.push(r.method());});
 await page.goto(url);for(let i=0;i<4;i++){for(const name of ['继续','Continue','稍后配置','Configure later']){const b=page.getByRole('button',{name,exact:true});if(await b.isVisible().catch(()=>false))await b.click();}await page.waitForTimeout(700);}
 page.on('framenavigated',f=>{if(f===page.mainFrame())navigations++;});
 await page.getByText('未分组',{exact:true}).click();
 const title='Image viewer synthetic acceptance';
 const session=page.getByText(title,{exact:true});await session.hover();
 await page.getByRole('button',{name:`会话“${title}”的操作`,exact:true}).click();
 await page.getByRole('menuitem',{name:'归档会话',exact:true}).click();
 await page.locator('#archived-sessions').click();
 const restore=page.getByRole('button',{name:`取消归档 ${title}`,exact:true});
 const remove=page.getByRole('button',{name:`永久删除 ${title}`,exact:true});
 await restore.waitFor();await remove.waitFor();
 const color=await remove.evaluate(e=>getComputedStyle(e).color);
 const regular=await restore.evaluate(e=>getComputedStyle(e).color);assert.notEqual(color,regular);
 assert.equal(await page.getByRole('dialog',{name:'归档会话',exact:true}).count(),0);
 await remove.click();const confirm=page.getByRole('dialog',{name:'永久删除会话？',exact:true});await confirm.waitFor();
 await confirm.getByRole('button',{name:'取消',exact:true}).filter({hasText:'取消'}).click();await confirm.waitFor({state:'hidden'});assert.equal(deletes.length,0);
 fs.mkdirSync(output,{recursive:true});await page.screenshot({path:output+'/archived-settings.png'});
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/plugins/dsh-session-delete/restore');await restore.click();const restored=await response;assert.equal(restored.status(),200);assert.equal((await restored.json()).ok,true);await restore.waitFor({state:'detached'});
 await page.getByRole('button',{name:'关闭',exact:true}).last().click();
 await page.waitForTimeout(700);assert.equal(await page.getByRole('searchbox',{name:'搜索已归档会话',exact:true}).count(),0);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'已归档会话',exact:true}).last().click();
 await page.getByRole('searchbox',{name:'搜索已归档会话',exact:true}).waitFor();await page.getByRole('button',{name:'关闭',exact:true}).last().click();
 await page.waitForTimeout(1000);assert.equal(await page.getByRole('searchbox',{name:'搜索已归档会话',exact:true}).count(),0);
 assert.equal(navigations,0);assert.deepEqual(errors,[]);
 const result={passed:true,checks:['real alpha2 host with candidate chat plugin','single archive settings route','red delete action','cancel sends no delete','restore endpoint succeeds','closing settings stays closed','no reload','no runtime exceptions'],deleteColor:color};
 fs.writeFileSync(output+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
