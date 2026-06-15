// ============================================================
// Extracción de texto en el navegador (PDF / Word / Excel)
// ============================================================
// Usado por admin/admin.js y enviar/enviar.js.
//
// Librerías cargadas desde CDN (sin necesidad de "npm install"):
//  - mammoth: extraer texto de .docx
//  - xlsx (SheetJS): extraer texto de .xlsx / .xls
//  - pdfjs-dist: extraer texto de .pdf
// ============================================================

import * as mammoth from "https://esm.sh/mammoth@1.8.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs";

export async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return extractPdf(file);
  if (name.endsWith(".docx")) return extractDocx(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return extractXlsx(file);
  throw new Error("Formato no soportado. Usa PDF, DOCX o XLSX.");
}

async function extractPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n\n";
  }
  return text;
}

async function extractDocx(file) {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

async function extractXlsx(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  let text = "";
  wb.SheetNames.forEach((name) => {
    const sheet = wb.Sheets[name];
    text += `Hoja: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}\n\n`;
  });
  return text;
}
