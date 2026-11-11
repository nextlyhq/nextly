import { z } from "zod";

import { getPrebuiltHook } from "@admin/components/features/schema-builder/HooksEditor/utils/prebuiltHooks";
import { getObjectShape } from "@admin/components/features/schema-builder/HooksEditor/utils/zodIntrospection";

/**
 * A collection's stored hook, described for reading: what it does to writes,
 * when it runs, its settings and whether it is on. The Builder shows these
 * read-only, so nothing here ever turns back into a stored hook.
 */
export interface StoredHookSummary {
  hookId: string;
  /** False for a hook id this version does not provide: the server skips it. */
  known: boolean;
  name: string;
  when: string;
  does: string;
  on: boolean;
  settings: Array<{ label: string; value: string }>;
}

/** Shown where a stored setting is absent: the hook runs with it missing. */
const NOT_SET_IN_SENTENCE = "(not set)";
const NOT_SET_VALUE = "Not set";

/**
 * One stored entry, parsed at the boundary. The collection API stores `hooks`
 * as an array of anything, so an entry may be null or the wrong shape; such an
 * entry is shown as unreadable rather than read as a hook. `hookType` stays a
 * string: a phase this admin does not name is still a stored fact to show.
 */
const storedHookEntry = z.object({
  hookId: z.string(),
  hookType: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
  order: z.number(),
});
type StoredHookEntry = z.infer<typeof storedHookEntry>;

/**
 * The phases the server runs stored hooks in, in lifecycle sequence, and how
 * each reads. A phase missing here (`beforeOperation`, `beforeRead`, or any
 * other string) is never dispatched to stored hooks, so a hook stored with it
 * never runs. The server orders hooks by `order` only within a phase, so the
 * list is grouped by this sequence first.
 */
const RUNNING_PHASES: ReadonlyArray<readonly [phase: string, when: string]> = [
  ["beforeChange", "Before an entry is created or updated"],
  ["beforeCreate", "Before an entry is created"],
  ["beforeUpdate", "Before an entry is updated"],
  ["beforeDelete", "Before an entry is deleted"],
  ["afterChange", "After an entry is created or updated"],
  ["afterCreate", "After an entry is created"],
  ["afterUpdate", "After an entry is updated"],
  ["afterDelete", "After an entry is deleted"],
  ["afterRead", "After entries are read"],
];
const PHASE_RANK = new Map(RUNNING_PHASES.map(([phase], i) => [phase, i]));
const PHASE_WHEN = new Map(RUNNING_PHASES);

/**
 * Where the provided kinds act. Each changes or refuses the data being written,
 * which only takes effect before a create or an update: after the write the
 * server ignores what a hook returns, and before a delete there is nothing
 * being written.
 */
const ACTING_PHASES: ReadonlySet<string> = new Set([
  "beforeChange",
  "beforeCreate",
  "beforeUpdate",
]);

type Entry =
  | { readable: true; hook: StoredHookEntry }
  | { readable: false; value: unknown };

/**
 * The stored hooks grouped by when they run, in lifecycle sequence, and by
 * ascending `order` within each phase, as the executor sorts them; stored
 * position breaks ties (the sort is stable). Hooks that never run, and
 * unreadable entries, come last.
 */
export function summarizeStoredHooks(
  hooks: readonly unknown[] | undefined
): StoredHookSummary[] {
  if (!hooks || hooks.length === 0) return [];
  const entries: Entry[] = hooks.map(value => {
    const parsed = storedHookEntry.safeParse(value);
    return parsed.success
      ? { readable: true, hook: parsed.data }
      : { readable: false, value };
  });
  return [...entries].sort(compareEntries).map(summarizeEntry);
}

function rankOf(entry: Entry): number {
  if (!entry.readable) return RUNNING_PHASES.length + 1;
  return PHASE_RANK.get(entry.hook.hookType) ?? RUNNING_PHASES.length;
}

function compareEntries(a: Entry, b: Entry): number {
  const byPhase = rankOf(a) - rankOf(b);
  if (byPhase !== 0 || !a.readable || !b.readable) return byPhase;
  return a.hook.order - b.hook.order;
}

function summarizeEntry(entry: Entry): StoredHookSummary {
  if (entry.readable) return summarize(entry.hook);
  return {
    hookId: "",
    known: false,
    name: "Unreadable entry",
    when: "Unknown",
    does: "This stored entry is not in the shape a hook is stored in, so what it does cannot be shown.",
    on: false,
    settings: [],
  };
}

function summarize(hook: StoredHookEntry): StoredHookSummary {
  const kind = getPrebuiltHook(hook.hookId);
  const config = hook.config ?? {};
  return {
    hookId: hook.hookId,
    known: kind !== undefined,
    name: kind?.name ?? hook.hookId,
    when:
      PHASE_WHEN.get(hook.hookType) ?? `Never (stored as "${hook.hookType}")`,
    does: describe(hook, kind?.name),
    on: hook.enabled,
    settings: kind
      ? declaredSettings(kind.configSchema, config)
      : undeclaredSettings(config, new Set()),
  };
}

/**
 * What a hook does, given both its kind and its stored phase: a phase the
 * server never runs stored hooks in, an unknown kind, and a known kind stored
 * where it cannot act each say so instead of describing an effect.
 */
function describe(hook: StoredHookEntry, kindName: string | undefined): string {
  if (!PHASE_WHEN.has(hook.hookType))
    return "Never runs: the server does not run stored hooks at this point.";
  if (kindName === undefined)
    return "Not a hook this version of Nextly knows, so it runs nothing.";
  if (!ACTING_PHASES.has(hook.hookType))
    return `Runs, but changes nothing: ${kindName} only acts before an entry is created or updated.`;
  return describeKnown(hook.hookId, hook.config ?? {});
}

/**
 * The declared settings first, in the kind's own order and labelled by its
 * schema's descriptions (the labels the hooks editor shows), then any stored
 * key the kind does not declare, by its key.
 */
function declaredSettings(
  schema: Parameters<typeof getObjectShape>[0],
  config: Record<string, unknown>
): Array<{ label: string; value: string }> {
  const shape = getObjectShape(schema);
  const declared = Object.entries(shape).map(([key, field]) => ({
    label: field.description || key,
    value: settingValue(config[key]),
  }));
  return [
    ...declared,
    ...undeclaredSettings(config, new Set(Object.keys(shape))),
  ];
}

function undeclaredSettings(
  config: Record<string, unknown>,
  declared: ReadonlySet<string>
): Array<{ label: string; value: string }> {
  return Object.entries(config)
    .filter(([key]) => !declared.has(key))
    .map(([key, value]) => ({ label: key, value: settingValue(value) }));
}

function settingValue(value: unknown): string {
  if (value === undefined || value === null || value === "")
    return NOT_SET_VALUE;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** A stored field name as it reads inside a sentence. */
function named(value: unknown): string {
  return typeof value === "string" && value !== ""
    ? value
    : NOT_SET_IN_SENTENCE;
}

type HookConfig = Record<string, unknown>;

/**
 * What each kind does to a write, from its stored settings, one sentence per
 * kind. Worded from the server's behaviour for that kind, which runs with the
 * stored values as they are: no default is assumed for a setting that is
 * missing.
 */
const DESCRIBE_KIND: Record<string, (config: HookConfig) => string> = {
  "auto-slug": config => {
    const target = named(config.targetField);
    const source = named(config.sourceField);
    return config.overwriteExisting === true
      ? `Fills ${target} from ${source}, replacing any value already there.`
      : `Fills ${target} from ${source}, unless ${target} already has a value.`;
  },
  "audit-fields": config =>
    `Records who created an entry in ${named(config.createdByField)}, and who last changed it in ${named(config.updatedByField)}.`,
  "unique-validation": config =>
    `Refuses an entry whose ${named(config.field)} another entry already uses${ignoringCase(config)}${refusalMessage(config)}.`,
};

function ignoringCase(config: HookConfig): string {
  return config.caseInsensitive === true ? ", ignoring case" : "";
}

function refusalMessage(config: HookConfig): string {
  const message = config.errorMessage;
  return typeof message === "string" && message !== ""
    ? `, saying "${message}"`
    : "";
}

/**
 * A kind this admin provides but has no sentence for falls back to the kind's
 * own description, so a kind added to the registry still reads as something.
 */
function describeKnown(hookId: string, config: HookConfig): string {
  // Own keys only: an id such as "constructor" must not reach Object's.
  return Object.hasOwn(DESCRIBE_KIND, hookId)
    ? DESCRIBE_KIND[hookId](config)
    : (getPrebuiltHook(hookId)?.description ?? "");
}
