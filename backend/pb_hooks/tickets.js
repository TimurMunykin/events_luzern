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
  if (order.getString('status')!=='paid') return;
  var guests=json(order,'guests',[]);
  // Existing Sandbox orders predate named tickets. Never invent missing guest names.
  if (!guests.length) for(var i=0;i<order.getInt('quantity');i++) guests.push({name:i===0?order.getString('name'):'Имя гостя не указано',email:'',wishes:''});
  guests.forEach(function(guest,i) {
    var found=app.findRecordsByFilter('tickets','order = {:id} && position = {:position}','',1,0,{id:order.id,position:i+1});
    if (found.length) return;
    var ticket=new Record(app.findCollectionByNameOrId('tickets'));
    ticket.load({order:order.id,position:i+1,name:guest.name,email:guest.email,wishes:guest.wishes,token:$security.randomString(40)});
    app.save(ticket);
  });
};
function ticketsFor(order) {return $app.findRecordsByFilter('tickets','order = {:id}','position',10,0,{id:order.id});}
function ticketURL(ticket) {return config().origin+'/ticket/'+ticket.getString('token');}
exports.forBuyer=function(order) {
  return ticketsFor(order).map(function(t){return {name:t.getString('name'),url:ticketURL(t)};});
};
function publicTicket(token) {
  config();
  if (!/^[a-zA-Z0-9]{40}$/.test(token)) throw new NotFoundError('Ticket not found');
  var ticket,order;
  try {ticket=$app.findFirstRecordByFilter('tickets','token = {:token}',{token:token}); order=$app.findRecordById('orders',ticket.getString('order'));}
  catch (_) {throw new NotFoundError('Ticket not found');}
  if (order.getString('status')!=='paid') throw new NotFoundError('Ticket not found');
  return {ticket:ticket,order:order,event:eventForOrder(order)};
}
function noStore(e) {e.response.header().set('Cache-Control','no-store'); e.response.header().set('Referrer-Policy','no-referrer');}
exports.view=function(e) {
  noStore(e); var data=publicTicket(e.request.pathValue('token'));
  return e.json(200,{name:data.ticket.getString('name'),number:data.ticket.id,event:data.event,
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
exports.qr=function(e) {noStore(e); return e.blob(200,'image/gif',qrBytes(publicTicket(e.request.pathValue('token')).ticket));};
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
  e.response.header().set('Content-Disposition','attachment; filename="events-luzern.ics"');
  return e.blob(200,'text/calendar; charset=utf-8',calendar(data.event,data.order.getString('language')));
};
var COPY={
  ru:{subject:'Ваши билеты',reminder:'Напоминание о событии',intro:'Оплата получена. До встречи!',reminderIntro:'Скоро встречаемся! Ваши билеты и детали события:',entry:'Как найти вход',bring:'Что взять с собой',unknown:'Организатор уточнит эту информацию.',calendar:'Добавить в календарь',ticket:'Открыть билет',show:'Покажите QR-код при входе. Каждый билет действует для одного гостя.',total:'Оплачено'},
  de:{subject:'Ihre Tickets',reminder:'Erinnerung an die Veranstaltung',intro:'Zahlung erhalten. Wir freuen uns auf Sie!',reminderIntro:'Wir sehen uns bald! Hier sind Ihre Tickets und alle Informationen:',entry:'So finden Sie den Eingang',bring:'Bitte mitbringen',unknown:'Diese Information wird noch vom Veranstalter ergänzt.',calendar:'Zum Kalender hinzufügen',ticket:'Ticket öffnen',show:'Zeigen Sie den QR-Code am Eingang. Jedes Ticket gilt für einen Gast.',total:'Bezahlt'},
  en:{subject:'Your tickets',reminder:'Event reminder',intro:'Payment received. See you there!',reminderIntro:'See you soon! Here are your tickets and event details:',entry:'Finding the entrance',bring:'What to bring',unknown:'The organiser will confirm this information.',calendar:'Add to calendar',ticket:'Open ticket',show:'Show the QR code at the entrance. Each ticket admits one guest.',total:'Paid'}
};
function escape(s) {return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function lines(s) {return escape(s).replace(/\n/g,'<br>');}
function sendTickets(order,tickets,address,reminder,messageKey,includeTotal) {
  var lang=order.getString('language'), copy=COPY[lang] || COPY.ru, event=eventForOrder(order);
  var details=event.details[lang] || event.details.ru || {}, entry=details.entry || copy.unknown, bring=details.bring || copy.unknown;
  var intro=reminder?copy.reminderIntro:copy.intro;
  var calURL=config().origin+'/api/events/tickets/'+tickets[0].getString('token')+'/calendar.ics';
  var html='<div style="background:#f5f5f5;padding:24px 12px;font:16px/1.6 Arial,sans-serif;color:#202020"><div style="max-width:580px;margin:auto;background:#fff;padding:28px">'+
    '<p style="font:24px Georgia,serif;color:#80652c">Events.Luzern</p><h1 style="font:30px Georgia,serif">'+escape(event.name)+'</h1><p>'+intro+'</p>'+
    '<p><strong>'+escape(event.time_label)+'</strong><br>'+escape(event.venue)+'<br>'+escape(event.address)+'</p>'+
    '<p><strong>'+copy.entry+'</strong><br>'+lines(entry)+'</p><p><strong>'+copy.bring+'</strong><br>'+lines(bring)+'</p>'+
    '<p><a href="'+escape(calURL)+'" style="display:inline-block;background:#eee9dd;color:#202020;padding:10px 16px;text-decoration:none;border-radius:4px">'+copy.calendar+'</a></p>';
  var text=intro+'\n\n'+event.name+'\n'+event.time_label+'\n'+event.venue+'\n'+event.address+'\n\n'+copy.entry+': '+entry+'\n'+copy.bring+': '+bring+'\n\n'+copy.calendar+': '+calURL+'\n';
  var inline={}, readers=[];
  tickets.forEach(function(t){
    var cid='ticket-'+t.id+'.gif', reader=$filesystem.fileFromBytes(qrBytes(t),cid).reader.open(); readers.push(reader); inline[cid]=reader;
    html+='<div style="padding:22px 0;border-top:1px solid #ddd"><h2 style="font-size:20px">'+escape(t.getString('name'))+'</h2>'+
      '<img src="cid:'+cid+'" width="260" height="260" alt="QR" style="display:block;max-width:100%;height:auto"><p>'+copy.show+'</p>'+
      '<a href="'+escape(ticketURL(t))+'" style="display:inline-block;background:#202020;color:#fff;padding:12px 20px;text-decoration:none">'+copy.ticket+'</a></div>';
    text+='\n'+t.getString('name')+'\n'+ticketURL(t)+'\n';
  });
  if(includeTotal) {var total=copy.total+': '+order.getString('currency').toUpperCase()+' '+(order.getInt('amount')/100).toFixed(2);html+='<p>'+escape(total)+'</p>';text+='\n'+total;}
  html+='</div></div>';
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
    var orders=$app.findRecordsByFilter('orders','status = "paid"','created,id',100,offset);
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
  return e.json(200,{items:$app.findRecordsByFilter('checkout_events','','starts_at',100,0).map(eventData)});
};
exports.updateEvent=function(e) {
  staff(e,true);var body=e.requestInfo().body;
  var event=$app.findRecordById('checkout_events',e.request.pathValue('id')), details={};
  ['ru','de','en'].forEach(function(lang){var src=body.details && body.details[lang];if(!src) throw new BadRequestError('Missing language');
    details[lang]={entry:String(src.entry || '').trim(),bring:String(src.bring || '').trim()};
    if(details[lang].entry.length>3000 || details[lang].bring.length>3000) throw new BadRequestError('Text is too long');});
  event.set('details',details);event.set('reminders',body.reminders===true);$app.save(event);return e.json(200,eventData(event));
};
function staffTicket(t,order) {
  return {id:t.id,name:t.getString('name'),email:t.getString('email'),wishes:t.getString('wishes'),checked_in:t.getString('checked_in'),
    buyer:order.getString('name'),buyer_email:order.getString('email'),phone:order.getString('phone'),quantity:order.getInt('quantity'),order_id:order.id,
    amount:order.getInt('amount'),currency:order.getString('currency'),message:order.getString('message'),url:ticketURL(t)};
}
exports.list=function(e) {
  staff(e,false);var query=e.request.url.query(),slug=query.get('event'),q=String(query.get('q') || '').trim();
  exports.eventBySlug(slug);
  var params={event:slug,q:q},base='order.status = "paid" && order.event_id = {:event}',filter=base;
  if(q) filter+=' && (name ~ {:q} || email ~ {:q} || order.name ~ {:q} || order.email ~ {:q} || order.phone ~ {:q})';
  if(query.get('state')==='arrived') filter+=' && checked_in != ""';
  if(query.get('state')==='waiting') filter+=' && checked_in = ""';
  var page=Math.max(1,Math.min(10000,parseInt(query.get('page'),10) || 1));
  var tickets=$app.findRecordsByFilter('tickets',filter,'name,id',100,(page-1)*100,params);
  var counts=new DynamicModel({paid:0,arrived:0,total:0});
  $app.db().newQuery('SELECT COUNT(*) AS paid, COALESCE(SUM(t.checked_in != \'\'),0) AS arrived, '+
    'COALESCE(SUM(CASE WHEN ({:q} = \'\' OR t.name LIKE {:search} OR t.email LIKE {:search} OR o.name LIKE {:search} OR o.email LIKE {:search} OR o.phone LIKE {:search}) '+
    'AND ({:state} NOT IN (\'arrived\',\'waiting\') OR ({:state}=\'arrived\' AND t.checked_in != \'\') OR ({:state}=\'waiting\' AND t.checked_in = \'\')) THEN 1 ELSE 0 END),0) AS total '+
    'FROM tickets t JOIN orders o ON o.id=t."order" WHERE o.status=\'paid\' AND o.event_id={:event}')
    .bind({q:q,search:'%'+q+'%',state:query.get('state'),event:slug}).one(counts);
  return e.json(200,{items:tickets.map(function(t){return staffTicket(t,$app.findRecordById('orders',t.getString('order')));}),page:page,
    total:counts.total,paid:counts.paid,arrived:counts.arrived});
};
exports.checkIn=function(e) {
  var operator=staff(e,true),body=e.requestInfo().body,result;
  if(!body.event_id || (!body.ticket_id && !body.token)) throw new BadRequestError('Choose an event and a ticket');
  $app.runInTransaction(function(app){
    var ticket;
    try {ticket=body.token?app.findFirstRecordByFilter('tickets','token = {:token}',{token:String(body.token)}):app.findRecordById('tickets',String(body.ticket_id));}
    catch (_) {throw new NotFoundError('Ticket not found');}
    var order=app.findRecordById('orders',ticket.getString('order'));
    if(order.getString('status')!=='paid') throw new BadRequestError('Ticket is not paid');
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
    if(order.getString('status')!=='paid') throw new BadRequestError('Ticket is not paid');
    if(order.getString('event_id')!==body.event_id) throw new BadRequestError('Ticket belongs to another event');
    var checked=ticket.getString('checked_in');
    // A stale phone must not undo a newer arrival recorded by another operator.
    if(checked && checked!==body.checked_in) throw new BadRequestError('Attendance changed');
    if(checked) {ticket.set('checked_in','');ticket.set('checked_by','');app.save(ticket);}
    result={already_undone:!checked,ticket:staffTicket(ticket,order)};
  });
  return e.json(200,result);
};
