/**
 * The schedules plugins declare, collected for the jobs pass.
 *
 * Read and checked as the installation starts, beside the jobs they run, so a
 * schedule that cannot run stops the start that introduced it, naming its
 * plugin, rather than failing quietly on every pass. A disabled plugin
 * contributes none, as it contributes no jobs.
 *
 * A schedule in the earlier shape (`{ name, schedule, handler? }`, published
 * as reserved and never executed) is left as it always was: not run.
 *
 * @module domains/schedules/collect-schedules
 * @experimental
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { NextlyError } from "../../errors";
import type { CollectedJob } from "../../plugins/jobs/collect-jobs";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { isJsonValue } from "../../shared/lib/json-value";
import { normalizeJobSlug } from "../jobs/job-registry";
import { MAX_PORTABLE_KEY_LENGTH } from "../jobs/portable-key";

import { isTimeZone, parseCron, type CronExpression } from "./cron";

/** One schedule, read and checked. */
export interface CollectedSchedule {
  /**
   * `<plugin name>:<schedule slug>@<definition>`, unique across the
   * installation: the definition is a short hash of the cron as parsed and
   * the time zone, so each definition keeps windows of its own.
   */
  readonly key: string;
  readonly plugin: string;
  readonly slug: string;
  readonly cron: CronExpression;
  /** An IANA time zone; UTC when the schedule names none. */
  readonly timeZone: string;
  /** The job each window enqueues: one the plugin itself declares. */
  readonly job: string;
  /** Given to every window's job, beside the window itself. */
  readonly input: Readonly<Record<string, unknown>>;
}

/** The current shape, as declared; values a plugin wrote are checked here. */
const scheduleShape = z.object({
  // Lowercase letters, digits, dots, dashes and underscores: a key the
  // database compares exactly on every dialect, whatever its collation.
  slug: z
    .string()
    .trim()
    .min(1, "its slug is empty")
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      "its slug may hold only lowercase letters, digits, '.', '_' and '-'"
    ),
  cron: z.string(),
  job: z.string(),
  tz: z.string().optional(),
  input: z
    .record(z.string(), z.unknown(), { error: "its input is not an object" })
    .optional(),
});

/**
 * Whether `entry` is in the earlier shape: a `name` and a `schedule`, and
 * neither of the current shape's `slug` and `cron`. Anything else is checked
 * as the current shape, so a misspelled one is refused rather than skipped.
 */
function isEarlierShape(entry: unknown): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "name" in entry &&
    "schedule" in entry &&
    !("slug" in entry) &&
    !("cron" in entry)
  );
}

/** The refusal of `plugin`'s schedule `slug`, saying why it cannot run. */
function refuse(plugin: string, slug: string, reason: string): NextlyError {
  return NextlyError.invalidInput({
    message: `NEXTLY_SCHEDULE_INVALID: plugin "${plugin}" declares schedule "${slug}", which cannot run: ${reason}.`,
    logContext: { plugin, slug },
  });
}

/** `source` read as cron, or the plugin's schedule refused saying why not. */
function cronOf(source: string, plugin: string, slug: string): CronExpression {
  try {
    return parseCron(source);
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    const detail = (error.publicData as { errors?: { message?: string }[] })
      ?.errors?.[0]?.message;
    throw refuse(
      plugin,
      slug,
      detail ?? `"${source}" is not a cron expression`
    );
  }
}

/** The slug an entry names, for a refusal of an entry whose shape is wrong. */
function namedSlug(entry: unknown): string {
  return typeof entry === "object" && entry !== null && "slug" in entry
    ? String(entry.slug)
    : "";
}

/** `entry` in the current shape, or the plugin's schedule refused saying why not. */
function readShape(plugin: string, entry: unknown) {
  const parsed = scheduleShape.safeParse(entry);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  const field = issue?.path.join(".");
  throw refuse(
    plugin,
    namedSlug(entry),
    issue === undefined
      ? "its shape is wrong"
      : field
        ? `${field}: ${issue.message}`
        : issue.message
  );
}

/**
 * What a schedule's windows are read with, as one short, stable tag: the
 * cron as parsed (so `@daily` and `0 0 * * *`, or a change of spacing, are
 * one definition) and the time zone. Any change to either is another tag,
 * and so a schedule seen for the first time.
 */
function definitionTag(cron: CronExpression, timeZone: string): string {
  const field = (values: ReadonlySet<number>) =>
    [...values].sort((a, b) => a - b).join(",");
  const parsed = [
    field(cron.minutes),
    field(cron.hours),
    field(cron.daysOfMonth),
    field(cron.months),
    field(cron.daysOfWeek),
    // Which day fields were written from `*`: it decides how they combine.
    `${cron.anyDayOfMonth ? 1 : 0}${cron.anyDayOfWeek ? 1 : 0}`,
    timeZone,
  ].join(" ");
  return createHash("sha256").update(parsed).digest("base64url").slice(0, 12);
}

/**
 * The key of `plugin`'s schedule `slug` read with `cron` in `timeZone`.
 *
 * @experimental
 */
export function scheduleKeyOf(
  plugin: string,
  slug: string,
  cron: CronExpression,
  timeZone: string
): string {
  return `${plugin}:${slug}@${definitionTag(cron, timeZone)}`;
}

/** The schedule's key, refused when it is too long to store or cannot be stored at all. */
function keyOf(
  plugin: string,
  slug: string,
  cron: CronExpression,
  timeZone: string
): string {
  const key = scheduleKeyOf(plugin, slug, cron, timeZone);
  // Measured in bytes, as MySQL's binary key column stores it: a name of
  // multibyte characters can fit in characters and still be cut short there,
  // and a cut key would never find its own windows.
  if (Buffer.byteLength(key, "utf8") > MAX_PORTABLE_KEY_LENGTH) {
    throw refuse(
      plugin,
      slug,
      `its key "${key}" is longer than ${MAX_PORTABLE_KEY_LENGTH} bytes`
    );
  }
  // PostgreSQL text cannot hold NUL, so such a key's every sweep would fail;
  // the other control characters are refused with it, as no plugin name or
  // slug means one.
  if (/\p{Cc}/u.test(key)) {
    throw refuse(plugin, slug, "its key has a control character in it");
  }
  return key;
}

/** The time zone a schedule names, UTC when none, refused when unknown. */
function timeZoneOf(plugin: string, slug: string, tz: string | undefined) {
  const timeZone = tz ?? "UTC";
  if (!isTimeZone(timeZone)) {
    throw refuse(plugin, slug, `"${timeZone}" is not a time zone`);
  }
  return timeZone;
}

/** The job a schedule runs, refused unless the plugin itself declares it. */
function jobOf(
  plugin: string,
  slug: string,
  job: string,
  ownJobs: ReadonlySet<string>
): string {
  let runs: string;
  try {
    runs = normalizeJobSlug(job);
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    throw refuse(plugin, slug, `its job "${job}" is not a job slug`);
  }
  if (!ownJobs.has(runs)) {
    throw refuse(
      plugin,
      slug,
      `it runs the job "${runs}", which the plugin does not declare`
    );
  }
  return runs;
}

/** One plugin's schedule, read and checked against the jobs it declares. */
function collectOne(
  plugin: string,
  entry: unknown,
  ownJobs: ReadonlySet<string>
): CollectedSchedule {
  const { slug, cron: source, job, tz, input } = readShape(plugin, entry);
  // Stored as JSON with each job: anything a JSON round trip would change or
  // refuse would reach the handler reshaped, or fail every window's enqueue.
  if (input !== undefined && !isJsonValue(input)) {
    throw refuse(plugin, slug, "its input is not plain JSON");
  }
  const cron = cronOf(source, plugin, slug);
  const timeZone = timeZoneOf(plugin, slug, tz);
  return {
    key: keyOf(plugin, slug, cron, timeZone),
    plugin,
    slug,
    cron,
    timeZone,
    job: jobOf(plugin, slug, job, ownJobs),
    input: input ?? {},
  };
}

/**
 * Every enabled plugin's schedules, checked.
 *
 * @throws NextlyError.invalidInput naming the plugin, for a schedule that
 *   cannot run: an invalid cron, an unknown time zone, a job the plugin does
 *   not declare, a slug it uses twice, or input that is not an object.
 */
export function collectSchedules(
  plugins: readonly PluginDefinition[],
  jobs: readonly CollectedJob[]
): CollectedSchedule[] {
  const out: CollectedSchedule[] = [];
  // Keys across the installation, compared as stored, byte for byte: two
  // schedules with one key would share each other's windows.
  const keys = new Set<string>();
  for (const plugin of plugins) {
    // `enabled` is optional and absent means enabled, as for jobs.
    if (plugin.enabled === false) continue;
    const ownJobs = new Set(
      jobs
        .filter(collected => collected.plugin === plugin.name)
        .map(collected => collected.definition.slug)
    );
    const seen = new Set<string>();
    for (const entry of plugin.contributes?.schedules ?? []) {
      // The earlier shape was never executed, and is left so.
      if (isEarlierShape(entry)) continue;
      const schedule = collectOne(plugin.name, entry, ownJobs);
      if (seen.has(schedule.slug)) {
        throw refuse(
          plugin.name,
          schedule.slug,
          "another of the plugin's schedules has the same slug"
        );
      }
      seen.add(schedule.slug);
      if (keys.has(schedule.key)) {
        throw refuse(
          plugin.name,
          schedule.slug,
          `another plugin's schedule has the same key "${schedule.key}"`
        );
      }
      keys.add(schedule.key);
      out.push(schedule);
    }
  }
  return out;
}
