/**
 * Taking fields' values out of a component's variants.
 *
 * A variant is a preset of values keyed by exposed field id, and the save
 * refuses one naming a field the component no longer has
 * (`variant-unknown-target`). So whenever fields go, removed in the editor or
 * dropped by a block's upgrade, their values leave every variant. This is the
 * one statement of what that does: which variants lose a value, whether each
 * is left with none, and what each keeps. Each caller applies it to its own
 * document.
 */
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys } from "./safe-record";

/** One variant that loses a value. */
export interface VariantPrune {
  /** The variant's key, which placements store. */
  readonly variant: string;
  /** What the editor calls it: its label, else its key. */
  readonly label: string;
  /** True when it keeps no value, so it now shows the component's defaults. */
  readonly emptied: boolean;
  /** The values it keeps, as a new record. */
  readonly overrides: Record<string, unknown>;
}

/**
 * Each variant that holds a value for one of the fields `gone`, in key order,
 * with the values it keeps. The variants read are not changed. Read within the
 * envelope's entry limit, as the save reads them; a record beyond it, or one
 * that is not a set of variants, loses nothing here.
 */
export function variantPrunes(
  variants: unknown,
  gone: ReadonlySet<string>
): VariantPrune[] {
  if (gone.size === 0 || !isPlainRecord(variants)) return [];
  const prunes: VariantPrune[] = [];
  for (const key of boundedOwnKeys(variants, MAX_ENVELOPE_ENTRIES) ?? []) {
    const variant: unknown = variants[key];
    if (!isPlainRecord(variant)) continue;
    const held = variant.overrides;
    if (!isPlainRecord(held)) continue;
    if (![...gone].some(id => Object.hasOwn(held, id))) continue;
    // Built through `fromEntries`, which defines each key as the record's own,
    // so a stored key such as `__proto__` stays a value, not a prototype.
    const overrides = Object.fromEntries(
      Object.entries(held).filter(([id]) => !gone.has(id))
    );
    prunes.push({
      variant: key,
      label: typeof variant.label === "string" ? variant.label : key,
      emptied: boundedOwnKeys(overrides, 0) !== null,
      overrides,
    });
  }
  return prunes;
}
