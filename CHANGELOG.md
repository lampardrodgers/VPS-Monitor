# Changelog

## v0.1.0 - 2026-05-24

- Added the built-in VPSMonitor web console with token login, overview, node list, node detail history, alerts, manual refresh, and settings pages.
- Added controller APIs for global and per-node check interval settings from 1 to 86400 seconds.
- Added per-node monitoring pause and resume support. Paused nodes resolve open alerts, skip new alert evaluation, and accept agent reports without storing them.
- Added controller static hosting for packaged web assets and package build scripts that refresh the frontend bundle.
- Added agent timer synchronization so agents can apply controller-provided systemd timer intervals.
- Added node metadata update support for name, provider, country, and quota.
- Updated documentation, install scripts, package metadata, and tests for the web console, pause behavior, and interval synchronization.
