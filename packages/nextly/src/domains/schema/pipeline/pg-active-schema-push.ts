/**
 * drizzle-kit's PostgreSQL push, reconciling the schema the installation uses.
 *
 * drizzle-kit reads a table's PostgreSQL schema from the table itself, and
 * every table Nextly builds — core, collection, Single, component, extension —
 * is built without one, which drizzle-kit reads as `public`. Introspecting the
 * configured schema while the desired tables claim `public` makes its differ
 * propose creating `public`, dropping the configured schema, and moving every
 * table between them.
 *
 * So for the push alone, each desired table is told the configured schema, and
 * restored afterwards, and the schema itself is declared beside them: the kit
 * takes the schemas it should keep from the `pgSchema` objects it is handed,
 * so a schema holding the tables but not declared reads as one to drop. The statements drizzle-kit then writes name that schema
 * (`"cms"."users"`), and the qualifier is taken back off: every connection's
 * `search_path` is that schema, so the unqualified statement reaches the same
 * table, and everything that reads the statements afterwards — the drop
 * guard, the unsafe-statement filter, the replay — sees the same text a
 * `public` installation produces. A `public` installation never enters this
 * path at all.
 *
 * @module domains/schema/pipeline/pg-active-schema-push
 */
import { is, Table } from "drizzle-orm";
import { pgSchema, PgTable } from "drizzle-orm/pg-core";

import type { KitHint } from "../../../database/drizzle-kit-lazy";
import {
  activePostgresSchema,
  DEFAULT_POSTGRES_SCHEMA,
} from "../services/postgres-schema";

/** What drizzle-kit's push answers with, as far as this module touches it. */
interface PushAnswer {
  sqlStatements: string[];
  hints: KitHint[];
}

/**
 * Remove `"<schema>".` qualifiers from one statement, outside string literals.
 *
 * Only the exact quoted form drizzle-kit writes is removed, and never inside a
 * single-quoted literal: a default value or a check's text that happens to
 * spell the schema is data, and a sequence named inside `nextval('…')` is
 * resolved by the server through the same `search_path` either way.
 *
 * @param statement - One statement drizzle-kit produced
 * @param schema - The configured schema, already validated as an identifier
 */
export function unqualifySchema(statement: string, schema: string): string {
  const qualifier = `"${schema}".`;
  let out = "";
  let i = 0;
  while (i < statement.length) {
    if (statement[i] === "'") {
      // Copy the literal whole, its doubled quotes included.
      const end = literalEnd(statement, i);
      out += statement.slice(i, end);
      i = end;
    } else if (statement.startsWith(qualifier, i)) {
      i += qualifier.length;
    } else {
      out += statement[i];
      i++;
    }
  }
  return out;
}

/**
 * Where the single-quoted literal opening at `start` ends: the index just past
 * its closing quote, a doubled quote inside it read as part of it. An
 * unterminated literal runs to the end of the statement.
 */
function literalEnd(statement: string, start: number): number {
  let end = start + 1;
  while (end < statement.length) {
    if (statement[end] !== "'") {
      end++;
    } else if (statement[end + 1] === "'") {
      end += 2;
    } else {
      return end + 1;
    }
  }
  return statement.length;
}

/**
 * Run `push` with every desired PostgreSQL table placed in `schema`, then put
 * each table's own schema back, whether the push answered or threw.
 *
 * The tables are shared module objects, so the placement is undone in a
 * `finally`: a query built while the push runs would read the configured
 * schema, which is the schema it reaches through `search_path` anyway.
 */
async function withTablesInSchema<T>(
  imports: Record<string, unknown>,
  schema: string,
  push: () => Promise<T>
): Promise<T> {
  const tables = Object.values(imports).filter((value): value is PgTable =>
    is(value, PgTable)
  );
  const own = tables.map(table => {
    const slot = table as unknown as Record<symbol, unknown>;
    return { slot, schema: slot[Table.Symbol.Schema] };
  });
  for (const { slot } of own) slot[Table.Symbol.Schema] = schema;
  try {
    return await push();
  } finally {
    for (const { slot, schema: previous } of own) {
      slot[Table.Symbol.Schema] = previous;
    }
  }
}

/**
 * The key the configured schema's `pgSchema` object is handed to drizzle-kit
 * under, beside the tables. Only the kit reads the set, and only by value.
 */
const SCHEMA_ENTRY = "__nextlyPostgresSchema";

/**
 * drizzle-kit's push over the configured schema, its answer written as a
 * `public` installation's would be.
 *
 * @param imports - The desired tables
 * @param push - The kit call, given the schema to introspect and the set to
 *   hand drizzle-kit as desired (the tables, plus the schema when it is not
 *   `public`)
 */
export async function pushInActiveSchema<R extends PushAnswer>(
  imports: Record<string, unknown>,
  push: (schema: string, desired: Record<string, unknown>) => Promise<R>
): Promise<R> {
  const schema = activePostgresSchema();
  if (schema === DEFAULT_POSTGRES_SCHEMA) return push(schema, imports);
  const desired = { ...imports, [SCHEMA_ENTRY]: pgSchema(schema) };
  const answer = await withTablesInSchema(imports, schema, () =>
    push(schema, desired)
  );
  return {
    ...answer,
    sqlStatements: answer.sqlStatements.map(statement =>
      unqualifySchema(statement, schema)
    ),
    hints: answer.hints.map(hint =>
      hint.statement === undefined
        ? hint
        : { ...hint, statement: unqualifySchema(hint.statement, schema) }
    ),
  };
}
