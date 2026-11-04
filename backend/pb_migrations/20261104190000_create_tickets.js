migrate(function(app) {
  var events = new Collection({name:'checkout_events',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    fields:[{name:'slug',type:'text',required:true},{name:'name',type:'text',required:true},
      {name:'starts_at',type:'date',required:true},{name:'ends_at',type:'date'},
      {name:'time_label',type:'text',required:true},{name:'venue',type:'text',required:true},{name:'address',type:'text',required:true},
      {name:'unit_amount',type:'number',min:1,onlyInt:true,required:true},{name:'currency',type:'text',required:true},
      {name:'details',type:'json'},{name:'reminders',type:'bool'},{name:'enabled',type:'bool'}],
    indexes:['CREATE UNIQUE INDEX idx_checkout_events_slug ON checkout_events (slug)']});
  app.save(events);
  var event = new Record(events);
  event.load({slug:'refresh-2-0',name:'RE:FRESH 2.0',starts_at:'2026-11-15 10:00:00.000Z',time_label:'15.11.2026 · 11:00 (Europe/Zurich)',
    venue:'HERMITAGE Lake Lucerne',address:'Seeburgstrasse 72, 6006 Luzern',unit_amount:15000,currency:'chf',reminders:true,enabled:true,
    details:{ru:{entry:'',bring:''},de:{entry:'',bring:''},en:{entry:'',bring:''}}});
  app.save(event);
  var orders=app.findCollectionByNameOrId('orders');
  orders.fields.add(new JSONField({name:'guests',maxSize:131072}));
  orders.fields.add(new JSONField({name:'event_snapshot',maxSize:131072}));
  orders.fields.add(new BoolField({name:'owner_notified'}));
  orders.fields.add(new BoolField({name:'reminder_sent'}));
  app.save(orders);
  app.save(new Collection({name:'tickets',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    fields:[{name:'order',type:'relation',collectionId:orders.id,required:true,maxSelect:1},
      {name:'position',type:'number',min:1,max:10,onlyInt:true,required:true},{name:'token',type:'text',required:true,min:40,max:40},
      {name:'name',type:'text',required:true,max:180},{name:'email',type:'email'},
      {name:'wishes',type:'text',max:2000},{name:'checked_in',type:'date'},{name:'checked_by',type:'text'},
      {name:'email_sent',type:'bool'},{name:'reminder_sent',type:'bool'},
      {name:'created',type:'autodate',onCreate:true,onUpdate:false}],
    indexes:['CREATE UNIQUE INDEX idx_tickets_token ON tickets (token)','CREATE UNIQUE INDEX idx_tickets_order_position ON tickets ("order", position)']}));
  app.save(new Collection({name:'ticket_staff',type:'auth',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    passwordAuth:{enabled:true,identityFields:['username']},authToken:{duration:21600},
    fields:[{name:'name',type:'text'},{name:'username',type:'text',required:true,max:64}],
    indexes:['CREATE UNIQUE INDEX idx_ticket_staff_username ON ticket_staff (username)']}));
  if($os.getenv('CHECKOUT_ENABLED')==='true') {
    var password=$os.getenv('TICKET_STAFF_PASSWORD');
    if(!password || password.length<16) throw new Error('Set an isolated staff password');
    var staff=new Record(app.findCollectionByNameOrId('ticket_staff'));
    staff.set('username','natali');staff.set('name','Натали');staff.set('email','natali@events-luzern.test');staff.setPassword(password);app.save(staff);
  }
}, function(app) {
  app.delete(app.findCollectionByNameOrId('ticket_staff'));
  app.delete(app.findCollectionByNameOrId('tickets'));
  var orders=app.findCollectionByNameOrId('orders');
  ['guests','event_snapshot','owner_notified','reminder_sent'].forEach(function(name){orders.fields.removeByName(name);});
  app.save(orders);
  app.delete(app.findCollectionByNameOrId('checkout_events'));
});
