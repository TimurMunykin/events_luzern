migrate(function(app) {
  var collection = new Collection({
    type: "base",
    name: "requests",
    listRule: null,
    viewRule: null,
    createRule: "",
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "request_type", type: "text", required: true, max: 60 },
      { name: "status", type: "text", max: 40 },
      { name: "event_name", type: "text", max: 180 },
      { name: "event_date", type: "text", max: 80 },
      { name: "price", type: "text", max: 80 },
      { name: "name", type: "text", max: 180 },
      { name: "email", type: "email" },
      { name: "phone", type: "text", max: 120 },
      { name: "tickets_count", type: "text", max: 20 },
      { name: "language", type: "text", max: 12 },
      { name: "message", type: "text", max: 5000 },
      { name: "source_url", type: "url" },
      { name: "user_agent", type: "text", max: 1000 },
      { name: "newsletter_opt_in", type: "bool" }
    ],
    indexes: [
      "CREATE INDEX idx_requests_request_type ON requests (request_type)",
      "CREATE INDEX idx_requests_status ON requests (status)"
    ]
  });

  app.save(collection);
}, function(app) {
  var collection = app.findCollectionByNameOrId("requests");
  app.delete(collection);
});
