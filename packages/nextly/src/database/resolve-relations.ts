// Single home for the "which relations config powers db.query right now?"
// policy. Both BaseService and ServiceContainer resolve through here so the
// registry-vs-static-fallback rule can never drift between them.
//
// Resolution is deliberately PER ACCESS, never cached by the consumer: the
// SchemaRegistry invalidates its assembled relations whenever a table is
// (re)registered (relations close over table objects — the "500s until
// restart" bug class), and that invalidation only propagates if consumers
// re-resolve. The cost is two map lookups: the registry caches the relations
// object until invalidation, and the adapters memoize the drizzle instance
// per relations object (WeakMap), so an unchanged schema resolves to the
// exact same instance every time.
//
// Kept separate from database/static-relations.ts on purpose: this module
// imports the DI container, which several legacy unit suites mock around —
// static-relations stays dependency-free so those mocks keep working.

import type { AnyRelations } from "drizzle-orm";

import { container } from "../di/container";

import type { SchemaRegistry, SupportedDialect } from "./schema-registry";
import { getStaticRelations } from "./static-relations";

export function resolveRelations(dialect: SupportedDialect): AnyRelations {
  return container.has("schemaRegistry")
    ? container.get<SchemaRegistry>("schemaRegistry").getRelations()
    : getStaticRelations(dialect);
}
