// Import previously issued tickets without charging guests or sending duplicate receipts.
function rows(body){
  if(!Array.isArray(body.guests) || !body.guests.length || body.guests.length>500)throw new BadRequestError('Invalid guest list');
  var used={};
  return body.guests.map(function(src){
    var row={number:src.number,name:String(src.name || '').trim(),email:String(src.email || '').trim(),phone:String(src.phone || '').trim(),
      total:src.total,received:src.received,method:String(src.method || '').trim(),purchase_date:String(src.purchase_date || '').trim(),notes:String(src.notes || '').trim()};
    if(!Number.isInteger(row.number) || row.number<1 || row.number>100000 || used[row.number] || !row.name || row.name.length>180 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || row.email.length>254 || row.phone.length>120 || row.notes.length>5000 || row.method.length>180 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.purchase_date) || !Number.isInteger(row.total) || row.total<1 || (row.received!==null && (!Number.isInteger(row.received) || row.received<0 || row.received>row.total)))throw new BadRequestError('Invalid imported guest');
    used[row.number]=true;return row;
  });
}
function archiveSandbox(app,event){
  if($os.getenv('APP_ENV')!=='staging')throw new ForbiddenError('Only Sandbox orders can be archived');
  var slug=event.getString('slug');
  var orders=app.findRecordsByFilter('orders','event_id = {:slug} && payment_source != "offline"','created',10000,0,{slug:slug});
  if(!orders.length)return 0;
  if(orders.some(function(order){return order.getString('stripe_session') && !/^cs_test_/.test(order.getString('stripe_session'));}))throw new ForbiddenError('Only Sandbox orders can be archived');
  var archive=new Record(app.findCollectionByNameOrId('checkout_events'));
  ['name','starts_at','ends_at','time_label','venue','address','unit_amount','currency','details','capacity','ticket_sequence'].forEach(function(key){archive.set(key,event.get(key));});
  archive.set('slug',slug+'-test-archive-'+$security.randomString(8));archive.set('name',event.getString('name')+' · прежние тестовые покупки');
  archive.set('enabled',false);archive.set('reminders',false);app.save(archive);
  orders.forEach(function(order){
    app.findRecordsByFilter('tickets','order = {:order}','',10,0,{order:order.id}).forEach(function(ticket){ticket.set('event_id',archive.getString('slug'));app.save(ticket);});
    order.set('event_id',archive.getString('slug'));app.save(order);
  });
  var max=new DynamicModel({value:0});app.db().newQuery('SELECT COALESCE(MAX(number),0) AS value FROM tickets WHERE event_id={:slug}').bind({slug:slug}).one(max);
  event.set('ticket_sequence',max.value);app.save(event);return orders.length;
}
exports.importGuests=function(body){
  var guests=rows(body),result={created:0,unchanged:0,archived_orders:0};
  if(!body.event_id || !Number.isInteger(body.capacity) || body.capacity<1 || body.capacity>100000)throw new BadRequestError('Invalid capacity');
  $app.runInTransaction(function(app){
    var event=app.findFirstRecordByFilter('checkout_events','slug = {:slug}',{slug:body.event_id});
    if(body.archive_sandbox_orders===true && !app.findRecordsByFilter('orders','event_id = {:slug} && payment_source = "offline"','',1,0,{slug:body.event_id}).length)result.archived_orders=archiveSandbox(app,event);
    guests.forEach(function(row){
      var key=body.event_id+':'+row.number,hash=$security.sha256(JSON.stringify(row)),existing=null;
      try{existing=app.findFirstRecordByFilter('orders','offline_import_key = {:key}',{key:key});}catch(_){}
      if(existing){if(existing.getString('payload_hash')!==hash)throw new BadRequestError('Imported guest changed');result.unchanged++;return;}
      if(app.findRecordsByFilter('tickets','event_id = {:slug} && number = {:number}','',1,0,{slug:body.event_id,number:row.number}).length)throw new BadRequestError('Ticket number already used');
      var order=new Record(app.findCollectionByNameOrId('orders'));
      order.load({event_id:body.event_id,checkout_key:$security.randomString(40),payload_hash:hash,name:row.name,email:row.email,phone:row.phone,
        quantity:1,amount:row.total,currency:event.getString('currency'),language:'ru',status:row.received===row.total?'paid':'reserved',
        payment_source:'offline',offline_import_key:key,offline_received:row.received===null?0:row.received,offline_received_unknown:row.received===null,offline_method:row.method,offline_purchase_date:row.purchase_date,
        message:row.notes,guests:[{name:row.name,email:row.email,wishes:''}],receipt_sent:true,owner_notified:true});
      app.save(order);
      var ticket=new Record(app.findCollectionByNameOrId('tickets'));
      ticket.load({order:order.id,event_id:body.event_id,position:1,number:row.number,token:$security.randomString(40),name:row.name,email:row.email,email_sent:true});app.save(ticket);
      event.set('ticket_sequence',Math.max(event.getInt('ticket_sequence'),row.number));result.created++;
    });
    var counts=require(__hooks+'/inventory.js').counts(app,body.event_id);
    if(body.capacity<counts.paid+counts.held+counts.reserved)throw new BadRequestError('Capacity below bookings');
    event.set('capacity',body.capacity);app.save(event);result.next_number=event.getInt('ticket_sequence')+1;
  });return result;
};
exports.confirmPayment=function(body){
  var result;
  $app.runInTransaction(function(app){
    var ticket=app.findRecordById('tickets',String(body.ticket_id || '')),order=app.findRecordById('orders',ticket.getString('order'));
    if(order.getString('event_id')!==body.event_id)throw new BadRequestError('Ticket belongs to another event');
    if(order.getString('payment_source')!=='offline')throw new BadRequestError('Not an offline payment');
    if(order.getString('status')==='paid'){result={already_paid:true};return;}
    if(order.getString('status')!=='reserved')throw new BadRequestError('Ticket is not reserved');
    if(body.expected_received!==order.getInt('offline_received') || body.expected_total!==order.getInt('amount') || !!body.expected_received_unknown!==order.getBool('offline_received_unknown'))throw new BadRequestError('Payment changed');
    order.set('offline_received',order.getInt('amount'));order.set('offline_received_unknown',false);order.set('status','paid');app.save(order);result={paid:true};
  });return result;
};
