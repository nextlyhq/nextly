/**
 * Keyed digests core lends plugins as `ctx.security.digests`: a one-way
 * HMAC-SHA256 of a value a plugin must compare without keeping it, such as an
 * email address or an IP address it uses to tell one person's submission from
 * another's.
 *
 * A plain hash of an address can be reversed by hashing every likely address,
 * so the digest is keyed. It must also keep matching for as long as what it
 * was stored beside is kept, while the install's secret rotates, so it is not
 * keyed by the secret. Each plugin gets one random key, made once and kept in
 * `nextly_meta` sealed under the secret, as core keeps its own digest key
 * (`domains/audit/principal-digest`): a rotation seals the same key again
 * under the new secret, and digests made before the rotation still match once
 * the earlier secret is gone.
 *
 * The key is made by an insert that does nothing when the row exists, then
 * read back, so two instances making it at once both use the first. Sealed
 * under a secret the install now reads only as a previous one, it is sealed
 * again under the current secret on its first read, by a compare-and-set of
 * the value read, and at every start (`resealPluginDigestKeys`), before an
 * operator can remove the previous secret. The first use commits on its own,
 * so it is refused inside an open transaction: a plugin taking digests inside
 * its transactions calls `prepare()` at start.
 *
 * Neither the key nor anything derived from it but the digest leaves this
 * module: never in a log, an error or a return value.
 *
 * @module plugins/security/keyed-digest
 */
import { createHmac, randomBytes } from "node:crypto";

import type { MetaService } from "../../domains/meta/services/meta-service";
import {
  openSetting,
  sealSetting,
} from "../../domains/plugins/settings-crypto";
import { NextlyError } from "../../errors/nextly-error";
import {
  assertNoOpenTransaction,
  type OpenTransactionProbe,
} from "../../shared/lib/open-transaction";

/** @experimental Keyed one-way digests, under the plugin's own key. */
export interface KeyedDigests {
  /**
   * The digest of `value` for `purpose`, hex-encoded: the same for the same
   * purpose and value, across restarts and secret rotations, and different
   * from any other plugin's. `purpose` names what the value is (`email`,
   * `ip`), so one value used for two purposes gives two unrelated digests.
   * Normalise `value` first, as the comparison needs (lowercase an address):
   * the digest compares it exactly.
   */
  digest(purpose: string, value: string): Promise<string>;
  /**
   * Make and read the plugin's key now, outside any transaction. The first
   * use reads the key on its own connection and may make it, which must
   * commit on its own, so it is refused inside an open transaction: a
   * plugin that takes digests inside its transactions calls this first, at
   * start, after which `digest` works anywhere.
   */
  prepare(): Promise<void>;
}

/** What the helper needs of `nextly_meta`. */
export type DigestKeyStore = Pick<
  MetaService,
  "getEntry" | "insertIfAbsent" | "compareAndSet" | "getAll"
>;

/** What the helper is built from. */
export interface KeyedDigestsOptions {
  /** The plugin's name: its key is its own, and sealed in its name. */
  owner: string;
  /** Where the key is kept, resolved per call: the database may connect later. */
  store: () => DigestKeyStore;
  /** The install's secrets, current first, read per call so a rotation applies. */
  secrets: () => readonly string[];
  /** Whether the calling flow is inside an open transaction. */
  probe: () => OpenTransactionProbe;
}

/** Bytes of key material: the HMAC-SHA256 block's worth of entropy. */
const KEY_BYTES = 32;
const SEALED = "sealed:";
const UNSEALED = "unsealed:";
const PURPOSE = /^[a-z][a-z0-9.-]{0,63}$/;

/** What every plugin's digest key is kept under in `nextly_meta`. */
const KEY_PREFIX = "plugin.digestKey:";

/** The `nextly_meta` key a plugin's digest key is kept under. */
export function digestKeyMetaKey(owner: string): string {
  return `${KEY_PREFIX}${owner}`;
}

/**
 * The envelope's path, bound into its associated data with the owner, so an
 * envelope copied from the plugin's settings, which share the owner, fails to
 * open as this key.
 */
function sealPath(owner: string): readonly string[] {
  return ["nextly_meta", digestKeyMetaKey(owner)];
}

function keyUnreadable(owner: string, reason: string): NextlyError {
  return NextlyError.internal({
    logContext: {
      reason: "plugin-digest-key-unreadable",
      owner,
      detail: reason,
    },
  });
}

/** The key as stored: sealed under the current secret when there is one. */
function storedForm(
  owner: string,
  key: Buffer,
  secrets: readonly string[]
): string {
  const [current] = secrets;
  const encoded = key.toString("base64url");
  return current === undefined
    ? `${UNSEALED}${encoded}`
    : `${SEALED}${sealSetting(encoded, current, owner, sealPath(owner))}`;
}

/** The key itself, and whether it should be sealed again under the current secret. */
function openKey(
  owner: string,
  stored: string,
  secrets: readonly string[]
): { key: Buffer; stale: boolean } {
  if (stored.startsWith(UNSEALED)) {
    return {
      key: decodeKey(owner, stored.slice(UNSEALED.length)),
      stale: secrets.length > 0,
    };
  }
  if (!stored.startsWith(SEALED)) throw keyUnreadable(owner, "malformed");
  const opened = openSetting(
    stored.slice(SEALED.length),
    secrets,
    owner,
    sealPath(owner)
  );
  if (!opened.readable) throw keyUnreadable(owner, opened.reason);
  return { key: decodeKey(owner, opened.plaintext), stale: opened.stale };
}

function decodeKey(owner: string, encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== KEY_BYTES) throw keyUnreadable(owner, "malformed");
  return key;
}

/**
 * The plugin's key: made when there is none, sealed again when a previous
 * secret opened it.
 */
async function loadKey(
  owner: string,
  store: DigestKeyStore,
  secrets: readonly string[]
): Promise<Buffer> {
  const metaKey = digestKeyMetaKey(owner);
  let entry = await store.getEntry<string>(metaKey);
  if (!entry.present) {
    await store.insertIfAbsent(
      metaKey,
      storedForm(owner, randomBytes(KEY_BYTES), secrets)
    );
    // Read back: an instance that made it first holds the key everyone uses.
    entry = await store.getEntry<string>(metaKey);
  }
  if (!entry.present || typeof entry.value !== "string") {
    throw keyUnreadable(owner, "missing");
  }
  const { key, stale } = openKey(owner, entry.value, secrets);
  if (stale) {
    // The same key, sealed under the current secret. Losing the race to
    // another instance doing the same leaves its equally good envelope.
    await store.compareAndSet(
      metaKey,
      entry.value,
      storedForm(owner, key, secrets)
    );
  }
  return key;
}

/** @experimental `ctx.security.digests` for one plugin. */
export function createKeyedDigests(options: KeyedDigestsOptions): KeyedDigests {
  // The key never changes once made, so it is read once per process; the
  // promise is dropped on a failure, so the next call tries again.
  let key: Promise<Buffer> | undefined;
  const keyOnce = () => {
    // Made or read on its own connection, never inside the caller's
    // transaction: on SQLite, which shares one connection, a key made there
    // would be undone by a rollback while this process kept using it, and on
    // a pool of one a read beside the transaction would wait for it.
    if (key === undefined) {
      assertNoOpenTransaction(options.probe(), "security.digests first use");
    }
    key ??= loadKey(options.owner, options.store(), options.secrets()).catch(
      (error: unknown) => {
        key = undefined;
        throw error;
      }
    );
    return key;
  };
  return {
    async prepare() {
      await keyOnce();
    },
    async digest(purpose, value) {
      if (!PURPOSE.test(purpose)) {
        throw NextlyError.validation({
          errors: [
            {
              path: "purpose",
              code: "INVALID",
              message:
                "A digest's purpose is a short lowercase name, such as `email`.",
            },
          ],
        });
      }
      return createHmac("sha256", await keyOnce())
        .update(`${purpose}\u0000${value}`, "utf8")
        .digest("hex");
    },
  };
}

/**
 * Seal every stored plugin digest key again under the current secret where a
 * previous one opened it: run at start, so a key read only after an operator
 * has removed the previous secret is not left sealed under it. Every stored
 * key is visited, a plugin's no longer configured among them, since data a
 * plugin left behind may be read again once it is installed again. No key is
 * made here, and one no configured secret opens is left as stored: it fails
 * where it is used, never at start.
 */
export async function resealPluginDigestKeys(
  store: DigestKeyStore,
  secrets: readonly string[]
): Promise<void> {
  const entries = Object.entries(await store.getAll()).filter(([metaKey]) =>
    metaKey.startsWith(KEY_PREFIX)
  );
  for (const [metaKey, stored] of entries) {
    if (typeof stored !== "string") continue;
    const owner = metaKey.slice(KEY_PREFIX.length);
    const opened = tryOpenKey(owner, stored, secrets);
    if (opened === undefined || !opened.stale) continue;
    await store.compareAndSet(
      metaKey,
      stored,
      storedForm(owner, opened.key, secrets)
    );
  }
}

/** {@link openKey}, or undefined when no configured secret opens the key. */
function tryOpenKey(
  owner: string,
  stored: string,
  secrets: readonly string[]
): { key: Buffer; stale: boolean } | undefined {
  try {
    return openKey(owner, stored, secrets);
  } catch {
    return undefined;
  }
}
