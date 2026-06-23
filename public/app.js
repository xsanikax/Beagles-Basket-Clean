const STORAGE_KEY = "basketly-v1";
const APP_VERSION = "98";
const ACTION_QUEUE_KEY = "beagles-basket-action-queue-v1";
const DAY = 86400000;
const makeId=()=>globalThis.crypto?.randomUUID?.()||`bb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
const catalog = {
  "milk": ["Dairy", "🥛"], "oat milk": ["Dairy", "🥛"], "eggs": ["Dairy", "🥚"], "butter": ["Dairy", "🧈"], "yogurt": ["Dairy", "🥣"],
  "bananas": ["Produce", "🍌"], "avocados": ["Produce", "🥑"], "apples": ["Produce", "🍎"], "spinach": ["Produce", "🥬"], "tomatoes": ["Produce", "🍅"],
  "bread": ["Bakery", "🍞"], "coffee": ["Pantry", "☕"], "pasta": ["Pantry", "🍝"], "rice": ["Pantry", "🍚"], "olive oil": ["Pantry", "🫒"]
};
const starterPrices = {
  morrisons:{},
  asda:{}
};
const legacyGuidePrices={morrisons:{"avocados":1.50,"oat milk":1.50,"sourdough bread":2.00,"coffee":3.50,"milk":1.55,"eggs":2.50,"bananas":0.90,"bread":1.40,"tomatoes":1.25,"butter":2.15,"yogurt":1.10,"pasta":0.85,"rice":1.25,"olive oil":5.75},asda:{"avocados":1.45,"oat milk":1.45,"sourdough bread":1.90,"coffee":3.40,"milk":1.50,"eggs":2.45,"bananas":0.85,"bread":1.35,"tomatoes":1.20,"butter":2.10,"yogurt":1.00,"pasta":0.75,"rice":1.20,"olive oil":5.50}};
const seed = () => {
  const now = Date.now();
  const history = [];
  [["milk",7,0],["eggs",9,1],["bananas",6,2],["bread",8,3],["coffee",20,5],["avocados",7,4]].forEach(([name, interval, offset]) => {
    for(let i=1;i<=4;i++) history.push({name, boughtAt:now-((interval*i)+offset)*DAY});
  });
  return {items:[
    {id:makeId(),name:"Avocados",category:"Produce",qty:"2",done:false,addedBy:"You"},
    {id:makeId(),name:"Oat milk",category:"Dairy",qty:"1",done:false,addedBy:"Her"},
    {id:makeId(),name:"Sourdough bread",category:"Bakery",qty:"1 loaf",done:true,addedBy:"You"},
    {id:makeId(),name:"Coffee",category:"Pantry",qty:"1 bag",done:false,addedBy:"Her"}
  ],history,trips:8,selectedStore:"morrisons",prices:clone(starterPrices)};
};
function repairStateData(value){const repaired=value&&Array.isArray(value.items)&&Array.isArray(value.history)?value:seed();repaired.selectedStore||="morrisons";repaired.prices||=clone(starterPrices);repaired.priceSources||={morrisons:{},asda:{}};repaired.priceSources.morrisons||={};repaired.priceSources.asda||={};repaired.prices.morrisons||={};repaired.prices.asda||={};repaired.productCatalog||={morrisons:{}};repaired.productCatalog.morrisons||={};repaired.productSelections||={morrisons:{}};repaired.productSelections.morrisons||={};if((repaired.priceDataVersion||0)<2){for(const store of Object.keys(legacyGuidePrices)){for(const [item,price] of Object.entries(legacyGuidePrices[store])){if(repaired.prices[store]?.[item]===price&&!repaired.priceSources[store]?.[item])delete repaired.prices[store][item];}}repaired.priceDataVersion=2;}if(!Object.keys(repaired.priceSources.morrisons).length&&!Object.keys(repaired.prices.morrisons).length)delete repaired.lastMorrisonsRefresh;return repaired;}
let state=repairStateData(JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"));
let filter = "all";
const $ = s => document.querySelector(s);
const isMobileViewport=()=>globalThis.matchMedia?.("(max-width: 800px)")?.matches??((globalThis.innerWidth||1024)<=800);
const normalize = s => s.toLowerCase().trim().replace(/^\d+\s*/,"");
const infoFor = name => catalog[normalize(name)] || ["Other","🛒"];
function loadActionQueue(){try{return JSON.parse(localStorage.getItem(ACTION_QUEUE_KEY)||"[]").filter(action=>action&&action.type&&action.actionId);}catch{return [];}}
let sharedReady=false;
let sharedRevision=0;
const CLIENT_ID_KEY="beagles-basket-client-id";
const clientId=localStorage.getItem(CLIENT_ID_KEY)||makeId();
localStorage.setItem(CLIENT_ID_KEY,clientId);
let deferredRemote=null;
let actionQueue=loadActionQueue();
let actionSending=false;
let actionRetryTimer;
let liveSocket=null;
let liveSocketReady=false;
let localMutation=0;
const saveLocal=()=>localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
const save=saveLocal;
const persistActionQueue=()=>localStorage.setItem(ACTION_QUEUE_KEY,JSON.stringify(actionQueue.slice(-80)));
function compactPricePayload(payload={}){
  const compact=clone(payload);
  if(compact.productCatalog)compact.productCatalog={morrisons:{}};
  for(const store of Object.keys(compact.priceSources||{})){
    for(const key of Object.keys(compact.priceSources[store]||{})){
      if(Array.isArray(compact.priceSources[store][key]?.options))delete compact.priceSources[store][key].options;
    }
  }
  return compact;
}
function sharedStateSnapshot(){
  const outgoing=clone(state);
  outgoing.productCatalog={morrisons:{}};
  for(const store of Object.keys(outgoing.priceSources||{})){
    for(const key of Object.keys(outgoing.priceSources[store]||{})){
      if(Array.isArray(outgoing.priceSources[store][key]?.options))delete outgoing.priceSources[store][key].options;
    }
  }
  return outgoing;
}
function actionPayloadBase(){return {clientId,createdAt:Date.now()};}
function applyRemoteState(remote,{quiet=true,allowDuringQueue=false}={}){
  if(!remote?.state)return false;
  const revision=Number(remote.revision)||0;
  if(revision<=sharedRevision&&!allowDuringQueue)return false;
  if((actionQueue.length||actionSending)&&!allowDuringQueue){deferredRemote=remote;return false;}
  state=repairStateData(remote.state);
  sharedRevision=revision;
  sharedReady=true;
  saveLocal();
  render();
  if(!quiet)toast("Shared list updated");
  return true;
}
function afterLocalAction(type,payload={}){
  if(type==="mergePriceData")payload=compactPricePayload(payload);
  state._localUpdatedAt=Date.now();
  state._lastLocalAction=type;
  state._clientId=clientId;
  state._clientMutation=++localMutation;
  saveLocal();
  enqueueAction(type,payload);
}
function enqueueAction(type,payload={}){
  if(location.protocol==="file:")return;
  const action={type,payload,actionId:makeId(),clientId,clientMutation:localMutation,createdAt:Date.now()};
  if(type==="mergePriceData")actionQueue.push(action);
  else{
    const priceIndex=actionQueue.findIndex(item=>item.type==="mergePriceData");
    if(priceIndex>=0)actionQueue.splice(priceIndex,0,action);
    else actionQueue.push(action);
  }
  persistActionQueue();
  flushActions();
}
function scheduleActionRetry(delay){
  if(location.protocol==="file:")return;
  clearTimeout(actionRetryTimer);
  actionRetryTimer=setTimeout(flushActions,delay);
}
async function flushActions(){
  if(location.protocol==="file:")return;
  if(actionSending||!actionQueue.length)return;
  actionSending=true;
  try{
    while(actionQueue.length){
      const action=actionQueue[0];
      const response=await fetch("/api/action",{method:"POST",headers:{"content-type":"application/json"},cache:"no-store",body:JSON.stringify(action)});
      const remote=await response.json().catch(()=>null);
      if(!response.ok){
        if(action.type==="mergePriceData"){console.warn("Dropping background price sync",remote?.error||response.status);actionQueue.shift();persistActionQueue();continue;}
        throw new Error(remote?.error||"Shared action failed");
      }
      actionQueue.shift();
      persistActionQueue();
      applyRemoteState(remote,{quiet:true,allowDuringQueue:true});
    }
    if(deferredRemote){const latest=deferredRemote;deferredRemote=null;applyRemoteState(latest,{quiet:true});}
  }catch(error){
    console.warn("Shared action failed",error);
    scheduleActionRetry(900);
  }finally{
    actionSending=false;
    if(actionQueue.length)scheduleActionRetry(0);
  }
}
function syncNow(){
  if(location.protocol==="file:")return;
  flushActions();
}
async function seedSharedState(){
  const response=await fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},cache:"no-store",body:JSON.stringify({clientId,updatedAt:Date.now(),state:sharedStateSnapshot()})});
  const remote=await response.json().catch(()=>null);
  if(response.ok&&remote?.state)applyRemoteState(remote,{quiet:true,allowDuringQueue:true});
}
async function pullSharedState({force=false}={}){
  if(location.protocol==="file:")return;
  try{
    const response=await fetch("/api/state",{cache:"no-store",headers:{"cache-control":"no-cache"}});
    if(!response.ok){console.warn("Shared list pull rejected",await response.text());return;}
    const remote=await response.json();
    if(remote.state){applyRemoteState(remote,{quiet:true});}
    else if(force){saveLocal();await seedSharedState();}
    sharedReady=true;
  }catch(error){console.warn("Shared list pull failed",error);sharedReady=false;}
}
function connectLiveState(){
  if(location.protocol==="file:")return;
  if(globalThis.WebSocket){
    const protocol=location.protocol==="https:"?"wss:":"ws:";
    liveSocket=new WebSocket(`${protocol}//${location.host}/api/sync`);
    liveSocket.addEventListener("open",()=>{liveSocketReady=true;sharedReady=true;syncNow();});
    liveSocket.addEventListener("message",event=>{
      try{
        const data=JSON.parse(event.data||"{}");
        if(data.ack)return;
        if(data.lastAction?.clientId===clientId)return;
        if(data.state)applyRemoteState(data,{quiet:true});
      }catch{}
    });
    liveSocket.addEventListener("close",()=>{liveSocketReady=false;setTimeout(connectLiveState,1000);});
    liveSocket.addEventListener("error",()=>{liveSocketReady=false;try{liveSocket.close();}catch{}});
    return;
  }
  if(!globalThis.EventSource)return;
  const events=new EventSource("/api/state/events");
  events.onmessage=event=>{
    try{const data=JSON.parse(event.data||"{}");if(data.state)applyRemoteState(data,{quiet:true});else pullSharedState();}
    catch{pullSharedState();}
  };
  events.onerror=()=>{sharedReady=false;setTimeout(()=>pullSharedState(),1000);};
  events.onopen=()=>{sharedReady=true;};
}
async function initSharedState(){await pullSharedState({force:true});connectLiveState();setInterval(()=>{syncNow();if(!actionQueue.length&&!actionSending)pullSharedState();},1000);}
const numericQty = qty => Math.max(1,Number.parseInt(qty,10)||1);
const unitPrice = item => state.prices[state.selectedStore]?.[normalize(item.name)] ?? null;
const money = amount => new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(amount);
const toast = text => {const el=$("#toast");el.textContent=text;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1800)};
let installPrompt=null;
globalThis.addEventListener?.("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;$("#install-app").hidden=false;});
$("#install-app")?.addEventListener("click",async()=>{if(!installPrompt)return;installPrompt.prompt();const choice=await installPrompt.userChoice.catch(()=>null);if(choice?.outcome==="accepted")$("#install-app").hidden=true;installPrompt=null;});
globalThis.addEventListener?.("appinstalled",()=>{$("#install-app").hidden=true;installPrompt=null;toast("Installed as an app")});

let refreshTimer;
const queueMorrisonsRefresh=name=>{if(location.protocol==="file:"||state.selectedStore!=="morrisons"||state.priceSources.morrisons[normalize(name)])return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refreshMorrisonsPrices(true),500);};
function rememberProducts(products,updatedAt,sourceUrl){for(const product of products)state.productCatalog.morrisons[product.name]={...product,updatedAt,sourceUrl};}
async function refreshMorrisonsPrices(silent=false){
  if(location.protocol==="file:"){toast("Open Beagle's Basket with the launcher for live prices");return;}
  const button=$("#refresh-prices");button.disabled=true;button.textContent="Refreshing…";
  try{
    const response=await fetch("/api/morrisons/prices",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({items:state.items.map(item=>item.name)})});
    if(!response.ok)throw new Error("Price service unavailable");
    const data=await response.json();let updated=0;
    for(const result of data.results){if(!result.ok||!result.products.length)continue;const key=normalize(result.query);rememberProducts(result.products,result.updatedAt,result.sourceUrl);const previous=state.productSelections.morrisons[key]||state.priceSources.morrisons[key]?.productName;const match=result.products.find(product=>product.name===previous)||result.products.find(product=>/^morrisons\b/i.test(product.name))||result.products[0];state.productSelections.morrisons[key]=match.name;state.prices.morrisons[key]=match.price;state.priceSources.morrisons[key]={productName:match.name,size:match.size,updatedAt:result.updatedAt,sourceUrl:result.sourceUrl,options:result.products,resultVersion:3,imageVersion:2};updated++;}
    if(!updated)throw new Error("No Morrisons matches were returned");
    state.lastMorrisonsRefresh=Date.now();delete state.lastMorrisonsError;saveLocal();afterLocalAction("mergePriceData",{prices:state.prices,priceSources:state.priceSources,productCatalog:state.productCatalog,productSelections:state.productSelections,lastMorrisonsRefresh:state.lastMorrisonsRefresh,lastMorrisonsError:null});render();if(!silent)toast(`${updated} Morrisons price${updated===1?"":"s"} updated`);
  }catch(error){state.lastMorrisonsError=error.message;saveLocal();afterLocalAction("mergePriceData",{prices:state.prices,priceSources:state.priceSources,productCatalog:state.productCatalog,productSelections:state.productSelections,lastMorrisonsRefresh:state.lastMorrisonsRefresh||null,lastMorrisonsError:state.lastMorrisonsError});render();toast("Morrisons prices could not be matched — try refresh again");}
  finally{button.disabled=false;button.textContent="↻ Refresh prices";}
}

function predict(){
  const groups = Object.groupBy ? Object.groupBy(state.history,x=>normalize(x.name)) : state.history.reduce((a,x)=>((a[normalize(x.name)]||=[]).push(x),a),{});
  return Object.entries(groups).map(([name,events])=>{
    const times=events.map(x=>x.boughtAt).sort((a,b)=>a-b); if(times.length<2)return null;
    const gaps=times.slice(1).map((t,i)=>(t-times[i])/DAY); const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length;
    const daysSince=(Date.now()-times[times.length-1])/DAY; const consistency=Math.max(0,1-(Math.sqrt(gaps.map(g=>(g-avg)**2).reduce((a,b)=>a+b,0)/gaps.length)/(avg||1)));
    const due=daysSince/avg; const frequency=Math.min(1,times.length/5); const score=due*.6+consistency*.25+frequency*.15;
    return {name:name.replace(/\b\w/g,c=>c.toUpperCase()),score,avg:Math.round(avg),due:Math.round(avg-daysSince),icon:infoFor(name)[1]};
  }).filter(Boolean).filter(r=>!state.items.some(i=>!i.done&&normalize(i.name)===normalize(r.name))).sort((a,b)=>b.score-a.score).slice(0,3);
}
function pricePatchForKey(key){return {key,prices:state.prices,priceSources:state.priceSources,productCatalog:state.productCatalog,productSelections:state.productSelections,lastMorrisonsRefresh:state.lastMorrisonsRefresh||null,lastMorrisonsError:state.lastMorrisonsError||null};}
function addItem(raw,chosenProduct=null){
  const match=raw.trim().match(/^(\d+)\s+(.+)$/); const name=(match?.[2]||raw).trim(); if(!name)return;
  const key=normalize(name);const cached=state.priceSources.morrisons[key];const existing=state.items.find(i=>!i.done&&normalize(i.name)===key);const amount=Math.max(1,Number.parseInt(match?.[1]||"1",10)||1);
  let itemForAction=null;
  if(existing){
    if(chosenProduct){state.productSelections.morrisons[key]=chosenProduct.name;state.prices.morrisons[key]=chosenProduct.price;state.priceSources.morrisons[key]={productName:chosenProduct.name,size:chosenProduct.size,updatedAt:Date.now(),sourceUrl:cached?.sourceUrl||`https://groceries.morrisons.com/search?q=${encodeURIComponent(name)}`,options:cached?.options||pickerResults,resultVersion:cached?.resultVersion||3,imageVersion:cached?.imageVersion||2};rememberProducts(cached?.options||pickerResults,Date.now(),state.priceSources.morrisons[key].sourceUrl);}
    existing.qty=String(numericQty(existing.qty)+amount);itemForAction=clone(existing);afterLocalAction("addItem",{name,key,amount,item:itemForAction,chosenProduct,pricePatch:pricePatchForKey(key)});render();toast(`${name} quantity increased to ${existing.qty}`);return;
  }
  const item={id:makeId(),name:name.replace(/^./,c=>c.toUpperCase()),category:infoFor(name)[0],qty:String(amount),done:false,addedBy:"You"};
  if(chosenProduct){state.productSelections.morrisons[key]=chosenProduct.name;state.prices.morrisons[key]=chosenProduct.price;state.priceSources.morrisons[key]={productName:chosenProduct.name,size:chosenProduct.size,updatedAt:Date.now(),sourceUrl:cached?.sourceUrl||`https://groceries.morrisons.com/search?q=${encodeURIComponent(name)}`,options:cached?.options||pickerResults,resultVersion:cached?.resultVersion||3,imageVersion:cached?.imageVersion||2};rememberProducts(cached?.options||pickerResults,Date.now(),state.priceSources.morrisons[key].sourceUrl);}
  state.items.unshift(item);afterLocalAction("addItem",{name,key,amount,item:clone(item),chosenProduct,pricePatch:pricePatchForKey(key)});render();toast(`${name} added${state.selectedStore==="morrisons"&&!state.priceSources.morrisons[key]&&location.protocol!=="file:"?" · checking Morrisons…":""}`);queueMorrisonsRefresh(name);
}
function render(){
  const visible=state.items.filter(i=>filter==="all"||i.category===filter); const done=state.items.filter(i=>i.done).length; const pct=state.items.length?Math.round(done/state.items.length*100):0;
  const basketItems=state.items; const priced=basketItems.filter(i=>unitPrice(i)!==null); const total=priced.reduce((sum,i)=>sum+unitPrice(i)*numericQty(i.qty),0); const storeName=state.selectedStore==="morrisons"?"Morrisons Gamston":"Asda West Bridgford";
  $("#item-count").textContent=state.items.filter(i=>!i.done).length; $("#progress-label").textContent=`${pct}% complete`; $("#progress-bar").style.width=`${pct}%`;
  $("#shopping-list").innerHTML=visible.length?visible.map(i=>{const price=unitPrice(i);const source=state.priceSources[state.selectedStore]?.[normalize(i.name)];const match=source?.productName?`<span class="live-match">Matched: ${escapeHtml(source.productName)}${source.size?` · ${escapeHtml(source.size)}`:""}</span>`:"";return `<div class="item ${i.done?'done':''}"><input class="check" type="checkbox" data-id="${i.id}" ${i.done?'checked':''}><div><div class="item-name">${infoFor(i.name)[1]} ${escapeHtml(i.name)}</div><div class="item-meta">${i.category} · added by ${i.addedBy}${match}</div></div><div class="item-actions"><button class="item-price ${price===null?'unpriced':''}" data-price="${i.id}" title="Set ${storeName} price">${price===null?'Set price':money(price*numericQty(i.qty))}</button><div class="qty-control" aria-label="Quantity for ${escapeHtml(i.name)}"><button data-qty-change="-1" data-item-id="${i.id}" aria-label="Decrease ${escapeHtml(i.name)} quantity">−</button><span>${escapeHtml(i.qty)}</span><button data-qty-change="1" data-item-id="${i.id}" aria-label="Increase ${escapeHtml(i.name)} quantity">+</button></div><button class="delete" data-delete="${i.id}" aria-label="Remove ${escapeHtml(i.name)} without marking it bought" title="Remove from list">×</button></div></div>`}).join(""):`<div class="empty">Your list is clear. Nicely done.</div>`;
  $("#store-select").value=state.selectedStore; $("#total-store").textContent=`${storeName} estimate`; $("#priced-status").textContent=`${priced.length} of ${basketItems.length} items priced`; $("#basket-total").textContent=money(total);
  const isMorrisons=state.selectedStore==="morrisons";const liveCount=state.items.filter(item=>state.priceSources.morrisons[normalize(item.name)]).length;const catalogCount=Object.keys(state.productCatalog.morrisons).length;const liveStatus=liveCount&&state.lastMorrisonsRefresh?`Live · ${liveCount}/${state.items.length} matched · ${catalogCount} products saved` :state.lastMorrisonsError?"Morrisons lookup failed · retry":"Morrisons online · not refreshed";$("#refresh-prices").hidden=!isMorrisons;$("#price-source").innerHTML=isMorrisons?`<i></i> ${liveStatus}`:`<i></i> Receipt-learned prices · tap to correct`;
  const recs=predict(); $("#recommendations").innerHTML=recs.length?recs.map(r=>`<div class="recommendation"><span class="rec-icon">${r.icon}</span><div><strong>${r.name}</strong><small>${r.due<=0?'Likely due now':`Likely in ${r.due} day${r.due===1?'':'s'}`} · every ${r.avg} days</small></div><button class="rec-add" data-add="${r.name}" aria-label="Add ${r.name}">+</button></div>`).join(""):`<p class="muted">You’re all caught up. New patterns will appear after more trips.</p>`;
  $("#add-all").hidden=!recs.length; $("#trip-stat").textContent=state.trips; $("#memory-stat").textContent=new Set(state.history.map(x=>normalize(x.name))).size;
  $("#quick-row").innerHTML=["Milk","Eggs","Bananas","Bread"].map(x=>`<button data-quick="${x}">${infoFor(x)[1]} ${x}</button>`).join("");
}
function escapeHtml(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function renderMobileSheet(view){
  const sheet=$("#mobile-sheet");document.querySelectorAll("[data-mobile-view]").forEach(button=>button.classList.toggle("active",button.dataset.mobileView===view));
  if(view==="list"){sheet.hidden=true;document.querySelector(".list-column")?.scrollIntoView?.({behavior:"smooth",block:"start"});return;}
  sheet.hidden=false;$("#mobile-sheet-title").textContent=view==="history"?"Shopping history":"Settings";
  if(view==="history"){const events=[...state.history].sort((a,b)=>b.boughtAt-a.boughtAt).slice(0,60);$("#mobile-sheet-content").innerHTML=events.length?events.map(event=>`<div class="history-entry"><strong>${escapeHtml(event.productName||event.name)}</strong><span>${new Date(event.boughtAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}${event.store?` · ${event.store==="morrisons"?"Morrisons":"Asda"}`:""}</span>${event.price!=null?`<b>${money(event.price)}</b>`:""}</div>`).join(""):'<p class="muted">Completed purchases will appear here.</p>';return;}
  const cached=Object.keys(state.productCatalog.morrisons).length;$("#mobile-sheet-content").innerHTML=`<div class="settings-block"><strong>Shared household</strong><p>${sharedReady?"Connected to the shared cloud list. Changes sync in real time.":"Connecting to the shared cloud list…"}</p></div><div class="settings-block"><strong>Price catalogue</strong><p>${cached} Morrisons products remembered on this device. Selected products and list data are shared.</p><button class="settings-action" data-mobile-refresh>Refresh Morrisons prices</button></div><div class="settings-block"><strong>Current shop</strong><p>${state.selectedStore==="morrisons"?"Morrisons Gamston":"Asda West Bridgford"}</p></div>`;
}
let pickerTimer;let pickerRequest=0;let pickerResults=[];let pickerQuery="";let pickerHistoryActive=false;
function showProductPicker(){const picker=$("#product-picker");picker.hidden=false;document.body?.classList.add("picker-open");if(isMobileViewport()){dismissSearchKeyboard();if(!pickerHistoryActive&&globalThis.history?.pushState){globalThis.history.pushState({beaglesBasketPicker:true},"",globalThis.location.href);pickerHistoryActive=true;}}}
function hideProductPicker(fromHistory=false){const wasOpen=!$("#product-picker").hidden;$("#product-picker").hidden=true;document.body?.classList.remove("picker-open");pickerResults=[];pickerQuery="";if(wasOpen&&pickerHistoryActive){pickerHistoryActive=false;if(!fromHistory)globalThis.history?.back?.();}}
function renderProductPicker(query,products){
  pickerQuery=query;const selected=state.productSelections.morrisons[normalize(query)];const fallback=infoFor(query)[1];const bought=state.history.reduce((counts,event)=>{if(event.productName)counts[event.productName]=(counts[event.productName]||0)+1;return counts},{});pickerResults=products.map((product,index)=>({product,index})).sort((a,b)=>Number(b.product.name===selected)-Number(a.product.name===selected)||(bought[b.product.name]||0)-(bought[a.product.name]||0)||Number(!/^morrisons\b/i.test(a.product.name))-Number(!/^morrisons\b/i.test(b.product.name))||a.index-b.index).map(entry=>entry.product);$("#picker-title").textContent=`Choose your ${query} · ${pickerResults.length} matches`;$("#product-options").innerHTML=pickerResults.length?pickerResults.map((product,index)=>`<button type="button" role="option" aria-selected="${product.name===selected}" class="product-option ${product.name===selected?"active":""}" data-picker-index="${index}"><span class="product-thumb-wrap"><span>${fallback}</span>${product.image?`<img class="product-thumb" src="/api/morrisons/image?url=${encodeURIComponent(product.image)}" alt="" loading="lazy" onerror="this.remove()">`:""}</span><span class="product-copy"><strong>${escapeHtml(product.name)}${/^morrisons\b/i.test(product.name)?'<span class="own-brand">Morrisons own</span>':""}</strong><small>${escapeHtml(product.size||"Pack size unavailable")}${product.name===selected?" · Your usual":bought[product.name]?` · Bought ${bought[product.name]}×`:""}</small></span><b>${money(product.price)}</b></button>`).join(""):'<div class="picker-empty">No close Morrisons matches found.</div>';showProductPicker();
}
async function findProductsForInput(raw){
  const query=raw.trim().replace(/^\d+\s*/,"");if(query.length<2||state.selectedStore!=="morrisons"||location.protocol==="file:"){hideProductPicker();return;}
  const savedSource=state.priceSources.morrisons[normalize(query)];const cached=savedSource?.options;if(savedSource?.resultVersion>=3&&savedSource?.imageVersion>=2&&cached?.length){renderProductPicker(query,cached);return;}
  const request=++pickerRequest;pickerQuery=query;$("#product-options").innerHTML='<div class="picker-loading">Checking Morrisons…</div>';showProductPicker();
  try{const response=await fetch("/api/morrisons/prices",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({items:[query]})});const data=await response.json();if(request!==pickerRequest)return;const result=data.results?.[0];if(!result?.ok||!result.products?.length)throw new Error("No matches");rememberProducts(result.products,result.updatedAt,result.sourceUrl);state.priceSources.morrisons[normalize(query)]={productName:savedSource?.productName||"",size:savedSource?.size||"",updatedAt:result.updatedAt,sourceUrl:result.sourceUrl,options:result.products,resultVersion:3,imageVersion:2};saveLocal();afterLocalAction("mergePriceData",{prices:state.prices,priceSources:state.priceSources,productCatalog:state.productCatalog,productSelections:state.productSelections,lastMorrisonsRefresh:state.lastMorrisonsRefresh||null,lastMorrisonsError:state.lastMorrisonsError||null});renderProductPicker(query,result.products);}catch(error){if(request===pickerRequest){$("#product-options").innerHTML='<div class="picker-empty">Morrisons search is unavailable. Try Refresh prices.</div>';showProductPicker();}}
}
function editPrice(item){
  const key=normalize(item.name);const source=state.priceSources[state.selectedStore]?.[key];
  if(state.selectedStore==="morrisons"&&source?.options?.length){
    const choices=source.options.map((option,index)=>`${index+1}. ${option.name}${option.size?` (${option.size})`:""} — ${money(option.price)}`).join("\n");
    const selected=prompt(`Choose the Morrisons product for ${item.name}:\n\n${choices}\n\nEnter its number:`,"1");if(selected===null)return;const option=source.options[Number.parseInt(selected,10)-1];if(!option){toast("Choose a number from the list");return;}state.productSelections.morrisons[key]=option.name;state.prices.morrisons[key]=option.price;state.priceSources.morrisons[key]={...source,productName:option.name,size:option.size};afterLocalAction("setProductSelection",{store:state.selectedStore,key,option,source:state.priceSources.morrisons[key],prices:state.prices,priceSources:state.priceSources,productSelections:state.productSelections,productCatalog:state.productCatalog});render();toast("Morrisons product matched");return;
  }
  const current=unitPrice(item);const entered=prompt(`Unit price for ${item.name} at ${state.selectedStore==="morrisons"?"Morrisons Gamston":"Asda West Bridgford"} (£)`,current??"");if(entered===null)return;const value=Number.parseFloat(entered.replace("£","").trim());if(Number.isFinite(value)&&value>=0){state.prices[state.selectedStore][key]=value;delete state.priceSources[state.selectedStore][key];afterLocalAction("setManualPrice",{store:state.selectedStore,key,price:value,prices:state.prices,priceSources:state.priceSources});render();toast("Price book updated")}else toast("Enter a valid price");
}
const dismissSearchKeyboard=()=>$("#item-input").blur?.();
$("#item-input").addEventListener("input",e=>{clearTimeout(pickerTimer);if(!isMobileViewport())pickerTimer=setTimeout(()=>findProductsForInput(e.target.value),350)});
$("#item-input").addEventListener("focus",e=>{if(!isMobileViewport()&&e.target.value.trim())findProductsForInput(e.target.value)});
$("#product-options").addEventListener("pointerdown",dismissSearchKeyboard,{passive:true});
$("#product-options").addEventListener("touchstart",dismissSearchKeyboard,{passive:true});
$("#product-options").addEventListener("scroll",dismissSearchKeyboard,{passive:true});
$("#close-product-picker").addEventListener("click",()=>{dismissSearchKeyboard();hideProductPicker()});
$("#add-form").addEventListener("submit",e=>{e.preventDefault();const raw=$("#item-input").value;if(isMobileViewport()){findProductsForInput(raw);return;}const key=normalize(raw.replace(/^\d+\s*/,""));const selected=state.productSelections.morrisons[key];const product=pickerResults.find(option=>option.name===selected)||pickerResults.find(option=>/^morrisons\b/i.test(option.name))||pickerResults[0]||null;addItem(raw,product);e.target.reset();hideProductPicker()});
$("#clear-search")?.addEventListener("click",()=>{$("#item-input").value="";hideProductPicker();$("#item-input").focus()});
$("#picker-close")?.addEventListener("click",()=>hideProductPicker());
globalThis.addEventListener?.("popstate",()=>{if(pickerHistoryActive)hideProductPicker(true)});
let pickerTouchStart=null;$("#product-picker").addEventListener("touchstart",e=>{const touch=e.touches?.[0];if(touch)pickerTouchStart={x:touch.clientX,y:touch.clientY};},{passive:true});$("#product-picker").addEventListener("touchend",e=>{const touch=e.changedTouches?.[0];if(!touch||!pickerTouchStart)return;const dx=touch.clientX-pickerTouchStart.x;const dy=touch.clientY-pickerTouchStart.y;pickerTouchStart=null;if(dx>80&&Math.abs(dy)<60)hideProductPicker();},{passive:true});
document.addEventListener("click",e=>{const t=e.target.closest("button")||e.target;if(t.dataset.mobileView){renderMobileSheet(t.dataset.mobileView);return}if(t.dataset.mobileRefresh!==undefined){refreshMorrisonsPrices(false);renderMobileSheet("settings");return}if(t.dataset.pickerIndex!==undefined){const product=pickerResults[Number(t.dataset.pickerIndex)];if(product){const raw=$("#item-input").value||pickerQuery;addItem(raw,product);$("#add-form").reset();hideProductPicker()}return}if(t.dataset.quick){addItem(t.dataset.quick);return}if(t.dataset.add){addItem(t.dataset.add);return}if(t.dataset.qtyChange){const item=state.items.find(i=>i.id===t.dataset.itemId);if(item){item.qty=String(Math.max(1,numericQty(item.qty)+Number(t.dataset.qtyChange)));afterLocalAction("setQty",{id:item.id,qty:item.qty});render()}return}if(t.dataset.delete){const item=state.items.find(i=>i.id===t.dataset.delete);state.items=state.items.filter(i=>i.id!==t.dataset.delete);afterLocalAction("deleteItem",{id:t.dataset.delete});render();toast(`${item?.name||"Item"} removed from the list`);return}if(t.dataset.price){editPrice(state.items.find(i=>i.id===t.dataset.price));return}if(t.dataset.filter){filter=t.dataset.filter;document.querySelectorAll("[data-filter]").forEach(b=>b.classList.toggle("active",b===t));render();return}});
$("#store-select").addEventListener("change",e=>{state.selectedStore=e.target.value;afterLocalAction("setSelectedStore",{selectedStore:state.selectedStore});render();toast(`Showing ${e.target.selectedOptions[0].text} prices`)});
$("#refresh-prices").addEventListener("click",()=>refreshMorrisonsPrices(false));
document.addEventListener("change",e=>{if(!e.target.matches(".check"))return;const item=state.items.find(i=>i.id===e.target.dataset.id);if(!item)return;item.done=e.target.checked;afterLocalAction("setDone",{id:item.id,done:item.done});render()});
$("#clear-bought").addEventListener("click",()=>{const ids=state.items.filter(i=>i.done).map(i=>i.id);state.items=state.items.filter(i=>!i.done);afterLocalAction("clearBought",{ids});render();toast("Bought items cleared")});
$("#add-all").addEventListener("click",()=>predict().forEach(r=>addItem(r.name)));
$("#finish-trip").addEventListener("click",()=>{const bought=state.items.filter(i=>i.done);if(!bought.length){toast("Tick off items as you shop first");return}const now=Date.now();const boughtIds=bought.map(i=>i.id);bought.forEach(i=>{const source=state.priceSources[state.selectedStore]?.[normalize(i.name)];state.history.push({name:i.name,boughtAt:now,store:state.selectedStore,price:unitPrice(i),productName:source?.productName||null})});state.items=state.items.filter(i=>!i.done);state.trips++;afterLocalAction("completeQuest",{ids:boughtIds,now,store:state.selectedStore});render();toast("Trip saved everywhere — predictions updated")});
globalThis.BEAGLES_BASKET_VERSION=APP_VERSION;
$("#greeting").textContent=`A shared shopping adventure · v${APP_VERSION}`;if(isMobileViewport()){$("#add-submit-icon").textContent="⌕";$("#add-submit-label").textContent="Search";}render();
if(location.protocol!=="file:")initSharedState();
function updateAppHeight(){document.documentElement?.style.setProperty("--app-height",`${globalThis.visualViewport?.height||globalThis.innerHeight||800}px`)}
updateAppHeight();globalThis.visualViewport?.addEventListener?.("resize",updateAppHeight);globalThis.addEventListener?.("orientationchange",updateAppHeight);
if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="127.0.0.1"||location.hostname==="localhost"))navigator.serviceWorker.register("/service-worker.js").then(reg=>reg.update?.()).catch(()=>{});
