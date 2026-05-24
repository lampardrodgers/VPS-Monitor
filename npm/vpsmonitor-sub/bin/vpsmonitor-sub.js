#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { spawnSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const vendorRoot = path.join(packageRoot, "vendor");
const agentScript = path.join(vendorRoot, "scripts", "install-agent.sh");
const agentPackage = path.join(vendorRoot, "packages", "agent");

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "help";
  if (command === "help" || command === "--help" || command === "-h" || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (command === "install") {
    await install(args);
    return;
  }
  if (command === "disconnect" || command === "uninstall" || command === "remove") {
    assertPackaged();
    run("bash", [agentScript, "disconnect"], { sudo: true, stdio: "inherit" });
    return;
  }
  if (command === "status") {
    run("systemctl", ["status", "vpsmon-agent.timer"], { sudo: true, stdio: "inherit" });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`Usage:
  vpsmonitor-sub install      Install and connect this VPS to the main VPS
  vpsmonitor-sub disconnect   Stop and remove local agent configuration
  vpsmonitor-sub status       Show agent timer status
`);
}

async function install(args) {
  assertPackaged();
  const options = parseArgs(args);
  const pairing = options.pairingUrl ? parsePairingURL(options.pairingUrl) : {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const controllerURL = await ask(rl, "主 VPS 对外访问地址", options.controllerUrl || pairing.controllerUrl || "");
    const nodeID = await ask(rl, "节点 ID", options.nodeId || pairing.nodeId || "");
    const nodeToken = await ask(rl, "节点 Token", options.nodeToken || pairing.nodeToken || "");
    const netInterface = await ask(rl, "网卡名，auto 表示自动识别", options.interface || "auto");
    const diskPath = await ask(rl, "磁盘路径", options.diskPath || "/");
    if (!controllerURL || !nodeID || !nodeToken) {
      throw new Error("Controller URL, node ID, and node token are required.");
    }
    run("bash", [agentScript], {
      sudo: true,
      stdio: "inherit",
      env: {
        PACKAGE_SPEC: agentPackage,
        VPSMON_CONTROLLER_URL: controllerURL,
        VPSMON_NODE_ID: nodeID,
        VPSMON_NODE_TOKEN: nodeToken,
        VPSMON_INTERFACE: netInterface,
        VPSMON_DISK_PATH: diskPath
      }
    });
  } finally {
    rl.close();
  }
}

function parsePairingURL(value) {
  const url = new URL(value);
  return {
    controllerUrl: url.searchParams.get("controller_url") || "",
    nodeId: url.searchParams.get("node_id") || "",
    nodeToken: url.searchParams.get("node_token") || ""
  };
}

function run(command, args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const stdio = options.stdio || "pipe";
  let finalCommand = command;
  let finalArgs = args;
  if (options.sudo && process.getuid && process.getuid() !== 0) {
    finalCommand = "sudo";
    finalArgs = ["env", ...Object.entries(options.env || {}).map(([key, value]) => `${key}=${value}`), command, ...args];
  }
  const result = spawnSync(finalCommand, finalArgs, { env, stdio, encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    throw new Error(`${finalCommand} ${finalArgs.join(" ")} failed with exit ${result.status}${stderr}`);
  }
  return result;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "1";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function ask(rl, prompt, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${prompt}${suffix}: `);
  return (answer.trim() || defaultValue || "").trim();
}

function assertPackaged() {
  if (!fs.existsSync(agentScript) || !fs.existsSync(agentPackage)) {
    throw new Error("NPM package payload is missing. Run npm pack/publish so prepack can include vendor files.");
  }
}
