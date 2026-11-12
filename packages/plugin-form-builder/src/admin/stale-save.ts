/**
 * A save refused only because the plugin wrote the form since it was read.
 *
 * Changing how a form tells people apart can leave the plugin to finish
 * giving earlier submissions their keys in the background, and when it does
 * it records so on the form (`settings.oneResponseKeyedVersion`), which moves
 * the form's revision on. An editor still open on the revision it read would
 * then be refused its next save as if someone else had changed the form.
 *
 * So a save refused as out of date reads the stored form and compares only
 * what the save sends, as it stood when the editor read it: when none of it
 * changed but the plugin's own one-response versions, the save is sent again
 * on the stored revision. A save sends only those keys, so sending it again
 * cannot overwrite anyone's change; any other difference keeps the refusal.
 *
 * @module admin/stale-save
 */

/** Settings the plugin writes for itself, never the editor. */
const PLUGIN_SETTINGS = ["oneResponseVersion", "oneResponseKeyedVersion"];

/** JSON with every object's keys in one order, so equal values read equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : inner
  );
}

/** What of `doc` a save of `keys` writes, without the plugin's own settings. */
function sentPartOf(doc: Record<string, unknown>, keys: string[]): string {
  return stableJson(
    Object.fromEntries(
      keys.map(key => {
        const value = doc[key];
        if (key !== "settings" || value === null || typeof value !== "object") {
          return [key, value ?? null];
        }
        const settings = { ...(value as Record<string, unknown>) };
        for (const own of PLUGIN_SETTINGS) delete settings[own];
        return [key, settings];
      })
    )
  );
}

/** The error code a refused save answered with. */
async function refusalCode(refused: Response): Promise<unknown> {
  const body: unknown = await refused
    .clone()
    .json()
    .catch(() => undefined);
  return (body as { error?: { code?: unknown } } | undefined)?.error?.code;
}

/**
 * The stored revision to send a refused save again on, or undefined to keep
 * the refusal: anything but a refusal as out of date, an editor with no copy
 * of what it read, a form that cannot be read, or one whose stored values of
 * what the save sends differ from what the editor read.
 */
export async function revisionToRetryOn(input: {
  refused: Response;
  /** The form's own address, read with GET. */
  url: string;
  /** What the save sent. */
  sent: Record<string, unknown>;
  /** The form as the editor read it, or as its last save answered. */
  readAs: Record<string, unknown> | undefined;
}): Promise<string | undefined> {
  const { refused, readAs } = input;
  if (refused.status !== 409 || readAs === undefined) return undefined;
  if ((await refusalCode(refused)) !== "STALE_VERSION") return undefined;
  const response = await fetch(input.url, { credentials: "include" });
  if (!response.ok) return undefined;
  // The admin answers a read with the document itself; `{ item }` too.
  const body = (await response.json().catch(() => undefined)) as
    | (Record<string, unknown> & { item?: Record<string, unknown> })
    | undefined;
  const stored = body?.item ?? body;
  if (!stored) return undefined;
  const keys = Object.keys(input.sent);
  if (sentPartOf(stored, keys) !== sentPartOf(readAs, keys)) return undefined;
  return typeof stored._rev === "string" ? stored._rev : undefined;
}
