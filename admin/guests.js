import QrScanner from '/assets/ticketing-v22b/vendor/qr-scanner.min.js';

export function mountGuests(root,token){
root.classList.add('has-guests');
const panel=document.createElement('section');panel.className='guests-panel';
panel.innerHTML=`
<div class="title-row"><div><h1>Оплаченные гости</h1><p class="muted" id="event-meta"></p></div><button id="export-guests">Скачать CSV</button><button id="refresh-list">Обновить</button><label class="event-switch">Событие<select id="event-select"></select></label></div>
<div class="attendance" aria-label="Посещение"><span>Посетили: <strong id="count-arrived">0</strong></span><span>из <strong id="count-paid">0</strong> оплаченных гостей</span></div>
<div class="tools"><label class="search-label">Поиск<input id="guest-search" type="search" placeholder="Имя, email или телефон"></label><label>Показать<select id="guest-filter"><option value="all">Всех гостей</option><option value="waiting">Без отметки</option><option value="arrived">Посетили</option><option value="refunded">Возвраты</option></select></label><button id="scan-open" class="primary">Сканировать билет</button></div>
<p id="list-status" role="status"></p><div id="guest-list" class="guest-list"></div>
<div id="paging" class="paging" hidden><button id="previous-page">Назад</button><span id="page-label"></span><button id="next-page">Далее</button></div>
<details class="event-settings"><summary>Информация в билетах и напоминания</summary><p class="muted">Текст появится в билетах и следующих письмах об этом событии.</p><form id="event-settings-form"><label>Мест для продажи на сайте<input name="capacity" type="number" min="0" max="100000" step="1" placeholder="Без ограничения"></label><p class="muted" id="capacity-summary"></p><div id="event-texts"></div><label class="checkbox"><input type="checkbox" name="reminders">Напомнить гостям за 24 часа до события</label><button>Сохранить</button><p id="settings-status" role="status"></p></form></details>

<dialog id="scanner-dialog"><div class="dialog-head"><h2>Проверка билета</h2><button id="scan-close" aria-label="Закрыть">×</button></div><p id="scan-event" class="muted"></p><div id="camera-preview" hidden><video id="scan-video" muted playsinline></video></div><p id="camera-status" role="status"></p><button id="camera-start" class="primary">Включить камеру</button><form id="scan-code-form"><label>Ссылка или код билета<input name="code" required autocomplete="off" placeholder="Вставьте ссылку из билета"></label><button>Проверить билет</button></form><div id="scan-result" role="status"></div><p class="muted">При успешной проверке посещение отмечается автоматически. Ошибочную отметку можно отменить.</p></dialog>
<dialog id="refund-dialog" class="refund-dialog" aria-labelledby="refund-title"><div class="dialog-head"><h2 id="refund-title">Возврат за билет</h2></div><p id="refund-event" class="muted"></p><p id="refund-guest" class="refund-guest"></p><p id="refund-amount" class="refund-amount"></p><p id="refund-explanation"></p><p id="refund-attendance" class="muted" hidden>У этой гостьи уже отмечено посещение.</p><label id="refund-existing-label" hidden>Возврат по этому заказу<select id="refund-existing"></select></label><p id="refund-status" role="status"></p><div class="refund-actions"><button id="refund-close" autofocus>Закрыть</button><button id="refund-refresh" hidden>Проверить возврат</button><button id="refund-confirm" class="primary" hidden></button></div></dialog>`;
root.replaceChildren(panel);
const $=id=>panel.querySelector('#'+id);
let events=[],page=1,sequence=0,scanner=null,checking=false,disposed=false,cameraStarting=false,cameraRun=0;
let ticketOrigins=[location.origin];
let refundTarget=null,refundOptions=null,refundBusy=false,refundRun=0;
const escape=s=>String(s ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const date=s=>new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Zurich',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
async function api(path,body,method){
  const response=await fetch('/api/events/staff/'+path,{method:method || (body?'POST':'GET'),cache:'no-store',headers:{'Content-Type':'application/json',Authorization:token},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(response.status===401 || response.status===403){location.href='/login?next='+encodeURIComponent('/admin/#/guests');throw new Error('Войдите снова, чтобы продолжить.');}
  if(!response.ok){
    const messages={'Ticket refunded':'Оплата возвращена. Этот билет недействителен.','Invalid capacity':'Укажите целое количество мест.','Capacity below bookings':'Лимит меньше числа оплаченных и временно забронированных мест.','Ticket not found':'Билет не найден. Проверьте ссылку.','Ticket is not paid':'Оплата этого билета не подтверждена.','Ticket belongs to another event':'Этот билет на другое событие. Выберите нужное событие в списке.','Attendance changed':'Посещение уже отметили заново. Обновите список перед отменой.','Text is too long':'Текст слишком длинный. Максимум 3000 символов в поле.'};
    Object.assign(messages,{'Payment reference unavailable':'Не удалось найти оплату в Stripe. Возврат не отправлен.','Ticket price unavailable':'Не удалось определить стоимость билета. Возврат не отправлен.','Refund already pending':'Возврат ещё обрабатывается. Нажмите «Проверить возврат».','Choose existing refund':'По заказу уже возвращены деньги. Нажмите «Проверить возврат» и выберите этот возврат.','Refund already assigned':'Этот возврат уже связан с другим билетом. Обновите данные.','Refund does not match ticket':'Этот возврат не относится к выбранному билету.','Refund exceeds payment':'Сумма превышает оставшуюся оплату. Обновите данные.','Refund needs reconciliation':'Статус старого запроса пока неизвестен. Нужна проверка в Stripe; новый возврат не отправлен.'});
    throw new Error(messages[String(result.message || '').replace(/\.$/,'')] || 'Не удалось выполнить действие. Попробуйте ещё раз.');
  }
  return result;
}
function selected(){return events.find(e=>e.slug===$('event-select').value);}
function undoButton(ticket){return '<button type="button" class="undo-attendance" data-undo="'+escape(ticket.id)+'" data-checked-in="'+escape(ticket.checked_in)+'">Отменить отметку</button>';}
const money=(amount,currency)=>currency.toUpperCase()+' '+(amount/100).toFixed(2);
function refundControls(t){
  if(t.status==='refunded')return '<p>Возвращено '+escape(money(t.ticket_refunded_amount,t.currency))+'. Билет недействителен.</p>';
  const pending=['requesting','pending','requires_action'].includes(t.refund_state),failed=['failed','canceled'].includes(t.refund_state);
  let text=pending?'Возврат обрабатывается. Билет пока действует.':failed?'Возврат не выполнен. Билет действует.':t.order_status==='partially_refunded'?'Билет действует. По заказу возвращено '+money(t.refunded_amount,t.currency)+'.':'';
  return (text?'<p>'+escape(text)+'</p>':'')+'<button type="button" class="refund-open" data-refund="'+escape(t.id)+'">'+(pending?'Проверить возврат':failed?'Повторить возврат':'Вернуть оплату')+'</button>';
}
function showRefund(options){
  refundOptions=options;
  $('refund-guest').textContent=options.name+' · билет № '+options.number;
  $('refund-amount').textContent=money(options.amount,options.currency);
  $('refund-attendance').hidden=!options.checked_in || options.status==='succeeded';
  $('refund-status').textContent='';$('refund-status').className='';
  $('refund-confirm').hidden=true;$('refund-refresh').hidden=true;
  $('refund-existing-label').hidden=true;
  if(options.status==='succeeded'){
    $('refund-explanation').textContent='Оплата возвращена. Этот билет отменён, место снова доступно для покупки.';
  }else if(['pending','requires_action'].includes(options.status) || options.unassigned_pending){
    $('refund-refresh').hidden=false;
    $('refund-explanation').textContent='Stripe обрабатывает возврат. После подтверждения билет отменится автоматически. Пока он действует.';
  }else if(options.existing.length){
    $('refund-explanation').textContent='По этому заказу деньги уже возвращены. Свяжите возврат с этой гостьей: отменится только её билет. Деньги повторно не возвращаются.';
    $('refund-existing').replaceChildren(...options.existing.map(row=>{const option=document.createElement('option');option.value=row.id;option.textContent=money(row.remaining,options.currency)+' · '+date(row.created);return option;}));
    $('refund-existing-label').hidden=options.existing.length===1;
    $('refund-confirm').textContent='Отменить этот билет';$('refund-confirm').hidden=false;
  }else if(options.unassigned_amount){
    $('refund-refresh').hidden=false;
    $('refund-explanation').textContent='По заказу возвращено '+money(options.unassigned_amount,options.currency)+', но эта сумма меньше стоимости билета. Нужна проверка возврата в Stripe.';
  }else if(options.can_refund){
    $('refund-refresh').hidden=options.status!=='requesting';
    $('refund-explanation').textContent=options.status==='requesting'?'Проверяем ранее отправленный запрос. Можно повторить его: второй возврат не создастся.':(['failed','canceled'].includes(options.status)?'Предыдущий возврат не выполнен. Можно отправить новый запрос. ':'')+'Деньги вернутся тем же способом, которым была оплачена покупка. После подтверждения отменится только этот билет. Остальные билеты в заказе сохранятся.';
    $('refund-confirm').textContent=options.status==='requesting'?'Повторить запрос':'Вернуть '+money(options.amount,options.currency);$('refund-confirm').hidden=false;
  }else {$('refund-explanation').textContent='Возврат пока недоступен. Обновите его статус.';$('refund-refresh').hidden=false;}
}
async function refreshRefund(){
  if(!refundTarget || refundBusy)return;
  const run=++refundRun;refundBusy=true;$('refund-confirm').hidden=true;$('refund-refresh').disabled=true;
  $('refund-status').className='muted';$('refund-status').textContent='Проверяем оплату…';
  try{const options=await api('refund-options?'+new URLSearchParams(refundTarget));if(disposed || run!==refundRun)return;showRefund(options);await loadGuests();}
  catch(error){if(run===refundRun){$('refund-status').className='error';$('refund-status').textContent=error.message;$('refund-refresh').hidden=false;}}
  finally{refundBusy=false;$('refund-refresh').disabled=false;}
}
function openRefund(id){
  if(refundBusy || !selected())return;refundTarget={event_id:selected().slug,ticket_id:id};refundOptions=null;
  $('refund-event').textContent=selected().name;$('refund-guest').textContent='';$('refund-amount').textContent='';$('refund-explanation').textContent='';
  $('refund-attendance').hidden=true;$('refund-existing-label').hidden=true;$('refund-confirm').hidden=true;
  $('refund-dialog').showModal();refreshRefund();
}
$('refund-close').onclick=()=>{$('refund-dialog').close();};
$('refund-dialog').addEventListener('close',()=>{$('guest-search').focus();});
$('refund-refresh').onclick=refreshRefund;
$('refund-confirm').onclick=async()=>{
  if(refundBusy || !refundTarget || !refundOptions)return;
  const run=++refundRun,body={...refundTarget,mode:refundOptions.existing.length?'existing':'refund'};
  if(body.mode==='existing')body.refund_id=$('refund-existing').value;
  refundBusy=true;$('refund-confirm').disabled=true;$('refund-refresh').disabled=true;
  $('refund-status').className='muted';$('refund-status').textContent=body.mode==='existing'?'Отменяем билет…':'Отправляем возврат…';
  try{const result=await api('refund-ticket',body);if(disposed || run!==refundRun)return;showRefund(result.refund);await loadGuests();}
  catch(error){if(run===refundRun){$('refund-status').className='error';$('refund-status').textContent=error.message+' Проверьте статус перед повторной попыткой.';$('refund-confirm').hidden=true;$('refund-refresh').hidden=false;}}
  finally{refundBusy=false;$('refund-confirm').disabled=false;$('refund-refresh').disabled=false;}
};
function settings(){
  const event=selected();if(!event) return;
  $('event-meta').textContent=event.name+' · '+event.time_label+' · '+event.venue;
  $('event-select').closest('label').hidden=events.length<2;
  $('event-texts').replaceChildren();
  for(const [lang,name] of [['ru','Русский'],['de','Deutsch'],['en','English']]){
    const group=document.createElement('fieldset');group.className='language-fields';
    group.innerHTML=`<legend>${name}</legend><label>Как найти вход<textarea name="entry_${lang}" maxlength="3000"></textarea></label><label>Что взять с собой<textarea name="bring_${lang}" maxlength="3000"></textarea></label>`;
    group.querySelector(`[name="entry_${lang}"]`).value=event.details[lang]?.entry || '';
    group.querySelector(`[name="bring_${lang}"]`).value=event.details[lang]?.bring || '';
    $('event-texts').append(group);
  }
  $('event-settings-form').elements.reminders.checked=event.reminders;
  $('event-settings-form').elements.capacity.value=event.capacity || '';
  capacitySummary(event.availability);
  $('settings-status').textContent='';
}
function capacitySummary(a){$('capacity-summary').textContent=a?`Оплачено: ${a.paid}. На оплате: ${a.held}. ${a.capacity?'Свободно: '+a.remaining+'.':'Лимит не задан.'} Места на оплате удерживаются до часа.`:'';}
async function loadGuests(){
  const event=selected();if(!event)return;
  const seq=++sequence,params=new URLSearchParams({event:event.slug,page:String(page),q:$('guest-search').value,state:$('guest-filter').value});
  $('list-status').className='muted';$('list-status').textContent='Обновляем список…';
  try {
    const result=await api('tickets?'+params);if(disposed || seq!==sequence)return;
    event.availability=result.availability;capacitySummary(result.availability);
    $('count-arrived').textContent=result.arrived;$('count-paid').textContent=result.paid;
    $('count-arrived').classList.toggle('zero',result.arrived===0);
    $('list-status').textContent=result.total?`Найдено гостей: ${result.total}`:'Оплаченных гостей с такими условиями пока нет.';
    $('guest-list').innerHTML=result.items.map(t=>`<article class="guest-row">
      <div><h2>${escape(t.name)}</h2><p>${escape(t.email || t.buyer_email)}</p><p class="muted">${escape(t.phone || 'Телефон не указан')}</p><p class="caption">Билет № ${escape(t.number)}</p></div>
      <div><p class="caption">Покупатель</p><p>${escape(t.buyer)}</p><p class="muted">${escape(t.buyer_email)}</p><p class="muted">${t.quantity} билет(а) · ${escape(t.currency.toUpperCase())} ${(t.amount/100).toFixed(2)} за заказ</p></div>
      <div class="guest-notes"><p class="caption">Аллергии / пожелания</p><p class="wishes">${escape(t.wishes || 'Не указаны')}</p>${t.message?'<p class="caption">Комментарий к заказу</p><p class="wishes">'+escape(t.message)+'</p>':''}</div>
      <div class="entry-cell">${refundControls(t)}<label class="attendance-toggle"><input type="checkbox" data-attendance="${escape(t.id)}" data-checked-in="${escape(t.checked_in)}" ${t.checked_in?'checked':''} ${t.status==='refunded'?'disabled':''}>Посетил</label>${t.checked_in?'<time>'+escape(date(t.checked_in))+'</time>':''}${t.status!=='refunded'?'<button type="button" class="reminder-preview" data-reminder="'+escape(t.id)+'">Пробное напоминание</button>':''}</div>
    </article>`).join('');
    $('paging').hidden=result.total<=100;$('previous-page').disabled=page===1;$('next-page').disabled=page*100>=result.total;
    $('page-label').textContent=`${page} / ${Math.max(1,Math.ceil(result.total/100))}`;
  } catch(error){if(seq===sequence){$('list-status').className='error';$('list-status').textContent=error.message;}}
}
async function init(){
  try {
    const result=await api('events');if(disposed)return;events=result.items;
    ticketOrigins=Array.isArray(result.ticket_origins)?result.ticket_origins:[location.origin];
    $('event-select').replaceChildren(...events.map(event=>{const option=document.createElement('option');option.value=event.slug;option.textContent=event.name;return option;}));
    if(!events.length){$('list-status').textContent='Событий с онлайн-оплатой пока нет.';return;}
    settings();await loadGuests();
  } catch(error){if(!disposed){$('list-status').className='error';$('list-status').textContent=error.message;}}
}
$('event-select').onchange=()=>{page=1;settings();loadGuests();};
$('guest-filter').onchange=()=>{page=1;loadGuests();};
let searchTimer;$('guest-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;loadGuests();},250);};
$('refresh-list').onclick=loadGuests;$('previous-page').onclick=()=>{page--;loadGuests();};$('next-page').onclick=()=>{page++;loadGuests();};
$('export-guests').onclick=async()=>{
  const button=$('export-guests');if(!selected())return;button.disabled=true;
  try{
    const response=await fetch('/api/events/staff/guests.csv?'+new URLSearchParams({event:selected().slug}),{cache:'no-store',headers:{Authorization:token}});
    if(!response.ok)throw new Error('Не удалось скачать список гостей. Обновите страницу и попробуйте ещё раз.');
    const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='Events-Luzern-guests.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){$('list-status').className='error';$('list-status').textContent=error.message;}finally{button.disabled=false;}
};
async function updateAttendance(control,undo,fromScan=false){
  const event=selected();if(!event)return;control.disabled=true;
  try{
    const body={event_id:event.slug,ticket_id:control.dataset.attendance || control.dataset.undo};
    if(undo)body.checked_in=control.dataset.checkedIn;
    const result=await api(undo?'undo-check-in':'check-in',body);
    await loadGuests();
    $('list-status').textContent=result.ticket.name+(undo?' — отметка о посещении отменена.':' — посещение отмечено: '+date(result.ticket.checked_in));
    if(fromScan){$('scan-result').className='';$('scan-result').innerHTML='<h3>'+escape(result.ticket.name)+'</h3><p>Отметка о посещении отменена. Билет можно проверить снова.</p>';}
  }catch(error){
    const status=$(fromScan?'scan-result':'list-status');status.className='error';status.textContent=error.message;
    if(control.type==='checkbox')control.checked=undo;
    control.disabled=false;
  }
}
panel.addEventListener('change',e=>{
  const checkbox=e.target.closest('[data-attendance]');if(checkbox)updateAttendance(checkbox,!checkbox.checked);
});
panel.addEventListener('click',e=>{
  const refund=e.target.closest('[data-refund]');if(refund){openRefund(refund.dataset.refund);return;}
  const reminder=e.target.closest('[data-reminder]');if(reminder){reminder.disabled=true;api('reminder-preview',{ticket_id:reminder.dataset.reminder}).then(()=>{$('list-status').textContent='Пробное напоминание отправлено. Оно доступно в тестовой почте.';}).catch(error=>{$('list-status').textContent=error.message;}).finally(()=>{reminder.disabled=false;});return;}
  const button=e.target.closest('[data-undo]');if(button)updateAttendance(button,true,!!button.closest('#scan-result'));
});
$('event-settings-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),event=selected(),details={};button.disabled=true;
  for(const lang of ['ru','de','en']) details[lang]={entry:form.elements['entry_'+lang].value,bring:form.elements['bring_'+lang].value};
  try{const result=await api('events/'+event.id,{details,reminders:form.elements.reminders.checked,capacity:Number(form.elements.capacity.value || 0)},'PUT');Object.assign(event,result);settings();$('settings-status').className='success';$('settings-status').textContent='Сохранено.';}
  catch(error){$('settings-status').className='error';$('settings-status').textContent=error.message;}finally{button.disabled=false;}
};
function stopCamera(){cameraRun++;if(scanner)scanner.stop();$('camera-preview').hidden=true;$('camera-start').hidden=false;$('camera-status').textContent='';}
async function admitCode(value){
  if(checking)return;checking=true;stopCamera();$('scan-result').className='';$('scan-result').textContent='Проверяем билет…';
  $('scan-code-form').querySelector('button').disabled=true;
  try {
    let code=String(value).trim();
    if(code.startsWith('http')){const url=new URL(code);if(!ticketOrigins.includes(url.origin) || !/^\/ticket\/[a-zA-Z0-9]{40}$/.test(url.pathname))throw new Error('Эта ссылка не относится к билетам этого сайта.');code=url.pathname.split('/').pop();}
    if(!/^[a-zA-Z0-9]{40}$/.test(code))throw new Error('Вставьте полную ссылку на билет или отсканируйте его QR-код.');
    const result=await api('check-in',{event_id:selected().slug,token:code});
    $('scan-result').className=result.already_used?'error':'success';
    $('scan-result').innerHTML='<h3>'+escape(result.ticket.name)+'</h3><p>'+(result.already_used?'Билет уже использован: ':'Посещение отмечено: ')+escape(date(result.ticket.checked_in))+'</p>'+(result.already_used?'':undoButton(result.ticket));
    $('scan-code-form').elements.code.value='';loadGuests();
  } catch(error){$('scan-result').className='error';$('scan-result').textContent=error.message;}
  finally{checking=false;$('scan-code-form').querySelector('button').disabled=false;$('camera-start').textContent='Сканировать следующий билет';}
}
$('scan-open').onclick=()=>{if(!selected() || disposed)return;$('scan-event').textContent=selected().name;$('scan-result').textContent='';$('camera-status').textContent='';$('scanner-dialog').showModal();};
$('scan-close').onclick=()=>{$('scanner-dialog').close();stopCamera();};
$('scanner-dialog').addEventListener('close',stopCamera);
$('camera-start').onclick=async()=>{
  if(cameraStarting || disposed || !$('scanner-dialog').open)return;
  const run=++cameraRun;cameraStarting=true;$('camera-start').disabled=true;
  $('camera-status').className='muted';$('camera-status').textContent='Включаем камеру…';$('scan-result').textContent='';
  // QrScanner must see a visible video at construction; hide its wrapper when idle.
  $('camera-preview').hidden=false;
  try{
    if(!scanner)scanner=new QrScanner($('scan-video'),result=>admitCode(result.data),{preferredCamera:'environment',returnDetailedScanResult:true,highlightScanRegion:true});
    await scanner.start();
    if(disposed || run!==cameraRun || !$('scanner-dialog').open){scanner.stop();return;}
    $('camera-start').hidden=true;$('camera-status').textContent='Наведите камеру на QR-код билета.';
  }catch(_){
    if(disposed || run!==cameraRun)return;
    stopCamera();$('camera-status').className='error';$('camera-status').textContent='Не удалось включить камеру. Проверьте разрешение на доступ к камере и закройте другие приложения, которые её используют. Можно также вставить ссылку на билет ниже.';
  }finally{cameraStarting=false;$('camera-start').disabled=false;}
};
$('scan-code-form').onsubmit=e=>{e.preventDefault();admitCode(e.currentTarget.elements.code.value);};
function dispose(){
  if(disposed)return;disposed=true;sequence++;clearTimeout(searchTimer);
  if(scanner)scanner.destroy();
  if($('scanner-dialog').open)$('scanner-dialog').close();
  refundRun++;if($('refund-dialog').open)$('refund-dialog').close();
  root.classList.remove('has-guests');window.removeEventListener('pagehide',dispose);
}
window.addEventListener('pagehide',dispose);
init();return dispose;

}
