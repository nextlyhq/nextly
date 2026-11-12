/**
 * A store for one interface preference, kept by the device memory's rules,
 * for code outside the admin's own (an editor a plugin mounts) and for the
 * admin's own preferences kept under a key of the host's spelling (the
 * theme). Its own module, with nothing but explicit types in what it
 * exports, so it can be published without the device memory's internals.
 *
 * @module lib/device-memory/preference-store
 */
import {
  forgetHeldPreference,
  forgetTabPreference,
  keepHeldPreference,
  recallHeldPreference,
  recallTabPreference,
  registerPreferenceKey,
  rememberTabPreference,
} from "./device-memory";

/** One interface preference, read and written by the device memory's rules. */
export interface DevicePreferenceStore {
  /** The preference, or null when none is kept or held. */
  read: () => string | null;
  /** Keep the preference; never throws. */
  write: (value: string) => void;
  /** Remove the preference, wherever it is kept or held; never throws. */
  remove: () => void;
}

/** How long a preference is kept. */
export interface DevicePreferenceOptions {
  /**
   * `"device"` (the default) keeps it in this browser's storage; `"tab"`
   * keeps it in the tab's session storage, for a working choice not worth
   * keeping past the tab.
   */
  lifetime?: "device" | "tab";
}

/**
 * A store for one interface preference under `key`, so the person's choices
 * follow the same rules as the admin's own:
 *
 * - while the site turns remembering off, nothing is written to storage and
 *   the choice holds for this page alone;
 * - signing out forgets it, with everything else about the person, in every
 *   tab, and from then on it reads as nothing;
 * - it never reads or writes the admin's own records (the device memory's
 *   entries, the record that someone signed in here).
 *
 * Storage that refuses is answered as the off switch is: the choice holds for
 * the page.
 */
export function devicePreferenceStore(
  key: string,
  { lifetime = "device" }: DevicePreferenceOptions = {}
): DevicePreferenceStore {
  // Registered so the forgetting reaches it whatever its spelling.
  registerPreferenceKey(key);
  if (lifetime === "tab") {
    return {
      read: () => recallTabPreference(key),
      write: value => rememberTabPreference(key, value),
      remove: () => forgetTabPreference(key),
    };
  }
  return {
    read: () => recallHeldPreference(key),
    write: value => keepHeldPreference(key, value),
    remove: () => forgetHeldPreference(key),
  };
}
