/**
 * The fingerprint of what bindings are judged against: every collection's,
 * every Single's and every field group's fields, as the registry's schema hash
 * for each says (a field group's fields are judged where a collection or a
 * Single places it), whether
 * a collection's entries carry timestamps, and every registered block's
 * props.
 *
 * Nothing tells a plugin that one of these changed, so the check of every
 * document compares this with the one the last complete check was made
 * against. The engine's own 53-bit hash, not a cryptographic one: a
 * collision only skips a check the next change makes, and nothing here needs
 * a Node built-in, since the plugin's entry is reachable from a browser
 * bundle.
 *
 * @module bindings-report/fingerprint
 */
import { hashId } from "@nextlyhq/blocks-engine";

/** One registry record, as far as the fingerprint reads it. */
interface RegistryRow {
  readonly slug?: unknown;
  readonly schemaHash?: unknown;
  readonly updatedAt?: unknown;
  readonly timestamps?: unknown;
}

/** A block definition, as far as the fingerprint reads it. */
interface BlockRow {
  readonly name: string;
  readonly props?: unknown;
}

/** What the fingerprint is taken over. */
export interface FingerprintSources {
  readonly collections: () => Promise<readonly unknown[]>;
  readonly singles: () => Promise<readonly unknown[]>;
  /** Every field group, whose fields a binding reaches where one is placed. */
  readonly fieldGroups?: () => Promise<readonly unknown[]>;
  /**
   * Every named query's declared rows, by name: a list's item bindings are
   * judged against them, so a change to a query's rows is judged on every
   * page listing it.
   */
  readonly namedQueries?: () => readonly {
    readonly name: string;
    readonly rows: unknown;
  }[];
  readonly blocks: () => readonly BlockRow[];
  /**
   * When a component or a Layout was last saved: a placed component's, or a
   * Layout region's, bindings read the entry of each page drawing it, so a
   * change to one is judged on every page.
   */
  readonly designs?: () => Promise<string>;
}

/** One record's part: its slug and what says its fields changed. */
function recordPart(kind: string, row: unknown): string {
  const record = (
    typeof row === "object" && row !== null ? row : {}
  ) as RegistryRow;
  const slug = typeof record.slug === "string" ? record.slug : "";
  // The schema hash moves with the fields; a record without one falls back to
  // when it was last changed.
  const version =
    typeof record.schemaHash === "string"
      ? record.schemaHash
      : record.updatedAt instanceof Date
        ? record.updatedAt.toISOString()
        : JSON.stringify(record.updatedAt ?? null);
  // Whether its entries carry timestamps, which the fields' hash leaves out
  // and the shapes a binding is judged against list.
  return `${kind}:${slug}:${version}:${record.timestamps === false ? "no-timestamps" : "timestamps"}`;
}

/** The fingerprint of the schema bindings are judged against now. */
export async function schemaFingerprint(
  sources: FingerprintSources
): Promise<string> {
  const [collections, singles, fieldGroups, designs] = await Promise.all([
    sources.collections(),
    sources.singles(),
    sources.fieldGroups?.() ?? Promise.resolve([]),
    sources.designs?.() ?? Promise.resolve(""),
  ]);
  const parts = [
    ...collections.map(row => recordPart("c", row)),
    ...singles.map(row => recordPart("s", row)),
    ...fieldGroups.map(row => recordPart("g", row)),
    ...(sources.namedQueries?.() ?? []).map(
      query => `q:${query.name}:${JSON.stringify(query.rows)}`
    ),
    ...sources
      .blocks()
      .map(block => `b:${block.name}:${JSON.stringify(block.props ?? {})}`),
    `d:${designs}`,
  ].sort();
  return hashId(parts.join("\n"));
}
