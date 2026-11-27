// The CI check on its own, published as `@nextlyhq/telemetry/ci`. Code that
// only needs to know whether it runs in CI or a deploy pipeline imports this
// entry instead of the package root, so it does not load the usage-data
// client (and the HTTP library behind it) just to read a few environment
// variables. Re-exported rather than copied, so the product keeps one list of
// CI markers.
export { detectIsCi } from "./environment.js";
