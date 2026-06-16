/* global Buffer, console, process */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export const observatoryBundlePaths = {
  entry: path.join(repoRoot, "scripts", "observatory-3d-entry.mjs"),
  outfile: path.join(repoRoot, "vendor", "observatory-3d.bundle.js"),
  checksum: path.join(repoRoot, "vendor", "observatory-3d.bundle.sha256"),
};

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function checksumLine(buffer) {
  return `${sha256Hex(buffer)}  observatory-3d.bundle.js`;
}

function normalizeBundleSource(buffer) {
  return Buffer.from(buffer.toString("utf8").replace(/[ \t]+$/gm, ""));
}

export async function buildObservatoryBundle({ write = true } = {}) {
  const result = await build({
    entryPoints: [observatoryBundlePaths.entry],
    bundle: true,
    format: "iife",
    globalName: "CodexMemoryObservatoryRuntime",
    outfile: observatoryBundlePaths.outfile,
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "eof",
    write: false,
    logLevel: "silent",
  });

  const bundle = normalizeBundleSource(Buffer.from(result.outputFiles[0].contents));

  if (write) {
    writeFileSync(observatoryBundlePaths.outfile, bundle);
    writeFileSync(observatoryBundlePaths.checksum, `${checksumLine(bundle)}\n`);
  }

  return bundle;
}

if (process.argv[1] === scriptPath) {
  const bundle = await buildObservatoryBundle();
  console.log(`Built vendor/observatory-3d.bundle.js (${bundle.length} bytes)`);
  console.log(checksumLine(bundle));
}
