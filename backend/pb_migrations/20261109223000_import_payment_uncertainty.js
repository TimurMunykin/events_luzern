migrate(function(app){
  var orders=app.findCollectionByNameOrId('orders');
  orders.fields.add(new BoolField({name:'offline_received_unknown'}));app.save(orders);
},function(app){
  var orders=app.findCollectionByNameOrId('orders');
  orders.fields.removeByName('offline_received_unknown');app.save(orders);
});
