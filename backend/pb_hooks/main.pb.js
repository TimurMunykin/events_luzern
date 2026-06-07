function requestField(record, name) {
  var value = record.get(name);
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function rowsHtml(rows) {
  var html = "";
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].value) {
      continue;
    }
    html += "<tr><td style=\"padding:6px 12px;color:#6b7280\">" + escapeHtml(rows[i].label) + "</td><td style=\"padding:6px 12px\">" + escapeHtml(rows[i].value) + "</td></tr>";
  }
  return "<table style=\"border-collapse:collapse\">" + html + "</table>";
}

onRecordAfterCreateSuccess(function(e) {
  e.next();

  var notifyTo = $os.getenv("REQUEST_NOTIFY_TO");
  if (!notifyTo) {
    return;
  }

  try {
    var record = e.record;
    var type = requestField(record, "request_type") || "request";
    var email = requestField(record, "email");
    var recipients = notifyTo.split(",");
    var to = [];

    for (var i = 0; i < recipients.length; i++) {
      var address = recipients[i].trim();
      if (address) {
        to.push({ address: address });
      }
    }

    if (!to.length) {
      return;
    }

    var subject = "Events.Luzern: new " + type + " request";
    var html = "<h2 style=\"font-family:Arial,sans-serif\">New Events.Luzern request</h2>" + rowsHtml([
      { label: "Type", value: type },
      { label: "Status", value: requestField(record, "status") },
      { label: "Event", value: requestField(record, "event_name") },
      { label: "Event date", value: requestField(record, "event_date") },
      { label: "Price", value: requestField(record, "price") },
      { label: "Name", value: requestField(record, "name") },
      { label: "Email", value: email },
      { label: "Phone", value: requestField(record, "phone") },
      { label: "Tickets", value: requestField(record, "tickets_count") },
      { label: "Language", value: requestField(record, "language") },
      { label: "Newsletter opt-in", value: requestField(record, "newsletter_opt_in") },
      { label: "Source URL", value: requestField(record, "source_url") },
      { label: "Message", value: requestField(record, "message") }
    ]);

    var message = new MailerMessage({
      from: {
        address: $app.settings().meta.senderAddress,
        name: $app.settings().meta.senderName || "Events.Luzern"
      },
      to: to,
      replyTo: email ? [{ address: email }] : [],
      subject: subject,
      html: html
    });

    $app.newMailClient().send(message);
  } catch (err) {
    console.log("[requests] email notification failed: " + err);
  }
}, "requests");
