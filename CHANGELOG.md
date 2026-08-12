# Changelog

## Unreleased

## web-v0.3.1 - 2026-08-12

- Published the synchronized patch release for the Web module.
- Kept the API proxy and external SSH configuration behavior unchanged from v0.3.0.

## web-v0.3.0 - 2026-08-11

- Added a server-backed retention settings panel for curve and collector-log history.
- Added RackNerd provider presentation metadata.
- Changed local API access to an on-demand SSH proxy that closes after each request burst.

## web-v0.2.0 - 2026-08-10

- Published the React 19/Vite 7 read-only monitoring dashboard as a standalone branch.
- Added safe external local configuration loading for SSH tunnel settings.
- Replaced account-derived mock and test data with synthetic fixtures.
- Kept provider credentials and private SSH settings out of browser bundles and Git.
