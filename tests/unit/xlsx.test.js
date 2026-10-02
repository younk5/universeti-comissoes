import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx, columnName, escapeXml } from '../../src/server/domain/xlsx.js';

function readZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, uncompressedSize === 0 ? '' : inflateRawSync(compressed).toString('utf8'));
    offset = dataStart + compressedSize;
  }
  return entries;
}

test('xlsx writer produces a valid OOXML package with styled cells', () => {
  const workbook = buildXlsx({
    sheets: [{
      name: 'Vendedores',
      title: 'Vendedores',
      columns: [
        { title: 'Nome', width: 26 },
        { title: 'Comissão', width: 16, type: 'currency' },
      ],
      rows: [['Ana', 129.63], ['Bia & Cia <teste>', 10]],
    }],
  });

  assert.equal(workbook.subarray(0, 2).toString('utf8'), 'PK');

  const entries = readZipEntries(workbook);
  assert.deepEqual([...entries.keys()], [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]);

  assert.match(entries.get('[Content_Types].xml'), /spreadsheetml\.sheet\.main\+xml/);
  assert.match(entries.get('xl/workbook.xml'), /name="Vendedores"/);
  assert.match(entries.get('xl/_rels/workbook.xml.rels'), /Target="styles\.xml"/);
  assert.match(entries.get('xl/styles.xml'), /formatCode="&quot;R\$&quot;\\ #,##0\.00"/);

  const sheet = entries.get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<v>129\.63<\/v>/);
  assert.match(sheet, /Bia &amp; Cia &lt;teste&gt;/);
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /<autoFilter ref="A2:B4"\/>/);
  assert.match(sheet, /<col min="2" max="2" width="16" customWidth="1"\/>/);
});

test('xlsx writer refuses an empty workbook and sanitizes text', () => {
  assert.throws(() => buildXlsx({ sheets: [] }), /ao menos uma aba/);
  assert.equal(escapeXml('a\u0000b'), 'ab');
  assert.equal(escapeXml(`x & 'y' "z" <w>`), 'x &amp; &apos;y&apos; &quot;z&quot; &lt;w&gt;');
});

test('columnName maps indexes to spreadsheet letters', () => {
  assert.equal(columnName(1), 'A');
  assert.equal(columnName(26), 'Z');
  assert.equal(columnName(27), 'AA');
  assert.equal(columnName(52), 'AZ');
  assert.equal(columnName(53), 'BA');
});