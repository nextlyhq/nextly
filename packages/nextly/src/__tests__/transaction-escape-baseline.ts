/**
 * The transaction escapes the integration suites already make, accepted as
 * known debt so that only a new one fails a run (`./transaction-escapes`).
 *
 * Taken from an Integration run's inventory (`./transaction-escapes-inventory`),
 * one entry per dialect and call site. This is a baseline, not an approval:
 * each entry is a statement that runs outside the transaction it belongs to,
 * and the change that fixes it deletes the entry. The list can only shrink.
 * Each entry names a witness, a test file that reaches it, and the run fails
 * when the witness runs and no longer does, so a fixed escape cannot linger
 * here and hide a new one under the same key.
 *
 * @module __tests__/transaction-escape-baseline
 */
import type { KnownEscape } from "./transaction-escapes";

const PIPELINE =
  "known: the schema pipeline reads tables on another connection while its own transaction is open";
const CALLER =
  "known: a write made inside a caller's transaction reads or writes on another connection";
const TIMING =
  "known, timing-dependent: a schema probe on another connection, made only when the first check of the run happens inside a transaction; unwitnessed, since a run where it does not happen would report it fixed";
const REGISTRY =
  "known, timing-dependent: the collection and Single registry cache is filled on another connection inside whichever write first needs it, which test order decides, so it is listed for any opener; the fix fills the cache before the transaction opens, or inside it";
const PLUGIN =
  "known: a statement in a plugin's transaction runs on another connection";

export const KNOWN_ESCAPES: readonly KnownEscape[] = [
  {
    dialect: "mysql",
    key: "* (opened the transaction) \u00b7 select dynamic_collections",
    witness: null,
    reason: REGISTRY,
  },
  {
    dialect: "mysql",
    key: "* (opened the transaction) \u00b7 select dynamic_singles",
    witness: null,
    reason: REGISTRY,
  },
  {
    dialect: "mysql",
    key: "* (opened the transaction) \u00b7 select nextly_webhooks",
    witness: null,
    reason: REGISTRY,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select COLUMNS",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select KEY_COLUMN_USAGE",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select SCHEMATA",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select STATISTICS",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select TABLES",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select TABLE_CONSTRAINTS",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select VIEWS",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select comp_*_locales",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select dc_*_locales",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/archive-entity-kind.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/database/drizzle-kit-lazy.ts#Object.query \u00b7 select single_*_locales",
    witness:
      "packages/nextly/src/domains/i18n/__tests__/enable-translation-dialogs.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 delete nextly_meta",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 insert nextly_meta",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_deliveries",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_one_time_secrets",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_preview_links",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/audit/erase-principal.ts#reportPrincipalDeleted \u00b7 select tables",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 delete nextly_meta",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 insert nextly_meta",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select dc_*",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_deliveries",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_one_time_secrets",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_preview_links",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/collections/services/collection-mutation-service.ts#CollectionMutationService.createEntry \u00b7 checkout",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 delete email_providers",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 delete nextly_meta",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 insert nextly_meta",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_deliveries",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_providers",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_templates",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_meta",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_one_time_secrets",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_preview_links",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/limits/__tests__/database-limit-store.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_limit_store",
    witness:
      "packages/nextly/src/domains/limits/__tests__/database-limit-store.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/notices/notices-service.ts#NoticesService.tablePresent \u00b7 select tables",
    witness: null,
    reason: TIMING,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/schema/pipeline/pushschema-pipeline.ts#<anonymous> (opened the transaction) \u00b7 select nextly_schema_owners",
    witness:
      "packages/nextly/src/auth/__tests__/access-every-way-in.mysql.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/users/services/plaintext-password-cleanup.ts#PlainTextPasswordCleanup.clear (opened the transaction) \u00b7 insert users",
    witness:
      "packages/nextly/src/domains/users/__tests__/plaintext-password-cleanup.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/domains/users/services/plaintext-password-cleanup.ts#PlainTextPasswordCleanup.clear (opened the transaction) \u00b7 update users",
    witness:
      "packages/nextly/src/domains/users/__tests__/plaintext-password-cleanup.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "mysql",
    key: "packages/nextly/src/plugins/__tests__/plugin-db-transaction-dialects.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select txd__marks",
    witness:
      "packages/nextly/src/plugins/__tests__/plugin-db-transaction-dialects.integration.test.ts",
    reason: PLUGIN,
  },
  {
    dialect: "postgresql",
    key: "* (opened the transaction) \u00b7 select dynamic_collections",
    witness: null,
    reason: REGISTRY,
  },
  {
    dialect: "postgresql",
    key: "* (opened the transaction) \u00b7 select dynamic_singles",
    witness: null,
    reason: REGISTRY,
  },
  {
    dialect: "postgresql",
    key: "* (opened the transaction) \u00b7 select nextly_webhooks",
    witness: null,
    reason: REGISTRY,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 delete nextly_meta",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 insert nextly_meta",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_deliveries",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_one_time_secrets",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_preview_links",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/audit/erase-principal.ts#reportPrincipalDeleted \u00b7 select tables",
    witness:
      "packages/nextly/src/domains/audit/__tests__/principal-audit-and-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 delete nextly_meta",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 insert nextly_meta",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select dc_*",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_deliveries",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_one_time_secrets",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_preview_links",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/collections/services/collection-mutation-service.ts#CollectionMutationService.createEntry \u00b7 checkout",
    witness:
      "packages/nextly/src/domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 delete email_providers",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 delete nextly_meta",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 insert nextly_meta",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_deliveries",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_providers",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select email_templates",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_meta",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_one_time_secrets",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_preview_links",
    witness:
      "packages/nextly/src/domains/email/__tests__/principal-delivery-erasure.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/limits/__tests__/database-limit-store.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select nextly_limit_store",
    witness:
      "packages/nextly/src/domains/limits/__tests__/database-limit-store.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/notices/notices-service.ts#NoticesService.tablePresent \u00b7 select tables",
    witness: null,
    reason: TIMING,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/schema/pipeline/pushschema-pipeline.ts#<anonymous> (opened the transaction) \u00b7 select nextly_schema_owners",
    witness:
      "packages/nextly/src/auth/__tests__/access-every-way-in.postgresql.integration.test.ts",
    reason: PIPELINE,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/users/services/plaintext-password-cleanup.ts#PlainTextPasswordCleanup.clear (opened the transaction) \u00b7 insert users",
    witness:
      "packages/nextly/src/domains/users/__tests__/plaintext-password-cleanup.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/domains/users/services/plaintext-password-cleanup.ts#PlainTextPasswordCleanup.clear (opened the transaction) \u00b7 update users",
    witness:
      "packages/nextly/src/domains/users/__tests__/plaintext-password-cleanup.integration.test.ts",
    reason: CALLER,
  },
  {
    dialect: "postgresql",
    key: "packages/nextly/src/plugins/__tests__/plugin-db-transaction-dialects.integration.test.ts#<anonymous> (opened the transaction) \u00b7 select txd__marks",
    witness:
      "packages/nextly/src/plugins/__tests__/plugin-db-transaction-dialects.integration.test.ts",
    reason: PLUGIN,
  },
];
