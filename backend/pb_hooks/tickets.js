// Ticket possession permits viewing that ticket. Only authenticated staff can check it in.
function config() {
  if ($os.getenv('CHECKOUT_ENABLED')!=='true' || !/^sk_test_/.test($os.getenv('STRIPE_SECRET_KEY'))) throw new ApiError(503,'Tickets unavailable');
  return {origin:$os.getenv('CHECKOUT_ORIGIN').replace(/\/$/,''),owner:$os.getenv('CHECKOUT_NOTIFY_TO')};
}
function json(record,key,fallback) {
  try {return JSON.parse(record.getString(key)) || fallback;} catch (_) {return fallback;}
}
function eventData(r) {
  var e={id:r.id};
  ['slug','name','starts_at','ends_at','time_label','venue','address','currency'].forEach(function(k){e[k]=r.getString(k);});
  e.capacity=r.getInt('capacity'); e.availability=require(__hooks+'/inventory.js').availability($app,r);
  e.unit_amount=r.getInt('unit_amount'); e.enabled=r.getBool('enabled'); e.reminders=r.getBool('reminders');
  e.details=json(r,'details',{}); return e;
}
exports.eventBySlug=function(slug) {
  try {return eventData($app.findFirstRecordByFilter('checkout_events','slug = {:slug}',{slug:slug}));}
  catch (_) {throw new BadRequestError('Unknown event');}
};
function eventForOrder(order) {
  var current=exports.eventBySlug(order.getString('event_id'));
  var snapshot=json(order,'event_snapshot',current);
  snapshot.details=current.details; snapshot.reminders=current.reminders;
  return snapshot;
}
exports.issue=function(app,order) {
  if (['paid','partially_refunded'].indexOf(order.getString('status'))<0) return;
  var guests=json(order,'guests',[]);
  // Existing Sandbox orders predate named tickets. Never invent missing guest names.
  if (!guests.length) for(var i=0;i<order.getInt('quantity');i++) guests.push({name:i===0?order.getString('name'):'Имя гостя не указано',email:'',wishes:''});
  var event=app.findFirstRecordByFilter('checkout_events','slug = {:slug}',{slug:order.getString('event_id')});
  guests.forEach(function(guest,i) {
    var found=app.findRecordsByFilter('tickets','order = {:id} && position = {:position}','',1,0,{id:order.id,position:i+1});
    if (found.length && found[0].getInt('number')) return;
    var ticket=found.length?found[0]:new Record(app.findCollectionByNameOrId('tickets'));
    if(!found.length) ticket.load({order:order.id,position:i+1,name:guest.name,email:guest.email,wishes:guest.wishes,token:$security.randomString(40)});
    event.set('ticket_sequence',event.getInt('ticket_sequence')+1);
    ticket.set('number',event.getInt('ticket_sequence'));ticket.set('event_id',event.getString('slug'));
    app.save(ticket);
  });
  app.save(event);
};
function ticketsFor(order) {return $app.findRecordsByFilter('tickets','order = {:id}','position',10,0,{id:order.id});}
function ticketURL(ticket) {return config().origin+'/ticket/'+ticket.getString('token');}
exports.forBuyer=function(order) {
  return ticketsFor(order).map(function(t){return {name:t.getString('name'),number:number(t),url:ticketURL(t)};});
};
function number(ticket) {return String(ticket.getInt('number')).padStart(3,'0');}
function valid(order) {return ['paid','partially_refunded'].indexOf(order.getString('status'))>=0;}
function publicTicket(token) {
  config();
  if (!/^[a-zA-Z0-9]{40}$/.test(token)) throw new NotFoundError('Ticket not found');
  var ticket,order;
  try {ticket=$app.findFirstRecordByFilter('tickets','token = {:token}',{token:token}); order=$app.findRecordById('orders',ticket.getString('order'));}
  catch (_) {throw new NotFoundError('Ticket not found');}
  if (!valid(order) && order.getString('status')!=='refunded') throw new NotFoundError('Ticket not found');
  return {ticket:ticket,order:order,event:eventForOrder(order)};
}
function noStore(e) {e.response.header().set('Cache-Control','no-store'); e.response.header().set('Referrer-Policy','no-referrer');}
exports.view=function(e) {
  noStore(e); var data=publicTicket(e.request.pathValue('token'));
  return e.json(200,{name:data.ticket.getString('name'),number:number(data.ticket),event:data.event,status:data.order.getString('status'),contact:'info@events-luzern.ch',
    language:data.order.getString('language'),checked_in:data.ticket.getString('checked_in')});
};
function qrBytes(ticket) {
  var qr=require(__hooks+'/vendor/qrcode-generator-1.4.4.js')(0,'M');
  qr.addData(ticketURL(ticket)); qr.make();
  var data=qr.createDataURL(5,20).split(',')[1], alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes=[], bits=0, value=0;
  for(var i=0;i<data.length;i++) {
    var n=alphabet.indexOf(data[i]); if(n<0) continue;
    value=(value<<6)|n; bits+=6;
    if(bits>=8) {bits-=8; bytes.push((value>>bits)&255);}
  }
  return bytes;
}
exports.qr=function(e) {noStore(e);var data=publicTicket(e.request.pathValue('token'));if(!valid(data.order))throw new ApiError(410,'Ticket refunded');return e.blob(200,'image/gif',qrBytes(data.ticket));};
function icsEscape(s) {return String(s || '').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
function stamp(date) {return new Date(date).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
function calendar(event,language) {
  var details=event.details[language] || event.details.ru || {};
  var lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Events.Luzern//Tickets//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
    'UID:'+event.id+'@events-luzern.ch','DTSTAMP:'+stamp(Date.now()),'DTSTART:'+stamp(event.starts_at),
    'SUMMARY:'+icsEscape(event.name),'LOCATION:'+icsEscape(event.venue+', '+event.address),
    'DESCRIPTION:'+icsEscape([details.entry,details.bring].filter(Boolean).join('\n'))];
  if(event.ends_at) lines.push('DTEND:'+stamp(event.ends_at));
  lines.push('END:VEVENT','END:VCALENDAR');
  // Fold at 75 UTF-8 octets without splitting a code point (RFC 5545).
  return lines.map(function(line){var out='',n=0;for(var ch of line){var size=encodeURIComponent(ch).replace(/%[A-F0-9]{2}/gi,'x').length;if(n+size>75){out+='\r\n ';n=1;}out+=ch;n+=size;}return out;}).join('\r\n')+'\r\n';
}
exports.calendar=function(e) {
  noStore(e); var data=publicTicket(e.request.pathValue('token'));
  if(!valid(data.order))throw new ApiError(410,'Ticket refunded');
  e.response.header().set('Content-Disposition','attachment; filename="events-luzern.ics"');
  return e.blob(200,'text/calendar; charset=utf-8',calendar(data.event,data.order.getString('language')));
};
var COPY={
  ru:{subject:'Ваши билеты',reminder:'Напоминание о событии',intro:'Оплата получена. До встречи!',reminderIntro:'Скоро встречаемся! Ваши билеты и детали события:',entry:'Как найти вход',bring:'Что взять с собой',unknown:'Организатор уточнит эту информацию.',calendar:'Добавить в календарь',ticket:'Открыть билет',map:'Открыть карту',pdf:'Скачать PDF',contact:'Вопросы о встрече:',guest:'Гостья',show:'Покажите QR-код при входе. Каждый билет действует для одного гостя.',total:'Оплачено'},
  de:{subject:'Ihre Tickets',reminder:'Erinnerung an die Veranstaltung',intro:'Zahlung erhalten. Wir freuen uns auf Sie!',reminderIntro:'Wir sehen uns bald! Hier sind Ihre Tickets und alle Informationen:',entry:'So finden Sie den Eingang',bring:'Bitte mitbringen',unknown:'Diese Information wird noch vom Veranstalter ergänzt.',calendar:'Zum Kalender hinzufügen',ticket:'Ticket öffnen',map:'Karte öffnen',pdf:'PDF herunterladen',contact:'Fragen zur Veranstaltung:',guest:'Gast',show:'Zeigen Sie den QR-Code am Eingang. Jedes Ticket gilt für einen Gast.',total:'Bezahlt'},
  en:{subject:'Your tickets',reminder:'Event reminder',intro:'Payment received. See you there!',reminderIntro:'See you soon! Here are your tickets and event details:',entry:'Finding the entrance',bring:'What to bring',unknown:'The organiser will confirm this information.',calendar:'Add to calendar',ticket:'Open ticket',map:'Open map',pdf:'Download PDF',contact:'Questions about the event:',guest:'Guest',show:'Show the QR code at the entrance. Each ticket admits one guest.',total:'Paid'}
};
function escape(s) {return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function lines(s) {return escape(s).replace(/\n/g,'<br>');}
function sendTickets(order,tickets,address,reminder,messageKey,includeTotal) {
  var lang=order.getString('language'), copy=COPY[lang] || COPY.ru, event=eventForOrder(order);
  var details=event.details[lang] || event.details.ru || {}, entry=details.entry || copy.unknown, bring=details.bring || copy.unknown;
  var intro=reminder?copy.reminderIntro:copy.intro;
  var calURL=config().origin+'/api/events/tickets/'+tickets[0].getString('token')+'/calendar.ics';
  var mapURL='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(event.venue+', '+event.address);
  var html='<div style="background:#080a20;padding:24px 12px;font:16px/1.6 Arial,sans-serif;color:#ece5d3"><div style="max-width:620px;margin:auto;background:#11142d;padding:28px">'+
    '<table role="presentation"><tr><td><img src="cid:brand.png" width="60" height="60" alt="Events.Luzern"></td><td style="padding-left:12px;font:28px Georgia,serif;color:#cdb88a">Events.Luzern</td></tr></table>'+
    '<p>'+intro+'</p>';
  var text=intro+'\n\n'+event.name+'\n'+event.time_label+'\n'+event.venue+'\n'+event.address+'\n'+mapURL+'\n\n';
  var inline={}, readers=[];
  var logo=$filesystem.fileFromBytes($os.readFile('/pb/prototypes/assets/logo.png'),'brand.png').reader.open();readers.push(logo);inline['brand.png']=logo;
  tickets.forEach(function(t){
    var cid='ticket-'+t.id+'.gif', reader=$filesystem.fileFromBytes(qrBytes(t),cid).reader.open();readers.push(reader);inline[cid]=reader;
    html+='<div style="padding:24px 0;border-top:1px solid #3b3d51"><p style="color:#cdb88a">№ '+number(t)+'</p><h1 style="font:32px Georgia,serif;margin:0 0 12px">'+escape(event.name)+'</h1>'+
      '<p style="color:#cdb88a">'+escape(event.time_label)+'</p><p>'+escape(event.venue)+'<br>'+escape(event.address)+'<br><a style="color:#ece5d3" href="'+escape(mapURL)+'">'+copy.map+'</a></p>'+
      '<p style="color:#cdb88a;margin-bottom:4px">'+copy.guest+'</p><h2 style="font:26px Georgia,serif;margin:0 0 16px">'+escape(t.getString('name'))+'</h2>'+
      '<img src="cid:'+cid+'" width="240" height="240" alt="QR" style="display:block;max-width:100%;height:auto"><p>'+copy.show+'</p>'+
      '<p><strong style="color:#cdb88a">'+copy.entry+'</strong><br>'+lines(entry)+'</p><p><strong style="color:#cdb88a">'+copy.bring+'</strong><br>'+lines(bring)+'</p>'+
      '<p><a href="'+escape(ticketURL(t))+'" style="display:inline-block;background:#cdb88a;color:#080a20;padding:12px 20px;text-decoration:none">'+copy.ticket+'</a></p>'+
      '<p><a href="'+escape(ticketURL(t))+'#pdf" style="color:#ece5d3">'+copy.pdf+'</a> · <a href="'+escape(calURL)+'" style="color:#ece5d3">'+copy.calendar+'</a></p></div>';
    text+='№ '+number(t)+' — '+t.getString('name')+'\n'+ticketURL(t)+'\n'+copy.entry+': '+entry+'\n'+copy.bring+': '+bring+'\n'+copy.calendar+': '+calURL+'\n\n';
  });
  if(includeTotal){var total=copy.total+': '+order.getString('currency').toUpperCase()+' '+(order.getInt('amount')/100).toFixed(2);html+='<p>'+escape(total)+'</p>';text+='\n'+total;}
  html+='<p style="font-size:14px">'+copy.contact+' <a href="mailto:info@events-luzern.ch" style="color:#ece5d3">info@events-luzern.ch</a></p></div></div>';
  text+='\n'+copy.contact+' info@events-luzern.ch';
  var calReader=$filesystem.fileFromBytes(calendar(event,lang),'event.ics').reader.open();readers.push(calReader);
  try {$app.newMailClient().send(new MailerMessage({from:{address:$app.settings().meta.senderAddress,name:'Events.Luzern'},to:[{address:address}],
    subject:'Events.Luzern — '+(reminder?copy.reminder:copy.subject)+' · '+event.name,html:html,text:text,
    attachments:{'event.ics':calReader},inlineAttachments:inline,headers:{'Message-ID':'<'+messageKey+'@events-luzern.ch>'}}));}
  finally {readers.forEach(function(r){r.close();});}
}
function mark(collection,id,field) {var r=$app.findRecordById(collection,id);r.set(field,true);$app.save(r);}
function attemptMail(id,send) {try {send();} catch(err) {console.log('[tickets] Mail pending for '+id+': '+err.message);}}
function due(order,event,now) {
  var start=Date.parse(event.starts_at), threshold=start-86400000;
  return event.reminders && now>=threshold && now<start && Date.parse(order.getString('created'))<threshold;
}
exports.deliver=function() {
  var cfg=config(),now=Date.now(),offset=0;
  // Page the paid orders: growing guest lists must not starve old pending mail/reminders.
  while(true) {
    var orders=$app.findRecordsByFilter('orders','status = "paid" || status = "partially_refunded"','created,id',100,offset);
    orders.forEach(function(order){
      try {
        $app.runInTransaction(function(app){exports.issue(app,app.findRecordById('orders',order.id));});
        var tickets=ticketsFor(order),event=eventForOrder(order),remind=due(order,event,now);
        if(!order.getBool('receipt_sent')) attemptMail(order.id,function(){sendTickets(order,tickets,order.getString('email'),false,'order-'+order.id,true);mark('orders',order.id,'receipt_sent');});
        if(cfg.owner && !order.getBool('owner_notified')) attemptMail(order.id,function(){
          $app.newMailClient().send(new MailerMessage({from:{address:$app.settings().meta.senderAddress,name:'Events.Luzern'},to:[{address:cfg.owner}],
            subject:'Оплачены билеты · '+event.name,
            text:event.name+'\nПокупатель: '+order.getString('name')+'\nEmail: '+order.getString('email')+'\nТелефон: '+order.getString('phone')+'\nБилетов: '+order.getInt('quantity')+'\nОплачено: '+order.getString('currency').toUpperCase()+' '+(order.getInt('amount')/100).toFixed(2)+'\n\n'+cfg.origin+'/admin/#/guests',
            headers:{'Message-ID':'<owner-'+order.id+'@events-luzern.ch>'}}));
          mark('orders',order.id,'owner_notified');
        });
        if(remind && !order.getBool('reminder_sent')) attemptMail(order.id,function(){sendTickets(order,tickets,order.getString('email'),true,'reminder-order-'+order.id,false);mark('orders',order.id,'reminder_sent');});
        tickets.forEach(function(t){
          var email=t.getString('email');
          if(!email || email.toLowerCase()===order.getString('email').toLowerCase()) return;
          try {
            if(!t.getBool('email_sent')) {sendTickets(order,[t],email,false,'ticket-'+t.id,false);mark('tickets',t.id,'email_sent');}
            if(remind && !t.getBool('reminder_sent')) {sendTickets(order,[t],email,true,'reminder-ticket-'+t.id,false);mark('tickets',t.id,'reminder_sent');}
          } catch(err) {console.log('[tickets] Guest mail pending for '+t.id+': '+err.message);}
        });
      } catch(err) {console.log('[tickets] Mail pending for order '+order.id+': '+err.message);}
    });
    if(orders.length<100) break;
    offset+=100;
  }
};
function staff(e,write) {
  config();noStore(e);
  if(write && e.request.header.get('Origin')!==config().origin) throw new ForbiddenError('Invalid origin');
  var record;
  try {
    var token=e.request.header.get('X-Staff-Token') || e.request.header.get('Authorization') || '';
    record=$app.findAuthRecordByToken(token.replace(/^Bearer\s+/i,''),'auth');
  }
  catch (_) {throw new UnauthorizedError('Please sign in');}
  if(['ticket_staff','_superusers'].indexOf(record.collection().name)===-1) throw new ForbiddenError('Staff access required');
  return record;
}
exports.events=function(e) {
  staff(e,false);
  var origins=[config().origin],legacy=$os.getenv('STAGING_LEGACY_ORIGIN');
  if($os.getenv('APP_ENV')==='staging' && /^https:\/\//.test(legacy))origins.push(legacy.replace(/\/$/,''));
  return e.json(200,{items:$app.findRecordsByFilter('checkout_events','','starts_at',100,0).map(eventData),ticket_origins:origins});
};
exports.updateEvent=function(e) {
  staff(e,true);var body=e.requestInfo().body;
  var event=$app.findRecordById('checkout_events',e.request.pathValue('id')), details={};
  ['ru','de','en'].forEach(function(lang){var src=body.details && body.details[lang];if(!src) throw new BadRequestError('Missing language');
    details[lang]={entry:String(src.entry || '').trim(),bring:String(src.bring || '').trim()};
    if(details[lang].entry.length>3000 || details[lang].bring.length>3000) throw new BadRequestError('Text is too long');});
  if(body.capacity!==undefined && (!Number.isInteger(body.capacity) || body.capacity<0 || body.capacity>100000))throw new BadRequestError('Invalid capacity');
  $app.runInTransaction(function(app){
    event=app.findRecordById('checkout_events',event.id);
    if(body.capacity!==undefined){var counts=require(__hooks+'/inventory.js').counts(app,event.getString('slug'));if(body.capacity && body.capacity<counts.paid+counts.held)throw new BadRequestError('Capacity below bookings');event.set('capacity',body.capacity);}
    event.set('details',details);event.set('reminders',body.reminders===true);app.save(event);
  });return e.json(200,eventData(event));
};
function staffTicket(t,order) {
  return {id:t.id,number:number(t),status:order.getString('status'),refunded_amount:order.getInt('refunded_amount'),name:t.getString('name'),email:t.getString('email'),wishes:t.getString('wishes'),checked_in:t.getString('checked_in'),
    buyer:order.getString('name'),buyer_email:order.getString('email'),phone:order.getString('phone'),quantity:order.getInt('quantity'),order_id:order.id,
    amount:order.getInt('amount'),currency:order.getString('currency'),message:order.getString('message'),url:ticketURL(t)};
}
exports.list=function(e) {
  staff(e,false);var query=e.request.url.query(),slug=query.get('event'),q=String(query.get('q') || '').trim();
  var event=exports.eventBySlug(slug);
  var params={event:slug,q:q},base='(order.status = "paid" || order.status = "partially_refunded" || order.status = "refunded") && order.event_id = {:event}',filter=base;
  if(q) filter+=' && (name ~ {:q} || email ~ {:q} || order.name ~ {:q} || order.email ~ {:q} || order.phone ~ {:q})';
  if(query.get('state')==='refunded')filter+=' && order.status = "refunded"';
  if(query.get('state')==='arrived') filter+=' && order.status != "refunded" && checked_in != ""';
  if(query.get('state')==='waiting') filter+=' && order.status != "refunded" && checked_in = ""';
  var page=Math.max(1,Math.min(10000,parseInt(query.get('page'),10) || 1));
  var tickets=$app.findRecordsByFilter('tickets',filter,'name,id',100,(page-1)*100,params);
  var counts=new DynamicModel({paid:0,arrived:0,total:0});
  $app.db().newQuery("SELECT COALESCE(SUM(o.status!='refunded'),0) AS paid, COALESCE(SUM(o.status!='refunded' AND t.checked_in!=''),0) AS arrived, "+
    "COALESCE(SUM(CASE WHEN ({:q}='' OR t.name LIKE {:search} OR t.email LIKE {:search} OR o.name LIKE {:search} OR o.email LIKE {:search} OR o.phone LIKE {:search}) "+
    "AND ({:state} NOT IN ('arrived','waiting','refunded') OR ({:state}='refunded' AND o.status='refunded') OR (o.status!='refunded' AND (({:state}='arrived' AND t.checked_in!='') OR ({:state}='waiting' AND t.checked_in='')))) THEN 1 ELSE 0 END),0) AS total "+
    "FROM tickets t JOIN orders o ON o.id=t.\"order\" WHERE o.status IN ('paid','partially_refunded','refunded') AND o.event_id={:event}")
    .bind({q:q,search:'%'+q+'%',state:query.get('state'),event:slug}).one(counts);
  return e.json(200,{items:tickets.map(function(t){return staffTicket(t,$app.findRecordById('orders',t.getString('order')));}),page:page,
    total:counts.total,paid:counts.paid,arrived:counts.arrived,availability:event.availability});
};
exports.checkIn=function(e) {
  var operator=staff(e,true),body=e.requestInfo().body,result;
  if(!body.event_id || (!body.ticket_id && !body.token)) throw new BadRequestError('Choose an event and a ticket');
  $app.runInTransaction(function(app){
    var ticket;
    try {ticket=body.token?app.findFirstRecordByFilter('tickets','token = {:token}',{token:String(body.token)}):app.findRecordById('tickets',String(body.ticket_id));}
    catch (_) {throw new NotFoundError('Ticket not found');}
    var order=app.findRecordById('orders',ticket.getString('order'));
    if(order.getString('status')==='refunded')throw new BadRequestError('Ticket refunded');
    if(!valid(order)) throw new BadRequestError('Ticket is not paid');
    if(order.getString('event_id')!==body.event_id) throw new BadRequestError('Ticket belongs to another event');
    var used=!!ticket.getString('checked_in');
    if(!used) {ticket.set('checked_in',new Date().toISOString());ticket.set('checked_by',operator.id);app.save(ticket);}
    result={already_used:used,ticket:staffTicket(ticket,order)};
  });
  return e.json(200,result);
};
exports.undoCheckIn=function(e) {
  staff(e,true);var body=e.requestInfo().body,result;
  if(!body.event_id || !body.ticket_id || typeof body.checked_in!=='string' || !body.checked_in) {
    throw new BadRequestError('Choose an event and a checked-in ticket');
  }
  $app.runInTransaction(function(app){
    var ticket;
    try {ticket=app.findRecordById('tickets',String(body.ticket_id));}
    catch (_) {throw new NotFoundError('Ticket not found');}
    var order=app.findRecordById('orders',ticket.getString('order'));
    if(order.getString('status')==='refunded')throw new BadRequestError('Ticket refunded');
    if(!valid(order)) throw new BadRequestError('Ticket is not paid');
    if(order.getString('event_id')!==body.event_id) throw new BadRequestError('Ticket belongs to another event');
    var checked=ticket.getString('checked_in');
    // A stale phone must not undo a newer arrival recorded by another operator.
    if(checked && checked!==body.checked_in) throw new BadRequestError('Attendance changed');
    if(checked) {ticket.set('checked_in','');ticket.set('checked_by','');app.save(ticket);}
    result={already_undone:!checked,ticket:staffTicket(ticket,order)};
  });
  return e.json(200,result);
};

function csvCell(value) {
  var text=String(value===null || value===undefined?'':value);
  // Spreadsheet cells must remain text, even when a guest supplied a formula.
  if(/^[\s]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
exports.csv=function(e) {
  staff(e,false);var slug=e.request.url.query().get('event');exports.eventBySlug(slug);
  var rows=[['Билет','Имя гостьи','Email гостьи','Телефон покупателя','Покупатель','Email покупателя','Билетов в заказе','Сумма заказа','Валюта','Статус оплаты','Возвращено за заказ','Посетил','Время входа (UTC)','Аллергии / пожелания','Комментарий']],offset=0;
  while(true){
    var tickets=$app.findRecordsByFilter('tickets','order.event_id = {:event} && (order.status = "paid" || order.status = "partially_refunded" || order.status = "refunded")','number,id',100,offset,{event:slug});
    tickets.forEach(function(t){var order=$app.findRecordById('orders',t.getString('order')),item=staffTicket(t,order);
      rows.push(['№ '+item.number,item.name,item.email,item.phone,item.buyer,item.buyer_email,item.quantity,(item.amount/100).toFixed(2),item.currency.toUpperCase(),{paid:'Оплачено',partially_refunded:'Частичный возврат',refunded:'Возвращено — билет недействителен'}[item.status],(item.refunded_amount/100).toFixed(2),item.checked_in?'Да':'Нет',item.checked_in,item.wishes,item.message]);
    });
    if(tickets.length<100)break;offset+=100;
  }
  e.response.header().set('Content-Disposition','attachment; filename="events-luzern-guests.csv"');
  return e.blob(200,'text/csv; charset=utf-8','\uFEFF'+rows.map(function(row){return row.map(csvCell).join(';');}).join('\r\n'));
};
exports.previewReminder=function(e) {
  staff(e,true);
  if($os.getenv('APP_ENV')!=='staging')throw new ForbiddenError('Test reminder unavailable');
  var ticket=$app.findRecordById('tickets',String(e.requestInfo().body.ticket_id || ''));
  var order=$app.findRecordById('orders',ticket.getString('order'));
  if(!valid(order))throw new BadRequestError('Ticket is not paid');
  sendTickets(order,[ticket],config().owner,true,'preview-'+$security.randomString(20),false);
  return e.json(200,{sent:true});
};
