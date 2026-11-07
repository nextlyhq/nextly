/**
 * The fingerprint of what bindings are judged against: every collection's and
 * every Single's fields, as the registry's schema hash for each says, and
 * every registered block's props.
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
  readonly blocks: () => readonly BlockRow[];
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
  return `${kind}:${slug}:${version}`;
}

/** The fingerprint of the schema bindings are judged against now. */
export async function schemaFingerprint(
  sources: FingerprintSources
): Promise<string> {
  const [collections, singles] = await Promise.all([
    sources.collections(),
    sources.singles(),
  ]);
  const parts = [
    ...collections.map(row => recordPart("c", row)),
    ...singles.map(row => recordPart("s", row)),
    ...sources
      .blocks()
      .map(block => `b:${block.name}:${JSON.stringify(block.props ?? {})}`),
  ].sort();
  return hashId(parts.join("\n"));
}
