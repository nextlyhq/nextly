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
import { z } from "zod";

import { NextlyError } from "../../errors";
import type { CollectedJob } from "../../plugins/jobs/collect-jobs";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { normalizeJobSlug } from "../jobs/job-registry";
import { MAX_PORTABLE_KEY_LENGTH } from "../jobs/portable-key";

import { isTimeZone, parseCron, type CronExpression } from "./cron";

/** One schedule, read and checked. */
export interface CollectedSchedule {
  /** `<plugin name>:<schedule slug>`, unique across the installation. */
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
  slug: z.string().trim().min(1, "its slug is empty"),
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

/** The schedule's key, refused when it is too long to store. */
function keyOf(plugin: string, slug: string): string {
  const key = `${plugin}:${slug}`;
  if (key.length > MAX_PORTABLE_KEY_LENGTH) {
    throw refuse(
      plugin,
      slug,
      `its key "${key}" is longer than ${MAX_PORTABLE_KEY_LENGTH} characters`
    );
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
  const runs = normalizeJobSlug(job);
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
  const { slug, cron, job, tz, input } = readShape(plugin, entry);
  return {
    key: keyOf(plugin, slug),
    plugin,
    slug,
    cron: cronOf(cron, plugin, slug),
    timeZone: timeZoneOf(plugin, slug, tz),
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
      out.push(schedule);
    }
  }
  return out;
}
