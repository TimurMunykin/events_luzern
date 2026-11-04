import QrScanner from '/assets/ticketing-v22b/vendor/qr-scanner.min.js';

export function mountGuests(root,token){
root.classList.add('has-guests');
const panel=document.createElement('section');panel.className='guests-panel';
panel.innerHTML=`
<div class="title-row"><div><h1>Оплаченные гости</h1><p class="muted" id="event-meta"></p></div><button id="refresh-list">Обновить</button><label class="event-switch">Событие<select id="event-select"></select></label></div>
<div class="attendance" aria-label="Посещение"><span>Пришли: <strong id="count-arrived">0</strong></span><span>из <strong id="count-paid">0</strong> оплаченных гостей</span></div>
<div class="tools"><label class="search-label">Поиск<input id="guest-search" type="search" placeholder="Имя, email или телефон"></label><label>Показать<select id="guest-filter"><option value="all">Всех гостей</option><option value="waiting">Ещё не пришли</option><option value="arrived">Уже пришли</option></select></label><button id="scan-open" class="primary">Сканировать билет</button></div>
<p id="list-status" role="status"></p><div id="guest-list" class="guest-list"></div>
<div id="paging" class="paging" hidden><button id="previous-page">Назад</button><span id="page-label"></span><button id="next-page">Далее</button></div>
<details class="event-settings"><summary>Информация в билетах и напоминания</summary><p class="muted">Текст появится в билетах и следующих письмах об этом событии.</p><form id="event-settings-form"><div id="event-texts"></div><label class="checkbox"><input type="checkbox" name="reminders">Напомнить гостям за 24 часа до события</label><button>Сохранить</button><p id="settings-status" role="status"></p></form></details>

<dialog id="scanner-dialog"><div class="dialog-head"><h2>Проверка билета</h2><button id="scan-close" aria-label="Закрыть">×</button></div><p id="scan-event" class="muted"></p><video id="scan-video" muted playsinline hidden></video><p id="camera-status" role="status"></p><button id="camera-start" class="primary">Включить камеру</button><form id="scan-code-form"><label>Ссылка или код билета<input name="code" required autocomplete="off" placeholder="Вставьте ссылку из билета"></label><button>Проверить и отметить вход</button></form><div id="scan-result" role="status"></div><p class="muted">Повторное сканирование покажет время первого входа.</p></dialog>`;
root.replaceChildren(panel);
const $=id=>panel.querySelector('#'+id);
let events=[],page=1,sequence=0,scanner=null,checking=false,disposed=false;
const escape=s=>String(s ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const date=s=>new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Zurich',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
async function api(path,body,method){
  const response=await fetch('/api/events/staff/'+path,{method:method || (body?'POST':'GET'),cache:'no-store',headers:{'Content-Type':'application/json',Authorization:token},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(response.status===401 || response.status===403){location.href='/login?next='+encodeURIComponent('/admin/#/guests');throw new Error('Войдите снова, чтобы продолжить.');}
  if(!response.ok){
    const messages={'Ticket not found':'Билет не найден. Проверьте ссылку.','Ticket is not paid':'Оплата этого билета не подтверждена.','Ticket belongs to another event':'Этот билет на другое событие. Выберите нужное событие в списке.','Text is too long':'Текст слишком длинный. Максимум 3000 символов в поле.'};
    throw new Error(messages[result.message] || 'Не удалось выполнить действие. Попробуйте ещё раз.');
  }
  return result;
}
function selected(){return events.find(e=>e.slug===$('event-select').value);}
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
  $('settings-status').textContent='';
}
async function loadGuests(){
  const event=selected();if(!event)return;
  const seq=++sequence,params=new URLSearchParams({event:event.slug,page:String(page),q:$('guest-search').value,state:$('guest-filter').value});
  $('list-status').className='muted';$('list-status').textContent='Обновляем список…';
  try {
    const result=await api('tickets?'+params);if(disposed || seq!==sequence)return;
    $('count-arrived').textContent=result.arrived;$('count-paid').textContent=result.paid;
    $('count-arrived').classList.toggle('zero',result.arrived===0);
    $('list-status').textContent=result.total?`Найдено гостей: ${result.total}`:'Оплаченных гостей с такими условиями пока нет.';
    $('guest-list').innerHTML=result.items.map(t=>`<article class="guest-row">
      <div><h2>${escape(t.name)}</h2><p>${escape(t.email || t.buyer_email)}</p><p class="muted">${escape(t.phone || 'Телефон не указан')}</p><p class="caption">Билет ${escape(t.id)}</p></div>
      <div><p class="caption">Покупатель</p><p>${escape(t.buyer)}</p><p class="muted">${escape(t.buyer_email)}</p><p class="muted">${t.quantity} билет(а) · ${escape(t.currency.toUpperCase())} ${(t.amount/100).toFixed(2)} за заказ</p></div>
      <div class="guest-notes"><p class="caption">Аллергии / пожелания</p><p class="wishes">${escape(t.wishes || 'Не указаны')}</p>${t.message?'<p class="caption">Комментарий к заказу</p><p class="wishes">'+escape(t.message)+'</p>':''}</div>
      <div class="entry-cell">${t.checked_in?'<span class="success">Вход отмечен</span><time>'+escape(date(t.checked_in))+'</time>':'<button data-admit="'+escape(t.id)+'">Отметить вход</button>'}</div>
    </article>`).join('');
    $('paging').hidden=result.total<=100;$('previous-page').disabled=page===1;$('next-page').disabled=page*100>=result.total;
    $('page-label').textContent=`${page} / ${Math.max(1,Math.ceil(result.total/100))}`;
  } catch(error){if(seq===sequence){$('list-status').className='error';$('list-status').textContent=error.message;}}
}
async function init(){
  try {
    const result=await api('events');if(disposed)return;events=result.items;
    $('event-select').replaceChildren(...events.map(event=>{const option=document.createElement('option');option.value=event.slug;option.textContent=event.name;return option;}));
    if(!events.length){$('list-status').textContent='Событий с онлайн-оплатой пока нет.';return;}
    settings();await loadGuests();
  } catch(error){if(!disposed){$('list-status').className='error';$('list-status').textContent=error.message;}}
}
$('event-select').onchange=()=>{page=1;settings();loadGuests();};
$('guest-filter').onchange=()=>{page=1;loadGuests();};
let searchTimer;$('guest-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;loadGuests();},250);};
$('refresh-list').onclick=loadGuests;$('previous-page').onclick=()=>{page--;loadGuests();};$('next-page').onclick=()=>{page++;loadGuests();};
$('guest-list').addEventListener('click',async e=>{
  const button=e.target.closest('[data-admit]');if(!button)return;button.disabled=true;
  try{const result=await api('check-in',{event_id:selected().slug,ticket_id:button.dataset.admit});await loadGuests();$('list-status').textContent=result.ticket.name+(result.already_used?' — вход уже отмечен в ':' — вход отмечен в ')+date(result.ticket.checked_in);}
  catch(error){$('list-status').className='error';$('list-status').textContent=error.message;button.disabled=false;}
});
$('event-settings-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),event=selected(),details={};button.disabled=true;
  for(const lang of ['ru','de','en']) details[lang]={entry:form.elements['entry_'+lang].value,bring:form.elements['bring_'+lang].value};
  try{const result=await api('events/'+event.id,{details,reminders:form.elements.reminders.checked},'PUT');Object.assign(event,result);$('settings-status').className='success';$('settings-status').textContent='Сохранено.';}
  catch(error){$('settings-status').className='error';$('settings-status').textContent=error.message;}finally{button.disabled=false;}
};
function stopCamera(){if(scanner) scanner.stop();$('scan-video').hidden=true;$('camera-start').hidden=false;}
async function admitCode(value){
  if(checking)return;checking=true;stopCamera();$('scan-result').className='';$('scan-result').textContent='Проверяем билет…';
  $('scan-code-form').querySelector('button').disabled=true;
  try {
    let code=String(value).trim();
    if(code.startsWith('http')){const url=new URL(code);if(url.origin!==location.origin || !/^\/ticket\/[a-zA-Z0-9]{40}$/.test(url.pathname))throw new Error('Эта ссылка не относится к билетам этого сайта.');code=url.pathname.split('/').pop();}
    if(!/^[a-zA-Z0-9]{40}$/.test(code))throw new Error('Вставьте полную ссылку на билет или отсканируйте его QR-код.');
    const result=await api('check-in',{event_id:selected().slug,token:code});
    $('scan-result').className=result.already_used?'error':'success';
    $('scan-result').innerHTML='<h3>'+escape(result.ticket.name)+'</h3><p>'+(result.already_used?'Билет уже использован. Первый вход: ':'Вход отмечен: ')+escape(date(result.ticket.checked_in))+'</p>';
    $('scan-code-form').elements.code.value='';loadGuests();
  } catch(error){$('scan-result').className='error';$('scan-result').textContent=error.message;}
  finally{checking=false;$('scan-code-form').querySelector('button').disabled=false;$('camera-start').textContent='Сканировать следующий билет';}
}
$('scan-open').onclick=()=>{if(!selected() || disposed)return;$('scan-event').textContent=selected().name;$('scan-result').textContent='';$('camera-status').textContent='';$('scanner-dialog').showModal();};
$('scan-close').onclick=()=>{$('scanner-dialog').close();stopCamera();};
$('scanner-dialog').addEventListener('close',stopCamera);
$('camera-start').onclick=async()=>{
  $('camera-status').textContent='';$('scan-result').textContent='';
  try{
    if(!scanner)scanner=new QrScanner($('scan-video'),result=>admitCode(result.data),{preferredCamera:'environment',returnDetailedScanResult:true,highlightScanRegion:true});
    $('scan-video').hidden=false;await scanner.start();if(disposed){scanner.destroy();return;}$('camera-start').hidden=true;
  }catch(_){stopCamera();$('camera-status').textContent='Камера недоступна. Разрешите доступ к камере или вставьте ссылку на билет ниже.';}
};
$('scan-code-form').onsubmit=e=>{e.preventDefault();admitCode(e.currentTarget.elements.code.value);};
function dispose(){
  if(disposed)return;disposed=true;sequence++;clearTimeout(searchTimer);
  if(scanner)scanner.destroy();
  if($('scanner-dialog').open)$('scanner-dialog').close();
  root.classList.remove('has-guests');window.removeEventListener('pagehide',dispose);
}
window.addEventListener('pagehide',dispose);
init();return dispose;

}
