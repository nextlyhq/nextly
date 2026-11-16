/**
 * The moves a change made in code may hold. Code says only what the fields are now, so a field
 * that left one container and one of the same name and type that arrived in another may be one
 * field moved, or one deleted and one added. Each candidate is asked about, as a rename is; this
 * module only finds them, and none is taken without an answer.
 *
 * A candidate is left out where the answer would be a different change: a type changed with the
 * move, two places a field could have gone, or a container renamed, whose fields are all at new
 * paths though none of them moved.
 *
 * @module domains/schema/field-moves/move-candidates
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { addressableFields } from "../../../shared/addressable-fields";

import type { FieldMoveRequest } from "./check-move";

interface NamedAt {
  path: readonly string[];
  field: FieldDefinition;
}

function nameOf(field: FieldDefinition): string | undefined {
  const { name } = field as { name?: unknown };
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/**
 * Every named field at every depth, with its path; a group with no name is looked through. Walked
 * with a queue, a container entered again only on another path: a container used under two
 * parents is seen under both, and one that holds itself (possible in code) ends, since the
 * containers above a path are never entered again below it.
 */
function everyField(fields: readonly FieldDefinition[]): NamedAt[] {
  const out: NamedAt[] = [];
  const pending: {
    list: readonly FieldDefinition[];
    above: readonly string[];
    holders: ReadonlySet<object>;
  }[] = [{ list: fields, above: [], holders: new Set() }];
  while (pending.length > 0) {
    const { list, above, holders } = pending.shift() as (typeof pending)[number];
    for (const field of addressableFields(list) as unknown as FieldDefinition[]) {
      const name = nameOf(field);
      if (!name) continue;
      const path = [...above, name];
      out.push({ path, field });
      const { fields: inner } = field as { fields?: unknown };
      if (Array.isArray(inner) && !holders.has(field)) {
        pending.push({
          list: inner as FieldDefinition[],
          above: path,
          holders: new Set([...holders, field]),
        });
      }
    }
  }
  return out;
}

const key = (path: readonly string[]) => path.join("\u0000");

/** The moves `before` to `after` may hold, to be asked about one by one. */
export function moveCandidates(
  before: readonly FieldDefinition[],
  after: readonly FieldDefinition[]
): FieldMoveRequest[] {
  const was = everyField(before);
  const now = everyField(after);
  const wasAt = new Set(was.map(each => key(each.path)));
  const nowAt = new Set(now.map(each => key(each.path)));
  const gone = was.filter(each => !nowAt.has(key(each.path)));
  const arrived = now.filter(each => !wasAt.has(key(each.path)));
  const leaf = (each: NamedAt) => each.path[each.path.length - 1];
  const parent = (each: NamedAt) => each.path.slice(0, -1);

  const candidates: FieldMoveRequest[] = [];
  for (const from of gone) {
    const matches = arrived.filter(
      to => leaf(to) === leaf(from) && to.field.type === from.field.type
    );
    if (matches.length !== 1) continue;
    const [to] = matches;
    // The same name may also have left elsewhere: then which one moved is not known.
    const rivals = gone.filter(
      other => leaf(other) === leaf(to) && other.field.type === to.field.type
    );
    if (rivals.length !== 1) continue;
    // A container that left while one arrived in its place was renamed or replaced: its fields
    // are at new paths without having moved.
    const fromParent = parent(from);
    const toParent = parent(to);
    const containerReplaced =
      fromParent.length > 0 &&
      toParent.length > 0 &&
      !nowAt.has(key(fromParent)) &&
      !wasAt.has(key(toParent));
    if (containerReplaced) continue;
    candidates.push({ from: from.path, to: to.path });
  }
  return candidates;
}
