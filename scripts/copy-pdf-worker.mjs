// Copia el worker de pdf.js a /public para servirlo con la misma versión que la
// librería instalada. Se ejecuta en postinstall para que nunca se desincronice.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const dest = join(process.cwd(), "public", "pdfjs");

mkdirSync(dest, { recursive: true });
copyFileSync(
  join(pdfjsRoot, "build", "pdf.worker.min.mjs"),
  join(dest, "pdf.worker.min.mjs")
);
console.log("pdf.js worker copiado a public/pdfjs/pdf.worker.min.mjs");
