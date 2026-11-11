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
import { startupResponseHeaders } from "@admin/lib/api/startup-request";

import {
  applyRememberingSwitch,
  confirmLabels,
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
    const response = await fetch(
      `${BASE_URL}/startup?path=${encodeURIComponent("/auth/session")}`,
      { credentials: "include", headers: { accept: "application/json" } }
    );
    return response.ok ? response.headers : null;
  } catch {
    return null;
  }
}

/**
 * The server confirmed a session for `user`: label the device memory with
 * the versions it serves, discarding whatever was kept under others. Nothing
 * labelled is written on a page that never learns the versions.
 */
export async function confirmDeviceMemory(user: string): Promise<void> {
  const headers = await serverHeaders();
  if (headers === null) return;
  applyServerSwitch(headers);
  const versions = versionsOf(headers);
  if (versions === null) return;
  confirmLabels({ user, ...versions });
}
