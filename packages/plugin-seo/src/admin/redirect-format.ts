/**
 * How the redirects screen says who added a redirect and when, and when an
 * address not found was last asked for: short, in the reader's own clock.
 *
 * @module admin/redirect-format
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** A day as `Nov 2`, with the year where it is not this one. */
function shortDay(when: Date, now: Date = new Date()): string {
  return when.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** When a redirect was added: `Just now`, or its day. */
function addedWhen(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return now.getTime() - when.getTime() < MINUTE
    ? "Just now"
    : shortDay(when, now);
}

/** When a redirect was added, or edited where it was edited since. */
export function changedWhen(
  addedAt: string | null,
  editedAt: string | null,
  now: Date = new Date()
): string {
  const added = addedAt === null ? Number.NaN : Date.parse(addedAt);
  const edited = editedAt === null ? Number.NaN : Date.parse(editedAt);
  if (!Number.isNaN(edited) && !Number.isNaN(added) && edited - added > 2000) {
    const when = addedWhen(editedAt, now);
    return `Edited ${when === "Just now" ? "just now" : when}`;
  }
  return addedWhen(addedAt, now);
}

/** When an address was last asked for: `2 hours ago`, `Today, 08:12`, `Yesterday`, `Nov 7`. */
export function lastSeenWhen(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const ago = now.getTime() - when.getTime();
  if (ago < MINUTE) return "Just now";
  if (ago < HOUR) {
    const minutes = Math.floor(ago / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (ago < 6 * HOUR) {
    const hours = Math.floor(ago / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (sameDay(when, now)) {
    return `Today, ${when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(when, yesterday)) return "Yesterday";
  return shortDay(when, now);
}

/** A person's initials, for the small circle beside their name. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(part => part !== "")
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("");
}
