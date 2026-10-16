// Builds report/Cashew_Project_Report.docx following BCE497J PROJECT REPORT TEMPLATE_V1 exactly:
// A4, margins L 3.81 / R,T,B 2.54 cm, Times New Roman 12 pt body at 1.5 spacing, chapter label 12 bold +
// chapter title 16 bold, section 14 CAPS, subsection 12 CAPS, page numbers bottom-centre (roman for front
// matter from the Abstract, arabic from Chapter 1). Contents/LOT/LOF page numbers are static and filled in a
// second pass from the rendered PDF (see paginate.mjs), so the PDF and DOCX agree without a field update.
import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, LineRuleType, Packer, PageBreak, PageNumber,
  NumberFormat, Paragraph, PositionalTab, PositionalTabAlignment, PositionalTabLeader, PositionalTabRelativeTo,
  ShadingType, Table, TableCell, TableRow, TextRun, UnderlineType, VerticalAlign, WidthType, HeadingLevel,
  TableLayoutType, TabStopType,
} from "docx";
import JSZip from "jszip";
import { FRONT, CHAPTERS, REFERENCES, APPENDICES, ACRONYMS } from "./content/index.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PAGES = fs.existsSync(path.join(ROOT, "build/pages.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "build/pages.json"), "utf8")) : {};
const pg = (key) => PAGES[key] ?? "0";

const FONT = "Times New Roman";
const CM = 567; // twips per cm
const PAGE = { width: 11906, height: 16838, margin: { left: Math.round(3.81 * CM), right: Math.round(2.54 * CM), top: Math.round(2.54 * CM), bottom: Math.round(2.54 * CM), footer: 500 } };
const TEXT_W = PAGE.width - PAGE.margin.left - PAGE.margin.right; // twips
const LINE15 = { line: 360, lineRule: LineRuleType.AUTO };
const LOGO = fs.readFileSync(path.join(ROOT, "assets/vit-chennai-logo.jpg")); // original VIT Chennai logo from the template

// ---------------------------------------------------------------- inline text: **bold**, *italic*, `code`
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const t = m[0];
    if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, ...base }));
    else if (t.startsWith("`")) out.push(new TextRun({ text: t.slice(1, -1), font: "Courier New", ...base, size: Math.round((base.size ?? 24) * 0.88) }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, font: FONT, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  return out;
}

const P = (text, o = {}) =>
  new Paragraph({
    children: runs(text, { size: o.size ?? 24 }),
    alignment: o.align ?? AlignmentType.JUSTIFIED,
    spacing: { ...LINE15, after: o.after ?? 120, before: o.before ?? 0 },
    indent: o.noIndent ? undefined : { firstLine: 720 },
    widowControl: true,
    keepNext: o.keepNext,
  });
const C = (text, size, o = {}) =>
  new Paragraph({
    alignment: o.align ?? AlignmentType.CENTER,
    spacing: { line: o.line ?? 276, lineRule: LineRuleType.AUTO, before: o.before ?? 0, after: o.after ?? 0 },
    children: [new TextRun({ text, font: FONT, size: size * 2, bold: o.bold, italics: o.italics, allCaps: o.caps, underline: o.underline ? { type: UnderlineType.SINGLE } : undefined })],
    keepNext: o.keepNext,
  });
const blank = (n = 1, size = 12) => Array.from({ length: n }, () => C("", size));
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });
const logo = () =>
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "jpg", data: LOGO, transformation: { width: 332, height: 111 } })] }); // 3.458 in × 1.153 in, as in the template

// ---------------------------------------------------------------- numbering state
const state = { ch: 0, sec: 0, sub: 0, fig: 0, tab: 0, figs: [], tabs: [], toc: [] };

function block(b) {
  switch (b.t) {
    case "p":
      return [P(b.text, b)];
    case "h2": {
      state.sec++; state.sub = 0;
      const num = `${state.ch}.${state.sec}`;
      state.toc.push({ level: 2, num, title: b.text.toUpperCase(), key: `sec:${num}` });
      return [new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, keepLines: true, spacing: { before: 240, after: 120, ...LINE15 }, children: [new TextRun({ text: `${num}\t${b.text.toUpperCase()}`, font: FONT, size: 28 })], tabStops: [{ type: "left", position: 720 }] })];
    }
    case "h3": {
      state.sub++;
      const num = `${state.ch}.${state.sec}.${state.sub}`;
      state.toc.push({ level: 3, num, title: b.text.toUpperCase(), key: `sub:${num}` });
      return [new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, keepLines: true, spacing: { before: 180, after: 100, ...LINE15 }, children: [new TextRun({ text: `${num}\t${b.text.toUpperCase()}`, font: FONT, size: 24 })], tabStops: [{ type: "left", position: 864 }] })];
    }
    case "ul":
    case "ol":
      return b.items.map((it, i) =>
        new Paragraph({
          children: [new TextRun({ text: b.t === "ol" ? `${i + 1}.\t` : "•\t", font: FONT, size: 24 }), ...runs(it, { size: 24 })],
          alignment: AlignmentType.JUSTIFIED,
          spacing: { ...LINE15, after: 60 },
          indent: { left: 720, hanging: 360 },
          tabStops: [{ type: "left", position: 720 }],
          widowControl: true,
        }),
      );
    case "fig": {
      state.fig++;
      const num = `${state.ch}.${state.fig}`;
      state.figs.push({ num, title: b.caption, key: `fig:${num}` });
      const file = path.join(ROOT, b.file);
      const buf = fs.readFileSync(file);
      const { w, h } = pngSize(buf);
      const maxW = (b.width ?? 6.0) * 96; // px at 96 dpi
      const maxH = (b.maxH ?? 8.2) * 96;
      let W = maxW, H = (h / w) * maxW;
      if (H > maxH) (H = maxH), (W = (w / h) * maxH);
      return [
        new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: "png", data: buf, transformation: { width: Math.round(W), height: Math.round(H) } })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200, line: 240 }, children: [new TextRun({ text: `Figure ${num}  `, bold: true, font: FONT, size: 22 }), new TextRun({ text: b.caption, font: FONT, size: 22 })] }),
      ];
    }
    case "table": {
      state.tab++;
      const num = `${state.ch}.${state.tab}`;
      state.tabs.push({ num, title: b.caption, key: `tab:${num}` });
      return [
        new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 80, line: 240 }, children: [new TextRun({ text: `Table ${num}  `, bold: true, font: FONT, size: 22 }), new TextRun({ text: b.caption, font: FONT, size: 22 })] }),
        table(b.cols, b.rows, b.widths, b.size ?? 20),
        new Paragraph({ spacing: { after: 120 }, children: [] }),
      ];
    }
    case "code": {
      const out = [];
      if (b.caption) out.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 60 }, children: [new TextRun({ text: b.caption, bold: true, font: FONT, size: 22 })] }));
      const lines = b.lines ?? fs.readFileSync(path.join(ROOT, "..", b.file), "utf8").replace(/\t/g, "    ").split("\n");
      lines.forEach((l, i) =>
        out.push(
          new Paragraph({
            spacing: { line: 220, lineRule: LineRuleType.AUTO, after: 0 },
            shading: { type: ShadingType.CLEAR, fill: "F6F6F4", color: "auto" },
            children: [new TextRun({ text: (b.numbered ? String(i + 1).padStart(3, " ") + "  " : "") + (l || " "), font: "Courier New", size: b.size ?? 16 })],
          }),
        ),
      );
      out.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
      return out;
    }
    case "eq":
      return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120, ...LINE15 }, children: runs(b.text, { size: 24, italics: false }) })];
    case "break":
      return [pageBreak()];
    default:
      throw new Error("unknown block " + b.t);
  }
}

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function table(cols, rows, widths, size) {
  const n = cols.length;
  const ws = widths ? widths.map((x) => Math.round((x / widths.reduce((a, c) => a + c, 0)) * TEXT_W)) : Array(n).fill(Math.floor(TEXT_W / n));
  const fix = TEXT_W - ws.reduce((a, c) => a + c, 0);
  ws[ws.length - 1] += fix;
  const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
  const cell = (text, i, head) =>
    new TableCell({
      width: { size: ws[i], type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      shading: head ? { type: ShadingType.CLEAR, fill: "EDEBE6", color: "auto" } : undefined,
      margins: { top: 50, bottom: 50, left: 90, right: 90 },
      borders: { top: border, bottom: border, left: border, right: border },
      children: [new Paragraph({ spacing: { line: 240, after: 0 }, alignment: AlignmentType.LEFT, children: runs(String(text), { size, bold: head || undefined }) })],
    });
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: ws,
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({ tableHeader: true, cantSplit: true, children: cols.map((c, i) => cell(c, i, true)) }), ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))],
  });
}

// ---------------------------------------------------------------- list pages (static numbers from pass 1)
const dotLine = (left, right, o = {}) =>
  new Paragraph({
    spacing: { line: 300, lineRule: LineRuleType.AUTO, after: o.after ?? 40, before: o.before ?? 0 },
    indent: { left: o.indent ?? 0, hanging: o.hanging ?? 0, right: 0 },
    keepNext: o.keepNext,
    tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W, leader: "dot" }],
    children: [...runs(left, { size: 24, bold: o.bold }), new TextRun({ text: `\t${right}`, font: FONT, size: 24, bold: o.bold })],
  });
const title = (t) => C(t, 16, { bold: true, after: 300 });

// ---------------------------------------------------------------- assemble
const front1 = []; // cover..certificate: no page numbers
const coverBlock = (withIntro) => [
  ...blank(3),
  ...(withIntro ? [C("A project report on", 12, { italics: true, after: 200 })] : [C("", 12, { after: 200 })]),
  C(FRONT.title, 20, { bold: true, caps: true, after: 260, line: 300 }),
  C("Submitted in partial fulfillment for the award of the degree of", 14, { italics: true, after: 200 }),
  C(`Bachelor of Technology in ${FRONT.program}`, 22, { bold: true, after: 200, line: 300 }),
  C("by", 14, { italics: true, after: 200 }),
  ...FRONT.members.map((m) => C(`${m.name} (${m.reg})`, 16, { bold: true, caps: true, after: 60 })),
  ...blank(5),
  logo(),
  ...blank(2),
  C("SCHOOL OF COMPUTER SCIENCE AND ENGINEERING", 16, { bold: true, after: 120 }),
  C(FRONT.date, 12),
];
front1.push(...coverBlock(true), pageBreak(), ...coverBlock(false), pageBreak());

// Declaration
front1.push(
  logo(), ...blank(1),
  C("DECLARATION", 14, { bold: true, underline: true, caps: true, after: 360 }),
  P(`I hereby declare that the thesis entitled “${FRONT.title}” submitted by ${FRONT.candidate.name} (${FRONT.candidate.reg}), for the award of the degree of Bachelor of Technology in ${FRONT.program}, Vellore Institute of Technology, Chennai is a record of bonafide work carried out by me under the supervision of ${FRONT.guide}.`),
  P("I further declare that the work reported in this thesis has not been submitted and will not be submitted, either in part or in full, for the award of any other degree or diploma in this institute or any other institute or university."),
  ...blank(3),
  new Paragraph({ children: [new TextRun({ text: "Place: Chennai", font: FONT, size: 24, bold: true })] }),
  new Paragraph({ tabStops: [{ type: "right", position: TEXT_W }], children: [new TextRun({ text: "Date:", font: FONT, size: 24, bold: true }), new TextRun({ text: "\tSignature of the Candidate", font: FONT, size: 24, bold: true })] }),
  pageBreak(),
);

// Certificate
const sigRow = (l, r) => new Paragraph({ spacing: { after: 60 }, tabStops: [{ type: "left", position: Math.round(TEXT_W * 0.58) }], children: [new TextRun({ text: l, font: FONT, size: 24, bold: true }), new TextRun({ text: `\t${r}`, font: FONT, size: 24, bold: true })] });
const left = (t, o = {}) => new Paragraph({ spacing: { after: o.after ?? 60 }, alignment: o.align ?? AlignmentType.LEFT, children: [new TextRun({ text: t, font: FONT, size: 24, bold: o.bold ?? true })] });
front1.push(
  logo(),
  C("School of Computer Science and Engineering", 14, { bold: true, before: 120, after: 240 }),
  C("CERTIFICATE", 14, { bold: true, underline: true, caps: true, after: 300 }),
  P(`This is to certify that the report entitled “${FRONT.title}” is prepared and submitted by ${FRONT.candidate.name} (${FRONT.candidate.reg}) to Vellore Institute of Technology, Chennai, in partial fulfillment of the requirement for the award of the degree of Bachelor of Technology in ${FRONT.program} is a bonafide record carried out under my guidance. The project fulfills the requirements as per the regulations of this University and in my opinion meets the necessary standards for submission. The contents of this report have not been submitted and will not be submitted either in part or in full, for the award of any other degree or diploma and the same is certified.`),
  ...blank(1),
  left("Signature of the Guide:"),
  left(`Name: ${FRONT.guide}`),
  left("Date:", { after: 360 }),
  sigRow("Signature of the Examiner", "Signature of the Examiner"),
  sigRow("Name:", "Name:"),
  sigRow("Date:", "Date:"),
  ...blank(1),
  left("Approved by the Head of Department,", { align: AlignmentType.CENTER }),
  left(`B.Tech. ${FRONT.program}`, { align: AlignmentType.CENTER }),
  left(`Name: ${FRONT.hod}`, { align: AlignmentType.CENTER }),
  left("Date:", { align: AlignmentType.CENTER, after: 120 }),
  left("(Seal of the School of Computer Science and Engineering)", { align: AlignmentType.CENTER, bold: false }),
);

// Roman-numbered front matter
const front2 = [];
front2.push(C("ABSTRACT", 14, { bold: true, underline: true, after: 300 }), ...FRONT.abstract.map((t) => P(t)), pageBreak());
front2.push(
  C("ACKNOWLEDGEMENT", 14, { bold: true, underline: true, after: 300 }),
  ...FRONT.acknowledgement.map((t) => P(t)),
  ...blank(2),
  new Paragraph({ children: [new TextRun({ text: "Place: Chennai", font: FONT, size: 24, bold: true })] }),
  new Paragraph({ tabStops: [{ type: "right", position: TEXT_W }], children: [new TextRun({ text: "Date:", font: FONT, size: 24, bold: true }), new TextRun({ text: `\t${FRONT.candidate.name}`, font: FONT, size: 24, bold: true })] }),
  pageBreak(),
);

// Chapters (built first so we know the numbering for the lists)
const body = [];
for (const ch of CHAPTERS) {
  state.ch++; state.sec = 0; state.sub = 0; state.fig = 0; state.tab = 0;
  state.toc.push({ level: 1, num: String(state.ch), title: ch.title.toUpperCase(), key: `ch:${state.ch}` });
  body.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, pageBreakBefore: true, children: [new TextRun({ text: `Chapter ${state.ch}`, font: FONT, size: 24, bold: true })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: ch.title, font: FONT, size: 32, bold: true })] }),
  );
  for (const b of ch.blocks) body.push(...block(b));
}
// References (APA) and appendices
state.toc.push({ level: 1, num: "", title: "REFERENCES", key: "refs" });
body.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, pageBreakBefore: true, spacing: { after: 360 }, children: [new TextRun({ text: "References", font: FONT, size: 32, bold: true })] }),
  ...REFERENCES.map((r) => new Paragraph({ alignment: AlignmentType.LEFT, spacing: { ...LINE15, after: 120 }, indent: { left: 720, hanging: 720 }, children: runs(r, { size: 24 }) })),
);
state.toc.push({ level: 1, num: "", title: "APPENDICES", key: "apps" });
body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, pageBreakBefore: true, spacing: { after: 240 }, children: [new TextRun({ text: "Appendices", font: FONT, size: 32, bold: true })] }));
APPENDICES.forEach((a, i) => {
  const letter = String.fromCharCode(65 + i);
  state.toc.push({ level: 2, num: letter, title: a.title.toUpperCase(), key: `app:${letter}` });
  body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: i > 0, keepNext: true, spacing: { before: 120, after: 160 }, children: [new TextRun({ text: `Appendix ${letter}: ${a.title}`, font: FONT, size: 24, bold: true })] }));
  state.ch = letter; state.sec = 0; state.sub = 0; state.fig = 0; state.tab = 0;
  for (const b of a.blocks) body.push(...block(b));
});

// Contents / LOT / LOF / acronyms (front matter, roman)
front2.push(C("CONTENTS", 16, { bold: true, after: 300 }));
for (const [label, key] of [["ABSTRACT", "abstract"], ["ACKNOWLEDGEMENT", "ack"], ["LIST OF TABLES", "lot"], ["LIST OF FIGURES", "lof"], ["LIST OF ACRONYMS", "acr"]])
  front2.push(dotLine(`**${label}**`, pg(key), { after: 60 }));
for (const e of state.toc) {
  if (e.level === 1) front2.push(dotLine(e.num ? `**CHAPTER ${e.num}  ${e.title}**` : `**${e.title}**`, pg(e.key), { before: 160, keepNext: true }));
  else if (e.level === 2) front2.push(dotLine(`${e.num}${/^[A-Z]$/.test(e.num) ? "." : ""}  ${e.title}`, pg(e.key), { indent: 360 }));
  else front2.push(dotLine(`${e.num}  ${e.title}`, pg(e.key), { indent: 900 }));
}
front2.push(pageBreak(), C("LIST OF TABLES", 16, { bold: true, after: 300 }));
for (const t of state.tabs) front2.push(dotLine(`${t.num}  ${t.title}`, pg(t.key), { indent: 600, hanging: 600 }));
front2.push(pageBreak(), C("LIST OF FIGURES", 16, { bold: true, after: 300 }));
for (const f of state.figs) front2.push(dotLine(`${f.num}  ${f.title}`, pg(f.key), { indent: 600, hanging: 600 }));
front2.push(pageBreak(), C("LIST OF ACRONYMS", 16, { bold: true, after: 300 }));
front2.push(table(["Acronym", "Expansion"], ACRONYMS, [1.3, 4.7], 22));

const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 24, italics: false })] })] });
const romanFooter = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 24, italics: true })] })] });

const doc = new Document({
  creator: FRONT.candidate.name,
  title: FRONT.title,
  styles: {
    default: { document: { run: { font: FONT, size: 24 }, paragraph: { spacing: LINE15 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 32, bold: true, color: "000000" }, paragraph: { outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 28, color: "000000" }, paragraph: { outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, color: "000000" }, paragraph: { outlineLevel: 2 } },
    ],
  },
  sections: [
    { properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin } }, children: front1 },
    { properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } }, footers: { default: romanFooter }, children: front2 },
    { properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } }, footers: { default: footer }, children: body },
  ],
});

fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
// docx-js ships word/fontTable.xml without a relationship to it; Word treats unreferenced parts as corruption.
const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
const relsPath = "word/_rels/document.xml.rels";
let rels = await zip.file(relsPath).async("string");
if (zip.file("word/fontTable.xml") && !rels.includes("fontTable.xml"))
  rels = rels.replace("</Relationships>", '<Relationship Id="rIdFontTable1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>');
zip.file(relsPath, rels);
fs.writeFileSync(path.join(ROOT, "build/report.docx"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
fs.writeFileSync(path.join(ROOT, "build/index.json"), JSON.stringify({ toc: state.toc, figs: state.figs, tabs: state.tabs }, null, 1));
console.log(`built: ${state.toc.filter((e) => e.level === 1).length} top-level, ${state.figs.length} figures, ${state.tabs.length} tables`);
