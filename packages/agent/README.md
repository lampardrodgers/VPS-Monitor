# vps-monitor-agent

Agent package for VPSMonitor.

It is designed as a one-shot command run by a systemd timer. It collects:

- CPU usage from `/proc/stat`.
- Memory usage from `/proc/meminfo`.
- Disk usage from `statvfs`.
- Live network counters from `/proc/net/dev`.
- Monthly bandwidth from `vnStat` when available.

## Install

From this repository:

```bash
python3 -m pip install ./packages/agent
```

From GitHub after publishing:

```bash
python3 -m pip install "git+https://github.com/yourname/VPSMonitor.git#subdirectory=packages/agent"
```

## CLI

```bash
vpsmon-agent once --config /etc/vpsmonitor/agent.yaml
vpsmon-agent once --config /etc/vpsmonitor/agent.yaml --dry-run
vpsmon-agent print-systemd --config /etc/vpsmonitor/agent.yaml
```

The repository installer can also disconnect the local agent:

```bash
curl -fsSL https://raw.githubusercontent.com/yourname/VPSMonitor/main/scripts/install-agent.sh | sudo bash -s -- disconnect
```
