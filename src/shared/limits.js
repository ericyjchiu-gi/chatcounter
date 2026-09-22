/* Plan-aware Advanced Chat reference windows. These are estimates, never provider balances. */
(() => {
  'use strict';
  const C=globalThis.ChatCounter;
  const WEEKDAYS={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  function zoneParts(ms,tz){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(ms));
    const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return {year:+v.year,month:+v.month,day:+v.day,hour:+v.hour,minute:+v.minute,second:+v.second,weekday:WEEKDAYS[v.weekday]};
  }
  function zonedToUtc(local,tz){
    const target=Date.UTC(local.year,local.month-1,local.day,local.hour||0,local.minute||0,local.second||0);let guess=target;
    for(let i=0;i<4;i++){
      const p=zoneParts(guess,tz),seen=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
      const diff=target-seen;guess+=diff;if(Math.abs(diff)<1000)break;
    }
    return guess;
  }
  function weeklyStart(settings,now){
    const day=settings?.resetDay;
    if(day===''||day==null||!Number.isInteger(Number(day))||Number(day)<0||Number(day)>6)return {start:now-7*C.DAY,anchored:false};
    const tz=settings.resetTz||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',p=zoneParts(now,tz),[hh,mm]=String(settings.resetTime||'00:00').split(':').map(Number);
    let back=(p.weekday-Number(day)+7)%7;
    let localDate=new Date(Date.UTC(p.year,p.month-1,p.day)-back*C.DAY);
    let local={year:localDate.getUTCFullYear(),month:localDate.getUTCMonth()+1,day:localDate.getUTCDate(),hour:Number.isFinite(hh)?hh:0,minute:Number.isFinite(mm)?mm:0,second:0};
    let start=zonedToUtc(local,tz);
    if(start>now){localDate=new Date(Date.UTC(local.year,local.month-1,local.day)-7*C.DAY);local={...local,year:localDate.getUTCFullYear(),month:localDate.getUTCMonth()+1,day:localDate.getUTCDate()};start=zonedToUtc(local,tz);}
    return {start,anchored:true,tz};
  }
  function monthStart(settings,now){
    const tz=settings?.resetTz||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',p=zoneParts(now,tz);
    return {start:zonedToUtc({year:p.year,month:p.month,day:1,hour:0,minute:0,second:0},tz),anchored:true,tz};
  }
  C.planLimitConfig=plan=>{
    const raw=plan?.raw||'',business=String(plan?.label||'').startsWith('Business');
    if(raw==='pro')return {label:'Pro $200',mode:'separate'};
    if(raw==='prolite')return {label:'Pro $100',mode:'shared-week',cap:50};
    if(business&&plan?.seat==='premium')return {label:'Business Premium',mode:'shared-week',cap:50};
    if(business&&plan?.seat==='standard')return {label:'Business Standard',mode:'shared-month',cap:15};
    return null;
  };
  C.advancedUsage=(state,events,now=C.now())=>{
    const config=C.planLimitConfig(state.plan);if(!config)return {config:null,cards:[]};
    const family=e=>C.family(e.model),count=(key,start)=>events.filter(e=>e.t>=start&&e.t<=now&&(key==='total'?(family(e)==='gpt56pro'||family(e)==='gpt6pro'):family(e)===key)).length;
    const week=weeklyStart(state.settings,now),day={start:now-C.DAY,anchored:false},month=monthStart(state.settings,now);
    let cards;
    if(config.mode==='separate')cards=[
      {key:'gpt6pro',count:count('gpt6pro',week.start),cap:200,period:'week',anchored:week.anchored,shared:false},
      {key:'gpt56pro',count:count('gpt56pro',day.start),cap:170,period:'day',anchored:false,shared:false},
      {key:'total',count:count('total',day.start),cap:200,period:'day',anchored:false,shared:false}
    ];
    else if(config.mode==='shared-week')cards=[
      {key:'gpt56pro',count:count('gpt56pro',week.start),cap:config.cap,period:'week',anchored:week.anchored,shared:true},
      {key:'gpt6pro',count:count('gpt6pro',week.start),cap:config.cap,period:'week',anchored:week.anchored,shared:true},
      {key:'total',count:count('total',week.start),cap:config.cap,period:'week',anchored:week.anchored,shared:true}
    ];
    else cards=[
      {key:'gpt56pro',count:count('gpt56pro',month.start),cap:config.cap,period:'month',anchored:true,shared:true},
      {key:'gpt6pro',count:count('gpt6pro',month.start),cap:config.cap,period:'month',anchored:true,shared:true},
      {key:'total',count:count('total',month.start),cap:config.cap,period:'month',anchored:true,shared:true}
    ];
    for(const card of cards)card.percent=Math.max(0,Math.min(100,Math.round(card.count/card.cap*100)));
    return {config,cards,week};
  };
  C.weeklyStart=weeklyStart;
})();
