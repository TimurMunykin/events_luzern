migrate(function(app){
  var orders=app.findCollectionByNameOrId('orders');
  ['payment_source','offline_method','offline_purchase_date','offline_import_key'].forEach(function(name){orders.fields.add(new TextField({name:name,max:180}));});
  orders.fields.add(new NumberField({name:'offline_received',min:0,onlyInt:true}));
  orders.addIndex('idx_orders_offline_import',true,'offline_import_key',"offline_import_key != ''");app.save(orders);
},function(app){
  var orders=app.findCollectionByNameOrId('orders');orders.removeIndex('idx_orders_offline_import');
  ['payment_source','offline_method','offline_purchase_date','offline_import_key','offline_received'].forEach(function(name){orders.fields.removeByName(name);});app.save(orders);
});
