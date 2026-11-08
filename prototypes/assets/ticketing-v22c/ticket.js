'use strict';
(async()=>{
  const token=location.pathname.split('/').filter(Boolean).pop();
  const $=id=>document.getElementById(id);
  const copies={
    ru:{title:'Ваш билет',guest:'Гостья',entry:'Как найти вход',bring:'Что взять с собой',unknown:'Организатор уточнит эту информацию.',calendar:'Добавить в календарь',pdf:'Скачать PDF',help:'Покажите QR-код при входе. Один билет — одна гостья.',used:'Посещение отмечено',refunded:'Оплата возвращена. Билет недействителен.',contact:'Вопросы о встрече:',loading:'Готовим PDF…',error:'Не удалось скачать PDF. Попробуйте ещё раз.',missing:'Билет не найден или не удалось его загрузить. Проверьте ссылку из письма.'},
    de:{title:'Ihr Ticket',guest:'Gast',entry:'So finden Sie den Eingang',bring:'Bitte mitbringen',unknown:'Diese Information wird noch von der Veranstalterin ergänzt.',calendar:'Zum Kalender hinzufügen',pdf:'PDF herunterladen',help:'Zeigen Sie den QR-Code am Eingang. Ein Ticket gilt für einen Gast.',used:'Teilnahme erfasst',refunded:'Die Zahlung wurde erstattet. Das Ticket ist ungültig.',contact:'Fragen zur Veranstaltung:',loading:'PDF wird erstellt…',error:'PDF konnte nicht heruntergeladen werden. Bitte versuchen Sie es erneut.',missing:'Ticket nicht gefunden. Bitte prüfen Sie den Link in Ihrer E-Mail.'},
    en:{title:'Your ticket',guest:'Guest',entry:'Finding the entrance',bring:'What to bring',unknown:'The organiser will confirm this information.',calendar:'Add to calendar',pdf:'Download PDF',help:'Show the QR code at the entrance. One ticket admits one guest.',used:'Attendance recorded',refunded:'Payment refunded. This ticket is no longer valid.',contact:'Questions about the event:',loading:'Preparing PDF…',error:'Could not download the PDF. Please try again.',missing:'Ticket not found. Please check the link in your email.'}
  };
  let copy=copies.ru;
  try{
    if(!/^[a-zA-Z0-9]{40}$/.test(token || ''))throw new Error();
    const base='/api/events/tickets/'+token,response=await fetch(base,{cache:'no-store'});
    if(!response.ok)throw new Error();
    const data=await response.json(),lang=copies[data.language]?data.language:'ru',event=data.event,details=event.details[lang] || event.details.ru || {};
    copy=copies[lang];document.documentElement.lang=lang;document.title=copy.title+' · '+event.name+' · Events.Luzern';
    const set=(id,value)=>{$(id).textContent=value;};
    set('event-name',event.name);set('event-time',event.time_label);set('event-place',event.venue);set('event-address',event.address);
    const map='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(event.venue+', '+event.address);$('event-address').href=map;
    set('guest-label',copy.guest);set('guest-name',data.name);set('ticket-help',copy.help);set('ticket-number','№ '+data.number);
    set('entry-label',copy.entry);set('bring-label',copy.bring);set('event-entry',details.entry || copy.unknown);set('event-bring',details.bring || copy.unknown);set('contact-label',copy.contact);
    const invalid=data.status==='refunded';document.body.classList.toggle('refunded',invalid);
    if(invalid){set('admission-state',copy.refunded);$('ticket-qr').hidden=true;$('ticket-help').hidden=true;}
    else{
      $('ticket-qr').src=base+'/qr.gif';
      if(data.checked_in)set('admission-state',copy.used+' · '+new Date(data.checked_in).toLocaleString(lang,{timeZone:'Europe/Zurich'}));
    }
    const cal=$('ticket-calendar');cal.href=base+'/calendar.ics';cal.textContent=copy.calendar;
    cal.hidden=invalid;$('ticket-pdf').hidden=invalid;set('ticket-pdf',copy.pdf);
    $('ticket-status').hidden=true;$('ticket-content').hidden=false;
    $('ticket-pdf').onclick=async()=>{
      $('ticket-pdf').disabled=true;set('ticket-pdf',copy.loading);set('download-status','');
      try{
        // Check again: a PDF button on an old tab must not issue a refunded ticket.
        const fresh=await fetch(base,{cache:'no-store'});if(!fresh.ok)throw new Error();
        if((await fresh.json()).status==='refunded'){location.reload();return;}
        if(!window.jspdf)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/assets/ticketing-v22c/vendor/jspdf-4.2.1.umd.min.js';script.onload=resolve;script.onerror=reject;document.head.append(script);});
        const doc=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
        const binary=buffer=>{let s='';new Uint8Array(buffer).forEach(b=>{s+=String.fromCharCode(b);});return btoa(s);};
        for(const font of ['Inter','CormorantGaramond']){const response=await fetch('/assets/ticketing-v22c/vendor/'+font+'.ttf');if(!response.ok)throw new Error();doc.addFileToVFS(font+'.ttf',binary(await response.arrayBuffer()));doc.addFont(font+'.ttf',font,'normal');}
        const picture=async src=>{const image=new Image();image.src=src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png');};
        const [qr,logo]=await Promise.all([picture(base+'/qr.gif'),picture('/assets/logo.png')]);
        const page=()=>{doc.setFillColor('#11142d');doc.rect(0,0,210,297,'F');doc.setTextColor('#ece5d3');};
        page();doc.addImage(logo,'PNG',16,12,22,22);doc.setFont('CormorantGaramond');doc.setFontSize(25);doc.text('Events.Luzern',42,27);doc.setFont('Inter');doc.setFontSize(12);doc.setTextColor('#cdb88a');doc.text('№ '+data.number,194,25,{align:'right'});
        let y=48;
        const text=(value,size=11,font='Inter',colour='#ece5d3',width=178)=>{
          doc.setFont(font);doc.setFontSize(size);doc.setTextColor(colour);
          for(const line of doc.splitTextToSize(String(value),width)){
            if(y>280){doc.addPage();page();y=20;doc.setFont(font);doc.setFontSize(size);doc.setTextColor(colour);}
            doc.text(line,16,y);y+=size*.48;
          }
          y+=3;
        };
        text(event.name,29,'CormorantGaramond');text(event.time_label,13,'Inter','#cdb88a');text(event.venue);text(event.address);
        doc.link(16,y-10,178,10,{url:map});y+=5;text(copy.guest,10,'Inter','#cdb88a');text(data.name,22,'CormorantGaramond');
        if(y+88>278){doc.addPage();page();y=20;}
        doc.addImage(qr,'PNG',16,y,72,72);doc.link(16,y,72,72,{url:location.origin+location.pathname});y+=79;
        text(copy.help,10);text(copy.entry,11,'Inter','#cdb88a');text(details.entry || copy.unknown,11);
        text(copy.bring,11,'Inter','#cdb88a');text(details.bring || copy.unknown,11);text(copy.contact+' info@events-luzern.ch',10);
        doc.setProperties({title:event.name+' · '+copy.title+' № '+data.number,author:'Events.Luzern'});
        doc.save('Events-Luzern-'+data.number+'.pdf');
      }catch(_){set('download-status',copy.error);}
      finally{$('ticket-pdf').disabled=false;set('ticket-pdf',copy.pdf);}
    };
    if(location.hash==='#pdf' && !invalid)$('ticket-pdf').click();
  }catch(_){$('ticket-status').textContent=copy.missing;}
})();
