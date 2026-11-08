migrate(function(app) {
  var events=app.findCollectionByNameOrId('checkout_events');
  events.fields.add(new NumberField({name:'capacity',min:0,onlyInt:true}));
  events.fields.add(new NumberField({name:'ticket_sequence',min:0,onlyInt:true}));
  app.save(events);
  var orders=app.findCollectionByNameOrId('orders');
  orders.fields.add(new DateField({name:'hold_until'}));
  orders.fields.add(new DateField({name:'consent_at'}));
  orders.fields.add(new TextField({name:'consent_version'}));
  orders.fields.add(new TextField({name:'stripe_payment_intent'}));
  orders.fields.add(new NumberField({name:'refunded_amount',min:0,onlyInt:true}));
  app.save(orders);
  app.db().newQuery("UPDATE orders SET hold_until=strftime('%Y-%m-%d %H:%M:%fZ', created, '+1 hour') WHERE status='pending'").execute();
  var tickets=app.findCollectionByNameOrId('tickets');
  tickets.fields.add(new TextField({name:'event_id'}));
  tickets.fields.add(new NumberField({name:'number',min:0,onlyInt:true}));
  app.save(tickets);
  // Number existing tickets once, in purchase order. Refunds never recycle numbers.
  app.findAllRecords('checkout_events').forEach(function(event) {
    var sequence=0;
    app.findAllRecords('tickets', $dbx.exp('"order" IN (SELECT id FROM orders WHERE event_id={:slug})',{slug:event.getString('slug')}))
      .sort(function(a,b){return a.getString('created').localeCompare(b.getString('created')) || a.getString('order').localeCompare(b.getString('order')) || a.getInt('position')-b.getInt('position');})
      .forEach(function(ticket){ticket.set('event_id',event.getString('slug'));ticket.set('number',++sequence);app.save(ticket);});
    event.set('ticket_sequence',sequence);app.save(event);
  });
  tickets.addIndex('idx_ticket_event_number',true,'event_id, number','number > 0');
  app.save(tickets);
}, function(app) {
  var tickets=app.findCollectionByNameOrId('tickets');
  tickets.removeIndex('idx_ticket_event_number');
  ['event_id','number'].forEach(function(k){tickets.fields.removeByName(k);});app.save(tickets);
  var orders=app.findCollectionByNameOrId('orders');
  ['hold_until','consent_at','consent_version','stripe_payment_intent','refunded_amount'].forEach(function(k){orders.fields.removeByName(k);});app.save(orders);
  var events=app.findCollectionByNameOrId('checkout_events');
  ['capacity','ticket_sequence'].forEach(function(k){events.fields.removeByName(k);});app.save(events);
});
