// Pass 2 helper: render build/report.docx to PDF, locate every heading / figure / table caption in the PDF
// text, and write build/pages.json with the page labels the template's numbering would print
// (lower-case roman from the Abstract, arabic from Chapter 1).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const B = path.join(ROOT, "build");
const SOFFICE = process.env.SOFFICE ?? "/Applications/LibreOffice.app/Contents/MacOS/soffice";

export function toPdf(docx = path.join(B, "report.docx")) {
  execFileSync(SOFFICE, ["--headless", "--convert-to", "pdf", "--outdir", B, docx], { stdio: "ignore" });
  return docx.replace(/\.docx$/, ".pdf");
}

function pageTexts(pdf) {
  const n = Number(execFileSync("pdfinfo", [pdf]).toString().match(/Pages:\s+(\d+)/)[1]);
  const pages = [];
  for (let i = 1; i <= n; i++) pages.push(execFileSync("pdftotext", ["-f", String(i), "-l", String(i), "-layout", pdf, "-"]).toString());
  return pages;
}

const roman = (n) => {
  const t = [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) (s += r), (n -= v);
  return s;
};
const norm = (s) => s.replace(/\s+/g, " ").trim();
const firstLine = (t) => norm(t.split("\n").find((l) => l.trim()) ?? "");

if (import.meta.url === `file://${process.argv[1]}`) {
  const pdf = toPdf();
  const pages = pageTexts(pdf);
  const idx = JSON.parse(fs.readFileSync(path.join(B, "index.json"), "utf8"));
  const find = (pred, from = 0) => pages.findIndex((t, i) => i >= from && pred(t, i));

  const abs = find((t) => firstLine(t) === "ABSTRACT");
  const ch1 = find((t) => /^Chapter 1\b/.test(firstLine(t)));
  if (abs < 0 || ch1 < 0) throw new Error(`anchors not found (abstract ${abs}, chapter1 ${ch1})`);
  const label = (i) => (i < ch1 ? roman(i - abs + 1) : String(i - ch1 + 1));
  const out = {};
  for (const [key, title] of [["abstract", "ABSTRACT"], ["ack", "ACKNOWLEDGEMENT"], ["lot", "LIST OF TABLES"], ["lof", "LIST OF FIGURES"], ["acr", "LIST OF ACRONYMS"]]) {
    const i = find((t) => firstLine(t) === title, abs);
    if (i >= 0) out[key] = label(i);
  }
  const missing = [];
  let cursor = ch1;
  for (const e of idx.toc) {
    let i;
    if (e.level === 1 && e.num) i = find((t) => new RegExp(`^Chapter ${e.num}\\b`).test(firstLine(t)), cursor);
    else if (e.level === 1) i = find((t) => firstLine(t).toUpperCase() === e.title, cursor);
    else if (/^[A-Z]$/.test(e.num)) i = find((t) => norm(t).includes(`Appendix ${e.num}:`), cursor);
    else {
      const head = e.title.split(" ").slice(0, 3).join(" ");
      i = find((t) => norm(t).includes(`${e.num} ${head}`), cursor);
    }
    if (i < 0) missing.push(e.key);
    else (out[e.key] = label(i)), (cursor = i);
  }
  for (const f of idx.figs) {
    const i = find((t) => norm(t).includes(norm(`Figure ${f.num} ${f.title.split(" ").slice(0, 3).join(" ")}`)), ch1);
    i < 0 ? missing.push(f.key) : (out[f.key] = label(i));
  }
  for (const t of idx.tabs) {
    const i = find((x) => norm(x).includes(norm(`Table ${t.num} ${t.title.split(" ").slice(0, 3).join(" ")}`)), ch1);
    i < 0 ? missing.push(t.key) : (out[t.key] = label(i));
  }
  fs.writeFileSync(path.join(B, "pages.json"), JSON.stringify(out, null, 1));
  console.log(`pdf pages ${pages.length}; front roman pages ${ch1 - abs}; body pages ${pages.length - ch1}; missing: ${missing.join(", ") || "none"}`);
}
