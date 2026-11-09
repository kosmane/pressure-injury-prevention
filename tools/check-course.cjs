const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'');
const course = JSON.parse(read('course.json'));
const timeline = JSON.parse(read('export/mp4-timeline.json'));
const registry = JSON.parse(read('asset-registry.json'));
const results=[];
function check(name, ok, detail='') { results.push({name,passed:!!ok,detail}); }
const shots=course.scenes.flatMap(s=>s.shots);
check('Unique shot IDs',new Set(shots.map(s=>s.sourceId)).size===shots.length);
check('All referenced assets exist',shots.every(s=>fs.existsSync(path.join(root,s.interactionSrc || registry[s.assetId]?.path || 'MISSING')) && (!s.voiceFilename || fs.existsSync(path.join(root,s.voiceFilename)))));
check('Timeline scene durations',timeline.scenes.every(s=>Math.abs(s.endSeconds-s.startSeconds-s.durationSeconds)<0.01));
check('Timeline matches course',timeline.shots.length===shots.length && shots.every((s,i)=>s.sourceId===timeline.shots[i].sourceId && s.startSeconds===timeline.shots[i].startSeconds && s.endSeconds===timeline.shots[i].endSeconds));
for(const file of fs.readdirSync(path.join(root,'src')).filter(f=>f.endsWith('.js'))) new vm.Script(read('src/'+file));
for(const s of shots.filter(s=>s.interactionSrc)) { const html=read(s.interactionSrc); for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]); }
check('JavaScript syntax',true);
const data={};const sandbox={window:{}};
vm.runInNewContext(read('src/course-data.js'),sandbox);
check('Generated data matches source',JSON.stringify(sandbox.window.COURSE_DATA)===JSON.stringify(course));
vm.runInNewContext(read('src/cases.js'),sandbox);
for(const [caseId,sourceId] of [['case-1','S074'],['case-2','S078'],['case-3','S080']]) {
 const prompt=sandbox.window.Cases.showPrompt(caseId);
 check('Case prompt loads including removed scenario fallback '+caseId,prompt?.question?.sourceId===sourceId && !!prompt.reflection);
}
const apiWindow={API:{LMSInitialize:()=> 'true',LMSGetValue:k=>data[k] || (k==='cmi.core.lesson_status'?'not attempted':''),LMSSetValue:(k,v)=>(data[k]=v,'true'),LMSCommit:()=> 'true',LMSFinish:()=> 'true'}};apiWindow.parent=apiWindow;
vm.runInNewContext(read('src/scorm-api.js'),{window:apiWindow});
apiWindow.SCORMAdapter.initialize();check('SCORM starts as incomplete',data['cmi.core.lesson_status']==='incomplete');
apiWindow.SCORMAdapter.setProgress('03-classification:S089');check('SCORM saves bookmark',apiWindow.SCORMAdapter.getProgress()==='03-classification:S089');
apiWindow.SCORMAdapter.complete();check('SCORM completion',data['cmi.core.lesson_status']==='completed');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const profile=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pressure-course-qa-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9337','--no-first-run','--no-default-browser-check','--allow-file-access-from-files','--autoplay-policy=no-user-gesture-required','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',d=>process.stderr.write(d)); child.on('error',e=>console.error(e));
 let ws;
 try{
 let tabs;for(let i=0;i<60;i++){try{tabs=await(await fetch('http://127.0.0.1:9337/json')).json();break}catch{await sleep(200)}}
 if(!tabs)throw Error('Browser unavailable');
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();const errors=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text)});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:n,method,params}))});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await send('Runtime.enable');await send('Page.enable');
 const url=pathToFileURL(path.join(root,'index.html')).href;
 await send('Page.navigate',{url});await sleep(600);
 async function start(sceneId,shotId){await ev(`localStorage.setItem('pressure-injury-course-progress-v1',JSON.stringify({sceneId:${JSON.stringify(sceneId)},shotId:${JSON.stringify(shotId)}}))`);await send('Page.reload');await sleep(300);await ev("document.getElementById('start-course').click()");await sleep(100)}
 const click=id=>ev(`document.getElementById(${JSON.stringify(id)}).click()`);
 const disabled=id=>ev(`document.getElementById(${JSON.stringify(id)}).disabled`);
 const label=()=>ev("document.getElementById('shot-label').textContent");
 await start(course.scenes[0].id,'S001');check('One click starts first shot',await label()==='1-1');
 check('Shot numbering visible',await ev("getComputedStyle(document.getElementById('shot-label')).display!=='none'"));
 await ev("document.getElementById('voice-audio').dispatchEvent(new Event('ended'))");check('Audio end advances shot',await label()==='1-2');
 await click('next-shot');check('Manual audio skip',await label()==='1-3');
 await click('home-button');await click('start-course');check('Home resumes location',await label()==='1-3');
 await start(course.scenes[0].id,'S004');await ev("document.getElementById('voice-audio').dispatchEvent(new Event('ended'))");check('Chapter transition waits for click',await ev("document.getElementById('next-scene').textContent==='מעבר לפרק הבא' && !document.getElementById('next-scene').hidden"));
 await click('previous-shot');check('Transition back to last shot',await label()==='1-4');
 await start(course.scenes[5].id,course.scenes[5].shots.at(-1).sourceId);
 await ev("document.getElementById('voice-audio').dispatchEvent(new Event('ended'))");
 check('Chapter 6 waits before Chapter 7',await ev("!document.getElementById('next-scene').hidden"));
 await click('next-scene');check('Chapter 7 opens from Chapter 6',await label()==='7-1');
 await click('next-shot');check('First question appears from Chapter 7 opening',await ev("!document.getElementById('reflection').hidden && document.querySelectorAll('[data-option-id]').length===4"));
 for(const [idx,sid,lab] of [[2,'S089','3-24'],[3,'S088','4-21']]){await start(course.scenes[idx].id,sid);check('Reading gate '+lab,await disabled('next-shot'));check('Infographic unshaded '+lab,await ev("getComputedStyle(document.querySelector('.stage-shade')).display==='none'"));await click('read-confirmation');check('Reading unlocks '+lab,!await disabled('next-shot'));await click('next-shot');check('Reading exits to transition '+lab,await ev("!document.getElementById('next-scene').hidden"));}
 for(const [sid,correct] of [['S075','offload'],['S078','assess-device'],['S081','stage-three']]){await start(course.scenes[6].id,sid);check('Question initially gated '+sid,await disabled('next-shot'));await ev(`document.querySelector('[data-option-id="${correct}"]').click()`);await click('reveal-answer');check('Correct answer unlocks '+sid,!await disabled('next-shot'));await click('next-shot');check('Answer revealed '+sid,await ev("document.getElementById('reflection').hidden"));}
 await start(course.scenes[6].id,'S086');await sleep(300);
 await ev("document.getElementById('norton-frame').contentWindow.eval(\"for(let i=0;i<3;i++){openChoice(i,'score');choose('s'+(i+1));openChoice(i,'risk');choose('r'+(i+1));}check();finish();\")");await sleep(100);check('Matching completion unlocks',!await disabled('next-shot'));
 await ev("document.getElementById('norton-frame').contentWindow.document.getElementById('replay').click()");await sleep(100);check('Matching replay relocks',await disabled('next-shot'));
 await start(course.scenes[6].id,'complete');await click('restart-course');await sleep(500);await click('start-course');check('Standalone restart begins first shot',await label()==='1-1');
 await start(course.scenes[6].id,'S087');await sleep(300);
 await ev("document.getElementById('pressure-frame').contentWindow.eval(\"answers=Object.fromEntries(ITEMS.map(x=>[x.id,x.id]));document.getElementById('check').click();\")");await sleep(100);check('Six image matches unlock Continue',!await disabled('next-shot'));
 await ev("document.getElementById('pressure-frame').contentWindow.eval(\"successDialog.close();document.getElementById('reset').click();\")");await sleep(100);check('Clearing image matches relocks Continue',await disabled('next-shot'));
 const failedImages=[];
 for(const scene of course.scenes)for(const shot of scene.shots){await start(scene.id,shot.sourceId);if(!shot.interactionSrc){if(!await ev("document.getElementById('shot-image').naturalWidth>0 && !document.getElementById('shot-image').hidden"))failedImages.push(shot.sourceId)}}
 check(`All ${shots.length} shots open and all shot images load`,failedImages.length===0,failedImages.join(','));
 const bookmark=course.scenes[4].id+':S056';
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__lmsData={'cmi.core.lesson_location':${JSON.stringify(bookmark)},'cmi.core.lesson_status':'not attempted'};window.API={LMSInitialize:()=> 'true',LMSGetValue:k=>window.__lmsData[k]||'',LMSSetValue:(k,v)=>(window.__lmsData[k]=v,'true'),LMSCommit:()=> 'true',LMSFinish:()=> 'true'};`});
 await start(course.scenes[0].id,'S001');check('LMS bookmark takes priority over stale local bookmark',await label()==='5-2');
 await ev(`window.__lmsData['cmi.core.lesson_location']=${JSON.stringify(course.scenes[6].id+':complete')}`);await click('home-button');await click('start-course');await click('next-scene');check('Browser sends completion to LMS',await ev("window.__lmsData['cmi.core.lesson_status']==='completed'"));await click('restart-course');await click('start-course');check('Restart inside LMS begins first shot',await label()==='1-1');
 check('Browser runtime errors',errors.length===0,errors.join(';'));
 await send('Browser.close').catch(()=>{});
 }finally{ws?.close();child.kill();}
 fs.mkdirSync(path.join(root,'qa'),{recursive:true});fs.writeFileSync(path.join(root,'qa/bug-check-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));process.exitCode=results.some(r=>!r.passed)?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1});


