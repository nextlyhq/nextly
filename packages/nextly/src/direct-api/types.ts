/**
 * Direct API Type Definitions
 *
 * This file is a thin re-export of the domain-split type modules under
 * `./types/`. All public type names continue to be importable from
 * `./direct-api/types` for backward compatibility.
 *
 * For new code, prefer importing from the specific domain module:
 *
 * ```typescript
 * import type { FindArgs } from "./direct-api/types/collections";
 * import type { LoginArgs } from "./direct-api/types/auth";
 * ```
 *
 * @packageDocumentation
 */

export * from "./types/index";
