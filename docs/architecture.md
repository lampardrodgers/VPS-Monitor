# VPSMonitor Architecture

VPSMonitor is split into two installable VPS-side packages plus a later iOS client.

## Packages

- `vps-monitor-controller`: runs on the main monitoring VPS. It owns storage, node tokens, app tokens, alert evaluation, notifications, and read APIs.
- `vps-monitor-agent`: runs on each monitored VPS. It has no inbound server, no controller database access, and only sends signed reports to the controller.

The packages intentionally do not import each other. Their contract is the HTTP JSON API documented by the route names and model fields:

- `POST /api/v1/agent/report`
- `GET /api/v1/app/summary`
- `GET /api/v1/app/nodes`
- `GET /api/v1/app/nodes/{id}`
- `GET /api/v1/app/alerts`
- `GET /api/v1/app/settings`
- `PUT /api/v1/app/settings/check-interval`
- `PATCH /api/v1/app/nodes/{id}/settings`

The controller also serves the built web console from the same origin when static assets are present in the package.

## Refresh Model

- Agent timer: controller-managed target interval from 1 to 86400 seconds, defaulting to 900 seconds.
- Controller stale threshold: 45 minutes.
- Controller alert check timer: every 15 minutes, needed for offline detection even when no new reports arrive.
- iOS app later reads controller cache and should not drive collection.

Agents still have no inbound API. A changed check interval is returned in the next report response, and the agent updates its own `vpsmon-agent.timer`. The controller marks interval sync as complete after a later report includes the applied local timer interval.

## Monitoring Pause

The web console can pause monitoring per node. This is a controller-side pause, not a remote shutdown of the child VPS agent. While paused:

- reports are authenticated and accepted but not inserted into `reports`;
- existing open alerts for the node are resolved;
- new stale, traffic, disk, and forecast alerts are skipped;
- the node is returned with status `paused` and can be resumed from the web console.

## Extension Points

- Add provider billing adapters inside the controller only. They should normalize quota and usage into the same node view fields.
- Add new Linux collectors inside the agent only. They should append fields to the report without requiring controller schema changes unless the new data is queryable.
- Add app/UI features against the app API. Avoid coupling the iOS client to SQLite tables or agent internals.
