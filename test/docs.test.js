'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { zipSync, strToU8 } = require('fflate');
const { extractDocument } = require('../src/docs');

const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

// PDF mínimo válido con una página de texto (calcula el xref a mano).
function tinyPdf(lines) {
  const content = 'BT /F1 12 Tf 72 720 Td ' + lines.map((l, i) => (i ? '0 -16 Td ' : '') + `(${l}) Tj`).join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

test('PDF: saca el texto y las páginas', async () => {
  const r = await extractDocument('req.pdf', tinyPdf(['Requerimiento: login con Google', 'Debe tener tests']));
  assert.strictEqual(r.kind, 'PDF');
  assert.strictEqual(r.pages, 1);
  assert.match(r.text, /login con Google/);
  assert.match(r.text, /Debe tener tests/);
});

test('Word (.docx): párrafos, tabulaciones y tablas', async () => {
  const doc = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
    '<w:p><w:r><w:t>Módulo de pagos</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Usar </w:t></w:r><w:r><w:t>Stripe &amp; PayPal</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Campo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Tipo</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '</w:body></w:document>';
  const r = await extractDocument('req.docx', zip({ 'word/document.xml': doc }));
  assert.strictEqual(r.kind, 'Word');
  assert.match(r.text, /Módulo de pagos\nUsar Stripe & PayPal/);
  assert.match(r.text, /Campo/);
  assert.match(r.text, /Tipo/);
});

test('Excel (.xlsx): celdas con texto compartido y números', async () => {
  const r = await extractDocument('datos.xlsx', zip({
    'xl/sharedStrings.xml': '<sst><si><t>Tarea</t></si><si><t>Horas</t></si><si><t>Login</t></si></sst>',
    'xl/workbook.xml': '<workbook><sheets><sheet name="Backlog" sheetId="1"/></sheets></workbook>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>8</v></c></row></sheetData></worksheet>',
  }));
  assert.match(r.text, /## Hoja: Backlog/);
  assert.match(r.text, /Tarea\tHoras\nLogin\t8/);
});

test('PowerPoint (.pptx): texto por diapositiva, en orden', async () => {
  const r = await extractDocument('demo.pptx', zip({
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Segunda</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Primera</a:t></a:r></a:p></p:sld>',
  }));
  assert.ok(r.text.indexOf('Primera') < r.text.indexOf('Segunda'));
  assert.match(r.text, /## Diapositiva 1/);
});

test('texto, RTF y HTML', async () => {
  const t = await extractDocument('notas.txt', Buffer.from('Hola\r\nequipo', 'utf8'));
  assert.strictEqual(t.text, 'Hola\nequipo');
  const ansi = await extractDocument('viejo.txt', Buffer.from([0x63, 0x61, 0x6d, 0x69, 0xf3, 0x6e])); // «camión» en windows-1252
  assert.strictEqual(ansi.text, 'camión');
  const rtf = await extractDocument('r.rtf', Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Crear la API\\par Con autenticaci\\\'f3n}', 'latin1'));
  assert.match(rtf.text, /Crear la API\n\s*Con autenticación/);
  const html = await extractDocument('r.html', Buffer.from('<html><head><style>x{}</style></head><body><h1>Título</h1><p>Uno &amp; dos</p><script>alert(1)</script></body></html>'));
  assert.match(html.text, /Título\nUno & dos/);
  assert.doesNotMatch(html.text, /alert/);
});

test('imágenes y errores claros', async () => {
  const img = await extractDocument('mockup.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
  assert.strictEqual(img.image, true);
  await assert.rejects(extractDocument('viejo.doc', Buffer.from('xx')), /guárdalo como \.docx/);
  await assert.rejects(extractDocument('roto.docx', Buffer.from('no es un zip')), /dañado/);
  await assert.rejects(extractDocument('vacio.txt', Buffer.alloc(0)), /vacío/);
  await assert.rejects(extractDocument('prog.exe', Buffer.from([0x4d, 0x5a, 0, 0, 1, 2, 3])), /no sé leer/);
});
