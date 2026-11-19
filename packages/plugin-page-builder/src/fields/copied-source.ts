/**
 * What the stored entry a create copies holds, as a judgement of the copy's
 * page code and custom CSS may count it: text the source already holds is
 * placed on a new entry, not written new, so copying it is no change.
 *
 * Core says a create copies an entry (`write.copiedFrom`) only after reading
 * that entry as the caller in the same call, and names the forms and fields
 * that read could see. So this reads the source's stored value only in those
 * forms, and only from a field that read returned: a draft the caller could
 * not see, or a field a read rule withheld from them, vouches for nothing.
 *
 * @module fields/copied-source
 */
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";

import type { JudgedField } from "./added-undefined-ids";
import { storedReadReaches } from "./lock-baselines";

/** The source's stored values of one field, one per form the caller could see. */
type SourceValues = readonly unknown[];

/**
 * One read per write and field, shared by the page code and the CSS
 * judgements of the same value. Weak, so none outlives its write.
 */
const readsByWrite = new WeakMap<
  PluginFieldWrite,
  Map<string, Promise<SourceValues>>
>();

/**
 * The source field a copied value at `path` came from: the one the create
 * named, or the same path. Null where the caller's read of the source did
 * not return that very path (a field inside a group a read rule withheld is
 * absent though its group is there), or where no stored read can name it.
 */
function sourceFieldOf(
  copy: NonNullable<PluginFieldWrite["copiedFrom"]>,
  path: string
): string | null {
  const field = copy.field ?? path;
  if (!storedReadReaches(field)) return null;
  return copy.fields.includes(field) ? field : null;
}

/** Each form's stored value, read; a form that can't be read vouches nothing. */
async function readSource(
  write: PluginFieldWrite,
  copy: NonNullable<PluginFieldWrite["copiedFrom"]>,
  field: string
): Promise<SourceValues> {
  const values: unknown[] = [];
  for (const form of copy.forms) {
    try {
      const read = await write.readStoredOf({
        collection: copy.collection,
        ids: [copy.id],
        field,
        form,
      });
      const stored = read.get(copy.id);
      if (stored?.kind === "value") values.push(stored.value);
    } catch {
      // A source field that can't be read (a language store not ready)
      // vouches for nothing, so the copy is judged as written new.
    }
  }
  return values;
}

/**
 * The stored values of the entry this create copies, of the field the value
 * being judged came from, in each form the caller's read could see. Empty
 * for a write that copies nothing.
 */
export function copiedSourceValues(args: JudgedField): Promise<SourceValues> {
  const write = args.write;
  const copy = write?.copiedFrom;
  if (write === undefined || copy === undefined) return Promise.resolve([]);
  const field = sourceFieldOf(copy, args.path);
  if (field === null) return Promise.resolve([]);
  let reads = readsByWrite.get(write);
  if (reads === undefined) {
    reads = new Map();
    readsByWrite.set(write, reads);
  }
  let read = reads.get(args.path);
  if (read === undefined) {
    read = readSource(write, copy, field);
    reads.set(args.path, read);
  }
  return read;
}
