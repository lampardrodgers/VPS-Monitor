#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline/promises");
const { spawnSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const vendorRoot = path.join(packageRoot, "vendor");
const controllerScript = path.join(vendorRoot, "scripts", "install-controller.sh");
const controllerPackage = path.join(vendorRoot, "packages", "controller");
const agentPackage = path.join(vendorRoot, "packages", "agent");
const controllerBin = "/opt/vpsmonitor/controller/venv/bin/vpsmon-controller";
const controllerConfig = "/etc/vpsmonitor/controller.yaml";
const infoPath = "/root/vpsmonitor-install-info.txt";
const subPackageName = "@sunjiehao/vpsmonitor-sub";

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
  if (command === "add-sub" || command === "create-sub") {
    await addSub(args);
    return;
  }
  if (command === "nodes" || command === "list") {
    runController(["list-nodes", "--config", controllerConfig], true);
    return;
  }
  if (command === "delete-sub" || command === "delete-node") {
    await deleteSub(args);
    return;
  }
  if (command === "info") {
    printInfo();
    return;
  }
  if (command === "status") {
    run("systemctl", ["status", "vpsmon-controller.service", "vpsmon-agent.timer"], { sudo: true, stdio: "inherit" });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`Usage:
  vpsmonitor-main install      Install controller and self-monitoring agent
  vpsmonitor-main add-sub      Create a child VPS token and install command
  vpsmonitor-main nodes        List connected VPS nodes
  vpsmonitor-main delete-sub   Revoke a child VPS node
  vpsmonitor-main info         Show saved installation notes
  vpsmonitor-main status       Show systemd status
`);
}

async function install(args) {
  assertPackaged();
  const options = parseArgs(args);
  const rl = makeReadline();
  try {
    const publicURL = await ask(rl, "主 VPS 对外访问地址，例如 https://monitor.example.com", options.publicUrl || options.url || "");
    const selfNodeId = await ask(rl, "主 VPS 自身节点 ID", options.selfNodeId || "main-controller");
    const selfNodeName = await ask(rl, "主 VPS 显示名称", options.selfNodeName || "Main Controller");
    const selfQuota = await ask(rl, "主 VPS 月流量额度 GB，可留空", options.selfQuotaGb || "");
    if (!publicURL) throw new Error("Public controller URL is required.");
    const env = {
      VPSMON_PUBLIC_URL: publicURL,
      PACKAGE_SPEC: controllerPackage,
      AGENT_PACKAGE_SPEC: agentPackage,
      SUB_NPM_PACKAGE: subPackageName,
      SELF_NODE_ID: selfNodeId,
      SELF_NODE_NAME: selfNodeName,
      SELF_NODE_QUOTA_GB: selfQuota
    };
    run("bash", [controllerScript], { sudo: true, env, stdio: "inherit" });
  } finally {
    rl.close();
  }
}

async function addSub(args) {
  const options = parseArgs(args);
  const rl = makeReadline();
  try {
    const name = await ask(rl, "子 VPS 显示名称", options.name || "");
    const id = await ask(rl, "子 VPS 节点 ID，建议英文数字短横线", options.id || slugify(name));
    const quota = await ask(rl, "子 VPS 月流量额度 GB", options.quotaGb || "");
    const provider = await ask(rl, "供应商，可留空", options.provider || "");
    const country = await ask(rl, "国家/地区，可留空", options.country || "");
    const controllerURL = await ask(rl, "主 VPS 对外访问地址", options.controllerUrl || options.url || "");
    if (!name || !id || !quota || !controllerURL) {
      throw new Error("Name, node ID, quota, and controller URL are required.");
    }
    const createArgs = [
      "create-node",
      "--config",
      controllerConfig,
      "--name",
      name,
      "--id",
      id,
      "--quota-gb",
      quota,
      "--controller-url",
      controllerURL
    ];
    if (provider) createArgs.push("--provider", provider);
    if (country) createArgs.push("--country", country);
    const result = runController(createArgs, false);
    const payload = JSON.parse(result.stdout);
    const installCommand = [
      `sudo npm i -g ${subPackageName}`,
      "&&",
      "sudo vpsmonitor-sub install",
      `--controller-url ${shellQuote(controllerURL)}`,
      `--node-id ${shellQuote(payload.node_id)}`,
      `--node-token ${shellQuote(payload.node_token)}`
    ].join(" ");
    console.log(JSON.stringify({ ...payload, npm_install_command: installCommand }, null, 2));
    console.log("\n子 VPS 上直接执行：");
    console.log(installCommand);
  } finally {
    rl.close();
  }
}

async function deleteSub(args) {
  const options = parseArgs(args);
  const rl = makeReadline();
  try {
    const id = await ask(rl, "要删除的节点 ID", options.id || "");
    if (!id) throw new Error("Node ID is required.");
    runController(["delete-node", "--config", controllerConfig, "--id", id], true);
  } finally {
    rl.close();
  }
}

function printInfo() {
  if (fs.existsSync(infoPath)) {
    run("cat", [infoPath], { sudo: true, stdio: "inherit" });
  } else {
    console.log(`No install info found at ${infoPath}.`);
  }
}

function runController(args, inherit) {
  return run(controllerBin, args, { sudo: true, stdio: inherit ? "inherit" : "pipe" });
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

function makeReadline() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(rl, prompt, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${prompt}${suffix}: `);
  return (answer.trim() || defaultValue || "").trim();
}

function slugify(value) {
  return (value || os.hostname() || "node")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "node";
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function assertPackaged() {
  if (!fs.existsSync(controllerScript) || !fs.existsSync(controllerPackage) || !fs.existsSync(agentPackage)) {
    throw new Error("NPM package payload is missing. Run npm pack/publish so prepack can include vendor files.");
  }
}
