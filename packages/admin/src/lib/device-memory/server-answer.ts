/**
 * What the server says of the admin's device memory, read from its startup
 * answer's headers: whether the site lets the admin remember at all, and the
 * schema and permission versions everything remembered is labelled with.
 *
 * The startup answer carries them because it is the one request every fresh
 * tab sends; a page whose startup answer never came asks for them once with
 * the smallest startup request there is.
 *
 * @module lib/device-memory/server-answer
 */
import { BASE_URL } from "@admin/lib/api/fetcher";
import {
  sendStartupRequest,
  startupResponseHeaders,
} from "@admin/lib/api/startup-request";

import {
  applyRememberingSwitch,
  confirmLabels,
  deviceMemorySession,
  discardLabelledMemory,
  type ServerLabels,
} from "./device-memory";

/** The header saying whether the site lets the admin remember (`on`/`off`). */
const DEVICE_MEMORY_HEADER = "X-Nextly-Device-Memory";
/** The header carrying the stored schema version. */
const SCHEMA_VERSION_HEADER = "X-Nextly-Schema-Version";
/** The header carrying the permission version. */
const PERMISSION_VERSION_HEADER = "X-Nextly-Permission-Version";

/**
 * Apply the site's switch from a startup answer's headers. A server that says
 * nothing of it predates the switch, and remembering is on by default.
 */
export function applyServerSwitch(headers: Headers): void {
  const value = headers.get(DEVICE_MEMORY_HEADER)?.trim().toLowerCase();
  applyRememberingSwitch(value !== "off");
}

/** The versions the headers carry, or null when either is missing. */
function versionsOf(headers: Headers): Omit<ServerLabels, "user"> | null {
  const schemaVersion = headers.get(SCHEMA_VERSION_HEADER)?.trim();
  const permissionVersion = headers.get(PERMISSION_VERSION_HEADER)?.trim();
  if (!schemaVersion || !permissionVersion) return null;
  return { schemaVersion, permissionVersion };
}

/** The startup answer's headers, asked for again when this page has none. */
async function serverHeaders(): Promise<Headers | null> {
  const fromStartup = await startupResponseHeaders();
  if (fromStartup !== null) return fromStartup;
  try {
    const response = await sendStartupRequest(BASE_URL, ["/auth/session"]);
    return response.ok ? response.headers : null;
  } catch {
    return null;
  }
}

/**
 * The server confirmed a session for `user` (their id, or the lookup of it
 * under way): label the device memory with the versions it serves,
 * discarding whatever was kept under others. Nothing labelled is written on a
 * page that never learns the versions.
 *
 * The session is the one this page is in when this is called. Should the
 * person be forgotten before the id and the answer arrive (they signed out
 * meanwhile), the answer is about someone who has left and is not applied:
 * applied, it would label the device memory for them again and let what is
 * still drawn for them be kept.
 */
export async function confirmDeviceMemory(
  user: string | PromiseLike<string>
): Promise<void> {
  const session = deviceMemorySession();
  const id = await user;
  const headers = await serverHeaders();
  if (headers === null || session !== deviceMemorySession()) return;
  applyServerSwitch(headers);
  const versions = versionsOf(headers);
  // An answer without both versions cannot vouch for what was kept: it is
  // discarded rather than read as still true.
  if (versions === null) {
    discardLabelledMemory();
    return;
  }
  confirmLabels({ user: id, ...versions });
}
