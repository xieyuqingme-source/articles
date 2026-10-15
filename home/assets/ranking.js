/* Original local-only ranking editor. No network requests or third-party runtime. */
(() => {
  'use strict';
  const M = window.RankingModel, Store = window.RankingStorage, Export = window.RankingExport, Images = window.RankingImages;
  const $ = id => document.getElementById(id);
  if (!M || !Store || !Export || !Images) return;
  let state = M.createDefaultState(), itemId = null, rowId = null, newRow = false, itemDraftIndex=0, imageBusy=false, undoSnapshot=null, undoKind=null;
  let revision = 0, savedRevision = 0, initialized = false, busy = false, suppressClick = false, protectedSave = false, saveTimer;
  let lastTap = null, editBlockedUntil = 0;
  const templateDrafts = new Map();
  const storage = Store.createStore();
  const app = $('ranking-app'), board = $('ranking-board'), pool = $('candidate-pool');
  const title = $('ranking-title'), saveStatus = $('save-status');
  Object.values(M.TEMPLATES).forEach(template => {
    const option = document.createElement('option'); option.value = template.id; option.textContent = template.label;
    $('ranking-template').append(option);
  });
  function templateLabel(id = state.templateId) { return M.TEMPLATES[id].label; }
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
  function itemFailure(error) { $('item-error').textContent=error.message||'图片编辑未完成，请重试。';$('item-error').hidden=false; }
  const imageEditor=Images.createEditor({canvas:$('crop-preview'),zoomInput:$('crop-zoom'),zoomValue:$('crop-zoom-value'),status:$('crop-status'),resetButton:$('crop-reset'),replaceInput:$('item-image-file'),removeButton:$('item-image-remove'),onBusy(value){imageBusy=value;$('item-save').disabled=value;$('item-delete').disabled=value;$('item-target').disabled=value;updateOrderButtons();},onError:itemFailure});
  const view = window.RankingView?.create({enterPresentation(){presentation(true);}});
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
  function invalidateClearUndo() { undoSnapshot=null;undoKind=null;$('undo-clear').hidden=true; }
  function changed(text,options={}) { if(!options.preserveUndo)invalidateClearUndo();render();scheduleSave();if(text)message(text); }
  function run(operation) { try { operation(); } catch (error) { failure(error); } }
  function list(target) { return target === 'pool' ? state.pool : state.rows.find(row => row.id === target).itemIds; }
  function card(id) {
    const item = state.items[id], entry = node('div','rank-card'); entry.dataset.itemId = id;
    const button = node('button','card-main'); button.type = 'button'; button.setAttribute('aria-label', '编辑或移动：' + item.name);
    const art = node('span','card-art');
    const builtIn=item.art?(M.BUILTIN_ART || M.FOOD_ART)[item.art]:null,source=item.image||builtIn?.photo;
    if (source) { const image = node('img');image.alt='';image.draggable=false;image.loading='lazy';image.decoding='async';if(item.image&&item.crop){const crop=item.crop;image.className='cropped-image';image.onload=()=>{image.style.width=(image.naturalWidth/crop.size*100)+'%';image.style.height=(image.naturalHeight/crop.size*100)+'%';image.style.left=(-crop.x/crop.size*100)+'%';image.style.top=(-crop.y/crop.size*100)+'%';};}else if(builtIn)image.className='builtin-photo';image.src=source;art.append(image); }
    else if (item.art) { art.textContent = Array.from(item.name).slice(0,2).join('');art.classList.add('text-art'); }
    else { art.classList.add('text-art'); art.textContent = Array.from(item.name).slice(0,2).join(''); }
    art.setAttribute('aria-hidden','true'); button.append(art, node('span','card-name',item.name));
    const handle = node('button','drag-handle editor-only','⠿'); handle.type = 'button'; handle.title = '拖动项目（触屏按住此处）'; handle.setAttribute('aria-label','拖动或编辑：' + item.name);
    const remove=node('button','card-remove editor-only','×');remove.type='button';remove.dataset.removeItem=id;remove.title='删除项目';remove.setAttribute('aria-label','删除项目：'+item.name);
    entry.append(button,handle,remove);return entry;
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
    document.body.dataset.rankingSkin=state.skin;$('ranking-skin').value=state.skin;
    document.body.dataset.rankingTemplate=state.templateId;$('ranking-template').value=state.templateId;
    $('reset-ranking').textContent='恢复默认'+templateLabel();
    $('template-note').textContent=state.templateId==='sport'?'运动示例仅为个人偏好，不构成健康或训练建议。':'示例仅为个人演示，不代表权威评价。';
    $('add-row').disabled = state.rows.length >= M.LIMITS.rows;
    $('clear-items').disabled=Object.keys(state.items).length===0;$('undo-clear').hidden=!undoSnapshot;$('undo-clear').textContent=undoKind==='template'?'撤销切换模板':undoKind==='reset'?'撤销恢复默认':'撤销清空';
    view?.refresh(state.pool.length);
  }
  function focusCard(id) { document.querySelectorAll('.rank-card').forEach(entry => { if(entry.dataset.itemId===id) entry.querySelector('.card-main').focus({preventScroll:true}); }); }
  function isPresentation() { return document.body.classList.contains('presentation'); }
  function openItem(id) {
    if (busy || $('item-dialog').open || $('row-dialog').open) return; lastTap=null;itemId=id; const item=state.items[id]; if(!item) return;
    $('item-name').value=item.name; const target=$('item-target'); target.replaceChildren();
    const options=[{id:'pool',name:'待选区'},...state.rows]; options.forEach(row=>{const option=node('option',null,row.name);option.value=row.id;target.append(option);});
    const location=M.locateItem(state,id);target.value=location.target;itemDraftIndex=location.index;$('item-error').hidden=true;updateOrderButtons();$('item-dialog').showModal();imageEditor.open(item).catch(itemFailure);
  }
  function updateOrderButtons() {
    if(!itemId||!state.items[itemId])return;const target=$('item-target').value;if(!target)return;
    const peers=list(target).filter(id=>id!==itemId);itemDraftIndex=Math.max(0,Math.min(peers.length,itemDraftIndex));
    $('item-previous').disabled=imageBusy||itemDraftIndex===0;$('item-next').disabled=imageBusy||itemDraftIndex===peers.length;$('item-position').textContent='第 '+(itemDraftIndex+1)+' / '+(peers.length+1)+' 项 · 保存后生效';
  }
  function openRow(id) {
    if(busy)return; newRow=!id; rowId=id; const row=state.rows.find(row=>row.id===id);
    $('row-name').value=row ? row.name : ''; $('row-color').value=row ? row.color : '#c7d7bd';
    $('row-dialog-title').textContent=newRow?'添加等级':'等级设置'; $('row-delete').hidden=newRow;
    $('row-up').disabled=newRow||state.rows.indexOf(row)===0; $('row-down').disabled=newRow||state.rows.indexOf(row)===state.rows.length-1;
    $('row-delete').disabled=state.rows.length<=1; $('row-dialog').showModal();
  }
  app.addEventListener('click',event=>{
    if(suppressClick&&event.detail!==0){event.preventDefault();event.stopPropagation();return;}
    const remove=event.target.closest('[data-remove-item]');if(remove){if(!busy&&confirm('删除这个项目？此操作无法撤销。'))run(()=>{M.removeItem(state,remove.dataset.removeItem);changed('项目已删除。');});return;}
    const button=event.target.closest('.card-main,.drag-handle');
    if(button){
      // Native keyboard activation has detail 0. Pointer clicks edit only outside presentation.
      if(event.detail===0||!isPresentation()&&performance.now()>=editBlockedUntil)openItem(button.closest('.rank-card').dataset.itemId);
      return;
    }
    const row=event.target.closest('[data-edit-row]'); if(row)openRow(row.dataset.editRow);
  });
  app.addEventListener('dblclick',event=>{
    const button=event.target.closest('.card-main');
    if(!isPresentation()||!button)return;
    event.preventDefault();lastTap=null;
    if(!suppressClick&&performance.now()>=editBlockedUntil)openItem(button.closest('.rank-card').dataset.itemId);
  });
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('item-dialog').addEventListener('close',()=>{imageEditor.close();if(itemId)focusCard(itemId);});
  $('row-dialog').addEventListener('close',()=>{document.querySelectorAll('[data-edit-row]').forEach(button=>{if(button.dataset.editRow===rowId)button.focus({preventScroll:true});});});
  $('item-edit-form').addEventListener('submit',event=>{event.preventDefault();if(imageBusy)return;try{
    const name=$('item-name').value.trim(); if(!name)throw new Error('请填写项目名称。');
    const draft=M.validateState(state);M.updateItem(draft,itemId,{name,...imageEditor.getValue()});const target=$('item-target').value;
    M.moveItem(draft,itemId,target,itemDraftIndex);state=draft;
    changed('项目已更新。'); $('item-dialog').close();
  }catch(error){itemFailure(error);}});
  $('item-target').addEventListener('change',()=>{const location=M.locateItem(state,itemId);itemDraftIndex=$('item-target').value===location.target?location.index:list($('item-target').value).filter(id=>id!==itemId).length;updateOrderButtons();});
  $('item-cancel').addEventListener('click',()=>$('item-dialog').close());
  [['item-previous',-1],['item-next',1]].forEach(([id,offset])=>$(id).addEventListener('click',()=>run(()=>{
    itemDraftIndex+=offset;updateOrderButtons();
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
  title.addEventListener('input',()=>{autosizeTitle();if(title.value.trim())run(()=>{M.setTitle(state,title.value.trim());invalidateClearUndo();$('display-title').textContent=state.title;scheduleSave();});});
  title.addEventListener('blur',()=>{if(!title.value.trim()){title.value=state.title;message('标题不能为空，已恢复上次标题。');autosizeTitle();}});
  window.addEventListener('resize',autosizeTitle);
  function download(blob,name) {
    const url=URL.createObjectURL(blob),anchor=node('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function safeFilename(extension) {return (state.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,60)||'我的排行')+'.'+extension;}
  $('png-export').addEventListener('click',async()=>{
    if(busy)return;setBusy(true);message('正在生成 PNG，请稍候…');
    try{const result=await Export.exportRanking(M.validateState(state),{scale:Number($('export-scale').value),theme:document.documentElement.dataset.theme});download(result.blob,safeFilename('png'));message('PNG 已生成（'+result.width+' × '+result.height+' 像素'+(result.scale<Number($('export-scale').value)?'，已为长图自动降低倍率':'')+'）。');}
    catch(error){failure(error);}finally{setBusy(false);render();}
  });
  $('json-export').addEventListener('click',()=>run(()=>{download(new Blob([M.serialize(state)],{type:'application/json'}),safeFilename('json'));message('JSON 备份已生成，包含自定义图片与全部项目。');}));
  $('json-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return; if(busy){event.target.value='';return;}
    setBusy(true);
    try{
      if(file.size>M.LIMITS.jsonBytes)throw new Error('备份文件过大，最多支持 30 MB。');
      const imported=M.deserialize(await file.text());
      if(confirm('导入“'+templateLabel(imported.templateId)+'”备份？将替换此模板的内容，其他模板内容保留。请先导出 JSON 备份。')){
        const before=M.validateState(state);
        if(before.templateId!==imported.templateId&&!protectedSave)await storage.save(before);
        templateDrafts.set(before.templateId,before);state=imported;templateDrafts.set(state.templateId,M.validateState(state));protectedSave=false;changed('备份已导入。');
      }
    }catch(error){failure(error);}finally{event.target.value='';setBusy(false);render();}
  });
  $('reset-ranking').addEventListener('click',()=>{if(busy)return;const label=templateLabel();if(confirm('恢复默认'+label+'？只替换当前模板的标题、等级和项目，皮肤与主题选择保留。继续编辑前可撤销；需要留档请先导出 JSON 备份。'))run(()=>{const skin=state.skin,templateId=state.templateId;undoSnapshot=M.validateState(state);undoKind='reset';state=M.createDefaultState(templateId);M.setSkin(state,skin);protectedSave=false;changed('已恢复默认'+label+'。继续编辑前可撤销恢复。',{preserveUndo:true});presentation(true);});});
  $('clear-items').addEventListener('click',()=>{if(busy||!Object.keys(state.items).length)return;if(confirm('清空全部项目（含待选区）？标题和等级会保留，本页继续编辑前可撤销。'))run(()=>{undoSnapshot=M.validateState(state);undoKind='clear';M.clearItems(state);changed('全部项目已清空。继续编辑前，可点「撤销清空」恢复。',{preserveUndo:true});});});
  $('undo-clear').addEventListener('click',()=>{if(busy||!undoSnapshot)return;const skin=state.skin,kind=undoKind,leaving=M.validateState(state);templateDrafts.set(leaving.templateId,leaving);if(kind==='template')storage.saveTemplate(leaving).catch(failure);state=M.validateState(undoSnapshot);if(kind!=='template')M.setSkin(state,skin);templateDrafts.set(state.templateId,M.validateState(state));changed(kind==='template'?'已撤销切换，原模板内容已还原。':kind==='reset'?'已撤销恢复默认，原有排行和图片已还原。':'已恢复清空前的全部项目。');});
  $('ranking-template').addEventListener('change',async()=>{
    const target=$('ranking-template').value;$('ranking-template').value=state.templateId;
    if(busy||target===state.templateId||!Object.prototype.hasOwnProperty.call(M.TEMPLATES,target))return;
    if(!confirm('切换到“'+templateLabel(target)+'”？当前模板内容将分别保留，可切回继续，也可在继续编辑前撤销切换。重要内容建议先导出 JSON 备份。'))return;
    const before=M.validateState(state),oldRevision=revision;templateDrafts.set(before.templateId,before);
    setBusy(true);clearTimeout(saveTimer);let warning='';
    try{
      let next=templateDrafts.has(target)?M.validateState(templateDrafts.get(target)):null;
      if(!next){try{next=await storage.loadTemplate(target);}catch(error){
        if(error.code==='corrupt'){
          if(!confirm('“'+templateLabel(target)+'”存档无法读取。是否只恢复该模板默认？将替换这份损坏记录，当前模板内容保留；取消则不更改。'))throw error;
          next=M.createDefaultState(target);M.setSkin(next,before.skin);await storage.saveTemplate(next);
        }else if(error.code==='unavailable')warning='本地存储不可用，本次模板内容仅在当前页面保留，请导出 JSON 备份。';
        else throw error;
      }}
      if(!next){next=M.createDefaultState(target);M.setSkin(next,before.skin);}
      if(!protectedSave){try{await storage.save(before);savedRevision=oldRevision;}catch(error){warning=error.message||'离开模板前保存失败，本次内容已保留在当前页面，请导出 JSON 备份。';}}
      undoSnapshot=before;undoKind='template';state=next;
      if(protectedSave)warning='原存档仍受保护，切换内容暂存当前页面。请导出 JSON 备份，确认恢复默认或导入备份后再覆盖保存。';
      changed('已切换到'+templateLabel()+'；各模板内容分别保留，继续编辑前可撤销切换。',{preserveUndo:true});presentation(true);
      if(warning)message(warning,true);
    }catch(error){failure(error);if(revision!==savedRevision)scheduleSave();}
    finally{setBusy(false);render();}
  });
  $('ranking-skin').addEventListener('change',()=>{if(!busy)run(()=>{M.setSkin(state,$('ranking-skin').value);changed('已切换排行皮肤，站点明暗主题不变。',{preserveUndo:true});});});
  function presentation(enabled){lastTap=null;document.body.classList.toggle('presentation',enabled);$('presentation-toggle').textContent=enabled?'编辑 / 退出展示 · Esc':'展示模式';$('presentation-toggle').setAttribute('aria-pressed',String(enabled));autosizeTitle();view?.presentation(enabled);}
  $('presentation-toggle').addEventListener('click',()=>presentation(!document.body.classList.contains('presentation')));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('item-dialog').open&&!$('row-dialog').open)presentation(false);});
  async function importFiles(files,target='pool'){
    if(!files.length||busy||!initialized)return;
    if($('item-dialog').open||$('row-dialog').open){itemFailure(new Error('请先保存或取消当前编辑，再拖入新项目；换图请使用「添加 / 更换图片」。'));return;}
    if(files.length+Object.keys(state.items).length>M.LIMITS.items){message('项目总数最多 '+M.LIMITS.items+' 个，请减少本次选择。',true);return;}
    if(target!=='pool'&&!state.rows.some(row=>row.id===target))target='pool';
    setBusy(true);let added=0,failed=0;const errors=[];
    for(let index=0;index<files.length;index++){
      const file=files[index];message('正在处理图片 '+(index+1)+' / '+files.length+'…');
      try{const prepared=await Images.prepareFile(file);const name=Array.from(file.name.replace(/\.[^.]+$/,'').trim()).slice(0,80).join('')||'未命名图片';M.addItem(state,{name,...prepared,art:null},target);added++;invalidateClearUndo();scheduleSave();}
      catch(error){failed++;if(errors.length<4)errors.push(file.name+'：'+error.message);}
    }
    setBusy(false);if(added)changed();else render();
    const destination=target==='pool'?'待选区':state.rows.find(row=>row.id===target).name+'等级';
    message('已将 '+added+' 张图片导入'+destination+'。'+(failed?' '+failed+' 个文件未导入：'+errors.join('；')+(failed>4?'；其余失败文件请检查类型和大小。':''):''),failed>0);
  }
  $('image-files').addEventListener('change',event=>{const files=Array.from(event.target.files);event.target.value='';importFiles(files).catch(failure);});
  // External desktop files use native drag/drop; internal item sorting uses Pointer Events.
  function isFileDrag(event){return event.dataTransfer&&Array.from(event.dataTransfer.types||[]).includes('Files');}
  function externalZone(target){if(!(target instanceof Element))return null;return target.closest('.item-list[data-zone]')||target.closest('.tier-row')?.querySelector('.item-list')||target.closest('.pool-panel')?.querySelector('.item-list');}
  function clearFileDrop(){document.body.classList.remove('external-file-drag');document.querySelectorAll('.external-drop-zone').forEach(element=>element.classList.remove('external-drop-zone'));}
  document.addEventListener('dragover',event=>{if(!isFileDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';clearFileDrop();document.body.classList.add('external-file-drag');externalZone(event.target)?.classList.add('external-drop-zone');});
  document.addEventListener('drop',event=>{if(!isFileDrag(event))return;event.preventDefault();const zone=externalZone(event.target);const files=Array.from(event.dataTransfer.files||[]);clearFileDrop();if(!busy)importFiles(files,zone?.dataset.zone||'pool').catch(failure);});
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)clearFileDrop();});window.addEventListener('dragend',clearFileDrop);
  // Presentation drags from the whole card; editing uses a touch grip so the page can scroll.
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
    const scrollingBoard=view?.scrollDrag(x,y);
    if(!scrollingBoard){if(y<65)window.scrollBy(0,-12);else if(y>window.innerHeight-65)window.scrollBy(0,12);}
    raf=requestAnimationFrame(dragFrame);
  }
  app.addEventListener('pointerdown',event=>{
    if(busy||event.button!==0||drag||event.target.closest('.card-remove'))return;const cardElement=event.target.closest('.rank-card');if(!cardElement)return;
    if(event.pointerType==='touch'&&!isPresentation()&&!event.target.closest('.drag-handle'))return;
    drag={id:cardElement.dataset.itemId,element:cardElement,pointerId:event.pointerId,pointerType:event.pointerType,x:event.clientX,y:event.clientY,active:false};
    // Capture only once a drag starts; preserving the original target keeps click/keyboard editing native.
  });
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>7){
      lastTap=null;drag.active=true;drag.element.setPointerCapture(event.pointerId);suppressClick=true;drag.element.classList.add('is-dragging');document.body.classList.add('dragging');
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
    drop=null;lastPoint=null;
    if(old.active||cancelled){lastTap=null;editBlockedUntil=performance.now()+450;}
    else if(event&&old.pointerType==='touch'&&isPresentation()&&performance.now()>=editBlockedUntil){
      const tap={id:old.id,time:performance.now(),x:event.clientX,y:event.clientY};
      if(lastTap&&lastTap.id===tap.id&&tap.time-lastTap.time<=320&&Math.hypot(tap.x-lastTap.x,tap.y-lastTap.y)<=20){
        lastTap=null;event.preventDefault();openItem(old.id);
      }else lastTap=tap;
    }
    if(old.active)setTimeout(()=>{suppressClick=false;},80);
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
