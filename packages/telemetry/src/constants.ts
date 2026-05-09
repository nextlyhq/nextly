// Centralized constants. The endpoint and token ship inside the bundled CLI,
// so changes require a release. The proxy at telemetry.nextlyhq.com is why
// we can rotate providers or tokens server-side without a CLI release.
export const TELEMETRY_ENDPOINT = "https://telemetry.nextlyhq.com/";

// Public PostHog project write token for the "Nextly CLI" project.
// Intentionally hard-coded; it is not a secret (PostHog project tokens are
// designed to be public, the same way NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is
// shipped in browser JS). Populated when the PostHog project is provisioned;
// stub value here so the package builds.
export const POSTHOG_TOKEN = "phc_Bt3mRoQE9ztCyb6etyvnaGb7hoCYZvhxydaWk9PxGmcX";

// Schema version on every event. Bump when we make breaking changes to the
// property shape of any event.
export const TELEMETRY_SCHEMA_VERSION = 1;

// Name of the conf package "projectName"; resolves config to
// ~/.config/nextly/config.json (Linux),
// ~/Library/Preferences/nextly-nodejs/config.json (macOS), etc.
export const CONF_PROJECT_NAME = "nextly";

// Hard cap for shutdown flush in ms. A degraded network should never hang the CLI.
export const SHUTDOWN_TIMEOUT_MS = 2000;
