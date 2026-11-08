import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx } from '../src/xlsx.js';

// Reads the stored (uncompressed) parts back out of the archive.
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const parts = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    parts[name] = decoder.decode(bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size));
    at += 30 + nameLength + size;
  }
  return parts;
}

const workbook = (rows) => unzip(buildXlsx({
  sheet: 'البلاغات', titles: ['رقم البلاغ', 'الموقع'], rows, widths: [12, 34],
}));

test('the workbook has every part Excel requires and a right-to-left sheet', () => {
  const parts = workbook([[22, 'شارع الكيخيا']]);
  assert.deepEqual(Object.keys(parts).sort(), ['[Content_Types].xml', '_rels/.rels',
    'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  assert.match(parts['xl/worksheets/sheet1.xml'], /rightToLeft="1"/);
  assert.match(parts['xl/workbook.xml'], /name="البلاغات"/);
});

test('numbers stay numbers, text stays exact, and the header is bold', () => {
  const sheet = workbook([[22, 'شارع الكيخيا، زاوية الدهماني']])['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">رقم البلاغ<\/t>/);
  assert.match(sheet, /<c r="A2"><v>22<\/v><\/c>/);
  assert.match(sheet, /<c r="B2" t="inlineStr"><is><t xml:space="preserve">شارع الكيخيا، زاوية الدهماني<\/t>/);
});

test('text cannot break the file or become a formula', () => {
  const sheet = workbook([['=1+1', 'a & b <c> "d"\u0001']])['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<t xml:space="preserve">=1\+1<\/t>/, 'stored as text, so Excel never runs it');
  assert.match(sheet, /a &amp; b &lt;c&gt; &quot;d&quot;<\/t>/);
  assert.doesNotMatch(sheet, /<f>/);
});

test('columns past Z are named the way Excel expects', () => {
  const titles = Array.from({ length: 28 }, (_, index) => `t${index}`);
  const parts = unzip(buildXlsx({ sheet: 's', titles, rows: [], widths: [] }));
  assert.match(parts['xl/worksheets/sheet1.xml'], /r="Z1"/);
  assert.match(parts['xl/worksheets/sheet1.xml'], /r="AB1"/);
});
