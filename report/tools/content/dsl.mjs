// Tiny content DSL used by the chapter files.
export const p = (text, o = {}) => ({ t: "p", text, ...o });
export const h2 = (text) => ({ t: "h2", text });
export const h3 = (text) => ({ t: "h3", text });
export const ul = (...items) => ({ t: "ul", items });
export const ol = (...items) => ({ t: "ol", items });
export const fig = (file, caption, o = {}) => ({ t: "fig", file, caption, ...o });
export const table = (caption, cols, rows, widths, o = {}) => ({ t: "table", caption, cols, rows, widths, ...o });
export const code = (lines, caption, o = {}) => ({ t: "code", lines: typeof lines === "string" ? lines.split("\n") : lines, caption, ...o });
export const src = (file, caption, o = {}) => ({ t: "code", file, caption, numbered: true, ...o });
export const eq = (text) => ({ t: "eq", text });
