// PostgreSQL identifier quoting for the fast DDL emitter.
//
// Standard SQL: wrap in double quotes, double any embedded double quote.
// Reject NUL bytes outright (Postgres identifiers cannot contain them and
// they are a classic injection primitive). Table/column names in the
// pipeline originate from collection slugs / field names that the schema
// builder already constrains to [a-z0-9_], but the emitter must not
// assume that — defense in depth, mirroring renderDefaultValue's stance
// in @nextlyhq/adapter-drizzle.
export function quoteIdent(identifier: string): string {
  if (identifier.includes("\0")) {
    throw new Error(
      `Invalid identifier (contains NUL byte): ${JSON.stringify(identifier)}`
    );
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}
