# @sunjiehao/vpsmonitor-sub

Child VPS agent installer for VPSMonitor.

```bash
npm i -g @sunjiehao/vpsmonitor-sub
vpsmonitor-sub install
vpsmonitor-sub disconnect
```

`install` prompts for the main controller URL, node ID, and node token unless they are passed as flags. The controller can later adjust the local agent check interval through the web console.
