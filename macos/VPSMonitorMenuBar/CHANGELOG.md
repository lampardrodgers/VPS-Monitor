# Changelog

## Unreleased

## mac-v0.4.1 - 2026-09-02

- Added the native login-at-startup setting backed by macOS ServiceManagement.
- Added explicit notarization requirements for formal DMG releases.

## mac-v0.4.0 - 2026-08-22

- Added native first-run VPS SSH configuration and a save-and-test connection flow.
- Added automatic SSH host-key enrollment for unattended short-lived tunnels.
- Added signed DMG packaging with optional Apple notarization and stapling.

## mac-v0.3.1 - 2026-08-12

- Added a native status-bar panel with remembered, resizable dimensions.
- Added status/provider visibility filters for the main VPS list.
- Added masked IP address display with explicit reveal and copy actions.
- Replaced release test fixtures with documentation-only IP ranges.

## mac-v0.3.0 - 2026-08-11

- Added shared server retention settings to the native Settings window.
- Added RackNerd provider presentation metadata.
- Added short-lived SSH tunnels that are opened for refresh requests and closed immediately afterward.
- Added the release application icon and updated bundle metadata.

## mac-v0.2.0 - 2026-08-10

- Published the native SwiftUI menu bar client as a standalone branch.
- Added multi-source import, instance detail/history views, ordering, aliases, and refresh controls.
- Kept provider credentials server-side and defaulted connections to the local SSH tunnel.
- Replaced account-derived test data with synthetic fixtures and excluded private screenshots/builds.
