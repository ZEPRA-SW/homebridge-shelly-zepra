'use strict';
function pollDelay(intervalMs,key,cycle=0){
 const base=Math.max(1,Number.isFinite(intervalMs)?intervalMs:20000),spread=Math.min(3000,Math.floor(base*.15));
 let hash=2166136261;for(const c of String(key))hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
 const offset=spread?((hash+Math.imul(cycle,2654435761))>>>0)%(spread+1):0;
 return base+offset;
}
module.exports={pollDelay};
