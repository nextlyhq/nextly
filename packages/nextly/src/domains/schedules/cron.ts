/**
 * Cron expressions, read in a time zone.
 *
 * Five fields: minute, hour, day of the month, month and day of the week.
 * Each takes `*`, a value, a list (`1,15`), a range (`MON-FRI`) and a step
 * (`*\/15`, `5-10/2`, `5/15`, the last running to the field's end). Months and
 * days may be named in any case, and Sunday is 0 or 7. The `@` aliases stand
 * for their five fields. There is no seconds field: a schedule's finest
 * window is a minute.
 *
 * Read as Vixie cron reads them: when both day fields are restricted, a day
 * matching either one fires. When either is written from `*` (`*`, `*\/2`), a
 * day must match both, so a stepped `*` still names its days.
 *
 * Times are read in the schedule's time zone, UTC by default, from the
 * runtime's own zone data (`Intl`). A local time that a daylight-saving change
 * skips does not fire that day, and one that it repeats fires once, at its
 * first occurrence.
 *
 * @module domains/schedules/cron
 * @experimental
 */
import { NextlyError } from "../../errors";

/** A parsed five-field cron expression. */
export interface CronExpression {
  /** The expression as written. */
  readonly source: string;
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  /** 1 to 31. */
  readonly daysOfMonth: ReadonlySet<number>;
  /** 1 to 12. */
  readonly months: ReadonlySet<number>;
  /** 0 (Sunday) to 6. */
  readonly daysOfWeek: ReadonlySet<number>;
  /** Whether the day-of-month field was written from `*`. */
  readonly anyDayOfMonth: boolean;
  /** Whether the day-of-week field was written from `*`. */
  readonly anyDayOfWeek: boolean;
}

/** The aliases, as the five fields they stand for. */
const ALIASES: Readonly<Record<string, string>> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** One field's bounds, and the names it accepts for its values. */
interface FieldRule {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly names?: readonly string[];
  /** The value the first name stands for. */
  readonly firstNamed?: number;
}

const FIELD_RULES: readonly FieldRule[] = [
  { label: "minute", min: 0, max: 59 },
  { label: "hour", min: 0, max: 23 },
  { label: "day of the month", min: 1, max: 31 },
  { label: "month", min: 1, max: 12, names: MONTH_NAMES, firstNamed: 1 },
  // 7 is Sunday too, folded to 0 once read.
  { label: "day of the week", min: 0, max: 7, names: DAY_NAMES, firstNamed: 0 },
];

/** The refusal of `source`, saying what is wrong with it. */
function invalid(source: string, reason: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "cron",
        code: "invalid_cron",
        message: `"${source}" is not a cron expression: ${reason}.`,
      },
    ],
  });
}

/** One value of a field: a number in its bounds, or one of its names. */
function readValue(token: string, rule: FieldRule, source: string): number {
  if (/^\d+$/.test(token)) {
    const value = Number(token);
    if (value < rule.min || value > rule.max) {
      throw invalid(
        source,
        `the ${rule.label} ${token} is outside ${rule.min}-${rule.max}`
      );
    }
    return value;
  }
  const named = rule.names?.indexOf(token.toLowerCase()) ?? -1;
  if (named < 0) {
    throw invalid(source, `"${token}" is not a ${rule.label}`);
  }
  return named + (rule.firstNamed ?? 0);
}

/** A list item's step: 1 when it names none. */
function readStep(step: string | undefined, source: string): number {
  if (step === undefined) return 1;
  // A safe integer: hundreds of digits read as Infinity, which would step
  // past every value but the first.
  if (
    !/^\d+$/.test(step) ||
    !Number.isSafeInteger(Number(step)) ||
    Number(step) === 0
  ) {
    throw invalid(source, `the step "${step}" is not a positive whole number`);
  }
  return Number(step);
}

/** The values a list item's range spans, before its step. */
function readSpan(
  range: string,
  stepped: boolean,
  rule: FieldRule,
  source: string
): { low: number; high: number } {
  if (range === "*") return { low: rule.min, high: rule.max };
  if (!range.includes("-")) {
    const low = readValue(range, rule, source);
    // `5/15` runs from 5 to the field's end, as Vixie cron reads it.
    return { low, high: stepped ? rule.max : low };
  }
  const [from, to, beyond] = range.split("-");
  if (!from || !to || beyond !== undefined) {
    throw invalid(source, `"${range}" is not a ${rule.label} range`);
  }
  const low = readValue(from, rule, source);
  const high = readValue(to, rule, source);
  if (low > high) {
    throw invalid(source, `the range "${range}" runs backwards`);
  }
  return { low, high };
}

/** Every value one field allows. */
function readField(text: string, rule: FieldRule, source: string): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, step, extra] = part.split("/");
    if (!range || extra !== undefined || step === "") {
      throw invalid(source, `"${part}" is not a ${rule.label} list item`);
    }
    const every = readStep(step, source);
    const { low, high } = readSpan(range, step !== undefined, rule, source);
    for (let value = low; value <= high; value += every) {
      values.add(rule.max === 7 && value === 7 ? 0 : value);
    }
  }
  return values;
}

/**
 * Parse `source`, a five-field expression or an alias.
 *
 * @throws NextlyError.validation naming what is wrong, for anything else.
 */
export function parseCron(source: string): CronExpression {
  const trimmed = source.trim();
  let expanded = trimmed;
  if (trimmed.startsWith("@")) {
    const alias = trimmed.toLowerCase();
    if (!Object.hasOwn(ALIASES, alias)) {
      throw invalid(source, `"${trimmed}" is not a known alias`);
    }
    expanded = ALIASES[alias];
  }
  const fields = expanded.split(/\s+/);
  if (fields.length !== 5 || fields[0] === "") {
    throw invalid(source, "it needs exactly five fields");
  }
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = fields.map(
    (text, index) => readField(text, FIELD_RULES[index], source)
  );
  const anyDayOfMonth = fields[2].startsWith("*");
  const anyDayOfWeek = fields[4].startsWith("*");
  // With the weekday written from `*`, a day must be one of the named dates:
  // a date no month has (30 February) would never fire, and would pass
  // start-up only to stay silent on every pass.
  if (!anyDayOfMonth && anyDayOfWeek && !someDateExists(daysOfMonth, months)) {
    throw invalid(
      source,
      "no month it names has the day of the month it names"
    );
  }
  return {
    source,
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    anyDayOfMonth,
    anyDayOfWeek,
  };
}

/** The most days each month has, 29 for February in a leap year. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Whether any of `months` has any of `days`. */
function someDateExists(
  days: ReadonlySet<number>,
  months: ReadonlySet<number>
): boolean {
  for (const month of months) {
    for (const day of days) {
      if (day <= MONTH_DAYS[month - 1]) return true;
    }
  }
  return false;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
/**
 * How far a search runs before deciding the expression never fires: the
 * Gregorian calendar repeats every 400 years, so a date and weekday pair as
 * rare as a Sunday 29 February is found within it.
 */
const SEARCH_LIMIT = 400 * 366 * DAY;

/**
 * A local wall-clock time is held as the epoch milliseconds that time would
 * have in UTC, so its fields are read with the `getUTC*` methods and moved
 * with `Date.UTC`, free of the process's own zone.
 */
type WallClock = number;

/** A wall-clock minute as a date and the fields the searches step through. */
function fieldsOf(at: WallClock) {
  const d = new Date(at);
  return {
    d,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
  };
}

/** Whether `cron` fires on the day `at` falls on. */
function firesOnDay(cron: CronExpression, at: Date): boolean {
  const byDate = cron.daysOfMonth.has(at.getUTCDate());
  const byWeekday = cron.daysOfWeek.has(at.getUTCDay());
  if (cron.anyDayOfMonth || cron.anyDayOfWeek) return byDate && byWeekday;
  return byDate || byWeekday;
}

/**
 * The first wall-clock minute at or after `from` that `cron` names, or null
 * when none falls within the search limit.
 */
function nextWallClock(
  cron: CronExpression,
  from: WallClock
): WallClock | null {
  const limit = from + SEARCH_LIMIT;
  let at = from;
  while (at <= limit) {
    const { d, year, month, day, hour } = fieldsOf(at);
    if (!cron.months.has(month + 1)) at = Date.UTC(year, month + 1, 1);
    else if (!firesOnDay(cron, d)) at = Date.UTC(year, month, day + 1);
    else if (!cron.hours.has(hour)) at = Date.UTC(year, month, day, hour + 1);
    else if (!cron.minutes.has(d.getUTCMinutes())) at += MINUTE;
    else return at;
  }
  return null;
}

/**
 * The last wall-clock minute at or before `from` that `cron` names, or null
 * when none falls within the search limit.
 */
function previousWallClock(
  cron: CronExpression,
  from: WallClock
): WallClock | null {
  const limit = from - SEARCH_LIMIT;
  let at = from;
  while (at >= limit) {
    const { d, year, month, day, hour } = fieldsOf(at);
    // Each step lands on the last minute of the unit before.
    if (!cron.months.has(month + 1)) at = Date.UTC(year, month, 1) - MINUTE;
    else if (!firesOnDay(cron, d)) at = Date.UTC(year, month, day) - MINUTE;
    else if (!cron.hours.has(hour))
      at = Date.UTC(year, month, day, hour) - MINUTE;
    else if (!cron.minutes.has(d.getUTCMinutes())) at -= MINUTE;
    else return at;
  }
  return null;
}

/** Formatters by zone: building one is the costly part of reading a time. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      });
    } catch {
      throw NextlyError.validation({
        errors: [
          {
            path: "tz",
            code: "invalid_time_zone",
            message: `"${timeZone}" is not a time zone.`,
          },
        ],
      });
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether `name` is a time zone this runtime knows. */
export function isTimeZone(name: string): boolean {
  if (!name) return false;
  try {
    formatterFor(name);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock minute `instant` shows in `timeZone`. */
function wallClockOf(instant: number, timeZone: string): WallClock {
  if (timeZone === "UTC") return instant - (instant % MINUTE);
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
}

/**
 * Every instant that shows `wallClock` in `timeZone`, earliest first: one
 * ordinarily, none for a time a daylight-saving change skips, two for one it
 * repeats. Found from the offsets in force a day either side, which covers
 * any change.
 */
function instantsShowing(wallClock: WallClock, timeZone: string): number[] {
  if (timeZone === "UTC") return [wallClock];
  const offsets = new Set(
    [wallClock - DAY, wallClock, wallClock + DAY].map(
      probe => wallClockOf(probe, timeZone) - (probe - (probe % MINUTE))
    )
  );
  return [...offsets]
    .map(offset => wallClock - offset)
    .filter(instant => wallClockOf(instant, timeZone) === wallClock)
    .filter((instant, index, all) => all.indexOf(instant) === index)
    .sort((a, b) => a - b);
}

/**
 * When `cron` fires at the wall-clock minute `wallClock`: its first
 * occurrence, so a repeated time fires once; undefined for a skipped one.
 */
function fireOf(wallClock: WallClock, timeZone: string): number | undefined {
  return instantsShowing(wallClock, timeZone)[0];
}

/**
 * The first time `cron` fires after `after`, in `timeZone`; null when it
 * never does within a calendar cycle.
 */
export function nextFireAfter(
  cron: CronExpression,
  after: Date,
  timeZone = "UTC"
): Date | null {
  // A moment that is not one has no fire after it, in any zone.
  if (Number.isNaN(after.getTime())) return null;
  const limit = after.getTime() + SEARCH_LIMIT;
  let from = wallClockOf(after.getTime(), timeZone);
  for (;;) {
    const candidate = nextWallClock(cron, from);
    if (candidate === null) return null;
    const fire = fireOf(candidate, timeZone);
    // After a time repeated by a fall-back, wall clocks run behind the first
    // pass, so their fires may lie before `after`: those were already had.
    if (fire !== undefined && fire > after.getTime()) return new Date(fire);
    if (fire !== undefined && fire > limit) return null;
    from = candidate + MINUTE;
  }
}

/**
 * The latest time `cron` fired at or before `at`, in `timeZone`; null when it
 * did not within a calendar cycle.
 */
export function latestFireAtOrBefore(
  cron: CronExpression,
  at: Date,
  timeZone = "UTC"
): Date | null {
  if (Number.isNaN(at.getTime())) return null;
  const limit = at.getTime() - SEARCH_LIMIT;
  let from = wallClockOf(at.getTime(), timeZone);
  let latest: number | undefined;
  while (latest === undefined) {
    const candidate = previousWallClock(cron, from);
    if (candidate === null) return null;
    const fire = fireOf(candidate, timeZone);
    if (fire !== undefined && fire <= at.getTime()) latest = fire;
    else if (fire !== undefined && fire < limit) return null;
    else from = candidate - MINUTE;
  }
  // Searched backwards by wall clock, a time repeated by a fall-back can be
  // met before a later fire of its first pass: walk forward to the last fire
  // at or before `at`. A change repeats at most a few hours, so a day of
  // minutes bounds the walk.
  for (let step = 0; step < DAY / MINUTE; step += 1) {
    const later = nextFireAfter(cron, new Date(latest), timeZone);
    if (later === null || later.getTime() > at.getTime()) break;
    latest = later.getTime();
  }
  return new Date(latest);
}
