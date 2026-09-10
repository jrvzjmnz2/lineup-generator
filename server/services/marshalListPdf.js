// Renders an event's marshal list as a PDF, laid out after
// "EVENT NAME  MARSHALS LIST  Template.xlsx".
//
// The template's geometry was read out of that file rather than invented:
//   * Letter 8.5x11, portrait          (printerSettings1.bin: dmPaperSize=1)
//   * margins 0.7in sides, 0.75in top  (pageMargins)
//   * logo 1.43in wide, top-left       (drawing1.xml twoCellAnchor)
//   * "ITEMHOUND CORPORATION" bold, then EVENT NAME: / VENUE: with the value
//     centered, then a centered "MARSHAL LIST" caption and a bold, centered
//     header row over the name column
//
// Two deliberate departures from the template, both asked for:
//
//   1. NOTES GET THEIR OWN COLUMN. The template has three columns
//      (ROLE : NAME : COUNT in the ratio 25.3 : 48.3 : 8.9) and notes used to
//      be jammed into the name cell as "ALFONSO REYES - 42KM", which made the
//      category unreadable down a page and pushed long names past the cell
//      width. Four columns now, re-proportioned; see COLS.
//   2. THE EVENT'S OWN DETAILS ARE PRINTED. The template carried only the
//      name and venue, so a printed list said nothing about call time, gun
//      start or transport. The details block below prints exactly the fields
//      the event's TYPE has -- the same gate the on-screen card and the
//      announcement use -- so a Fulfillment shift never shows a gun start.
//
// Fonts: the template is set in Calibri, which is not an ITEMHOUND brand font
// and is not redistributable here. Helvetica is used instead -- the clean
// geometric sans fallback the brand guidelines allow -- so the PDF is not
// typeset in Inter/Nunito Sans. Swap in an embedded TTF if that matters.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const PAGE = { size: 'LETTER', margins: { left: 50.4, right: 50.4, top: 54, bottom: 54 } };
const PAGE_H = 792;
const CONTENT_W = 612 - PAGE.margins.left - PAGE.margins.right; // 511.2pt

// Brand palette. These four are the only colours in the document.
const MAROON = '#630A1F';
const SLATE = '#25363E';
const GRAY = '#D9D9D9';

// Four columns, keeping the template's feel: a wide NAME, a narrow COUNT, and
// the NOTE taking its width out of what NAME used to have. The template's
// 25.3 : 48.3 : 8.9 becomes 23 : 36 : 22 : 9.
const COLS = (() => {
  const parts = [23, 36, 22, 9];
  const total = parts.reduce((a, b) => a + b, 0);
  const widths = parts.map((p) => (CONTENT_W * p) / total);
  const x = [];
  let acc = PAGE.margins.left;
  for (const w of widths) { x.push(acc); acc += w; }
  return { widths, x, keys: ['role', 'name', 'note', 'count'] };
})();

const ROW_H = 17;
const CELL_PAD = 4;
const LOGO_W = 103; // 1.434in from the template's drawing anchor
const LOGO_RATIO = 5.799; // the approved full-logo aspect ratio, never stretched

// The event-detail fields, in the order the announcement uses so the two
// outputs read the same way. Which of these actually print is decided per
// event by its type -- see `owns()` in renderMarshalListPdf.
const DETAIL_FIELDS = [
  ['teamLeader', 'Team Lead'],
  ['offsiteSupport', 'Off Site Support'],
  ['categories', 'Categories'],
  ['lanes', 'No. of Lanes'],
  ['gunstart', 'Gun Start'],
  ['callTime', 'Call Time'],
  ['maxRunners', 'Max Runners'],
  ['meals', 'Meals'],
];

// Logistics, minus the rate.
//
// `rate` is deliberately NOT printed. It is the one commercially sensitive
// field on an event, and this PDF is made to be printed and handed round a
// venue. It stays visible in the app and in the announcement, which go to the
// team rather than onto a clipboard. Adding it here is a one-line change if
// that is ever wanted.
const LOGISTICS_PRINTED = [
  ['transpo', 'Transportation'],
  ['driver', 'Driver'],
  ['driverNumber', 'Contact Number'],
];

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

/**
 * "Sunday, September 13, 2026".
 *
 * Built from the date parts, never `new Date(str)`: a bare calendar date parses
 * as UTC midnight and renders the PREVIOUS day anywhere west of UTC -- the same
 * trap server/config/schedule.js exists to avoid. Prefers the day name the
 * server already derived.
 */
function longDate(event) {
  const raw = String(event.date || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw.toUpperCase();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return raw.toUpperCase();
  const day = event.dayName || d.toLocaleDateString('en-US', { weekday: 'long' });
  const rest = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${day}, ${rest}`.toUpperCase();
}

function sanitizeFilePart(str) {
  return String(str || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Download filename, e.g. "20260913 RUN FOR A CAUSE MANILA MARSHALS LIST.pdf" */
function fileNameFor(event) {
  const parts = [compactDate(event.date), sanitizeFilePart(event.name).toUpperCase(), 'MARSHALS LIST'];
  return parts.filter(Boolean).join(' ') + '.pdf';
}

const clean = (v) => String(v === null || v === undefined ? '' : v).trim();

/** "42KM|21KM|10KM" -> "42KM | 21KM | 10KM" -- the pipes need room to breathe. */
const spacePipes = (v) => clean(v).replace(/\s*\|\s*/g, ' | ');

/**
 * Flattens assignments into table rows. Roles with nobody assigned are skipped,
 * matching Generate Announcement, so the PDF reads as the lineup rather than as
 * a worksheet. COUNT restarts at 1 for each role.
 *
 * The note is its own field now rather than being appended to the name.
 */
function buildRows(event, allRoles) {
  const rows = [];
  for (const role of allRoles) {
    const assigned = (event.assignments && event.assignments[role]) || [];
    assigned.forEach((a, i) => {
      // Staff off the employee_list roster are marked so the printed lineup
      // distinguishes them from marshals who signed up. This rides with the
      // NAME, not the note -- it is who someone is, not what they are doing.
      const tag = a.kind === 'employee' ? ' (EMPLOYEE)' : '';
      rows.push({
        role: role.toUpperCase(),
        name: clean(a.name).toUpperCase() + tag,
        note: clean(a.note).toUpperCase(),
        count: String(i + 1),
      });
    });
  }
  return rows;
}

/**
 * Draws one table row and returns the height it used.
 *
 * Cells WRAP rather than being clipped. The old renderer passed
 * `lineBreak: false, ellipsis: true`, which silently truncated anything too
 * long -- and the NAME column is narrower now that NOTE has taken a share of
 * it, so "ADRIAN STEPHEN DE LOS REYES (EMPLOYEE)" would have lost its tail.
 * Height comes from the tallest cell, measured before anything is drawn.
 */
function drawRow(doc, cells, y, { bold = false, size = 9.5 } = {}) {
  const font = bold ? 'Helvetica-Bold' : 'Helvetica';
  doc.font(font).fontSize(size).fillColor(SLATE);

  let tallest = 0;
  COLS.keys.forEach((key, i) => {
    const text = clean(cells[key]);
    if (!text) return;
    tallest = Math.max(tallest, doc.heightOfString(text, { width: COLS.widths[i] - CELL_PAD * 2 }));
  });
  const rowH = Math.max(ROW_H, tallest + 6);

  COLS.keys.forEach((key, i) => {
    const text = clean(cells[key]);
    if (!text) return;
    doc.text(text, COLS.x[i] + CELL_PAD, y + 3, {
      width: COLS.widths[i] - CELL_PAD * 2,
      align: 'center',
    });
  });
  return rowH;
}

/** Bold header row plus a hairline under it -- four columns need the rule. */
function drawTableHeader(doc, y) {
  const h = drawRow(doc, { role: 'ROLE', name: 'NAME', note: 'NOTE', count: 'COUNT' }, y, { bold: true, size: 10 });
  const ruleY = y + h - 2;
  doc.moveTo(PAGE.margins.left, ruleY)
    .lineTo(PAGE.margins.left + CONTENT_W, ruleY)
    .lineWidth(0.8).strokeColor(SLATE).stroke();
  return ruleY + 5;
}

/**
 * Small maroon caption over a hairline, for EVENT DETAILS / LOGISTICS.
 *
 * No `characterSpacing`: letterspacing looks right but makes the glyphs
 * separate words to a text extractor, so the caption copies out of the PDF as
 * "E V E N T D E TA I L S". Bold, small and maroon carries it on its own.
 */
function drawCaption(doc, text, y) {
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MAROON);
  doc.text(String(text).toUpperCase(), PAGE.margins.left, y, {
    width: CONTENT_W,
    lineBreak: false,
  });
  const ruleY = y + 11;
  doc.moveTo(PAGE.margins.left, ruleY)
    .lineTo(PAGE.margins.left + CONTENT_W, ruleY)
    .lineWidth(0.6).strokeColor(GRAY).stroke();
  return ruleY + 7;
}

/**
 * Two-column grid of LABEL: value pairs. Returns the y it finished at.
 * Values wrap, and the row advances by the taller of the pair.
 */
function drawDetailGrid(doc, pairs, y) {
  const colW = CONTENT_W / 2;
  const labelW = 94;
  const valueW = colW - labelW - 10;
  let rowY = y;

  for (let i = 0; i < pairs.length; i += 2) {
    const pair = pairs.slice(i, i + 2);
    let tallest = 0;
    pair.forEach(([label, value], k) => {
      const x = PAGE.margins.left + k * colW;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE);
      doc.text(`${String(label).toUpperCase()}:`, x, rowY + 1, { width: labelW, lineBreak: false });
      doc.font('Helvetica').fontSize(9.5).fillColor(SLATE);
      doc.text(String(value), x + labelW, rowY, { width: valueW });
      tallest = Math.max(tallest, doc.heightOfString(String(value), { width: valueW }));
    });
    rowY += Math.max(14, tallest + 4);
  }
  return rowY;
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

  // Does this event's TYPE carry this field? Same gate as the card and the
  // announcement: an event that was re-typed can still hold a value in a
  // field its type doesn't have, and printing it would contradict the card.
  // `typeFields` is absent on an older payload or a bare fixture, in which
  // case every field is allowed through and blank-dropping decides.
  const owns = (field) => !event.typeFields || event.typeFields.includes(field);

  let y = PAGE.margins.top;

  // ---- Logo (height derived from width so the artwork cannot distort) ----
  const logo = findLogo();
  if (logo) {
    doc.image(logo, PAGE.margins.left, y, { width: LOGO_W });
    y += LOGO_W / LOGO_RATIO + 12;
  }

  // ---- Header block ----
  doc.font('Helvetica-Bold').fontSize(11).fillColor(MAROON);
  doc.text('ITEMHOUND CORPORATION', PAGE.margins.left, y, { width: CONTENT_W, align: 'left' });
  y += ROW_H + 6;

  doc.fillColor(SLATE);
  const headerLines = [['EVENT NAME:', clean(event.name).toUpperCase()]];
  if (event.eventType) headerLines.push(['EVENT TYPE:', clean(event.eventType).toUpperCase()]);
  headerLines.push(['DATE:', longDate(event)]);
  headerLines.push(['VENUE:', clean(event.location).toUpperCase()]);

  // Values are centered, as the template centers them -- but on the FULL
  // content width, which is the page's own axis. The template centered over
  // its NAME column because that was the middle of a three-column table;
  // with four columns that same spot sits noticeably right of centre and
  // reads as a mistake rather than a choice. The MARSHAL LIST caption below
  // uses the same axis, so the whole title block lines up on one centre.
  const centerX = PAGE.margins.left + COLS.widths[0];
  const centerW = CONTENT_W - COLS.widths[0] * 2;
  for (const [label, value] of headerLines) {
    doc.font('Helvetica-Bold').fontSize(9.5);
    doc.text(label, COLS.x[0] + CELL_PAD, y, { width: COLS.widths[0] - CELL_PAD * 2, align: 'left', lineBreak: false });
    doc.font('Helvetica').fontSize(9.5);
    doc.text(value, centerX, y, { width: centerW, align: 'center' });
    // A long venue or event name can wrap, so advance by what it actually used.
    y += Math.max(ROW_H, doc.heightOfString(value, { width: centerW }) + 3);
  }

  y += 10;

  // ---- Event details ----
  // Values are uppercased to match the header block and the table -- the whole
  // document is set in caps, and a mixed-case details grid in the middle of it
  // reads as a different document pasted in.
  const details = DETAIL_FIELDS
    .filter(([field]) => owns(field) && clean(event[field]) !== '')
    .map(([field, label]) => [
      label,
      (field === 'categories' || field === 'gunstart' ? spacePipes(event[field]) : clean(event[field])).toUpperCase(),
    ]);

  if (details.length) {
    y = drawCaption(doc, 'Event Details', y);
    y = drawDetailGrid(doc, details, y);
    y += 8;
  }

  // ---- Logistics (Timing events only; never the rate) ----
  const logistics = LOGISTICS_PRINTED
    .filter(([field]) => owns(field) && clean(event[field]) !== '')
    .map(([field, label]) => [label, clean(event[field]).toUpperCase()]);

  if (logistics.length) {
    y = drawCaption(doc, 'Logistics', y);
    y = drawDetailGrid(doc, logistics, y);
    y += 8;
  }

  // ---- "MARSHAL LIST" caption, on the same centre as the title block ----
  doc.font('Helvetica-Bold').fontSize(11).fillColor(SLATE);
  doc.text('MARSHAL LIST', PAGE.margins.left, y, { width: CONTENT_W, align: 'center' });
  y += ROW_H + 2;

  // ---- Table ----
  y = drawTableHeader(doc, y);

  const rows = buildRows(event, allRoles);
  const bottomLimit = PAGE_H - PAGE.margins.bottom;

  if (rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(SLATE);
    doc.text('No marshals have been assigned to this event yet.', PAGE.margins.left, y + 4, {
      width: CONTENT_W,
      align: 'center',
    });
  } else {
    let lastRole = null;
    for (const row of rows) {
      // Measure before committing to the page: a wrapped name can make a row
      // tall enough to cross the margin that a fixed ROW_H check would miss.
      doc.font('Helvetica').fontSize(9.5);
      let needed = ROW_H;
      COLS.keys.forEach((key, i) => {
        const text = clean(row[key]);
        if (text) needed = Math.max(needed, doc.heightOfString(text, { width: COLS.widths[i] - CELL_PAD * 2 }) + 6);
      });

      if (y + needed > bottomLimit) {
        doc.addPage();
        y = PAGE.margins.top;
        // Name the event on continuation pages -- a loose second sheet is
        // otherwise an anonymous table of names.
        doc.font('Helvetica-Bold').fontSize(9).fillColor(SLATE);
        doc.text(`${clean(event.name).toUpperCase()} — MARSHAL LIST (CONT.)`, PAGE.margins.left, y, {
          width: CONTENT_W,
          align: 'left',
          lineBreak: false,
        });
        y += ROW_H + 4;
        y = drawTableHeader(doc, y);
        lastRole = null;
      }

      // The template repeats the role on every line of a block; keep that, but
      // add a little air between blocks so it stays scannable.
      if (lastRole !== null && row.role !== lastRole) y += 4;
      y += drawRow(doc, row, y);
      lastRole = row.role;
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
