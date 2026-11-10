/**
 * The schedules plugins declare, collected for the jobs pass.
 *
 * Read and checked as the installation starts, beside the jobs they run, so a
 * schedule that cannot run stops the start that introduced it, naming its
 * plugin, rather than failing quietly on every pass. A disabled plugin
 * contributes none, as it contributes no jobs.
 *
 * A schedule in the earlier shape (`{ name, schedule, handler? }`, published
 * as reserved and never executed) is mapped to the current one, with a
 * deprecation notice: its `name` is the slug, a cron string or an interval in
 * milliseconds that fits a cron step is the cron, and its handler runs as a
 * job of its own. One that cannot be mapped is left unexecuted, as before,
 * with a notice saying why. Either way it never stops the start: it was
 * published as accepted, so refusing it would break an installation that
 * started yesterday.
 *
 * @module domains/schedules/collect-schedules
 * @experimental
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { NextlyError } from "../../errors";
import type { ScheduledTask } from "../../plugins/contributions";
import type { CollectedJob } from "../../plugins/jobs/collect-jobs";
import type {
  PluginContext,
  PluginDefinition,
} from "../../plugins/plugin-context";
import {
  noticeDeprecation,
  type DeprecationSink,
} from "../../shared/lib/deprecation-notice";
import { isJsonValue } from "../../shared/lib/json-value";
import { defineJob, normalizeJobSlug } from "../jobs/job-registry";
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
    // The reason alone, for the notice an earlier-shape schedule gets instead.
    logContext: { plugin, slug, reason },
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

/** What mapping the earlier shape needs of the installation. */
export interface EarlierScheduleOptions {
  /** Where its deprecation notice, or the notice that it is not run, goes. */
  notice: DeprecationSink;
  /**
   * The started context of `plugin`, which an earlier-shape handler is given
   * when its job runs; none when the plugin was not started in this process.
   */
  contextOf: (plugin: string) => Promise<PluginContext | undefined>;
}

/** The plugins' schedules, and the jobs earlier-shape schedules run. */
export interface CollectedSchedules {
  schedules: CollectedSchedule[];
  /** One per mapped earlier-shape schedule: its handler, as a job. */
  jobs: CollectedJob[];
}

/**
 * An interval in milliseconds as the cron that fires on it: whole hours that
 * divide a day, or whole minutes that divide an hour. Any other interval has
 * no cron that keeps it, so none.
 */
function intervalCron(ms: number): string | undefined {
  if (!Number.isSafeInteger(ms) || ms <= 0) return undefined;
  const HOUR = 3_600_000;
  const MINUTE = 60_000;
  if (ms % HOUR === 0 && 24 % (ms / HOUR) === 0)
    return `0 */${ms / HOUR} * * *`;
  if (ms % MINUTE === 0 && 60 % (ms / MINUTE) === 0) {
    return `*/${ms / MINUTE} * * * *`;
  }
  return undefined;
}

/**
 * `task`, in the earlier shape, as a schedule of the current shape and the
 * job that runs its handler, or refused saying why it cannot be: the same
 * checks as the current shape, on the slug, cron and key it maps to.
 */
function mapEarlier(
  plugin: string,
  task: ScheduledTask,
  declaredJobs: ReadonlySet<string>,
  contextOf: EarlierScheduleOptions["contextOf"]
): { schedule: CollectedSchedule; job: CollectedJob } {
  if (typeof task.name !== "string") {
    throw refuse(plugin, "", "its name is not a string");
  }
  // Trimmed as the current shape's slug is, so the job built from it is the
  // one the registry will hold, and a collision is seen here.
  const slug = task.name.trim();
  const source =
    typeof task.schedule === "number"
      ? intervalCron(task.schedule)
      : typeof task.schedule === "string"
        ? task.schedule
        : undefined;
  if (source === undefined) {
    throw refuse(
      plugin,
      slug,
      typeof task.schedule === "number"
        ? `its interval of ${task.schedule} ms is not whole minutes dividing an hour or whole hours dividing a day, so no cron keeps it`
        : "its schedule is neither a cron expression nor an interval in milliseconds"
    );
  }
  const handler = task.handler;
  if (typeof handler !== "function") {
    throw refuse(plugin, slug, "it has no handler to run");
  }
  // In the plugin's own namespace, apart from the jobs it declares.
  const runs = `${plugin}:schedule:${slug}`;
  if (declaredJobs.has(runs)) {
    throw refuse(
      plugin,
      slug,
      `the job "${runs}" it would run is declared already`
    );
  }
  const schedule = collectOne(
    plugin,
    { slug, cron: source, job: runs },
    new Set([runs])
  );
  const definition = defineJob({
    slug: schedule.job,
    handler: async () => {
      // The context the plugin was started with, as its other code is given.
      const context = await contextOf(plugin);
      if (context === undefined) {
        throw NextlyError.internal({
          logContext: {
            reason: "plugin-not-started",
            plugin,
            slug,
            detail:
              "An earlier-shape schedule's handler needs its plugin started in this process.",
          },
        });
      }
      await handler(context);
    },
  });
  return { schedule, job: { definition, owner: plugin, plugin } };
}

/**
 * Why `error` stopped an earlier-shape schedule, in its own words: a
 * refusal's reason, or what a plugin's own code threw while it was read.
 */
function reasonOf(error: unknown): string {
  if (!NextlyError.is(error)) {
    return `it could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  const reason = (error.logContext as { reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" ? reason : error.message;
}

/** The name an earlier-shape schedule gives itself, as a notice can say it. */
function earlierName(task: ScheduledTask): string {
  try {
    return typeof task.name === "string" ? `"${task.name}"` : "with no name";
  } catch {
    return "with no readable name";
  }
}

/**
 * `task`, in the earlier shape, mapped and handed to `admit`, with a
 * deprecation notice; or, when it cannot be, left unexecuted with a notice
 * saying why. Never refused. The job that runs its handler, when mapped.
 */
function collectEarlier(
  plugin: string,
  task: ScheduledTask,
  declaredJobs: ReadonlySet<string>,
  earlier: EarlierScheduleOptions,
  admit: (schedule: CollectedSchedule) => void
): CollectedJob | undefined {
  // Said once per schedule: each is its own surface.
  const surface = `Plugin "${plugin}"'s schedule ${earlierName(task)} in the { name, schedule, handler } shape`;
  const replacement = "{ slug, cron, job } with a job the plugin declares";
  try {
    const mapped = mapEarlier(plugin, task, declaredJobs, earlier.contextOf);
    admit(mapped.schedule);
    noticeDeprecation({ surface, replacement }, earlier.notice);
    return mapped.job;
  } catch (error) {
    // Anything this entry throws, its own code included, is told, not
    // raised: it never stops the start. Said apart from the deprecation, so
    // a second entry of one name, or one that stops mapping on a reload,
    // is still told it is not run.
    noticeDeprecation(
      {
        surface: `${surface}, not run`,
        replacement,
        message: `${surface} is not run: ${reasonOf(error)}. Declare it as ${replacement} instead.`,
      },
      earlier.notice
    );
    return undefined;
  }
}

/**
 * Hands each schedule of one plugin to `out`, refusing a slug the plugin uses
 * twice or a key another schedule has (`keys`, across the installation).
 */
function admitter(
  plugin: string,
  keys: Set<string>,
  out: CollectedSchedule[]
): (schedule: CollectedSchedule) => void {
  const seen = new Set<string>();
  return schedule => {
    if (seen.has(schedule.slug)) {
      throw refuse(
        plugin,
        schedule.slug,
        "another of the plugin's schedules has the same slug"
      );
    }
    if (keys.has(schedule.key)) {
      throw refuse(
        plugin,
        schedule.slug,
        `another plugin's schedule has the same key "${schedule.key}"`
      );
    }
    seen.add(schedule.slug);
    keys.add(schedule.key);
    out.push(schedule);
  };
}

/**
 * Every enabled plugin's schedules, checked.
 *
 * @throws NextlyError.invalidInput naming the plugin, for a schedule that
 *   cannot run: an invalid cron, an unknown time zone, a job the plugin does
 *   not declare, a slug it uses twice, or input that is not an object. An
 *   earlier-shape schedule is never refused: one that cannot run is told of.
 */
export function collectSchedules(
  plugins: readonly PluginDefinition[],
  jobs: readonly CollectedJob[],
  earlier: EarlierScheduleOptions
): CollectedSchedules {
  const out: CollectedSchedule[] = [];
  const earlierJobs: CollectedJob[] = [];
  const declaredJobs = new Set(jobs.map(job => job.definition.slug));
  // Keys across the installation, compared as stored, byte for byte: two
  // schedules with one key would share each other's windows.
  const keys = new Set<string>();
  // `enabled` is optional and absent means enabled, as for jobs.
  for (const plugin of plugins.filter(each => each.enabled !== false)) {
    const ownJobs = new Set(
      jobs
        .filter(collected => collected.plugin === plugin.name)
        .map(collected => collected.definition.slug)
    );
    const admit = admitter(plugin.name, keys, out);
    const entries = plugin.contributes?.schedules ?? [];
    // The current shape first, wherever it is listed: an earlier-shape entry
    // never takes a slug or key a current one then has to be refused for.
    for (const entry of entries.filter(each => !isEarlierShape(each))) {
      admit(collectOne(plugin.name, entry, ownJobs));
    }
    for (const entry of entries.filter(isEarlierShape)) {
      const job = collectEarlier(
        plugin.name,
        entry as ScheduledTask,
        declaredJobs,
        earlier,
        admit
      );
      if (job !== undefined) earlierJobs.push(job);
    }
  }
  return { schedules: out, jobs: earlierJobs };
}
