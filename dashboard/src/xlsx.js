// A small Excel workbook writer: one right-to-left sheet with a bold header row.
// A real .xlsx rather than CSV, because Excel splits CSV by the computer's regional
// list separator, which is ";" on Libyan settings: a comma file lands in one column.
// An xlsx file is a zip archive; these parts need no compression, so none is applied.

const encoder = new TextEncoder();

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const header = (size) => { const bytes = new Uint8Array(size); return [bytes, new DataView(bytes.buffer)]; };
  for (const [name, text] of files) {
    const path = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const [local, l] = header(30);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true); // Names are UTF-8.
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, path.length, true);
    chunks.push(local, path, data);
    const [entry, c] = header(46);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, path.length, true);
    c.setUint32(42, offset, true);
    central.push(entry, path);
    offset += local.length + path.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const [end, e] = header(22);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  const parts = [...chunks, ...central, end];
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}

// Characters XML forbids are dropped, so a stray one in a description cannot break the file.
const escapeXml = (value) => String(value)
  .replace(/[^\u0009\u000a\u000d -퟿-�]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function column(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function cell(value, row, col, style) {
  const ref = `${column(col)}${row}`;
  const attribute = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${attribute}><v>${value}</v></c>`;
  return `<c r="${ref}"${attribute} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value ?? '')}</t></is></c>`;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// `titles` is the header row, `rows` holds the values, `widths` the column widths in characters.
export function buildXlsx({ sheet, titles, rows, widths }) {
  const all = [titles, ...rows];
  const data = all.map((values, r) => `<row r="${r + 1}">${values
    .map((value, c) => cell(value, r + 1, c, r === 0 ? 1 : 0)).join('')}</row>`).join('');
  const cols = widths.map((width, c) => `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`).join('');
  return zip([
    ['[Content_Types].xml', `${XML}<Types xmlns="${PACKAGE}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PACKAGE}/relationships"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${OFFICE}"><sheets><sheet name="${escapeXml(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PACKAGE}/relationships"><Relationship Id="rId1" Type="${OFFICE}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OFFICE}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `${XML}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`],
    ['xl/worksheets/sheet1.xml', `${XML}<worksheet xmlns="${MAIN}"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>`],
  ]);
}
