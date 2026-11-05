import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {PUBLIC_DIR} from "../src/lib/paths.js";

// the csp forbids style attributes, so the views take a bar's width from these classes, see widthClass
const rules = Array.from({length: 1001}, (_, i) => `.w-${i} {\n    width: ${i / 10}%;\n}`);

writeFileSync(
    join(PUBLIC_DIR, "widths.css"),
    `/* written by scripts/widths.ts, widths in tenths of a percent */\n${rules.join("\n")}\n`
);
