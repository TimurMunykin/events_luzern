'use strict';

// The HTTP download and the email attachment use exactly the same document.
const fs = require('node:fs');
const path = require('node:path');
const qrCode = require('./vendor/qrcode-generator-1.4.4.js');
const assets = path.resolve(process.argv[2]);
const { jsPDF } = require(path.join(assets, 'ticketing-v22c/vendor/jspdf-4.2.1.umd.min.js'));
const presentation = require(path.join(assets, 'ticketing-v22h/presentation.js'));

function drawQr(doc, url, x, y, size) {
  const code = qrCode(0, 'M');
  code.addData(url);
  code.make();
  const modules = code.getModuleCount();
  const unit = size / (modules + 8);
  doc.setFillColor('#ffffff');
  doc.rect(x, y, size, size, 'F');
  doc.setFillColor('#000000');
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!code.isDark(row, col)) continue;
      const start = col;
      while (col + 1 < modules && code.isDark(row, col + 1)) col++;
      doc.rect(x + (4 + start) * unit, y + (4 + row) * unit, (col - start + 1) * unit, unit, 'F');
    }
  }
}

function ticketPdf(data) {
  const m = presentation.model(data);
  const c = m.copy, p = presentation.palette;
  const width = 148, height = 264, padding = 14;
  const doc = new jsPDF({ unit: 'mm', format: [width, height], orientation: 'portrait', compress: true });
  const fontFiles = { Inter: 'ticketing-v22c/vendor/Inter.ttf', Oswald: 'ticketing-v22d/vendor/Oswald-SemiBold.ttf' };
  for (const [name, file] of Object.entries(fontFiles)) {
    doc.addFileToVFS(name + '.ttf', fs.readFileSync(path.join(assets, file)).toString('base64'));
    doc.addFont(name + '.ttf', name, 'normal');
  }
  let y;
  function page() {
    doc.setFillColor(p.background);
    doc.rect(0, 0, width, height, 'F');
    doc.setFillColor(p.navy);
    doc.roundedRect(5, 5, width - 10, height - 10, 5, 5, 'F');
    y = 15;
  }
  function room(size) {
    if (y + size > height - padding) { doc.addPage(); page(); }
  }
  function text(value, { size = 10, font = 'Inter', color = p.cream, gap = 4, link } = {}) {
    doc.setFont(font);
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lineHeight = size * 0.48;
    for (const line of doc.splitTextToSize(String(value), width - 2 * padding)) {
      room(lineHeight);
      doc.text(line, width / 2, y, { align: 'center', baseline: 'top' });
      if (link) doc.link(padding, y, width - 2 * padding, lineHeight, { url: link });
      y += lineHeight;
    }
    y += gap;
  }
  page();
  doc.setFont('Inter');
  doc.setFontSize(9);
  doc.setTextColor(p.cream);
  doc.text(c.ticket, padding, y, { baseline: 'top' });
  doc.setTextColor(p.gold);
  doc.text('№ ' + m.number, width - padding, y, { align: 'right', baseline: 'top' });
  doc.addImage(fs.readFileSync(path.join(assets, 'events-luzern-icon-blue.png')), 'PNG', width / 2 - 10, 24, 20, 20);
  y = 45;
  text(m.event.name.toUpperCase(), { size: 36, font: 'Oswald', color: p.gold, gap: 5 });
  text(c.guest, { size: 9, gap: 1 });
  text(m.name.toUpperCase(), { size: 15, gap: 6 });
  text(m.time, { size: 11, gap: 3 });
  text(m.event.venue, { size: 9, gap: 1 });
  text(m.event.address, { size: 8, gap: 7, link: m.map });

  room(79);
  doc.setFillColor(p.paper);
  doc.roundedRect(width / 2 - 31, y, 62, 72, 4, 4, 'F');
  drawQr(doc, m.url, width / 2 - 28, y + 3, 56);
  doc.link(width / 2 - 31, y, 62, 72, { url: m.url });
  doc.setFont('Inter');
  doc.setFontSize(11);
  doc.setTextColor(p.inkGold);
  doc.text('№ ' + m.number, width / 2, y + 63, { align: 'center', baseline: 'top' });
  y += 76;
  text(c.show, { size: 8, gap: 1 });
  text(c.admission, { size: 8, gap: 5 });
  if (m.checkedIn) text(c.used, { size: 9, color: p.gold });
  for (const [label, detail] of [[c.entry, m.entry], [c.bring, m.bring]]) {
    if (!detail) continue;
    room(16);
    text(label, { size: 8, color: p.gold, gap: 1 });
    text(detail, { size: 9, gap: 5 });
  }
  room(17);
  text(c.contact, { size: 8, gap: 1 });
  text('info@events-luzern.ch', { size: 8, gap: 4, link: 'mailto:info@events-luzern.ch' });
  text('@events.luzern', { size: 8, color: p.gold, gap: 0 });
  doc.setProperties({ title: m.event.name + ' · ' + c.title + ' № ' + m.number, author: 'Events.Luzern' });
  return Buffer.from(doc.output('arraybuffer'));
}

process.stdout.write(ticketPdf(JSON.parse(fs.readFileSync(0, 'utf8'))));
