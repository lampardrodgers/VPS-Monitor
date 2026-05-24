#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const vendorRoot = path.join(packageRoot, "vendor");

const copyEntries = [
  ["scripts/install-controller.sh", "scripts/install-controller.sh"],
  ["scripts/install-agent.sh", "scripts/install-agent.sh"],
  ["packages/controller", "packages/controller"],
  ["packages/agent", "packages/agent"]
];

fs.rmSync(vendorRoot, { recursive: true, force: true });
for (const [from, to] of copyEntries) {
  copyRecursive(path.join(repoRoot, from), path.join(vendorRoot, to));
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      if (shouldSkip(entry)) continue;
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, stat.mode);
  }
}

function shouldSkip(entry) {
  return entry === "__pycache__" || entry === "build" || entry.endsWith(".egg-info");
}
