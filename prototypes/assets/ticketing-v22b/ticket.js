'use strict';
(async()=>{
  const token=location.pathname.split('/').filter(Boolean).pop();
  const status=document.getElementById('ticket-status');
  const copies={
    ru:{title:'Ваш билет',entry:'Как найти вход',bring:'Что взять с собой',unknown:'Организатор уточнит эту информацию.',calendar:'Добавить в календарь',print:'Распечатать / сохранить',help:'Покажите QR-код при входе. Этот билет действует для одного гостя.',used:'Вход уже отмечен',number:'Билет'},
    de:{title:'Ihr Ticket',entry:'So finden Sie den Eingang',bring:'Bitte mitbringen',unknown:'Diese Information wird noch vom Veranstalter ergänzt.',calendar:'Zum Kalender hinzufügen',print:'Drucken / speichern',help:'Zeigen Sie den QR-Code am Eingang. Dieses Ticket gilt für einen Gast.',used:'Einlass bereits erfasst',number:'Ticket'},
    en:{title:'Your ticket',entry:'Finding the entrance',bring:'What to bring',unknown:'The organiser will confirm this information.',calendar:'Add to calendar',print:'Print / save',help:'Show the QR code at the entrance. This ticket admits one guest.',used:'Entry already recorded',number:'Ticket'}
  };
  try {
    if(!/^[a-zA-Z0-9]{40}$/.test(token || '')) throw new Error();
    const base='/api/events/tickets/'+token, response=await fetch(base,{cache:'no-store'});
    if(!response.ok) throw new Error();
    const data=await response.json(),lang=copies[data.language]?data.language:'ru',copy=copies[lang],event=data.event,details=event.details[lang] || event.details.ru || {};
    document.documentElement.lang=lang;document.title=copy.title+' · '+event.name+' · Events.Luzern';
    const set=(id,value)=>{document.getElementById(id).textContent=value;};
    set('event-name',event.name);set('event-time',event.time_label);set('event-place',event.venue);set('event-address',event.address);
    set('guest-name',data.name);set('ticket-help',copy.help);set('ticket-number',copy.number+' '+data.number);
    set('entry-label',copy.entry);set('bring-label',copy.bring);set('event-entry',details.entry || copy.unknown);set('event-bring',details.bring || copy.unknown);
    if(data.checked_in) set('admission-state',copy.used+' · '+new Date(data.checked_in).toLocaleString(lang,{timeZone:'Europe/Zurich'}));
    const qr=document.getElementById('ticket-qr');qr.src=base+'/qr.gif';qr.alt=copy.number+' — QR';
    const cal=document.getElementById('ticket-calendar');cal.href=base+'/calendar.ics';cal.textContent=copy.calendar;
    set('ticket-print',copy.print);document.getElementById('ticket-print').onclick=()=>window.print();
    status.hidden=true;document.getElementById('ticket-content').hidden=false;
  } catch (_) {status.textContent='Билет не найден или не удалось его загрузить. Проверьте ссылку из письма и попробуйте обновить страницу.';}
})();
