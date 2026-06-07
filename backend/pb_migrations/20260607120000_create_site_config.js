migrate(function (app) {
  var collection = new Collection({
    type: "base",
    name: "site_config",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "current_version", type: "text", required: true, max: 120 }
    ]
  });

  app.save(collection);

  var record = new Record(collection);
  record.set("current_version", "aurora-v16a.html");
  app.save(record);
}, function (app) {
  var collection = app.findCollectionByNameOrId("site_config");
  app.delete(collection);
});
