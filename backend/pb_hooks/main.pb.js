onRecordAfterCreateSuccess(function(e) {
  e.next();

  var notifyTo = $os.getenv("REQUEST_NOTIFY_TO");
  if (!notifyTo) {
    return;
  }

  // NOTE: PocketBase JSVM runs each hook handler in an isolated runtime that
  // does NOT see file-level functions, so these helpers must be defined inside
  // the handler (see also the routerAdd note below).
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

// --- Live landing: serve the current version at "/" ---
// NOTE: PocketBase JSVM runs each route handler in an isolated runtime that does
// NOT see file-level vars/functions. Every handler below must be self-contained
// and may only rely on injected globals ($app, $os, e, toString, routerAdd).
routerAdd("GET", "/", function (e) {
  var prototypesDir = "/pb/prototypes";
  var fallback = "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Events.Luzern</title></head><body style=\"font-family:sans-serif;background:#0a0a14;color:#e8e8ea;display:flex;min-height:100vh;align-items:center;justify-content:center\">" +
    "<p>Events.Luzern — скоро здесь.</p></body></html>";

  var version = "";
  var maintenance = false;
  try {
    var rec = $app.findFirstRecordByFilter("site_config", "current_version != ''");
    version = String(rec.get("current_version") || "");
    maintenance = !!rec.get("maintenance");
  } catch (err) {
    return e.html(503, fallback);
  }

  // Maintenance mode: serve the "coming soon" placeholder instead of the live version.
  if (maintenance) {
    try {
      var page = toString($os.readFile(prototypesDir + "/maintenance.html"));
      return e.html(503, page);
    } catch (errM) {
      return e.html(503, fallback);
    }
  }

  var safe = /^[a-zA-Z0-9._-]+\.html$/.test(version) && version.indexOf("..") === -1;
  if (!safe) {
    return e.html(503, fallback);
  }

  try {
    var html = toString($os.readFile(prototypesDir + "/" + version));
    return e.html(200, html);
  } catch (err2) {
    return e.html(503, fallback);
  }
});

// --- Gate for /prototypes/* (used by Caddy forward_auth) ---
routerAdd("GET", "/pb-gate", function (e) {
  var token = "";
  try {
    var raw = e.request.header.get("Cookie") || "";
    var parts = raw.split(";");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.indexOf("pb_auth=") === 0) {
        token = decodeURIComponent(p.substring("pb_auth=".length));
        break;
      }
    }
  } catch (err) {
    token = "";
  }

  if (token) {
    try {
      $app.findAuthRecordByToken(token, "auth");
      return e.noContent(204);
    } catch (err2) {
      // invalid/expired token -> fall through to redirect
    }
  }
  return e.redirect(302, "/login");
});
