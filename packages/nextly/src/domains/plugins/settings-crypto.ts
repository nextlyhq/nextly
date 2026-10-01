/**
 * The encryption of a plugin's secret settings.
 *
 * Three properties the general-purpose `utils/encryption` does not give, and
 * that a store read on hot paths and rotated over its life needs:
 *
 * - **A key derived once per generation.** HKDF-SHA256 over the secret, with
 *   an `info` naming this use, computed once per process and kept. The
 *   general helper runs `scrypt` with a fresh salt for every ciphertext, so
 *   every read blocked the event loop for tens of milliseconds per secret —
 *   on a public route, per unauthenticated request. HKDF is the right tool
 *   here because the input is already a high-entropy secret, not a password,
 *   and the distinct `info` keeps this key separate from anything else
 *   derived from the same secret.
 * - **Associated data.** AES-256-GCM authenticates the plugin, the key and
 *   the path alongside the ciphertext, so a value copied from one plugin's
 *   row, or one path, into another fails to decrypt instead of being read as
 *   that other setting.
 * - **A key id.** Each envelope names the generation that wrote it, so a
 *   read picks the right key instead of trying each in turn, and an operator
 *   can tell when no row still depends on a retired secret.
 *
 * Envelope: `v2:<kid>:<iv>.<tag>.<ciphertext>`, each part base64url.
 *
 * @module domains/plugins/settings-crypto
 * @since 1.0.0
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const VERSION = "v2";
const KEY_INFO = "nextly/plugin-settings/v1";
const KID_INFO = "nextly/plugin-settings/kid/v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface GenerationKey {
  /** Names the generation without revealing anything about its key. */
  kid: string;
  key: Buffer;
}

/**
 * Derived keys, one per secret generation seen by this process.
 *
 * Bounded by the number of generations configured — the current secret and
 * the retired ones still able to read — so it never grows with traffic.
 */
const derived = new Map<string, GenerationKey>();

function generationKey(secret: string): GenerationKey {
  let entry = derived.get(secret);
  if (!entry) {
    entry = {
      key: Buffer.from(hkdfSync("sha256", secret, "", KEY_INFO, 32)),
      // From a different `info`, so knowing the id tells nothing of the key.
      kid: Buffer.from(hkdfSync("sha256", secret, "", KID_INFO, 8)).toString(
        "hex"
      ),
    };
    derived.set(secret, entry);
  }
  return entry;
}

/** The associated data binding a value to where it is stored. */
function associatedData(owner: string, path: readonly string[]): Buffer {
  // The path as a JSON array, not dot-joined: a record key may itself contain
  // a dot, and `["k", "a.b"]` and `["k", "a", "b"]` must not share one
  // encoding. A plugin name cannot contain the NUL that separates it.
  return Buffer.from(`${owner}\u0000${JSON.stringify(path)}`, "utf8");
}

/** Encrypt one secret under the current generation, bound to its location. */
export function sealSetting(
  plaintext: string,
  currentSecret: string,
  owner: string,
  path: readonly string[]
): string {
  const { kid, key } = generationKey(currentSecret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(associatedData(owner, path));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${kid}:${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/** The outcome of opening one envelope. */
export type OpenedSetting =
  | { readable: true; plaintext: string; stale: boolean }
  | { readable: false };

/**
 * Open one envelope with whichever configured generation wrote it.
 *
 * `stale` when that generation is not the current one: the caller re-seals
 * the value under the current key, so a retired secret can eventually be
 * dropped. Unreadable — reported, never thrown — when no configured
 * generation has the envelope's id, or when the value fails authentication
 * (tampered, or moved from another plugin or path); the caller decides what
 * an unreadable secret means for the operation at hand.
 */
export function openSetting(
  envelope: string,
  secrets: readonly string[],
  owner: string,
  path: readonly string[]
): OpenedSetting {
  const match = /^v2:([0-9a-f]{16}):([^.]+)\.([^.]+)\.([^.]*)$/.exec(envelope);
  if (!match) return { readable: false };
  const [, kid, ivText, tagText, ciphertextText] = match;

  const index = secrets.findIndex(secret => generationKey(secret).kid === kid);
  if (index === -1) return { readable: false };

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      generationKey(secrets[index]).key,
      Buffer.from(ivText, "base64url"),
      { authTagLength: TAG_BYTES }
    );
    decipher.setAAD(associatedData(owner, path));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return { readable: true, plaintext, stale: index !== 0 };
  } catch {
    return { readable: false };
  }
}
