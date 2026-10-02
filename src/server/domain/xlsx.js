import { deflateRawSync } from 'node:zlib';

const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const invalidXmlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = crcTable[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = toBuffer(entry.data);
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(invalidXmlCharacters, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function columnName(index) {
  let name = '';
  let value = Number(index);
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function contentTypes(sheets) {
  const sheetOverrides = sheets.map((_sheet, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('');
  return `${xmlDeclaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheetOverrides
    + '</Types>';
}

function rootRels() {
  return `${xmlDeclaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
}

function workbookXml(sheets) {
  const entries = sheets.map((sheet, index) => (
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join('');
  return `${xmlDeclaration}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${entries}</sheets>`
    + '</workbook>';
}

function workbookRels(sheets) {
  const entries = sheets.map((_sheet, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join('');
  const stylesId = `rId${sheets.length + 1}`;
  return `${xmlDeclaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + entries
    + `<Relationship Id="${stylesId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>';
}

function stylesXml() {
  return `${xmlDeclaration}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<numFmts count="2">'
    + '<numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/>'
    + '<numFmt numFmtId="165" formatCode="#,##0"/>'
    + '</numFmts>'
    + '<fonts count="4">'
    + '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="14"/><color rgb="FF3730A3"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><sz val="11"/><color rgb="FF5B6472"/><name val="Calibri"/><family val="2"/></font>'
    + '</fonts>'
    + '<fills count="4">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF0FF"/><bgColor indexed="64"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="2">'
    + '<border><left/><right/><top/><bottom/><diagonal/></border>'
    + '<border>'
    + '<left style="thin"><color rgb="FFE3E6EE"/></left>'
    + '<right style="thin"><color rgb="FFE3E6EE"/></right>'
    + '<top style="thin"><color rgb="FFE3E6EE"/></top>'
    + '<bottom style="thin"><color rgb="FFE3E6EE"/></bottom>'
    + '<diagonal/></border>'
    + '</borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="7">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

function cellXml({ reference, style, value, numeric }) {
  if (numeric) return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet) {
  const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const titleRowIndex = sheet.title ? 1 : 0;
  const headerRowIndex = titleRowIndex + 1;

  const titleXml = sheet.title
    ? `<row r="1" ht="24" customHeight="1">${cellXml({
      reference: 'A1',
      style: 1,
      value: sheet.title,
      numeric: false,
    })}</row>`
    : '';

  const headerXml = columns.length
    ? `<row r="${headerRowIndex}" ht="22" customHeight="1">${columns.map((column, index) => cellXml({
      reference: `${columnName(index + 1)}${headerRowIndex}`,
      style: 2,
      value: column.title,
      numeric: false,
    })).join('')}</row>`
    : '';

  const dataXml = rows.map((row, rowIndex) => {
    const rowNumber = headerRowIndex + 1 + rowIndex;
    const cells = columns.map((column, columnIndex) => {
      const value = Array.isArray(row) ? row[columnIndex] : undefined;
      if (value === null || value === undefined || value === '') return '';
      const reference = `${columnName(columnIndex + 1)}${rowNumber}`;
      if (typeof value === 'number' && Number.isFinite(value)) {
        const style = column.type === 'currency' ? 4 : (column.type === 'integer' ? 5 : 3);
        return cellXml({ reference, style, value, numeric: true });
      }
      return cellXml({ reference, style: 3, value, numeric: false });
    }).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');

  const colsXml = columns.length
    ? `<cols>${columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 16}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const lastColumn = columnName(Math.max(columns.length, 1));
  const autoFilterXml = (columns.length && rows.length)
    ? `<autoFilter ref="A${headerRowIndex}:${lastColumn}${headerRowIndex + rows.length}"/>`
    : '';

  return `${xmlDeclaration}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<sheetViews><sheetView workbookViewId="0">'
    + `<pane ySplit="${headerRowIndex}" topLeftCell="A${headerRowIndex + 1}" activePane="bottomLeft" state="frozen"/>`
    + '</sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + colsXml
    + `<sheetData>${titleXml}${headerXml}${dataXml}</sheetData>`
    + autoFilterXml
    + '</worksheet>';
}

export function buildXlsx({ sheets = [] } = {}) {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('A planilha precisa de ao menos uma aba.');
  }
  const parts = [
    { name: '[Content_Types].xml', data: contentTypes(sheets) },
    { name: '_rels/.rels', data: rootRels() },
    { name: 'xl/workbook.xml', data: workbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels(sheets) },
    { name: 'xl/styles.xml', data: stylesXml() },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: sheetXml(sheet),
    })),
  ];
  return zip(parts);
}