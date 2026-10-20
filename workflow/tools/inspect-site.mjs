import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'
const browser=await chromium.launch({executablePath:resolveChrome(),headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:900}})
page.on('console',m=>{if(m.type()==='error') console.log('CONSOLE',m.text())})
page.on('pageerror',e=>console.log('PAGEERROR',e.message))
await page.goto(process.argv[2]||'http://127.0.0.1:8080/',{waitUntil:'networkidle'})
console.log(await page.evaluate(()=>({data:window.COURSEWARE_SLIDES?.length, first:window.COURSEWARE_SLIDES?.[0], ls:localStorage.getItem('cpp-intro-current-page'), counter:document.querySelector('#counter')?.textContent, slide:document.querySelector('#slide')?.className})))
await browser.close()
