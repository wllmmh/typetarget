const r=(i,o)=>i.id===chrome.runtime.id&&i.url===chrome.runtime.getURL(o),t=i=>i.id===chrome.runtime.id&&i.tab===void 0&&i.url!==void 0&&new URL(i.url).pathname.endsWith(".js");export{t as a,r as i};
