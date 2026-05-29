#!/usr/bin/env node
/**
 * List AcroForm field names from a Wastelander character sheet PDF.
 * Usage: node scripts/list-pdf-fields.mjs [path-to.pdf]
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
// PDFs are user-installed (not in repo). Pass path to your local copy.
const defaultPdf = resolve(
  __dirname,
  "../assets/sheets/FO2d20-Human-Character-Sheet_v002m.pdf",
);

const pdfPath = process.argv[2] ? resolve(process.argv[2]) : defaultPdf;
const bytes = readFileSync(pdfPath);
const doc = await PDFDocument.load(bytes);
const form = doc.getForm();
const fields = form.getFields();

const rows = fields.map((f) => {
  const name = f.getName();
  const ctor = f.constructor.name;
  return { name, type: ctor };
});

rows.sort((a, b) => a.name.localeCompare(b.name));

console.log(`PDF: ${pdfPath}`);
console.log(`Fields: ${rows.length}\n`);
for (const { name, type } of rows) {
  console.log(`${type}\t${name}`);
}

const text = rows.filter((r) => r.type.includes("Text")).length;
const check = rows.filter((r) => r.type.includes("Check")).length;
console.log(`\nSummary: ${text} text-like, ${check} checkbox-like`);
