// Renders an event's marshal list as a PDF laid out to match
// "EVENT NAME  MARSHALS LIST  Template.xlsx".
//
// The geometry below is taken from that file rather than invented:
//   * Letter 8.5x11, portrait          (printerSettings1.bin: dmPaperSize=1)
//   * margins 0.7in sides, 0.75in top  (pageMargins)
//   * logo 1.43in wide, top-left       (drawing1.xml twoCellAnchor)
//   * columns ROLE / NAME / COUNT in the ratio 25.3 : 48.3 : 8.9
//     (column_dimensions widths), scaled to the printable width
//   * "ITEMHOUND CORPORATION" bold, then EVENT NAME: / VENUE: with the value
//     centered in the NAME column, then a centered "MARSHAL LIST" caption and
//     a bold, centered header row
//
// Fonts: the template is set in Calibri, which is not an ITEMHOUND brand font
// and is not redistributable here. Helvetica is used instead -- the clean
// geometric sans fallback the brand guidelines allow -- so the PDF will not be
// typeset in Inter/Nunito Sans. Swap in an embedded TTF if that matters.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const PAGE = { size: 'LETTER', margins: { left: 50.4, right: 50.4, top: 54, bottom: 54 } };
const CONTENT_W = 612 - PAGE.margins.left - PAGE.margins.right; // 511.2pt

// Column widths in the template's proportions (25.3 : 48.3 : 8.9 of 82.5).
const COLS = (() => {
  const parts = [25.3, 48.3, 8.9];
  const total = parts.reduce((a, b) => a + b, 0);
  const widths = parts.map((p) => (CONTENT_W * p) / total);
  const x = [PAGE.margins.left];
  x.push(x[0] + widths[0]);
  x.push(x[1] + widths[1]);
  return { widths, x, keys: ['role', 'name', 'count'] };
})();

const ROW_H = 17;
const LOGO_W = 103; // 1.434in from the template's drawing anchor
const LOGO_RATIO = 5.799; // the approved full-logo aspect ratio, never stretched

// Prefers the print-sized copy of the approved logo (620x107, a uniform
// downscale of the 3700x638 original) -- pdfkit embeds the source bytes as-is,
// so using the full-resolution file would add ~500KB to every export. Falls
// back to the full-resolution asset if the print copy is missing.
function findLogo() {
  const roots = [
    path.join(__dirname, '..', 'public', 'img'),
    path.join(__dirname, '..', '..', 'public', 'img'),
    path.join(process.cwd(), 'public', 'img'),
  ];
  for (const root of roots) {
    for (const file of ['itemhound-logo-print.png', 'itemhound-logo-color.png']) {
      const c = path.join(root, file);
      try { if (fs.existsSync(c)) return c; } catch (err) { /* keep looking */ }
    }
  }
  return null;
}

/** "2026-09-13" -> "20260913", matching the template's filename convention. */
function compactDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (m) return m[1] + m[2] + m[3];
  const d = new Date(date);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function sanitizeFilePart(str) {
  return String(str || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Download filename, e.g. "20260913 RUN FOR A CAUSE MANILA MARSHALS LIST.pdf" */
function fileNameFor(event) {
  const parts = [compactDate(event.date), sanitizeFilePart(event.name).toUpperCase(), 'MARSHALS LIST'];
  return parts.filter(Boolean).join(' ') + '.pdf';
}

/**
 * Flattens assignments into template rows. Roles with nobody assigned are
 * skipped, matching Generate Announcement. COUNT restarts at 1 for each role,
 * which is how the announcement numbers its names too.
 */
function buildRows(event, allRoles) {
  const rows = [];
  for (const role of allRoles) {
    const assigned = (event.assignments && event.assignments[role]) || [];
    assigned.forEach((a, i) => {
      const note = (a.note || '').trim();
      // Staff off the employee_list roster are marked so the printed lineup
      // distinguishes them from marshals who signed up.
      const tag = a.kind === 'employee' ? ' (EMPLOYEE)' : '';
      rows.push({
        role: role.toUpperCase(),
        name: String(a.name || '').toUpperCase() + tag + (note ? ` - ${note.toUpperCase()}` : ''),
        count: String(i + 1),
      });
    });
  }
  return rows;
}

function drawRow(doc, cells, y, { bold = false, size = 9.5 } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  COLS.keys.forEach((key, i) => {
    const text = cells[key] === undefined ? '' : String(cells[key]);
    if (!text) return;
    doc.text(text, COLS.x[i] + 2, y, {
      width: COLS.widths[i] - 4,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
  });
}

function drawTableHeader(doc, y) {
  drawRow(doc, { role: 'ROLE', name: 'NAME', count: 'COUNT' }, y, { bold: true, size: 10 });
  return y + ROW_H;
}

/**
 * Writes the PDF for `event` into `stream`.
 * @param {object} event   an Event.toCard() shaped object
 * @param {string[]} allRoles  role order to render in
 * @param {stream.Writable} stream
 */
function renderMarshalListPdf(event, allRoles, stream) {
  const doc = new PDFDocument({
    size: PAGE.size,
    layout: 'portrait',
    margins: PAGE.margins,
    info: {
      Title: `${event.name} - Marshals List`,
      Author: 'ITEMHOUND Corporation',
      Subject: 'Marshal lineup',
    },
  });
  doc.pipe(stream);

  let y = PAGE.margins.top;

  // ---- Logo (height derived from width so the artwork cannot distort) ----
  const logo = findLogo();
  if (logo) {
    doc.image(logo, PAGE.margins.left, y, { width: LOGO_W });
    y += LOGO_W / LOGO_RATIO + 12;
  }

  // ---- Header block ----
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#630A1F');
  doc.text('ITEMHOUND CORPORATION', PAGE.margins.left, y, { width: CONTENT_W, align: 'left' });
  y += ROW_H + 6;

  doc.fillColor('#25363E');
  const headerLines = [
    ['EVENT NAME:', String(event.name || '').toUpperCase()],
    ['VENUE:', String(event.location || '').toUpperCase()],
  ];
  for (const [label, value] of headerLines) {
    doc.font('Helvetica-Bold').fontSize(9.5);
    doc.text(label, COLS.x[0] + 2, y, { width: COLS.widths[0] - 4, align: 'left', lineBreak: false });
    doc.font('Helvetica').fontSize(9.5);
    doc.text(value, COLS.x[1] + 2, y, { width: COLS.widths[1] - 4, align: 'center' });
    // A long venue can wrap, so advance by whatever the value actually used.
    y += Math.max(ROW_H, doc.heightOfString(value, { width: COLS.widths[1] - 4 }) + 3);
  }

  y += ROW_H; // the template's blank row 6

  // ---- "MARSHAL LIST" caption, centered over the NAME column ----
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('MARSHAL LIST', COLS.x[1] + 2, y, { width: COLS.widths[1] - 4, align: 'center' });
  y += ROW_H + 2;

  // ---- Table ----
  y = drawTableHeader(doc, y);

  const rows = buildRows(event, allRoles);
  if (rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#25363E');
    doc.text('No marshals have been assigned to this event yet.', PAGE.margins.left, y + 4, {
      width: CONTENT_W,
      align: 'center',
    });
  } else {
    const bottomLimit = 792 - PAGE.margins.bottom - ROW_H;
    let lastRole = null;
    for (const row of rows) {
      if (y > bottomLimit) {
        doc.addPage();
        y = PAGE.margins.top;
        y = drawTableHeader(doc, y);
        lastRole = null;
      }
      // The template repeats the role on every line of a block; keep that, but
      // add a little air between blocks so it stays scannable.
      if (lastRole !== null && row.role !== lastRole) y += 4;
      drawRow(doc, row, y);
      lastRole = row.role;
      y += ROW_H;
    }
  }

  doc.end();
  return doc;
}

/**
 * Same output, collected into a Buffer. The route uses this so a failure
 * during generation can still return a JSON error -- once bytes have been
 * piped to the response the headers are committed and it is too late.
 */
function renderToBuffer(event, allRoles) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new (require('stream').Writable)({
      write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    try {
      const doc = renderMarshalListPdf(event, allRoles, sink);
      doc.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { renderMarshalListPdf, renderToBuffer, fileNameFor, buildRows };
