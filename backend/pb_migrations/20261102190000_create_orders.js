migrate(function(app) {
  app.save(new Collection({name: 'orders', type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      {name:'checkout_key',type:'text',required:true,max:64},
      {name:'payload_hash',type:'text',required:true,max:64},
      {name:'event_id',type:'text',required:true},
      {name:'name',type:'text',required:true,max:180},
      {name:'email',type:'email',required:true},
      {name:'phone',type:'text',max:120},
      {name:'message',type:'text',max:5000},
      {name:'newsletter_opt_in',type:'bool'},
      {name:'language',type:'text',max:2},
      {name:'quantity',type:'number',required:true,min:1,max:10,onlyInt:true},
      {name:'amount',type:'number',required:true,onlyInt:true},
      {name:'currency',type:'text',required:true},
      {name:'status',type:'text',required:true},
      {name:'stripe_session',type:'text'},
      {name:'checkout_url',type:'url'},
      {name:'receipt_sent',type:'bool'},
      {name:'created',type:'autodate',onCreate:true,onUpdate:false}
    ], indexes:['CREATE UNIQUE INDEX idx_orders_key ON orders (checkout_key)', 'CREATE UNIQUE INDEX idx_orders_session ON orders (stripe_session) WHERE stripe_session != ""']
  }));
}, function(app) { app.delete(app.findCollectionByNameOrId('orders')); });
