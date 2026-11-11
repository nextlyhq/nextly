import { getPrebuiltHook } from "@admin/components/features/schema-builder/HooksEditor/utils/prebuiltHooks";
import { getObjectShape } from "@admin/components/features/schema-builder/HooksEditor/utils/zodIntrospection";
import type { StoredHookConfig, StoredHookType } from "@admin/types/collection";

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
 * When a stored hook runs, from its STORED phase. The server matches hooks to a
 * write by that stored value, so the admin's own registry entry for the kind,
 * which may name a different phase, is not what decides it.
 */
const WHEN_IT_RUNS: Record<StoredHookType, string> = {
  beforeOperation: "Before any operation on an entry",
  beforeCreate: "Before an entry is created",
  afterCreate: "After an entry is created",
  beforeUpdate: "Before an entry is updated",
  afterUpdate: "After an entry is updated",
  beforeDelete: "Before an entry is deleted",
  afterDelete: "After an entry is deleted",
  beforeRead: "Before entries are read",
  afterRead: "After entries are read",
  beforeChange: "Before an entry is created or updated",
  afterChange: "After an entry is created or updated",
};

/**
 * The stored hooks in the order the server runs them: ascending `order`, as the
 * executor sorts them, with stored position breaking ties (the sort is stable).
 */
export function summarizeStoredHooks(
  hooks: readonly StoredHookConfig[] | undefined
): StoredHookSummary[] {
  if (!hooks || hooks.length === 0) return [];
  return [...hooks].sort((a, b) => a.order - b.order).map(summarize);
}

function summarize(hook: StoredHookConfig): StoredHookSummary {
  const kind = getPrebuiltHook(hook.hookId);
  const config = hook.config ?? {};
  return {
    hookId: hook.hookId,
    known: kind !== undefined,
    name: kind?.name ?? hook.hookId,
    when: WHEN_IT_RUNS[hook.hookType] ?? hook.hookType,
    does: kind
      ? describeKnown(hook.hookId, config)
      : "Not a hook this version of Nextly knows, so it runs nothing.",
    on: hook.enabled,
    settings: kind
      ? declaredSettings(kind.configSchema, config)
      : undeclaredSettings(config, new Set()),
  };
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
