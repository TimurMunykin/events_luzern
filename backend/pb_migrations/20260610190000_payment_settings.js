migrate(function (app) {
  // Payment settings edited by Natali in the PB admin (/_/). Public read so the
  // uploaded QR image can be embedded in confirmation emails. These are
  // payment-receiving details (IBAN/TWINT), not secrets.
  var collection = new Collection({
    type: "base",
    name: "payment_settings",
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "intro_ru", type: "editor" },
      { name: "intro_de", type: "editor" },
      { name: "intro_en", type: "editor" },
      { name: "bank_transfer", type: "editor" },
      { name: "twint", type: "text", max: 300 },
      {
        name: "qr_code",
        type: "file",
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]
      }
    ]
  });

  app.save(collection);

  var record = new Record(collection);
  record.set("intro_ru", "<p>Спасибо за бронь на «{event}»! Вы забронировали {tickets} билет(ов), к оплате <strong>{total}</strong>.</p><p>Ниже — реквизиты для оплаты. После оплаты мы подтвердим ваше место. По вопросам пишите на info@events-luzern.ch.</p>");
  record.set("intro_de", "<p>Vielen Dank für Ihre Reservierung für «{event}»! Sie haben {tickets} Ticket(s) reserviert, zu zahlen <strong>{total}</strong>.</p><p>Unten finden Sie die Zahlungsdetails. Nach Zahlungseingang bestätigen wir Ihren Platz.</p>");
  record.set("intro_en", "<p>Thank you for your booking for “{event}”! You reserved {tickets} ticket(s), total <strong>{total}</strong>.</p><p>Payment details are below. We will confirm your spot once the payment arrives.</p>");
  record.set("bank_transfer", "");
  record.set("twint", "");
  app.save(record);

  // Capture the event poster image URL on ticket requests so it can be shown
  // in the confirmation email.
  var requests = app.findCollectionByNameOrId("requests");
  requests.fields.add(new TextField({ name: "event_image", max: 600 }));
  app.save(requests);
}, function (app) {
  var requests = app.findCollectionByNameOrId("requests");
  requests.fields.removeByName("event_image");
  app.save(requests);

  var collection = app.findCollectionByNameOrId("payment_settings");
  app.delete(collection);
});
