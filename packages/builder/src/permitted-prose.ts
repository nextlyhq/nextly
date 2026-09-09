/**
 * Turning a permitted-types list into words an author reads.
 *
 * The nesting rule answers with registry SPECIFIERS — `core/columns`,
 * `acme/card`, or a namespace wildcard like `core/*` — and none of those is
 * something to put in front of a person. Told that a block "goes inside
 * core/columns", an author has to know how this project names its modules
 * before they can act on the sentence.
 *
 * One home, because two surfaces now say it. The drag refusal has said it since
 * drops were explained; the composition refusal says it about a selection that
 * cannot be saved. Written twice they would agree today and differ the first
 * time either learned about a new kind of entry — and a wildcard is exactly that
 * kind of entry, which is why the naive reading produces "goes inside *".
 *
 * @module permitted-prose
 */

import { blockLabel } from "./inserter";

/**
 * One entry of a permitted list, as an author reads it.
 *
 * A slot may admit a whole NAMESPACE rather than named types — `nesting.ts`
 * matches an entry ending `/*` as a prefix — and such an entry is not a block
 * name. Sending it through {@link blockLabel} humanises it into the bare `"*"`,
 * so a slot admitting everything core would announce "Takes *".
 *
 * The group is named instead. It is deliberately lower case where a block label
 * is not: "any core block" is a description of a set, and capitalising it would
 * dress it as the name of a block that does not exist.
 */
export function permittedLabel(entry: string): string {
  if (!entry.endsWith("/*")) return blockLabel(entry);
  const namespace = entry.slice(0, -2);
  return namespace === "" ? "any block" : `any ${namespace} block`;
}

/**
 * The permitted types as prose.
 *
 * A sentence an author reads rather than a set they scan, so it takes a word
 * rather than a delimiter. Two members join without a comma; three or more take
 * commas up to the last.
 *
 * The joiner is the caller's because it carries meaning: a list of containers a
 * block may sit in is alternatives an author picks between — "or" — while a
 * list of what a slot holds is an enumeration — "and".
 */
export function asPermittedList(
  labels: readonly string[],
  joiner: string
): string {
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} ${joiner} ${labels[1]}`;
  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(", ")} ${joiner} ${last}`;
}
