/* Executes production service-worker source with simulated extension APIs/HTTP.
 * Native browser policies prohibit loading extensions in this test environment. */
const fs=require('fs'),vm=require('vm'),path=require('path'),readline=require('readline');
const {webcrypto}=require('crypto');
const ROOT=path.resolve(__dirname,'..');const store={};const events={storage:[],alarms:[],runtime:[],installed:[],startup:[]};
const alarms=new Map(),badges={},calls=[];let invalid=false;
const fixture={auth:true,account:'account-test',user:'user-test',plan:'pro',fail:0,count:1,empty:false,hasProject:false,requests:[],noStorage:false,droppedWrites:false};
const respond=(v,cb)=>{if(cb)queueMicrotask(()=>cb(structuredClone(v)));return Promise.resolve(structuredClone(v));};
const chrome={
 runtime:{id:'ffnaboibekmfpegifameabebgpjpdpnn',getURL:p=>'chrome-extension://ffnaboibekmfpegifameabebgpjpdpnn/'+p,onMessage:{addListener:f=>events.runtime.push(f)},onInstalled:{addListener:f=>events.installed.push(f)},onStartup:{addListener:f=>events.startup.push(f)}},
 storage:{local:{
  get(keys,cb){if(fixture.noStorage)throw new Error('simulated storage unavailable');const value=keys==null?store:Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in store).map(k=>[k,store[k]]));return respond(value,cb);},
  set(items,cb){if(fixture.noStorage)throw new Error('simulated storage unavailable');const changes={};if(!fixture.droppedWrites)for(const [k,v] of Object.entries(items)){changes[k]={oldValue:store[k],newValue:v};store[k]=structuredClone(v);}const r=respond(undefined,cb);queueMicrotask(()=>events.storage.forEach(f=>f(changes,'local')));return r;},
  remove(keys,cb){for(const k of Array.isArray(keys)?keys:[keys])delete store[k];return respond(undefined,cb);}
 },onChanged:{addListener:f=>events.storage.push(f)}},
 action:Object.fromEntries(['setIcon','setTitle','setBadgeText','setBadgeBackgroundColor','setBadgeTextColor'].map(k=>[k,(v,cb)=>{badges[k]=structuredClone(v);calls.push({method:k,value:v});return respond(undefined,cb);} ])),
 alarms:{get:(n,cb)=>respond(alarms.get(n),cb),create:function(n,v){if(arguments.length!==2)throw new TypeError('alarms.create does not accept a callback');alarms.set(n,v);return Promise.resolve();},clear:(n,cb)=>respond(alarms.delete(n),cb),onAlarm:{addListener:f=>events.alarms.push(f)}},
 tabs:{query:(_q,cb)=>respond([],cb),sendMessage:()=>Promise.reject(new Error('No fixture tab.')),create:(args,cb)=>respond({id:1,...args},cb)}
};
const context={console:{log:(...a)=>console.error(...a),warn:(...a)=>console.error(...a)},setTimeout,clearTimeout,setInterval,clearInterval,crypto:webcrypto,navigator:{language:'en'},URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,Response,Request,Headers,Blob,Date,structuredClone,atob,btoa,chrome};
context.globalThis=context;vm.createContext(context);
context.importScripts=(...names)=>names.forEach(n=>vm.runInContext(fs.readFileSync(path.join(ROOT,n),'utf8'),context,{filename:n}));
context.fetch=async(input,init={})=>{
 const u=new URL(String(input),'https://chatgpt.com'),p=u.pathname,q=u.searchParams;fixture.requests.push({path:p,query:u.search,t:Date.now(),method:init.method||'GET'});
 let data,status=200,headers={'content-type':'application/json'};const now=Date.now()/1000;
 const msg=(id,days,model='gpt-6-pro')=>({id,create_time:now-days*86400,author:{role:'assistant'},recipient:'all',end_turn:true,metadata:{model_slug:model},content:{parts:['NEVER_PERSIST_CHAT_TEXT']}});
 if(p==='/api/auth/session'){status=fixture.auth?200:401;data=fixture.auth?{accessToken:'FAKE_TOKEN_DO_NOT_STORE',account:{id:fixture.account,plan_type:fixture.plan},user:{id:fixture.user}}:{error:'signed out'};}
 else if(p==='/backend-api/conversations')data={items:fixture.empty||q.get('is_archived')==='true'?[]:Array.from({length:fixture.count},(_,i)=>({id:'chat-'+i,update_time:now-5}))};
 else if(p==='/backend-api/gizmos/snorlax/sidebar')data={items:fixture.hasProject?[{gizmo:{id:'g-p-fixture'}}]:[]};
 else if(p==='/backend-api/gizmos/g-p-fixture/conversations')data={items:[{id:'project-chat',update_time:now-10}]};
 else if(p.startsWith('/backend-api/conversations/')){
  if(fixture.fail){status=fixture.fail;data={error:'fixture'};headers['retry-after']='60';}
  else data={messages:[msg(p+'-recent',.01),msg(p+'-old',40,'gpt-5-6-thinking')],page_info:{has_previous_page:false}};
 }else{status=404;data={error:'fixture endpoint not found'};}
 return new Response(JSON.stringify(data),{status,headers});
};
context.__fixture=fixture;context.__store=store;context.__alarms=alarms;context.__badges=badges;context.__calls=calls;
context.__clear=()=>{for(const k of Object.keys(store))delete store[k];fixture.requests.length=0;fixture.fail=0;fixture.auth=true;};
context.__message=m=>new Promise(resolve=>{let accepted=false;for(const f of events.runtime)if(f(m,{id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')},resolve))accepted=true;if(!accepted)resolve({ok:false,code:'NO_HANDLER'});});
context.__fireAlarm=name=>events.alarms.forEach(f=>f({name}));
vm.runInContext(fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8'),context,{filename:'service-worker.js'});
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on('line',async line=>{let req;try{req=JSON.parse(line);const value=await vm.runInContext(req.code,context);process.stdout.write(JSON.stringify({id:req.id,value:value===undefined?null:value})+'\n');}catch(e){process.stdout.write(JSON.stringify({id:req?.id,error:e.stack||String(e)})+'\n');}});
