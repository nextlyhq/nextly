/**
 * The Drizzle handle the schema bookkeeping repositories are constructed with.
 *
 * `SchemaEventsRepository` and `SchemaOwnersRepository` take their handle as
 * `unknown`, so the schema-domain layer does not leak dialect-specific Drizzle
 * types, and read it through this structural shape: the four query builders
 * they use, in the form all three dialects share.
 *
 * @module domains/schema/events/repository-db
 */

type Rows = Promise<Array<Record<string, unknown>>>;

/**
 * A `select().from()` chain: awaitable as is, or narrowed by `where`, and
 * then awaitable as is or ordered and limited.
 */
type SelectChain = Rows & {
  where: (c: unknown) => Rows & {
    orderBy: (o: unknown) => { limit: (n: number) => Rows };
  };
};

/** Structural shape of the Drizzle methods a schema repository uses. */
export interface RepositoryDb {
  insert: (t: unknown) => {
    values: (v: Record<string, unknown>) => Promise<unknown>;
  };
  select: () => { from: (t: unknown) => SelectChain };
  update: (t: unknown) => {
    set: (v: Record<string, unknown>) => {
      where: (c: unknown) => Promise<unknown>;
    };
  };
  delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> };
}

/** Read a repository's `unknown` handle through the shape it uses. */
export function asRepositoryDb(db: unknown): RepositoryDb {
  return db as RepositoryDb;
}
