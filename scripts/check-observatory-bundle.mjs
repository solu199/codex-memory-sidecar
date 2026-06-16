/* global console, process */

import { existsSync, readFileSync } from "node:fs";

import {
  buildObservatoryBundle,
  checksumLine,
  observatoryBundlePaths,
} from "./build-observatory-bundle.mjs";

const failures = [];

for (const filePath of [
  observatoryBundlePaths.entry,
  observatoryBundlePaths.outfile,
  observatoryBundlePaths.checksum,
]) {
  if (!existsSync(filePath)) {
    failures.push(`Missing required file: ${filePath}`);
  }
}

if (failures.length === 0) {
  const currentBundle = readFileSync(observatoryBundlePaths.outfile);
  const generatedBundle = await buildObservatoryBundle({ write: false });
  const currentChecksum = readFileSync(observatoryBundlePaths.checksum, "utf8").trim();
  const expectedChecksum = checksumLine(currentBundle);
  const source = currentBundle.toString("utf8");

  if (!currentBundle.equals(generatedBundle)) {
    failures.push(
      "vendor/observatory-3d.bundle.js does not match a fresh build. Run npm run build:observatory-bundle.",
    );
  }

  if (currentChecksum !== expectedChecksum) {
    failures.push(
      "vendor/observatory-3d.bundle.sha256 does not match the current bundle. Run npm run build:observatory-bundle.",
    );
  }

  for (const requiredSnippet of [
    "window.ForceGraph3D",
    "window.THREE",
    "window.UnrealBloomPass",
    "Bundled license information",
  ]) {
    if (!source.includes(requiredSnippet)) {
      failures.push(`Bundle is missing required runtime snippet: ${requiredSnippet}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Memory Observatory bundle provenance check passed.");
