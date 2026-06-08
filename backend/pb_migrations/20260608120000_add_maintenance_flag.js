migrate(function (app) {
  var collection = app.findCollectionByNameOrId("site_config");

  collection.fields.add(new BoolField({
    name: "maintenance"
  }));

  app.save(collection);
}, function (app) {
  var collection = app.findCollectionByNameOrId("site_config");
  collection.fields.removeByName("maintenance");
  app.save(collection);
});
