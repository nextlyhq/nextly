// Single source of truth for the required Drizzle version. Read by
// check-drizzle-kit-pin.cjs (every package.json pin must EQUAL this) and
// cross-checked against the runtime constant in
// packages/nextly/src/database/drizzle-version.ts by the zero-legacy gate.
// Bump ONLY in a dedicated pin-bump PR that re-runs the full Phase 7
// behavioral gate first.
module.exports = { REQUIRED_DRIZZLE_VERSION: "1.0.0-rc.4" };
