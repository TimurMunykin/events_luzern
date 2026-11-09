(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventsTicketPresentation = factory();
}(typeof window === 'undefined' ? this : window, function () {
  'use strict';
  var palette = {navy:'#111730', background:'#080b1d', gold:'#d3bd85', cream:'#f7f1e4', paper:'#fffdf7', inkGold:'#846127'};
  var labels = {
    ru:{ticket:'Билет',one:'Ваш билет',many:'Ваши билеты',guest:'Гостья',entry:'Как найти вход',bring:'Что взять с собой',calendar:'Добавить в календарь',pdf:'Скачать PDF',open:'Открыть билет',map:'Открыть карту',contact:'Вопросы о встрече',show:'Покажите QR-код при входе',admission:'Один билет — одна гостья.',used:'Посещение отмечено',refunded:'Оплата возвращена. Билет недействителен.',paidOne:'Оплата получена. Билет подтверждён!',paidMany:'Оплата получена. Билеты подтверждены!',confirmation:'Подтверждение придёт на email.',reminder:'Напоминание о событии',reminderOne:'Скоро встречаемся! Ваш билет и детали события:',reminderMany:'Скоро встречаемся! Ваши билеты и детали события:',total:'Оплачено',loading:'Готовим PDF…',error:'Не удалось скачать PDF. Попробуйте ещё раз.',missing:'Не удалось загрузить билет. Проверьте ссылку из письма или попробуйте ещё раз.',retry:'Попробовать ещё раз',checking:'Проверяем оплату'},
    de:{ticket:'Ticket',one:'Ihr Ticket',many:'Ihre Tickets',guest:'Gast',entry:'So finden Sie den Eingang',bring:'Bitte mitbringen',calendar:'Zum Kalender hinzufügen',pdf:'PDF herunterladen',open:'Ticket öffnen',map:'Karte öffnen',contact:'Fragen zur Veranstaltung',show:'Zeigen Sie den QR-Code am Eingang',admission:'Ein Ticket gilt für einen Gast.',used:'Teilnahme erfasst',refunded:'Die Zahlung wurde erstattet. Das Ticket ist ungültig.',paidOne:'Zahlung erhalten. Ihr Ticket ist bestätigt!',paidMany:'Zahlung erhalten. Ihre Tickets sind bestätigt!',confirmation:'Die Bestätigung erhalten Sie per E-Mail.',reminder:'Erinnerung an die Veranstaltung',reminderOne:'Wir sehen uns bald! Ihr Ticket und alle Informationen:',reminderMany:'Wir sehen uns bald! Ihre Tickets und alle Informationen:',total:'Bezahlt',loading:'PDF wird erstellt…',error:'PDF konnte nicht heruntergeladen werden. Bitte versuchen Sie es erneut.',missing:'Das Ticket konnte nicht geladen werden. Bitte prüfen Sie den Link in Ihrer E-Mail oder versuchen Sie es erneut.',retry:'Erneut versuchen',checking:'Zahlung wird geprüft'},
    en:{ticket:'Ticket',one:'Your ticket',many:'Your tickets',guest:'Guest',entry:'Finding the entrance',bring:'What to bring',calendar:'Add to calendar',pdf:'Download PDF',open:'Open ticket',map:'Open map',contact:'Questions about the event',show:'Show the QR code at the entrance',admission:'One ticket admits one guest.',used:'Attendance recorded',refunded:'Payment refunded. This ticket is no longer valid.',paidOne:'Payment received. Your ticket is confirmed!',paidMany:'Payment received. Your tickets are confirmed!',confirmation:'A confirmation will be sent to your email.',reminder:'Event reminder',reminderOne:'See you soon! Your ticket and event details:',reminderMany:'See you soon! Your tickets and event details:',total:'Paid',loading:'Preparing PDF…',error:'Could not download the PDF. Please try again.',missing:'The ticket could not be loaded. Please check the link in your email or try again.',retry:'Try again',checking:'Checking payment'}
  };
  function copy(language, quantity) {
    var base=labels[language] || labels.ru, result={};
    Object.keys(base).forEach(function(key){result[key]=base[key];});
    result.title=quantity===1?base.one:base.many;
    result.paid=quantity===1?base.paidOne:base.paidMany;
    result.reminderIntro=quantity===1?base.reminderOne:base.reminderMany;
    return result;
  }
  function escape(value) {
    return String(value === undefined || value === null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function model(data) {
    var event=data.event, lang=labels[data.language]?data.language:'ru';
    var details=event.details[lang] || event.details.ru || {};
    return {language:lang, copy:copy(lang,1), name:data.name, number:data.number, event:event,
      time:event.time_label.replace(/\s*\(Europe\/Zurich\)/g,''), entry:details.entry || '', bring:details.bring || '',
      map:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(event.venue+', '+event.address),
      url:data.url, api:data.url.replace('/ticket/','/api/events/tickets/'),
      refunded:data.status==='refunded', checkedIn:data.checked_in || ''};
  }
  function render(data, options) {
    options=options || {};
    var m=model(data), c=m.copy, p=palette, e=escape;
    var text='font-family:Inter,Arial,sans-serif;color:'+p.cream+';font-size:16px;line-height:1.5;';
    var button='display:block;padding:14px 18px;border-radius:6px;text-align:center;text-decoration:none;font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.4;';
    var html='<table class="event-ticket" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:480px;margin:0 auto;background:'+p.navy+';border-radius:20px;'+text+'"><tr><td class="event-ticket-inner" style="padding:26px 24px 28px;text-align:center">';
    html+='<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="left" style="font:14px/1.4 Inter,Arial,sans-serif;color:'+p.cream+'">'+c.ticket+'</td><td align="right" style="font:14px/1.4 Inter,Arial,sans-serif;color:'+p.gold+'">№ '+e(m.number)+'</td></tr></table>';
    html+='<img class="ticket-logo" src="'+e(options.logo || '/assets/logo.png')+'" alt="Events.Luzern" width="64" height="64" style="display:block;width:64px;height:64px;margin:20px auto 12px;object-fit:contain">';
    html+='<h2 class="ticket-event-name" style="margin:0 0 26px;font-family:Oswald,\'Arial Narrow\',Impact,sans-serif;font-size:56px;font-weight:600;line-height:1.08;letter-spacing:.025em;text-transform:uppercase;color:'+p.gold+';overflow-wrap:anywhere">'+e(m.event.name)+'</h2>';
    html+='<p style="margin:0 0 4px;font:14px/1.5 Inter,Arial,sans-serif;color:'+p.cream+'">'+c.guest+'</p><p class="ticket-guest-name" style="margin:0 0 20px;font:600 22px/1.3 Inter,Arial,sans-serif;overflow-wrap:anywhere;text-transform:uppercase;color:'+p.cream+'">'+e(m.name)+'</p>';
    html+='<p class="ticket-time" style="margin:0 0 8px;font:600 18px/1.5 Inter,Arial,sans-serif;color:'+p.cream+'">'+e(m.time)+'</p><p style="margin:0 0 4px;'+text+'">'+e(m.event.venue)+'</p>';
    html+='<p style="margin:0 0 24px;font:14px/1.5 Inter,Arial,sans-serif;overflow-wrap:anywhere"><a class="ticket-map" href="'+e(m.map)+'" target="_blank" rel="noopener noreferrer" style="color:'+p.cream+';text-decoration:underline;text-underline-offset:3px">'+e(m.event.address)+'</a></p>';
    if (!m.refunded) {
      html+='<table class="ticket-qr-panel" role="presentation" cellpadding="0" cellspacing="0" width="248" style="width:248px;max-width:100%;margin:0 auto;background:'+p.paper+';border-radius:16px"><tr><td style="padding:12px 12px 16px;text-align:center">';
      html+='<img class="ticket-qr" src="'+e(options.qr || m.api+'/qr.gif')+'" alt="QR" width="224" height="224" style="display:block;width:224px;max-width:100%;height:auto;margin:auto">';
      html+='<p class="ticket-qr-number" style="margin:4px 0 0;font:600 18px/1.5 Inter,Arial,sans-serif;color:'+p.inkGold+'">№ '+e(m.number)+'</p></td></tr></table>';
      html+='<p style="margin:16px 0 0;font:14px/1.5 Inter,Arial,sans-serif;color:'+p.cream+'">'+c.show+'<br>'+c.admission+'</p>';
    } else html+='<p class="ticket-invalid" role="status" style="margin:24px 0;padding:20px;background:#422c36;color:#ffd7d0;'+text+'">'+c.refunded+'</p>';
    if (m.checkedIn && !m.refunded) html+='<p class="ticket-attendance" role="status" style="margin:12px 0 0;color:'+p.gold+'">'+c.used+'</p>';
    [[c.entry,m.entry],[c.bring,m.bring]].forEach(function(item){
      if(item[1])html+='<p class="ticket-detail" style="margin:20px 0 0;'+text+'"><span style="font-size:14px;color:'+p.gold+'">'+e(item[0])+'</span><br>'+e(item[1]).replace(/\n/g,'<br>')+'</p>';
    });
    html+='<p style="margin:24px 0 0;font:14px/1.5 Inter,Arial,sans-serif;color:'+p.cream+'">'+c.contact+'<br><a href="mailto:info@events-luzern.ch" style="color:'+p.cream+';text-decoration:underline">info@events-luzern.ch</a></p>';
    html+='<p style="margin:18px 0 0;font:14px/1.5 Inter,Arial,sans-serif;color:'+p.gold+'">@events.luzern</p></td></tr></table>';
    if (!m.refunded) {
      html+='<div class="ticket-actions" style="max-width:480px;margin:16px auto 0"><a data-ticket-pdf href="'+e(m.url)+'#pdf" style="'+button+'background:'+p.gold+';color:'+p.background+'">'+c.pdf+'</a>';
      html+='<a data-ticket-calendar href="'+e(m.api)+'/calendar.ics" style="'+button+'margin-top:10px;background:#202844;color:'+p.cream+'">'+c.calendar+'</a></div>';
    }
    return html;
  }
  return {palette:palette, copy:copy, escape:escape, model:model, render:render};
}));
