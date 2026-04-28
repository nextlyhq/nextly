// Per-dialect type-change warning text. Returned per type_change event so
// the prompt UX surfaces what each engine will do to the user before they
// commit, even when the active dialect is just one of them — useful when
// the user's project ships migrations that may run against a different
// dialect later.

export function buildPerDialectWarning(
  fromType: string,
  toType: string
): { pg: string; mysql: string; sqlite: string } {
  const change = `${fromType} -> ${toType}`;
  return {
    pg: `Postgres: ${change} will fail if any value cannot be cast to ${toType}. Failed apply rolls back the entire transaction.`,
    mysql: `MySQL: ${change} silently coerces non-conforming values (numeric -> 0, invalid date -> 0000-00-00, truncated strings). No error raised.`,
    sqlite: `SQLite: ${change} silently coerces by storage-class rules (text -> 0 for integer affinity). No error raised.`,
  };
}
