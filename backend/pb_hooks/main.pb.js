onRecordAfterCreateSuccess(function(e) {
  e.next();

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

  // GoDaddy SMTP (smtpout.secureserver.net:587) intermittently resets the
  // connection ("connection reset by peer"). Retry with a fresh client.
  function sendWithRetry(message, label) {
    var sendErr = null;
    for (var attempt = 1; attempt <= 4; attempt++) {
      try {
        $app.newMailClient().send(message);
        sendErr = null;
        break;
      } catch (sendException) {
        sendErr = sendException;
        // GoDaddy throttles bursts (it resets the connection). Retrying
        // instantly hits the same bad window, so back off before the next
        // attempt. This was the cause of confirmation emails silently
        // dropping for some languages when several requests came in quickly.
        if (attempt < 4) {
          sleep(attempt * 800);
        }
      }
    }
    if (sendErr) {
      console.log("[requests] " + label + " failed after retries: " + sendErr);
    }
  }

  var record = e.record;
  var type = requestField(record, "request_type") || "request";
  var email = requestField(record, "email");
  var senderAddress = $app.settings().meta.senderAddress;
  var senderName = $app.settings().meta.senderName || "Events.Luzern";

  // 1) Internal notification to the business (REQUEST_NOTIFY_TO).
  try {
    var notifyTo = $os.getenv("REQUEST_NOTIFY_TO");
    var to = [];
    if (notifyTo) {
      var recipients = notifyTo.split(",");
      for (var i = 0; i < recipients.length; i++) {
        var address = recipients[i].trim();
        if (address) {
          to.push({ address: address });
        }
      }
    }
    if (to.length) {
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
      sendWithRetry(new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: to,
        replyTo: email ? [{ address: email }] : [],
        subject: subject,
        html: html
      }), "email notification");
    }
  } catch (err) {
    console.log("[requests] email notification failed: " + err);
  }

  // 2) Customer confirmation with payment details — ticket requests only.
  if (type === "ticket" && email) {
    try {
      var lang = (requestField(record, "language") || "ru").toLowerCase();
      if (lang !== "de" && lang !== "en") {
        lang = "ru";
      }
      var L = {
        ru: { subject: "Events.Luzern — детали оплаты", methods: "Способы оплаты", bank: "Банковский перевод", twint: "TWINT", qr: "QR-код", regards: "С уважением,<br>Events.Luzern" },
        de: { subject: "Events.Luzern — Zahlungsdetails", methods: "Zahlungsmethoden", bank: "Banküberweisung", twint: "TWINT", qr: "QR-Code", regards: "Mit freundlichen Grüßen,<br>Events.Luzern" },
        en: { subject: "Events.Luzern — payment details", methods: "Payment methods", bank: "Bank transfer", twint: "TWINT", qr: "QR code", regards: "Best regards,<br>Events.Luzern" }
      }[lang];

      var payment = null;
      try {
        payment = $app.findFirstRecordByFilter("payment_settings", "id != ''");
      } catch (pErr) {
        payment = null;
      }

      if (payment) {
        var eventName = requestField(record, "event_name");
        var ticketsRaw = requestField(record, "tickets_count");
        var priceRaw = requestField(record, "price");

        // total = price number * ticket count, keeping the currency token.
        var totalStr = priceRaw;
        var priceMatch = priceRaw.match(/[0-9]+([.,][0-9]+)?/);
        var count = parseInt(ticketsRaw, 10);
        if (priceMatch && !isNaN(count) && count > 0) {
          var priceNum = parseFloat(priceMatch[0].replace(",", "."));
          if (!isNaN(priceNum)) {
            var currencyMatch = priceRaw.match(/CHF|EUR|USD|€|\$|₣/i);
            var currency = currencyMatch ? currencyMatch[0] : "CHF";
            var totalVal = priceNum * count;
            var totalNum = (totalVal % 1 === 0) ? String(totalVal) : totalVal.toFixed(2);
            totalStr = currency + " " + totalNum;
          }
        }

        var intro = requestField(payment, "intro_" + lang)
          .replace(/\{event\}/g, escapeHtml(eventName))
          .replace(/\{tickets\}/g, escapeHtml(ticketsRaw))
          .replace(/\{total\}/g, escapeHtml(totalStr));

        var methodsHtml = "";
        var bank = String(payment.get("bank_transfer") || "").trim();
        var twint = requestField(payment, "twint").trim();
        var qrFile = requestField(payment, "qr_code");
        var methodHeading = "font-family:Arial,sans-serif;font-size:16px;margin:18px 0 6px;color:#1a1a2e";
        if (bank) {
          methodsHtml += "<h3 style=\"" + methodHeading + "\">" + L.bank + "</h3><div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.5\">" + bank + "</div>";
        }
        if (twint) {
          methodsHtml += "<h3 style=\"" + methodHeading + "\">" + L.twint + "</h3><p style=\"font-family:Arial,sans-serif;font-size:14px\">" + escapeHtml(twint) + "</p>";
        }
        if (qrFile) {
          // The QR image is fetched by the recipient's mail client, so it must
          // be an absolute public URL. PB's meta.appURL is the internal address
          // (http://localhost:8090) and would break the image — always use the
          // public domain (Caddy proxies /api/* to PocketBase).
          var baseUrl = "https://events-luzern.ch";
          var qrUrl = baseUrl + "/api/files/payment_settings/" + payment.id + "/" + qrFile;
          methodsHtml += "<h3 style=\"" + methodHeading + "\">" + L.qr + "</h3><p><img src=\"" + escapeHtml(qrUrl) + "\" alt=\"QR\" style=\"max-width:220px;height:auto\"/></p>";
        }

        var eventImage = requestField(record, "event_image");
        var imageHtml = eventImage ? "<img src=\"" + escapeHtml(eventImage) + "\" alt=\"\" style=\"max-width:100%;height:auto;border-radius:12px;margin-bottom:18px\"/>" : "";

        var custHtml =
          "<div style=\"max-width:560px;margin:0 auto;font-family:Arial,sans-serif;color:#1a1a2e\">" +
          imageHtml +
          "<div style=\"font-size:15px;line-height:1.6\">" + intro + "</div>" +
          (methodsHtml ? "<h2 style=\"font-size:18px;margin:26px 0 4px;color:#1a1a2e\">" + L.methods + "</h2>" + methodsHtml : "") +
          "<p style=\"margin-top:28px;color:#6b7280;font-size:13px\">" + L.regards + "</p>" +
          "</div>";

        sendWithRetry(new MailerMessage({
          from: { address: senderAddress, name: senderName },
          to: [{ address: email }],
          replyTo: [{ address: senderAddress }],
          subject: L.subject,
          html: custHtml
        }), "customer confirmation");
      }
    } catch (custErr) {
      console.log("[requests] customer confirmation failed: " + custErr);
    }
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
