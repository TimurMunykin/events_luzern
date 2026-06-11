migrate(function (app) {
  // Additive: timestamp for sorting requests by recency in the custom admin.
  // Existing records get no value (admin shows "—" for them); new records auto-fill.
  var requests = app.findCollectionByNameOrId("requests");
  requests.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false
  }));
  app.save(requests);
}, function (app) {
  var requests = app.findCollectionByNameOrId("requests");
  requests.fields.removeByName("created");
  app.save(requests);
});
