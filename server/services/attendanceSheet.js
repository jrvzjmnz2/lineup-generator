// Attendance sheet export: fills the team's own Excel template
// (server/templates/attendance-sheet.xlsx) with an event's lineup.
//
// Filled in:  Event (I3), Date (N3), and one row per assignment --
//             FULL NAME (A) and Assignment (D, the role they hold on this
//             event). Someone holding two roles gets two rows, the same way
//             the PDF marshal list reads.
// Left blank: CONTACT NO., TIME IN, TIME OUT, HOURS OF WORK, SIGNATURE,
//             AMOUNT, Approved By, Paid By, TOTAL -- filled on the day.
//
// The template carries the ITEMHOUND colours (maroon title and rule, slate
// header bar, Arial; no logo -- removed at the user's request) -- see the
// build notes for how it was made. Nothing here depends on those colours,
// only on the cell layout. A drawing/logo in the template is optional: if
// one is present it is copied onto every day-sheet.
//
// The template is edited at the XML level rather than rebuilt with a
// spreadsheet library, so its fonts, borders, merged cells, column widths,
// page setup and the header rule survive exactly as the team designed them.
//
// A consecutive-day event gets ONE SHEET PER DAY (tabs "Wed 9-16",
// "Thu 9-17", ...) with the same names on each, since time in/out and the
// signature are recorded per day.
//
// The template has 18 name rows (6-23). A longer lineup inserts extra rows
// above the last one, copying a body row's formatting, so the thick bottom
// border and the Approved By / TOTAL footer stay at the end.
const fs = require('fs');
const path = require('path');
const { readZip, writeZip } = require('./zip');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'attendance-sheet.xlsx');
const FIRST_ROW = 6;
const LAST_ROW = 23; // thick bottom border; row 24 is the footer
const TEMPLATE_ROWS = LAST_ROW - FIRST_ROW + 1; // 18
const CLONE_ROW = 22; // a plain body row, copied when more rows are needed
const ROW_MERGES = [['A', 'C'], ['D', 'E'], ['F', 'G'], ['H', 'I'], ['L', 'M'], ['N', 'O']];

const SHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const DRAWING_CT = 'application/vnd.openxmlformats-officedocument.drawing+xml';
const REL_SHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

let templateCache = null;
function loadTemplate() {
  if (!templateCache) {
    const entries = readZip(fs.readFileSync(TEMPLATE_PATH));
    templateCache = new Map(entries.map((e) => [e.name, e.data]));
    templateCache.order = entries.map((e) => e.name);
  }
  return templateCache;
}

// Characters XML 1.0 can't carry at all are dropped; the rest are escaped.
function xmlText(str) {
  return String(str == null ? '' : str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- dates (bare "YYYY-MM-DD" strings, parsed by parts -- see schedule.js) ----
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDay(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return d;
}

/** The days to make sheets for: every day from date to endDate, or just date. */
function eventDays(event) {
  const start = parseDay(event.date);
  if (!start) return [null]; // unreadable date: one sheet, date written as text
  const end = parseDay(event.endDate);
  const days = [];
  const last = end && end > start ? end : start;
  for (let t = start.getTime(); t <= last.getTime() && days.length < 31; t += 86400000) days.push(new Date(t));
  return days;
}

// Excel stores a date as days since 1899-12-30; the template's Date cell is
// formatted as a date (numFmt 14), so it gets a real date, not text.
const excelSerial = (d) => d.getTime() / 86400000 + 25569;
const sheetNameFor = (d) => (d ? `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCMonth() + 1}-${d.getUTCDate()}` : 'Attendance');

// ---- shared strings ------------------------------------------------------
function makeStringTable(sstXml) {
  const existing = (sstXml.match(/<si>/g) || []).length;
  const added = [];
  const index = new Map();
  let refs = 0;
  return {
    idx(text) {
      refs += 1;
      if (!index.has(text)) {
        index.set(text, existing + added.length);
        added.push(text);
      }
      return index.get(text);
    },
    xml(sheetCount) {
      const templateRefs = Number((/count="(\d+)"/.exec(sstXml) || [])[1] || existing);
      const count = templateRefs * sheetCount + refs;
      const extra = added.map((t) => `<si><t xml:space="preserve">${xmlText(t)}</t></si>`).join('');
      return sstXml
        .replace(/count="\d+"/, `count="${count}"`)
        .replace(/uniqueCount="\d+"/, `uniqueCount="${existing + added.length}"`)
        .replace('</sst>', `${extra}</sst>`);
    },
  };
}

// ---- shrink-to-fit copies of the name/role cell styles --------------------
//
// The template's name cells are 12pt Times New Roman, centred, no wrap, in a
// 3-column merge -- "MA. ANGELICA TALABUCON" already runs off both edges and
// longer names lose more. Filled cells get a copy of their own style with
// shrinkToFit added, so a long name shrinks to fit its box while everything
// that already fits looks exactly as the template does. Blank rows keep the
// original styles untouched.
function makeShrinkStyles(stylesXml) {
  const m = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!m) return { id: (s) => s, xml: () => stylesXml };
  const xfs = m[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
  const added = [];
  const map = new Map();
  return {
    id(styleId) {
      if (styleId == null || !xfs[styleId]) return styleId;
      if (!map.has(styleId)) {
        let xf = xfs[styleId];
        if (/<alignment\b/.test(xf)) {
          xf = xf.replace(/<alignment\b([^>]*?)\s*\/>/, (a, attrs) => `<alignment${attrs.replace(/\s*shrinkToFit="\d"/, '')} shrinkToFit="1"/>`);
        } else if (/\/>$/.test(xf)) {
          xf = xf.replace(/\s*\/>$/, ' applyAlignment="1"><alignment shrinkToFit="1"/></xf>');
        } else {
          // <alignment> must come before <protection> inside an <xf>.
          xf = /<protection\b/.test(xf)
            ? xf.replace(/<protection\b/, '<alignment shrinkToFit="1"/><protection')
            : xf.replace(/<\/xf>$/, '<alignment shrinkToFit="1"/></xf>');
        }
        map.set(styleId, xfs.length + added.length);
        added.push(xf);
      }
      return map.get(styleId);
    },
    xml() {
      if (!added.length) return stylesXml;
      return stylesXml.replace(m[0], `<cellXfs count="${xfs.length + added.length}">${m[2]}${added.join('')}</cellXfs>`);
    },
  };
}

// ---- sheet XML -------------------------------------------------------------
// `restyle(styleId)` optionally swaps the cell's style for another.
function setCell(xml, ref, inner, type, restyle) {
  const re = new RegExp(`<c r="${ref}"(?: s="(\\d+)")?(?: t="\\w+")?\\s*(?:/>|>.*?</c>)`);
  if (!re.test(xml)) throw new Error(`Template cell ${ref} not found`);
  return xml.replace(re, (m, style) => {
    const sId = style == null ? null : Number(style);
    const finalId = restyle ? restyle(sId) : sId;
    return `<c r="${ref}"${finalId == null ? '' : ` s="${finalId}"`}${type ? ` t="${type}"` : ''}>${inner}</c>`;
  });
}
const setString = (xml, ref, idx, restyle) => setCell(xml, ref, `<v>${idx}</v>`, 's', restyle);
const setNumber = (xml, ref, n) => setCell(xml, ref, `<v>${n}</v>`, null);

function renumberRow(rowXml, from, to) {
  return rowXml
    .replace(new RegExp(`<row r="${from}"`), `<row r="${to}"`)
    .replace(new RegExp(`(<c r="[A-Z]+)${from}"`, 'g'), `$1${to}"`);
}

// Adds `extra` rows above the template's last name row.
function growRows(xml, extra) {
  if (extra <= 0) return xml;
  const rowRe = (n) => new RegExp(`<row r="${n}"[^>]*>.*?</row>`);
  const cloneSrc = xml.match(rowRe(CLONE_ROW))[0];

  // Push the last name row and the footer down (highest first).
  for (const n of [LAST_ROW + 1, LAST_ROW]) {
    xml = xml.replace(rowRe(n), (row) => renumberRow(row, n, n + extra));
  }
  const clones = [];
  for (let i = 0; i < extra; i += 1) clones.push(renumberRow(cloneSrc, CLONE_ROW, LAST_ROW + i));
  const afterClone = xml.match(rowRe(CLONE_ROW))[0];
  xml = xml.replace(afterClone, afterClone + clones.join(''));

  // Merged cells: shift those at or below the moved rows, add the new rows' own.
  xml = xml.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g, (m, c1, r1, c2, r2) => {
    const a = Number(r1) >= LAST_ROW ? Number(r1) + extra : Number(r1);
    const b = Number(r2) >= LAST_ROW ? Number(r2) + extra : Number(r2);
    return `<mergeCell ref="${c1}${a}:${c2}${b}"/>`;
  });
  const newMerges = [];
  for (let r = LAST_ROW; r < LAST_ROW + extra; r += 1) {
    for (const [a, b] of ROW_MERGES) newMerges.push(`<mergeCell ref="${a}${r}:${b}${r}"/>`);
  }
  xml = xml.replace(/<mergeCells count="(\d+)">/, (m, n) => `<mergeCells count="${Number(n) + newMerges.length}">`);
  xml = xml.replace('</mergeCells>', `${newMerges.join('')}</mergeCells>`);
  xml = xml.replace(/<dimension ref="A1:O(\d+)"\/>/, (m, n) => `<dimension ref="A1:O${Number(n) + extra}"/>`);
  return xml;
}

function buildSheetXml(templateXml, { eventIdx, day, dateTextIdx, rows, selected, shrink }) {
  let xml = growRows(templateXml, rows.length - TEMPLATE_ROWS);
  xml = setString(xml, 'I3', eventIdx);
  xml = day ? setNumber(xml, 'N3', excelSerial(day)) : (dateTextIdx != null ? setString(xml, 'N3', dateTextIdx) : xml);
  rows.forEach((r, i) => {
    const n = FIRST_ROW + i;
    xml = setString(xml, `A${n}`, r.nameIdx, shrink);
    xml = setString(xml, `D${n}`, r.roleIdx, shrink);
  });
  if (!selected) xml = xml.replace(' tabSelected="1"', '');
  return xml;
}

/**
 * The lineup as attendance rows: one per assignment, in role order (the
 * event's own roles, then any off-type role still holding someone), then the
 * order people were placed in.
 */
function attendanceRows(card, roles) {
  const out = [];
  for (const role of roles) {
    for (const a of (card.assignments || {})[role] || []) {
      const name = String(a.name || '').trim();
      if (name) out.push({ name, role });
    }
  }
  return out;
}

/**
 * card: Event.toCard() output. roles: which roles to include, in order.
 * Returns the .xlsx as a Buffer.
 */
function buildAttendanceWorkbook(card, roles) {
  const tpl = loadTemplate();
  const get = (name) => {
    const data = tpl.get(name);
    if (!data) throw new Error(`Attendance template is missing ${name}`);
    return data.toString('utf8');
  };

  const strings = makeStringTable(get('xl/sharedStrings.xml'));
  const eventIdx = strings.idx(String(card.name || '').trim());
  const people = attendanceRows(card, roles).map((r) => ({ nameIdx: strings.idx(r.name), roleIdx: strings.idx(r.role) }));
  const days = eventDays(card);
  const dateTextIdx = days[0] ? null : (String(card.date || '').trim() ? strings.idx(String(card.date).trim()) : null);

  const sheetTpl = get('xl/worksheets/sheet1.xml');
  const sheetRelsTpl = get('xl/worksheets/_rels/sheet1.xml.rels');
  const drawing = tpl.get('xl/drawings/drawing1.xml');
  // The drawing holds the ITEMHOUND logo; its rels point at the one shared
  // image part (xl/media/image1.png), so each day's drawing reuses it.
  const drawingRels = tpl.get('xl/drawings/_rels/drawing1.xml.rels');
  const printer = tpl.get('xl/printerSettings/printerSettings1.bin');

  const styles = makeShrinkStyles(get('xl/styles.xml'));
  const shrink = (id) => styles.id(id);

  const out = new Map();
  const names = days.map(sheetNameFor);
  days.forEach((day, i) => {
    const n = i + 1;
    out.set(`xl/worksheets/sheet${n}.xml`, buildSheetXml(sheetTpl, { eventIdx, day, dateTextIdx, rows: people, selected: i === 0, shrink }));
    out.set(
      `xl/worksheets/_rels/sheet${n}.xml.rels`,
      sheetRelsTpl.replace('drawing1.xml', `drawing${n}.xml`).replace('printerSettings1.bin', `printerSettings${n}.bin`)
    );
    if (drawing) out.set(`xl/drawings/drawing${n}.xml`, drawing);
    if (drawingRels) out.set(`xl/drawings/_rels/drawing${n}.xml.rels`, drawingRels);
    if (printer) out.set(`xl/printerSettings/printerSettings${n}.bin`, printer);
  });
  out.set('xl/sharedStrings.xml', strings.xml(days.length));
  out.set('xl/styles.xml', styles.xml());

  // Workbook: one <sheet> per day. Sheet 1 keeps the template's rId1.
  const rid = (n) => (n === 1 ? 'rId1' : `rIdDay${n}`);
  let workbook = get('xl/workbook.xml').replace(
    /<sheets>.*?<\/sheets>/,
    `<sheets>${names.map((nm, i) => `<sheet name="${xmlText(nm)}" sheetId="${i + 1}" r:id="${rid(i + 1)}"/>`).join('')}</sheets>`
  );
  // Repeat the title/header rows (1-5) on every printed page, per sheet --
  // a lineup longer than one page keeps its logo and column headings.
  const titles = names
    .map((nm, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xmlText(nm).replace(/'/g, "''")}'!$1:$5</definedName>`)
    .join('');
  workbook = workbook.replace(/<definedNames>.*?<\/definedNames>/, '');
  workbook = workbook.replace('</sheets>', `</sheets><definedNames>${titles}</definedNames>`);
  out.set('xl/workbook.xml', workbook);

  let wbRels = get('xl/_rels/workbook.xml.rels');
  const moreRels = names.slice(1).map((nm, i) => `<Relationship Id="${rid(i + 2)}" Type="${REL_SHEET}" Target="worksheets/sheet${i + 2}.xml"/>`).join('');
  out.set('xl/_rels/workbook.xml.rels', wbRels.replace('</Relationships>', `${moreRels}</Relationships>`));

  let types = get('[Content_Types].xml');
  const moreTypes = [];
  for (let n = 2; n <= days.length; n += 1) {
    moreTypes.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${SHEET_CT}"/>`);
    if (drawing) moreTypes.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="${DRAWING_CT}"/>`);
  }
  out.set('[Content_Types].xml', types.replace('</Types>', `${moreTypes.join('')}</Types>`));

  const app = get('docProps/app.xml')
    .replace(/(<vt:lpstr>Worksheets<\/vt:lpstr><\/vt:variant><vt:variant><vt:i4>)\d+(<\/vt:i4>)/, `$1${names.length}$2`)
    .replace(
      /<TitlesOfParts>.*?<\/TitlesOfParts>/,
      `<TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map((nm) => `<vt:lpstr>${xmlText(nm)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>`
    );
  out.set('docProps/app.xml', app);

  // Everything else (styles, theme, core props, root rels) as-is, in the
  // template's order, with the per-day parts slotted in after their sheet 1.
  const entries = [];
  const seen = new Set();
  const push = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    entries.push({ name, data: out.has(name) ? out.get(name) : tpl.get(name) });
  };
  for (const name of tpl.order) {
    push(name);
    const m = /^(xl\/worksheets\/sheet|xl\/worksheets\/_rels\/sheet|xl\/drawings\/drawing|xl\/drawings\/_rels\/drawing|xl\/printerSettings\/printerSettings)1(\.xml\.rels|\.xml|\.bin)$/.exec(name);
    if (m) for (let n = 2; n <= days.length; n += 1) push(`${m[1]}${n}${m[2]}`);
  }
  return writeZip(entries);
}

/** "Run For A Cause Manila-Attendance Sheet.xlsx" */
function attendanceFileName(card) {
  const base = String(card.name || 'Event')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Event';
  return `${base}-Attendance Sheet.xlsx`;
}

module.exports = { buildAttendanceWorkbook, attendanceFileName, attendanceRows, eventDays };
