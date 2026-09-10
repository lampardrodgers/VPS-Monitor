# Changelog

## Unreleased

## v0.4.2 - 2026-09-10

- Added a native menu bar context menu for Settings, launch at login, refresh intervals, immediate refresh, and quitting.
- Improved first-run Settings opening through the SwiftUI Settings action and refreshed login-item status when the app becomes active.
- Added a standalone custom refresh interval window with consistent apply and cancel behavior.
- Refined the server list scrollbar with a subtle overlay appearance while preserving native scrolling and accessibility contrast.

## v0.4.1 - 2026-09-02

- Consolidated the API, Web client, and native macOS menu bar client into one repository snapshot.
- Added the one-command VPS installer safeguards and unified production service paths.
- Added native macOS startup-at-login settings and formal Developer ID DMG notarization workflow.
- Kept provider credentials outside the repository and documented the production release checks.

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
