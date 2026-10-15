/* Original local-only ranking editor. No network requests or third-party runtime. */
(() => {
  'use strict';
  const M = window.RankingModel, Store = window.RankingStorage, Export = window.RankingExport;
  const $ = id => document.getElementById(id);
  if (!M || !Store || !Export) return;
  let state = M.createDefaultState(), itemId = null, rowId = null, newRow = false;
  let revision = 0, savedRevision = 0, initialized = false, busy = false, suppressClick = false, protectedSave = false, saveTimer;
  const storage = Store.createStore();
  const app = $('ranking-app'), board = $('ranking-board'), pool = $('candidate-pool');
  const title = $('ranking-title'), saveStatus = $('save-status');
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function message(text, error = false) {
    const area = $('tool-message'); area.textContent = text; area.dataset.error = String(error); area.hidden = !text;
  }
  function failure(error) { message(error.message || '操作未完成，请重试或导出 JSON 备份。', true); }
  function autosizeTitle() { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; }
  function setBusy(value) {
    busy = value;
    app.querySelectorAll('button,input,select,textarea').forEach(element => { element.disabled = value; });
    app.setAttribute('aria-busy', String(value));
  }
  async function persist() {
    if(!initialized || revision===savedRevision)return;
    const current = revision;
    if (protectedSave) {
      saveStatus.textContent = '原存档受保护，请先导出备份或确认重置'; saveStatus.dataset.failed = 'true'; return;
    }
    saveStatus.textContent = '正在保存…'; saveStatus.dataset.failed = 'false';
    try {
      await storage.save(state);
      savedRevision=current;
      if (current === revision) { saveStatus.textContent = '已自动保存到本机'; saveStatus.dataset.failed = 'false'; }
    } catch (error) {
      if (current === revision) { saveStatus.textContent = '自动保存失败 · 请导出 JSON'; saveStatus.dataset.failed = 'true'; failure(error); }
    }
  }
  function scheduleSave() { revision++; clearTimeout(saveTimer); saveStatus.textContent='正在保存…'; saveTimer=setTimeout(persist,350); }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(saveTimer);persist();}});
  function changed(text) { render(); scheduleSave(); if (text) message(text); }
  function run(operation) { try { operation(); } catch (error) { failure(error); } }
  function list(target) { return target === 'pool' ? state.pool : state.rows.find(row => row.id === target).itemIds; }
  function card(id) {
    const item = state.items[id], entry = node('div','rank-card'); entry.dataset.itemId = id;
    const button = node('button','card-main'); button.type = 'button'; button.setAttribute('aria-label', '编辑或移动：' + item.name);
    const art = node('span','card-art');
    if (item.image) { const image = node('img'); image.src = item.image; image.alt = ''; image.draggable = false; image.loading='lazy'; image.decoding='async'; art.append(image); }
    else if (item.art) { art.textContent = M.FOOD_ART[item.art].emoji; art.style.backgroundColor = M.FOOD_ART[item.art].bg; }
    else { art.classList.add('text-art'); art.textContent = Array.from(item.name).slice(0,2).join(''); }
    art.setAttribute('aria-hidden','true'); button.append(art, node('span','card-name',item.name));
    const handle = node('button','drag-handle','⠿'); handle.type = 'button'; handle.title = '拖动项目（触屏按住此处）'; handle.setAttribute('aria-label','拖动或编辑：' + item.name);
    entry.append(button,handle); return entry;
  }
  function render() {
    const boardNodes = state.rows.map(row => {
      const section = node('div','tier-row'); section.dataset.rowId = row.id;
      const label = node('div','tier-label'); label.style.setProperty('--tier-color',row.color);
      // Keep arbitrary user colors readable without changing the saved color.
      const rgb = row.color.match(/[a-f\d]{2}/gi).map(x => parseInt(x,16));
      label.style.color = (rgb[0]*.299+rgb[1]*.587+rgb[2]*.114)<145 ? '#ffffff' : '#202a25';
      const heading = node('strong',null,row.name); const edit = node('button','row-settings','设置'); edit.type='button'; edit.dataset.editRow=row.id; edit.setAttribute('aria-label','设置等级：'+row.name);
      label.append(heading,edit);
      const items = node('div','item-list'); items.dataset.zone=row.id; items.setAttribute('aria-label',row.name+'级项目'); items.append(...row.itemIds.map(card)); section.append(label,items); return section;
    });
    board.replaceChildren(...boardNodes); pool.replaceChildren(...state.pool.map(card));
    $('pool-count').textContent = state.pool.length;
    if (document.activeElement !== title) { title.value = state.title; autosizeTitle(); }
    $('display-title').textContent = state.title;
    $('add-row').disabled = state.rows.length >= M.LIMITS.rows;
  }
  function focusCard(id) { document.querySelectorAll('.rank-card').forEach(entry => { if(entry.dataset.itemId===id) entry.querySelector('.card-main').focus({preventScroll:true}); }); }
  function openItem(id) {
    if (busy) return; itemId=id; const item=state.items[id]; if(!item) return;
    $('item-name').value=item.name; const target=$('item-target'); target.replaceChildren();
    const options=[{id:'pool',name:'待选区'},...state.rows]; options.forEach(row=>{const option=node('option',null,row.name);option.value=row.id;target.append(option);});
    target.value=M.locateItem(state,id).target; updateOrderButtons(); $('item-dialog').showModal();
  }
  function updateOrderButtons() {
    const location=M.locateItem(state,itemId); $('item-previous').disabled=location.index===0; $('item-next').disabled=location.index===list(location.target).length-1;
  }
  function openRow(id) {
    if(busy)return; newRow=!id; rowId=id; const row=state.rows.find(row=>row.id===id);
    $('row-name').value=row ? row.name : ''; $('row-color').value=row ? row.color : '#c7d7bd';
    $('row-dialog-title').textContent=newRow?'添加等级':'等级设置'; $('row-delete').hidden=newRow;
    $('row-up').disabled=newRow||state.rows.indexOf(row)===0; $('row-down').disabled=newRow||state.rows.indexOf(row)===state.rows.length-1;
    $('row-delete').disabled=state.rows.length<=1; $('row-dialog').showModal();
  }
  app.addEventListener('click',event=>{
    if(suppressClick){event.preventDefault();event.stopPropagation();return;}
    const button=event.target.closest('.card-main,.drag-handle'); if(button)openItem(button.closest('.rank-card').dataset.itemId);
    const row=event.target.closest('[data-edit-row]'); if(row)openRow(row.dataset.editRow);
  });
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('item-dialog').addEventListener('close',()=>{if(itemId)focusCard(itemId);});
  $('row-dialog').addEventListener('close',()=>{document.querySelectorAll('[data-edit-row]').forEach(button=>{if(button.dataset.editRow===rowId)button.focus({preventScroll:true});});});
  $('item-edit-form').addEventListener('submit',event=>{event.preventDefault();run(()=>{
    const name=$('item-name').value.trim(); if(!name)throw new Error('请填写项目名称。');
    M.updateItem(state,itemId,{name}); const target=$('item-target').value;
    if(M.locateItem(state,itemId).target!==target)M.moveItem(state,itemId,target);
    changed('项目已更新。'); $('item-dialog').close();
  });});
  [['item-previous',-1],['item-next',1]].forEach(([id,offset])=>$(id).addEventListener('click',()=>run(()=>{
    const location=M.locateItem(state,itemId); M.moveItem(state,itemId,location.target,location.index+offset); changed('项目顺序已调整。'); updateOrderButtons();
  })));
  $('item-delete').addEventListener('click',()=>{if(confirm('删除这个项目？此操作无法撤销。'))run(()=>{M.removeItem(state,itemId);itemId=null;changed('项目已删除。');$('item-dialog').close();});});
  $('add-row').addEventListener('click',()=>openRow(null));
  $('row-edit-form').addEventListener('submit',event=>{event.preventDefault();run(()=>{
    const options={name:$('row-name').value.trim(),color:$('row-color').value};
    if(newRow)rowId=M.addRow(state,options);else M.updateRow(state,rowId,options);
    changed('等级已保存。');$('row-dialog').close();
  });});
  [['row-up',-1],['row-down',1]].forEach(([id,offset])=>$(id).addEventListener('click',()=>run(()=>{
    M.reorderRow(state,rowId,state.rows.findIndex(row=>row.id===rowId)+offset);changed('等级顺序已调整。');
    const row=state.rows.find(row=>row.id===rowId);$('row-up').disabled=state.rows.indexOf(row)===0;$('row-down').disabled=state.rows.indexOf(row)===state.rows.length-1;
  })));
  $('row-delete').addEventListener('click',()=>run(()=>{M.deleteRow(state,rowId);changed('等级已删除，其中的项目已回到待选区。');$('row-dialog').close();}));
  $('add-text-form').addEventListener('submit',event=>{event.preventDefault();if(busy)return;run(()=>{M.addItem(state,{name:$('text-name').value.trim(),image:null,art:null});$('text-name').value='';changed('文字项目已加入待选区。');$('text-name').focus();});});
  title.addEventListener('input',()=>{autosizeTitle();if(title.value.trim())run(()=>{M.setTitle(state,title.value.trim());$('display-title').textContent=state.title;scheduleSave();});});
  title.addEventListener('blur',()=>{if(!title.value.trim()){title.value=state.title;message('标题不能为空，已恢复上次标题。');autosizeTitle();}});
  window.addEventListener('resize',autosizeTitle);
  function download(blob,name) {
    const url=URL.createObjectURL(blob),anchor=node('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function safeFilename(extension) {return (state.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,60)||'我的排行')+'.'+extension;}
  $('png-export').addEventListener('click',async()=>{
    if(busy)return;setBusy(true);message('正在生成 PNG，请稍候…');
    try{const result=await Export.exportRanking(M.validateState(state),{scale:Number($('export-scale').value)});download(result.blob,safeFilename('png'));message('PNG 已生成（'+result.width+' × '+result.height+' 像素'+(result.scale<Number($('export-scale').value)?'，已为长图自动降低倍率':'')+'）。');}
    catch(error){failure(error);}finally{setBusy(false);render();}
  });
  $('json-export').addEventListener('click',()=>run(()=>{download(new Blob([M.serialize(state)],{type:'application/json'}),safeFilename('json'));message('JSON 备份已生成，包含自定义图片与全部项目。');}));
  $('json-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return; if(busy){event.target.value='';return;}
    setBusy(true);
    try{
      if(file.size>M.LIMITS.jsonBytes)throw new Error('备份文件过大，最多支持 30 MB。');
      const imported=M.deserialize(await file.text());
      if(confirm('导入将替换当前排行。请先导出 JSON 备份。继续导入吗？')){state=imported;protectedSave=false;changed('备份已导入。');}
    }catch(error){failure(error);}finally{event.target.value='';setBusy(false);render();}
  });
  $('reset-ranking').addEventListener('click',()=>{if(busy)return;if(confirm('重置为默认美食排行？当前排行及自定义图片将被替换，请先导出 JSON 备份。')){state=M.createDefaultState();protectedSave=false;changed('已重置为默认美食排行。');presentation(true);}});
  function presentation(enabled){document.body.classList.toggle('presentation',enabled);$('presentation-toggle').textContent=enabled?'编辑 / 退出展示 · Esc':'展示模式';$('presentation-toggle').setAttribute('aria-pressed',String(enabled));autosizeTitle();}
  $('presentation-toggle').addEventListener('click',()=>presentation(!document.body.classList.contains('presentation')));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('item-dialog').open&&!$('row-dialog').open)presentation(false);});
  async function normalizeImage(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('仅支持 PNG、JPG、WebP；不接受 SVG 或其他文件。');
    if(file.size>10*1024*1024)throw new Error('图片超过 10 MB，请先缩小原图。');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const header=M.inspectRaster(bytes,file.type);
    if(header.width>12000||header.height>12000||header.width*header.height>32000000)throw new Error('原图尺寸过大，请先缩小到 3200 万像素以内。');
    const url=URL.createObjectURL(file),image=new Image();
    try{
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('图片读取超时，请换一张图片。')),12000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('图片损坏或浏览器无法读取。'));};image.src=url;});
      if(!image.naturalWidth||!image.naturalHeight)throw new Error('图片尺寸无效。');
      const factor=Math.min(1,640/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法处理图片。');
      ctx.drawImage(image,0,0,canvas.width,canvas.height);let data=canvas.toDataURL('image/webp',.84);
      if(!data.startsWith('data:image/webp;')){ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/jpeg',.85);}
      M.validateImage(data);canvas.width=1;canvas.height=1;return data;
    }finally{image.src='';URL.revokeObjectURL(url);}
  }
  $('image-files').addEventListener('change',async event=>{
    const files=Array.from(event.target.files);event.target.value='';if(!files.length||busy)return;
    if(files.length+Object.keys(state.items).length>M.LIMITS.items){message('项目总数最多 '+M.LIMITS.items+' 个，请减少本次选择。',true);return;}
    setBusy(true);let added=0;const errors=[];
    for(let index=0;index<files.length;index++){
      const file=files[index];message('正在处理图片 '+(index+1)+' / '+files.length+'…');
      try{const image=await normalizeImage(file);const name=file.name.replace(/\.[^.]+$/,'').trim().slice(0,80)||'未命名图片';M.addItem(state,{name,image,art:null});added++;scheduleSave();}
      catch(error){if(errors.length<4)errors.push(file.name+'：'+error.message);}
    }
    setBusy(false);if(added)changed();else render();
    message('已导入 '+added+' 张图片。'+(errors.length?' 部分文件未导入：'+errors.join('；'):''),errors.length>0);
  });
  // Pointer Events cover mouse, pen and touch. A touch grip preserves normal page scrolling.
  let drag=null,ghost=null,drop=null,raf=0,lastPoint=null;
  function clearDrop(){document.querySelectorAll('.drop-active,.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-active','drop-before','drop-after'));}
  function findDrop(x,y){
    clearDrop();const hit=document.elementFromPoint(x,y);const zone=hit&&hit.closest('.item-list[data-zone]');if(!zone)return null;
    zone.classList.add('drop-active');const cards=Array.from(zone.querySelectorAll('.rank-card')).filter(el=>el.dataset.itemId!==drag.id);let at=cards.length;
    for(let i=0;i<cards.length;i++){const box=cards[i].getBoundingClientRect();if(y<box.top||y<=box.bottom&&x<box.left+box.width/2){at=i;break;}}
    if(cards[at])cards[at].classList.add('drop-before');else if(cards.length)cards[cards.length-1].classList.add('drop-after');
    return{target:zone.dataset.zone,index:at,zone};
  }
  function dragFrame(){
    if(!drag||!drag.active||!lastPoint)return;
    const {x,y}=lastPoint;ghost.style.left=(x-36)+'px';ghost.style.top=(y-35)+'px';drop=findDrop(x,y);
    const poolBox=pool.getBoundingClientRect();
    if(x>=poolBox.left&&x<=poolBox.right&&y>=poolBox.top&&y<=poolBox.bottom){if(y<poolBox.top+45)pool.scrollTop-=12;else if(y>poolBox.bottom-45)pool.scrollTop+=12;}
    if(y<65)window.scrollBy(0,-12);else if(y>window.innerHeight-65)window.scrollBy(0,12);
    raf=requestAnimationFrame(dragFrame);
  }
  app.addEventListener('pointerdown',event=>{
    if(busy||event.button!==0||drag)return;const cardElement=event.target.closest('.rank-card');if(!cardElement)return;
    if(event.pointerType==='touch'&&!event.target.closest('.drag-handle'))return;
    drag={id:cardElement.dataset.itemId,element:cardElement,pointerId:event.pointerId,x:event.clientX,y:event.clientY,active:false};
    // Capture only once a drag starts; preserving the original target keeps click/keyboard editing native.
  });
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>7){
      drag.active=true;drag.element.setPointerCapture(event.pointerId);suppressClick=true;drag.element.classList.add('is-dragging');document.body.classList.add('dragging');
      ghost=drag.element.cloneNode(true);ghost.classList.remove('is-dragging');ghost.classList.add('drag-ghost');ghost.style.width='82px';ghost.setAttribute('aria-hidden','true');ghost.removeAttribute('data-item-id');document.body.append(ghost);
      lastPoint={x:event.clientX,y:event.clientY};raf=requestAnimationFrame(dragFrame);
    }
    if(drag.active){event.preventDefault();lastPoint={x:event.clientX,y:event.clientY};}
  },{passive:false});
  function endDrag(event,cancelled=false){
    if(!drag||event&&event.pointerId!==drag.pointerId)return;const old=drag;
    const finalDrop=old.active&&!cancelled&&event?findDrop(event.clientX,event.clientY):drop;
    cancelAnimationFrame(raf);clearDrop();if(ghost)ghost.remove();ghost=null;document.body.classList.remove('dragging');old.element.classList.remove('is-dragging');drag=null;
    if(old.active&&!cancelled&&finalDrop)run(()=>{M.moveItem(state,old.id,finalDrop.target,finalDrop.index);changed('项目已移动。');focusCard(old.id);});
    drop=null;lastPoint=null;if(old.active)setTimeout(()=>{suppressClick=false;},80);
  }
  document.addEventListener('pointerup',event=>endDrag(event));document.addEventListener('pointercancel',event=>endDrag(event,true));
  window.addEventListener('blur',()=>endDrag(null,true));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){endDrag(null,true);event.preventDefault();}});
  (async()=>{
    try{const restored=await storage.load();if(restored){state=restored;saveStatus.textContent='已恢复本机排行';}else saveStatus.textContent='修改后自动保存到本机';}
    catch(error){protectedSave=true;saveStatus.textContent='无法恢复存档 · 请备份';saveStatus.dataset.failed='true';failure(error);}
    render();app.hidden=false;initialized=true;presentation(true);
  })();
})();
