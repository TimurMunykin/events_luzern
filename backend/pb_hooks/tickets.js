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
function valid(order,ticket) {return ['paid','partially_refunded'].indexOf(order.getString('status'))>=0 && (!ticket || !ticket.getString('refunded_at'));}
function status(order,ticket) {return ticket.getString('refunded_at')?'refunded':order.getString('status');}
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
  return e.json(200,{name:data.ticket.getString('name'),number:number(data.ticket),event:data.event,status:status(data.order,data.ticket),contact:'info@events-luzern.ch',
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
exports.qr=function(e) {noStore(e);var data=publicTicket(e.request.pathValue('token'));if(!valid(data.order,data.ticket))throw new ApiError(410,'Ticket refunded');return e.blob(200,'image/gif',qrBytes(data.ticket));};
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
  if(!valid(data.order,data.ticket))throw new ApiError(410,'Ticket refunded');
  e.response.header().set('Content-Disposition','attachment; filename="events-luzern.ics"');
  return e.blob(200,'text/calendar; charset=utf-8',calendar(data.event,data.order.getString('language')));
};
function presentation() {return require('/pb/prototypes/assets/ticketing-v22d/presentation.js');}
function escape(s) {return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function sendTickets(order,tickets,address,reminder,messageKey,includeTotal) {
  if(!tickets.length)return;
  var lang=order.getString('language'), view=presentation(), copy=view.copy(lang,tickets.length), event=eventForOrder(order);
  var details=event.details[lang] || event.details.ru || {};
  var intro=reminder?copy.reminderIntro:copy.paid;
  var mapURL='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(event.venue+', '+event.address);
  // The same markup renders the ticket in the browser, confirmation and reminder emails.
  var html='<html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
    '@font-face{font-family:Oswald;src:url('+config().origin+'/assets/ticketing-v22d/vendor/Oswald-SemiBold.ttf);font-weight:600}'+
    '@font-face{font-family:Inter;src:url('+config().origin+'/assets/ticketing-v22c/vendor/Inter.ttf)}'+
    '@media(max-width:480px){.event-ticket-inner{padding-left:20px!important;padding-right:20px!important}.ticket-event-name{font-size:48px!important}.ticket-guest-name{font-size:20px!important}}'+
    '</style></head><body style="margin:0;background:#080b1d"><div style="background:#080b1d;padding:28px 12px;font:16px/1.6 Inter,Arial,sans-serif;color:#f7f1e4"><div style="max-width:480px;margin:0 auto 24px">'+
    '<h1 style="margin:0 0 12px;font:500 24px/1.3 Inter,Arial,sans-serif;color:#f7f1e4">'+escape(reminder?copy.reminder:copy.title)+'</h1><p style="margin:0">'+intro+'</p></div>';
  var text=intro+'\n\n'+event.name+'\n'+event.time_label+'\n'+event.venue+'\n'+event.address+'\n'+mapURL+'\n\n';
  var inline={},readers=[];
  var logo=$filesystem.fileFromBytes($os.readFile('/pb/prototypes/assets/logo.png'),'brand.png').reader.open();readers.push(logo);inline['brand.png']=logo;
  tickets.forEach(function(t){
    var cid='ticket-'+t.id+'.gif',reader=$filesystem.fileFromBytes(qrBytes(t),cid).reader.open();readers.push(reader);inline[cid]=reader;
    var data={name:t.getString('name'),number:number(t),event:event,language:lang,status:status(order,t),checked_in:t.getString('checked_in'),url:ticketURL(t)};
    html+='<div style="margin:0 auto 36px;max-width:480px">'+view.render(data,{logo:'cid:brand.png',qr:'cid:'+cid})+'</div>';
    text+='№ '+number(t)+' — '+t.getString('name')+'\n'+ticketURL(t)+'\n';
    if(details.entry)text+=copy.entry+': '+details.entry+'\n';
    if(details.bring)text+=copy.bring+': '+details.bring+'\n';
    text+=copy.pdf+': '+ticketURL(t)+'#pdf\n'+copy.calendar+': '+config().origin+'/api/events/tickets/'+t.getString('token')+'/calendar.ics\n\n';
  });
  if(includeTotal){var total=copy.total+': '+order.getString('currency').toUpperCase()+' '+((order.getInt('amount')-order.getInt('refunded_amount'))/100).toFixed(2);html+='<p style="max-width:480px;margin:auto">'+escape(total)+'</p>';text+='\n'+total;}
  html+='</div></body></html>';text+='\n'+copy.contact+': info@events-luzern.ch';
  var calReader=$filesystem.fileFromBytes(calendar(event,lang),'event.ics').reader.open();readers.push(calReader);
  try {$app.newMailClient().send(new MailerMessage({from:{address:$app.settings().meta.senderAddress,name:'Events.Luzern'},to:[{address:address}],
    subject:'Events.Luzern — '+(reminder?copy.reminder:copy.title)+' · '+event.name,html:html,text:text,
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
        var tickets=ticketsFor(order).filter(function(t){return valid(order,t);}),event=eventForOrder(order),remind=due(order,event,now);
        if(!order.getBool('receipt_sent')) attemptMail(order.id,function(){sendTickets(order,tickets,order.getString('email'),false,'order-'+order.id,true);mark('orders',order.id,'receipt_sent');});
        if(cfg.owner && !order.getBool('owner_notified')) attemptMail(order.id,function(){
          $app.newMailClient().send(new MailerMessage({from:{address:$app.settings().meta.senderAddress,name:'Events.Luzern'},to:[{address:cfg.owner}],
            subject:(order.getInt('quantity')===1?'Оплачен билет · ':'Оплачены билеты · ')+event.name,
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
  return {id:t.id,number:number(t),status:status(order,t),order_status:order.getString('status'),refund_state:t.getString('refund_state'),ticket_refunded_amount:status(order,t)==='refunded'?order.getInt('amount')/order.getInt('quantity'):0,refunded_amount:order.getInt('refunded_amount'),name:t.getString('name'),email:t.getString('email'),wishes:t.getString('wishes'),checked_in:t.getString('checked_in'),
    buyer:order.getString('name'),buyer_email:order.getString('email'),phone:order.getString('phone'),quantity:order.getInt('quantity'),order_id:order.id,
    amount:order.getInt('amount'),currency:order.getString('currency'),message:order.getString('message'),url:ticketURL(t)};
}
exports.list=function(e) {
  staff(e,false);var query=e.request.url.query(),slug=query.get('event'),q=String(query.get('q') || '').trim();
  var event=exports.eventBySlug(slug);
  var params={event:slug,q:q},base='(order.status = "paid" || order.status = "partially_refunded" || order.status = "refunded") && order.event_id = {:event}',filter=base;
  if(q) filter+=' && (name ~ {:q} || email ~ {:q} || order.name ~ {:q} || order.email ~ {:q} || order.phone ~ {:q})';
  if(query.get('state')==='refunded')filter+=' && (order.status = "refunded" || refunded_at != "")';
  if(query.get('state')==='arrived') filter+=' && order.status != "refunded" && refunded_at = "" && checked_in != ""';
  if(query.get('state')==='waiting') filter+=' && order.status != "refunded" && refunded_at = "" && checked_in = ""';
  var page=Math.max(1,Math.min(10000,parseInt(query.get('page'),10) || 1));
  var tickets=$app.findRecordsByFilter('tickets',filter,'name,id',100,(page-1)*100,params);
  var counts=new DynamicModel({paid:0,arrived:0,total:0});
  $app.db().newQuery("SELECT COALESCE(SUM(o.status!='refunded' AND t.refunded_at=''),0) AS paid, COALESCE(SUM(o.status!='refunded' AND t.refunded_at='' AND t.checked_in!=''),0) AS arrived, "+
    "COALESCE(SUM(CASE WHEN ({:q}='' OR t.name LIKE {:search} OR t.email LIKE {:search} OR o.name LIKE {:search} OR o.email LIKE {:search} OR o.phone LIKE {:search}) "+
    "AND ({:state} NOT IN ('arrived','waiting','refunded') OR ({:state}='refunded' AND (o.status='refunded' OR t.refunded_at!='')) OR (o.status!='refunded' AND t.refunded_at='' AND (({:state}='arrived' AND t.checked_in!='') OR ({:state}='waiting' AND t.checked_in='')))) THEN 1 ELSE 0 END),0) AS total "+
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
    if(status(order,ticket)==='refunded')throw new BadRequestError('Ticket refunded');
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
    if(status(order,ticket)==='refunded')throw new BadRequestError('Ticket refunded');
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
  var rows=[['Билет','Имя гостьи','Email гостьи','Телефон покупателя','Покупатель','Email покупателя','Билетов в заказе','Сумма заказа','Валюта','Статус билета','Возвращено за заказ','Возвращено за билет','Посетил','Время входа (UTC)','Аллергии / пожелания','Комментарий']],offset=0;
  while(true){
    var tickets=$app.findRecordsByFilter('tickets','order.event_id = {:event} && (order.status = "paid" || order.status = "partially_refunded" || order.status = "refunded")','number,id',100,offset,{event:slug});
    tickets.forEach(function(t){var order=$app.findRecordById('orders',t.getString('order')),item=staffTicket(t,order);
      rows.push(['№ '+item.number,item.name,item.email,item.phone,item.buyer,item.buyer_email,item.quantity,(item.amount/100).toFixed(2),item.currency.toUpperCase(),{paid:'Действует',partially_refunded:'Действует',refunded:'Возвращено — билет недействителен'}[item.status],(item.refunded_amount/100).toFixed(2),(item.ticket_refunded_amount/100).toFixed(2),item.checked_in?'Да':'Нет',item.checked_in,item.wishes,item.message]);
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
  if(status(order,ticket)==='refunded')throw new BadRequestError('Ticket refunded');
  if(!valid(order,ticket))throw new BadRequestError('Ticket is not paid');
  sendTickets(order,[ticket],config().owner,true,'preview-'+$security.randomString(20),false);
  return e.json(200,{sent:true});
};
exports.refundOptions=function(e) {
  staff(e,false);var query=e.request.url.query();
  return e.json(200,require(__hooks+'/refunds.js').options({ticket_id:query.get('ticket_id'),event_id:query.get('event_id')}));
};
exports.refundTicket=function(e) {
  var operator=staff(e,true);
  return e.json(200,require(__hooks+'/refunds.js').request(e.requestInfo().body,operator));
};
