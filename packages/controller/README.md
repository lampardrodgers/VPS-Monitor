# vps-monitor-controller

Controller package for VPSMonitor.

It provides:

- FastAPI app receiving agent reports.
- SQLite storage.
- App-facing read API.
- Same-origin web console static hosting.
- Traffic, disk, stale-node, and forecast alerts.
- Global and per-node agent check interval settings from `1s` to `86400s`.
- Per-node monitoring pause/resume.
- Telegram and Bark notification hooks.

## Install

From this repository:

```bash
python3 -m pip install ./packages/controller
```

From GitHub after publishing:

```bash
python3 -m pip install "git+https://github.com/yourname/VPSMonitor.git#subdirectory=packages/controller"
```

## CLI

```bash
vpsmon-controller init-db --config /etc/vpsmonitor/controller.yaml
vpsmon-controller create-node --config /etc/vpsmonitor/controller.yaml --name tokyo --quota-gb 1000
vpsmon-controller create-node --config /etc/vpsmonitor/controller.yaml --name tokyo --quota-gb 1000 --controller-url https://monitor.example.com --qr
vpsmon-controller list-nodes --config /etc/vpsmonitor/controller.yaml
vpsmon-controller delete-node --config /etc/vpsmonitor/controller.yaml --id tokyo
vpsmon-controller show-join --config /etc/vpsmonitor/controller.yaml --base-url https://monitor.example.com
vpsmon-controller create-app-token --config /etc/vpsmonitor/controller.yaml --base-url https://monitor.example.com
vpsmon-controller serve --config /etc/vpsmonitor/controller.yaml --host 127.0.0.1 --port 8080
vpsmon-controller print-systemd --config /etc/vpsmonitor/controller.yaml
```
