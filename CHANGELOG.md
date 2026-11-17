# Changelog

## Unreleased

## api-v0.4.3 - 2026-11-17

- Added per-provider `timeout_seconds` support and raised the default Virtualizor request timeout for slow control panels.
- Parallelized Virtualizor per-instance sub-queries with HTTP timeout fault tolerance and automatic fallback to `vpsmanage` / `listvs` fields.

## api-v0.4.2 - 2026-11-15

- Updated the RackNerd SolusVM collector default endpoint to `ctrl.racknerd.com` and added full `<ctrl>` XML document parsing compatibility.
- Updated the Panstar collector to support normalized `status`, `productRegionName`, and `primaryIp` fields in read-only API responses.
- Configured automatic retries and explicit connection/read timeouts for Aliyun SWAS SDK requests across cross-border networks.
- Fixed virtualenv read/execute permissions under `umask 027` in `scripts/install-vps.sh` for the dedicated `vpsmonitor` service account.

## api-v0.4.1 - 2026-09-02

- Added the VPS one-command installer safeguards and unified production service paths.

## api-v0.4.0 - 2026-08-22

- Added a one-command Linux VPS installer for provider setup, initial collection, and systemd services.
- Unified production configuration under `/etc/vpsmonitor` and runtime data under `/var/lib/vpsmonitor`.
- Added an interactive polling interval prompt and standardized the loopback API port on `18787`.

## api-v0.3.1 - 2026-08-12

- Published the synchronized patch release for the API module.
- Kept the API contract and secret-handling boundaries unchanged from v0.3.0.

## api-v0.3.0 - 2026-08-11

- Added RackNerd through the read-only SolusVM client `info` and `status` actions.
- Added server-persisted, user-configurable history and collector-log retention.
- Stopped persisting full provider payloads and retained only normalized observations.
- Added hardened systemd migration overrides for legacy deployments and writable data paths.

## api-v0.2.0 - 2026-08-10

- Added an interactive one-command configuration flow with hidden credential input.
- Moved default provider configuration, secrets, and runtime data outside the source tree.
- Rejected literal provider credentials in YAML configuration.
- Restricted API startup to loopback interfaces.
- Added a server-side minimum interval and single-flight cache for live Aliyun refreshes.
- Sanitized public examples and release documentation.
- Split the macOS, Web, API, and archived implementations into dedicated branches.
