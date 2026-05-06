# @nextly/telemetry

Internal anonymous telemetry client used by the Nextly CLIs.

> Internal package. Not published to npm. Bundled into consumers by tsup.

## What this is

A small client that posts anonymous usage events from `create-nextly-app` and the `nextly` CLI. It collects no personal information, no project contents, no file paths, and no secrets. It is automatically disabled in CI, Docker, production, and non-interactive shells. Users can disable it explicitly with `nextly telemetry disable` or `NEXTLY_TELEMETRY_DISABLED=1`.

The user-facing telemetry note lives in the root README, the `@revnixhq/create-nextly-app` README, and at [`nextlyhq.com/docs/telemetry`](https://nextlyhq.com/docs/telemetry).

## Used by

- `@revnixhq/nextly`
- `@revnixhq/create-nextly-app`

## Development

See the [root README](../../README.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).
