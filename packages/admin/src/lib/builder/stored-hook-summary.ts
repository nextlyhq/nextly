import { z } from "zod";

import {
  getPrebuiltHook,
  type PrebuiltHookConfig,
} from "@admin/components/features/schema-builder/HooksEditor/utils/prebuiltHooks";
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
  /** The stored `order`, which orders hooks within the pass that runs them. */
  order: number | null;
  does: string;
  on: boolean;
  /** Keyed by the stored setting's key, which is unique within one hook. */
  settings: Array<{ key: string; label: string; value: string }>;
}

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
type HookConfig = Record<string, unknown>;

/**
 * The phases the server runs stored hooks in, each with how it reads, in the
 * order the list groups them. A phase missing here (`beforeOperation`,
 * `beforeRead`, or any other string) is never dispatched to stored hooks, so a
 * hook stored with it never runs.
 *
 * The list is grouped by stored phase and claims no single order across
 * groups: each write runs its own passes, and within a pass the server sorts by
 * `order`, which every hook shows. `afterChange` hooks join the after-create
 * and after-update passes and are sorted with them, which their wording says.
 */
const RUNNING_PHASES: ReadonlyArray<readonly [phase: string, when: string]> = [
  ["beforeCreate", "Before an entry is created"],
  ["beforeUpdate", "Before an entry is updated"],
  [
    "beforeChange",
    "Before an entry is created or updated, after that write's own before hooks",
  ],
  ["afterCreate", "After an entry is created"],
  ["afterUpdate", "After an entry is updated"],
  [
    "afterChange",
    "After an entry is created or updated, sorted by order among that write's after hooks",
  ],
  ["beforeDelete", "Before an entry is deleted"],
  ["afterDelete", "After an entry is deleted"],
  ["afterRead", "After entries are read"],
];
const PHASE_GROUP = new Map(RUNNING_PHASES.map(([phase], i) => [phase, i]));
const PHASE_WHEN = new Map(RUNNING_PHASES);
/** After every group that runs: hooks that never run, then unreadable entries. */
const NEVER_RUNS_GROUP = RUNNING_PHASES.length;

/**
 * The phases the provided kinds are made for: each changes or refuses the data
 * of a create or an update. Their sentences describe them there and nowhere
 * else; stored for any other phase they still run, but what they do there is
 * not described rather than guessed.
 */
const MADE_FOR_PHASES: ReadonlySet<string> = new Set([
  "beforeChange",
  "beforeCreate",
  "beforeUpdate",
]);

type Entry =
  | { readable: true; hook: StoredHookEntry }
  | { readable: false; value: unknown };

/**
 * The stored hooks grouped by stored phase, and by ascending `order` within a
 * group; stored position breaks ties (the sort is stable). Hooks that never
 * run, and unreadable entries, come last.
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

function groupOf(entry: Entry): number {
  if (!entry.readable) return NEVER_RUNS_GROUP + 1;
  return PHASE_GROUP.get(entry.hook.hookType) ?? NEVER_RUNS_GROUP;
}

function compareEntries(a: Entry, b: Entry): number {
  const byGroup = groupOf(a) - groupOf(b);
  if (byGroup !== 0 || !a.readable || !b.readable) return byGroup;
  return a.hook.order - b.hook.order;
}

function summarizeEntry(entry: Entry): StoredHookSummary {
  if (entry.readable) return summarize(entry.hook);
  return {
    hookId: "",
    known: false,
    name: "Unreadable entry",
    when: "Unknown",
    order: null,
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
    order: hook.order,
    does: describe(hook, kind),
    on: hook.enabled,
    settings: kind
      ? declaredSettings(kind.configSchema, config)
      : undeclaredSettings(config, new Set()),
  };
}

/**
 * What a hook does. A sentence is given only for a known kind, stored for a
 * phase it is made for, with every declared setting stored and of its type:
 * the server runs a hook with its stored settings unparsed, so a missing or
 * mistyped one changes what it does in ways a sentence would have to guess.
 * Every other stored hook says why it is not described, beside its settings.
 */
function describe(
  hook: StoredHookEntry,
  kind: PrebuiltHookConfig | undefined
): string {
  if (!PHASE_WHEN.has(hook.hookType))
    return "Never runs: the server does not run stored hooks at this point.";
  if (kind === undefined)
    return "Not a hook this version of Nextly knows, so it runs nothing.";
  if (!MADE_FOR_PHASES.has(hook.hookType))
    return "Runs as stored, but what it does is not described here: it is stored for a phase it is not made for.";
  const config = hook.config ?? {};
  const unusable = unusableSettings(kind.configSchema, config);
  if (unusable.length > 0)
    return `Runs as stored, but what it does is not described here: settings missing or of the wrong type (${unusable.join(", ")}).`;
  return describeKnown(hook.hookId, config, hook.hookType);
}

/** The declared settings that are not stored, or not of their declared type. */
function unusableSettings(
  schema: Parameters<typeof getObjectShape>[0],
  config: HookConfig
): string[] {
  return Object.entries(getObjectShape(schema))
    .filter(
      ([key, field]) =>
        config[key] === undefined || !field.safeParse(config[key]).success
    )
    .map(([key]) => key);
}

/**
 * The declared settings first, in the kind's own order and labelled by its
 * schema's descriptions (the labels the hooks editor shows), then any stored
 * key the kind does not declare, by its key.
 */
function declaredSettings(
  schema: Parameters<typeof getObjectShape>[0],
  config: HookConfig
): StoredHookSummary["settings"] {
  const shape = getObjectShape(schema);
  const declared = Object.entries(shape).map(([key, field]) => ({
    key,
    label: field.description || key,
    value: settingValue(config[key]),
  }));
  return [
    ...declared,
    ...undeclaredSettings(config, new Set(Object.keys(shape))),
  ];
}

function undeclaredSettings(
  config: HookConfig,
  declared: ReadonlySet<string>
): StoredHookSummary["settings"] {
  return Object.entries(config)
    .filter(([key]) => !declared.has(key))
    .map(([key, value]) => ({ key, label: key, value: settingValue(value) }));
}

function settingValue(value: unknown): string {
  if (value === undefined || value === null || value === "")
    return NOT_SET_VALUE;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * What each kind does to a create or an update, one sentence per kind, from
 * stored settings already checked to be present and of their types.
 */
const DESCRIBE_KIND: Record<
  string,
  (config: HookConfig, phase: string) => string
> = {
  "auto-slug": config =>
    config.overwriteExisting === true
      ? `Fills ${String(config.targetField)} from ${String(config.sourceField)}, replacing any value already there.`
      : `Fills ${String(config.targetField)} from ${String(config.sourceField)}, unless ${String(config.targetField)} already has a value.`,
  // An update sets only the updater: the creator is written on a create alone,
  // so a hook stored for updates records nothing about who created the entry.
  "audit-fields": (config, phase) =>
    phase === "beforeUpdate"
      ? `Records who last changed an entry in ${String(config.updatedByField)}.`
      : `Records who created an entry in ${String(config.createdByField)}, and who last changed it in ${String(config.updatedByField)}.`,
  "unique-validation": config =>
    `Refuses an entry whose ${String(config.field)} another entry already uses${config.caseInsensitive === true ? ", ignoring case" : ""}, saying "${String(config.errorMessage)}".`,
};

/**
 * A kind this admin provides but has no sentence for falls back to the kind's
 * own description, so a kind added to the registry still reads as something.
 */
function describeKnown(
  hookId: string,
  config: HookConfig,
  phase: string
): string {
  // Own keys only: an id such as "constructor" must not reach Object's.
  return Object.hasOwn(DESCRIBE_KIND, hookId)
    ? DESCRIBE_KIND[hookId](config, phase)
    : (getPrebuiltHook(hookId)?.description ?? "");
}
