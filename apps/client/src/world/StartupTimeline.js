export function createStartupTimeline(enabled=false) {
  const milestones={},longTasks=[];
  const mark=name=>{if(!enabled||milestones[name]!==undefined)return;milestones[name]=performance.now();performance.mark(`cityverse:${name}`);if(name!=='module-start'&&milestones['module-start']!==undefined)performance.measure(`cityverse:${name}`, 'cityverse:module-start',`cityverse:${name}`);};
  mark('module-start');
  if(enabled&&typeof PerformanceObserver!=='undefined')try{new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});}catch{}
  return {mark,getStats:()=>({milestones:{...milestones},longTasks:[...longTasks],measures:enabled?performance.getEntriesByType('measure').filter(e=>e.name.startsWith('cityverse:')).map(e=>({name:e.name,duration:e.duration})):[]})};
}
