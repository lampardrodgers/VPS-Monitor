# VPSMonitor

VPSMonitor is a self-hosted VPS resource and bandwidth monitoring project.

The VPS-side code is split into two directly installable Python packages:

- `packages/controller`: `vps-monitor-controller`, installed only on the main monitoring VPS.
- `packages/agent`: `vps-monitor-agent`, installed on every monitored VPS.

The iOS app remains in `VPSMonitor/`, but the server and agent are intentionally decoupled so the mobile client can evolve later without changing VPS collection logic.

## Architecture

- Agents have no inbound API. A systemd timer runs `vpsmon-agent once`; the controller can set the target interval from `1s` to `86400s`.
- Agents collect CPU, memory, disk, network counters, and `vnStat` monthly bandwidth when available.
- The controller receives signed reports, stores them in SQLite, evaluates quota/disk/offline alerts, exposes app APIs, and serves the built web console when packaged.
- Telegram/Bark alerting is handled by the controller, not the iOS app.

More detail: [docs/architecture.md](docs/architecture.md).

## Install The Controller Package

Preferred npm workflow after publishing:

```bash
npm i -g @sunjiehao/vpsmonitor-main
vpsmonitor-main install
vpsmonitor-main add-sub
vpsmonitor-main nodes
```

Child VPS:

```bash
npm i -g @sunjiehao/vpsmonitor-sub
vpsmonitor-sub install
```

For local development:

```bash
python3 -m venv .venv-controller
. .venv-controller/bin/activate
python -m pip install ./packages/controller
vpsmon-controller init-db --config config/controller.example.yaml
vpsmon-controller serve --config config/controller.example.yaml --host 127.0.0.1 --port 8080
```

Open `http://127.0.0.1:8080/` for the web console after the frontend has been built into the controller package.

For a production VPS after this repo is published:

```bash
curl -fsSL https://raw.githubusercontent.com/yourname/VPSMonitor/main/scripts/install-controller.sh | \
  sudo env VPSMON_PUBLIC_URL="https://monitor.example.com" \
  PACKAGE_SPEC="git+https://github.com/yourname/VPSMonitor.git#subdirectory=packages/controller" \
  AGENT_PACKAGE_SPEC="git+https://github.com/yourname/VPSMonitor.git#subdirectory=packages/agent" \
  bash
```

The controller installer also installs the agent locally, registers `main-controller`, and starts monitoring the main VPS itself. It writes reusable instructions to `/root/vpsmonitor-install-info.txt`.

Create a monitored node token:

```bash
sudo /opt/vpsmonitor/controller/venv/bin/vpsmon-controller create-node \
  --config /etc/vpsmonitor/controller.yaml \
  --name tokyo-edge \
  --provider Vultr \
  --country JP \
  --quota-gb 1000 \
  --counting-mode total \
  --controller-url https://monitor.example.com \
  --qr
```

Create an app pairing token:

```bash
sudo /opt/vpsmonitor/controller/venv/bin/vpsmon-controller create-app-token \
  --config /etc/vpsmonitor/controller.yaml \
  --base-url https://monitor.example.com
```

Use the generated app token in the web console. The browser stores it in `localStorage` so the console remains available after refresh.

View and revoke nodes:

```bash
sudo /opt/vpsmonitor/controller/venv/bin/vpsmon-controller list-nodes --config /etc/vpsmonitor/controller.yaml
sudo /opt/vpsmonitor/controller/venv/bin/vpsmon-controller delete-node --config /etc/vpsmonitor/controller.yaml --id tokyo-edge
```

## Install The Agent Package

For local development:

```bash
python3 -m venv .venv-agent
. .venv-agent/bin/activate
python -m pip install ./packages/agent
vpsmon-agent once --config config/agent.example.yaml --dry-run
```

For a production monitored VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/yourname/VPSMonitor/main/scripts/install-agent.sh | \
  sudo env VPSMON_CONTROLLER_URL="https://monitor.example.com" \
  VPSMON_NODE_ID="tokyo-edge" \
  VPSMON_NODE_TOKEN="node_xxx" \
  PACKAGE_SPEC="git+https://github.com/yourname/VPSMonitor.git#subdirectory=packages/agent" \
  bash
```

The installer creates `/etc/vpsmonitor/agent.yaml`, installs `vnStat`, and enables `vpsmon-agent.timer`. The initial check interval defaults to 900 seconds and can later be changed from the web console.

Disconnect an agent locally:

```bash
curl -fsSL https://raw.githubusercontent.com/yourname/VPSMonitor/main/scripts/install-agent.sh | sudo bash -s -- disconnect
```

More detail: [docs/deployment.md](docs/deployment.md).

## Development

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
pytest
xcodebuild -project VPSMonitor.xcodeproj -scheme VPSMonitor -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
```

Build local wheel artifacts for the two VPS-side packages:

```bash
bash scripts/build-packages.sh
python -m pip install dist/vps_monitor_controller-0.1.0-py3-none-any.whl
python -m pip install dist/vps_monitor_agent-0.1.0-py3-none-any.whl
```

Build local npm artifacts:

```bash
bash scripts/build-npm-packages.sh
```

Both package build scripts refresh the web bundle first. Set `SKIP_WEB_BUILD=1` only when intentionally building server packages without a refreshed web console.

## Web Console

The web console is served by the controller under the same origin as the API. It supports:

- token login with the controller app bearer token;
- manual refresh and a browser-only auto-refresh interval;
- summary cards, node table, node detail history, and alerts;
- global and per-node agent check intervals from `1s` to `86400s`;
- per-node monitoring pause/resume. Paused nodes are shown as `paused`, do not generate alerts, and incoming agent reports are accepted but not stored until monitoring is resumed.

Publishing npm packages requires an npm account with access to the `@sunjiehao` scope. See [docs/npm-publish.md](docs/npm-publish.md).

## API Authentication

- Each agent has a per-node bearer token.
- The app has a separate app bearer token generated by the controller.
- Tokens are stored as SHA-256 hashes in SQLite; clear tokens are shown only at creation time.

## Traffic Accounting

`vnStat` is the preferred monthly accounting source. If `vnStat` is missing or has no monthly data yet, the agent still reports live interface counters so the node remains observable, but quota math remains unavailable until monthly data exists.
