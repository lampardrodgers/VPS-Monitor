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

## Refresh Model

- Agent timer: every 15 minutes.
- Controller stale threshold: 45 minutes.
- Controller alert check timer: every 15 minutes, needed for offline detection even when no new reports arrive.
- iOS app later reads controller cache and should not drive collection.

## Extension Points

- Add provider billing adapters inside the controller only. They should normalize quota and usage into the same node view fields.
- Add new Linux collectors inside the agent only. They should append fields to the report without requiring controller schema changes unless the new data is queryable.
- Add app/UI features against the app API. Avoid coupling the iOS client to SQLite tables or agent internals.
