migrate(function(app) {
  var orders=app.findCollectionByNameOrId('orders');
  orders.fields.add(new NumberField({name:'refund_sync_version',min:0,onlyInt:true}));app.save(orders);
  var refunds=new Collection({name:'ticket_refunds',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    fields:[{name:'order',type:'relation',collectionId:orders.id,required:true,maxSelect:1,cascadeDelete:true},
      {name:'ticket_ids',type:'json'},{name:'stripe_id',type:'text'},{name:'idempotency_key',type:'text'},
      {name:'amount',type:'number',min:0,onlyInt:true},{name:'currency',type:'text'},
      {name:'status',type:'text'},{name:'source',type:'text'},{name:'requested_by',type:'text'},{name:'failure_reason',type:'text'},
      {name:'created',type:'autodate',onCreate:true,onUpdate:false},{name:'updated',type:'autodate',onCreate:true,onUpdate:true}],
    indexes:["CREATE UNIQUE INDEX idx_ticket_refund_stripe ON ticket_refunds (stripe_id) WHERE stripe_id != ''",
      "CREATE UNIQUE INDEX idx_ticket_refund_key ON ticket_refunds (idempotency_key) WHERE idempotency_key != ''"]});
  app.save(refunds);
  var tickets=app.findCollectionByNameOrId('tickets');
  tickets.fields.add(new DateField({name:'refunded_at'}));
  tickets.fields.add(new TextField({name:'refund_state'}));
  tickets.fields.add(new RelationField({name:'refund_request',collectionId:refunds.id,maxSelect:1}));app.save(tickets);
}, function(app) {
  var tickets=app.findCollectionByNameOrId('tickets');
  ['refunded_at','refund_state','refund_request'].forEach(function(k){tickets.fields.removeByName(k);});app.save(tickets);
  app.delete(app.findCollectionByNameOrId('ticket_refunds'));
  var orders=app.findCollectionByNameOrId('orders');orders.fields.removeByName('refund_sync_version');app.save(orders);
});
