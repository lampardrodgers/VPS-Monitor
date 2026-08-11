# Changelog

## Unreleased

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
