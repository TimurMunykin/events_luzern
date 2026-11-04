import QrScanner from './vendor/qr-scanner.min.js';
const $=id=>document.getElementById(id);
let token=sessionStorage.getItem('events-staff-token') || '',events=[],page=1,sequence=0,scanner=null,checking=false;
const escape=s=>String(s ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const date=s=>new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Zurich',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
function showLogin(){stopCamera();$('organiser').hidden=true;$('login-panel').hidden=false;}
async function api(path,body,method){
  const response=await fetch('/api/events/staff/'+path,{method:method || (body?'POST':'GET'),cache:'no-store',headers:{'Content-Type':'application/json','X-Staff-Token':token},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(response.status===401 || response.status===403){sessionStorage.removeItem('events-staff-token');token='';showLogin();throw new Error('Войдите снова, чтобы продолжить.');}
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
    const result=await api('tickets?'+params);if(seq!==sequence)return;
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
    const result=await api('events');events=result.items;
    $('event-select').replaceChildren(...events.map(event=>{const option=document.createElement('option');option.value=event.slug;option.textContent=event.name;return option;}));
    $('login-panel').hidden=true;$('organiser').hidden=false;settings();await loadGuests();
  } catch(error){$('login-error').textContent=error.message;showLogin();}
}
$('staff-login').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;$('login-error').textContent='';
  try {
    const response=await fetch('/api/collections/ticket_staff/auth-with-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity:e.currentTarget.elements.identity.value.trim(),password:e.currentTarget.elements.password.value})});
    if(!response.ok) throw new Error('Не удалось войти. Проверьте логин и пароль.');
    const data=await response.json();token=data.token;sessionStorage.setItem('events-staff-token',token);e.target.elements.password.value='';await init();
  } catch(error){$('login-error').textContent=error.message;}finally{button.disabled=false;}
});
$('logout').onclick=()=>{token='';sessionStorage.removeItem('events-staff-token');showLogin();};
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
$('scan-open').onclick=()=>{if(!selected())return;$('scan-event').textContent=selected().name;$('scan-result').textContent='';$('camera-status').textContent='';$('scanner-dialog').showModal();};
$('scan-close').onclick=()=>{$('scanner-dialog').close();stopCamera();};
$('scanner-dialog').addEventListener('close',stopCamera);
$('camera-start').onclick=async()=>{
  $('camera-status').textContent='';$('scan-result').textContent='';
  try{
    if(!scanner)scanner=new QrScanner($('scan-video'),result=>admitCode(result.data),{preferredCamera:'environment',returnDetailedScanResult:true,highlightScanRegion:true});
    $('scan-video').hidden=false;await scanner.start();$('camera-start').hidden=true;
  }catch(_){stopCamera();$('camera-status').textContent='Камера недоступна. Разрешите доступ к камере или вставьте ссылку на билет ниже.';}
};
$('scan-code-form').onsubmit=e=>{e.preventDefault();admitCode(e.currentTarget.elements.code.value);};
window.addEventListener('pagehide',()=>{if(scanner)scanner.destroy();});
if(token)init();
