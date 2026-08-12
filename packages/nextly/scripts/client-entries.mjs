/**
 * The entry points a browser bundle may reach, declared once.
 *
 * Two views of this list existed before: the build needed source paths, the artifact check needed
 * export-map keys, and each kept its own copy. They had already drifted — the check covered
 * `./field-catalog` and the build's list did not name it — which is the failure mode exactly:
 * adding a client entry to one list leaves the other scanning the old set and passing, so the new
 * browser surface ships unprotected by the check written to protect it.
 *
 * So this is the richer declaration and both consumers derive from it. `tsup.config.js` maps to
 * `source`; `scripts/check-client-safe-artifacts.mjs` maps to `exportKey` and resolves the built
 * file through `package.json`'s export map.
 *
 * 🔴 Membership here is a CLAIM, not an enforcement. Nothing about being in this array makes a
 * module free of Node built-ins — the build applies one config to every entry. What enforces it is
 * the artifact check reading the built output, and that check is the reason this list is worth
 * keeping accurate.
 *
 * @module client-entries
 */

export const CLIENT_ENTRIES = [
  { exportKey: "./config", source: "src/config.ts" },
  { exportKey: "./next", source: "src/next.ts" },
  {
    // Read and written by the admin editor from a "use client" component.
    exportKey: "./field-group-type",
    source: "src/field-group-type.ts",
  },
  {
    // Imported by the admin field pickers, also from client components. It predates the check,
    // which is why it was the one missing from a hand-kept list.
    exportKey: "./field-catalog",
    source: "src/collections/fields/catalog.ts",
  },
];
