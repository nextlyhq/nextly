import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NextlyError } from "../../../errors/nextly-error";
import {
  PluginSettingsService,
  type PluginSettingRow,
  type PluginSettingsStore,
} from "../settings-service";

// Long and distinctive: a short plaintext could appear inside ciphertext by
// chance, and a test that passes for that reason proves nothing about
// encryption.
const SECRET_VALUE = "secret-value-7f3a9c1e5b";
// DERIVED from the value above rather than written as a second literal. It
// only has to DIFFER from it for a replacement to be observable, and deriving
// keeps that difference self-evident while leaving no second
// credential-shaped constant beside a `clientSecret` key.
const ROTATED_SECRET_VALUE = `${SECRET_VALUE}-rotated`;
const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(32);

/** An in-memory store, so the policy is tested without a database. */
function memoryStore(): PluginSettingsStore & { rows: PluginSettingRow[] } {
  const rows: PluginSettingRow[] = [];
  return {
    rows,
    read: async owner => rows.filter(r => r.owner === owner),
    // Reads and writes in one step, as the real store does inside a
    // transaction. The rows handed to `computeRows` are the ones this store
    // holds, so the service is exercised through the same seam production
    // uses rather than through a second path that only tests carry.
    mutate: async (owner, _keys, computeRows) => {
      const written = await computeRows(rows.filter(r => r.owner === owner));
      for (const row of written) {
        const at = rows.findIndex(
          r => r.owner === row.owner && r.key === row.key
        );
        // A removed key is deleted, as the real store deletes it.
        if (row.remove) {
          if (at !== -1) rows.splice(at, 1);
        } else if (at === -1) rows.push(row);
        else rows[at] = row;
      }
    },
  };
}

const schema = z.object({
  clientSecret: z.string().default(""),
  port: z.number().default(443),
  providers: z
    .record(
      z.string(),
      z.object({ clientId: z.string(), clientSecret: z.string() })
    )
    .default({}),
});

function service(
  store: PluginSettingsStore,
  secrets: string[] = [KEY_A],
  secretPaths: string[] = ["clientSecret", "providers.*.clientSecret"]
) {
  return new PluginSettingsService({
    owner: "@test/p",
    schema,
    secretPaths,
    store,
    secrets: () => secrets,
  });
}

describe("PluginSettingsService", () => {
  it("returns the schema defaults when nothing is stored", async () => {
    const settings = await service(memoryStore()).get();
    expect(settings).toEqual({ clientSecret: "", port: 443, providers: {} });
  });

  it("stores a secret as ciphertext and reads it back", async () => {
    const store = memoryStore();
    await service(store).set({ clientSecret: SECRET_VALUE });

    const stored = store.rows.find(r => r.key === "clientSecret");
    expect(stored?.isSecret).toBe(true);
    expect(stored?.value).not.toContain(SECRET_VALUE);

    const settings = await service(store).get<{ clientSecret: string }>();
    expect(settings.clientSecret).toBe(SECRET_VALUE);
  });

  it("encrypts a nested secret in place, leaving its siblings readable", async () => {
    const store = memoryStore();
    await service(store).set({
      providers: {
        google: { clientId: "google-id", clientSecret: SECRET_VALUE },
      },
    });

    const stored = store.rows.find(r => r.key === "providers");
    // The whole object is one row, so the readable half must survive it.
    expect(stored?.value).toContain("google-id");
    expect(stored?.value).not.toContain(SECRET_VALUE);

    const settings = await service(store).get<{
      providers: Record<string, { clientId: string; clientSecret: string }>;
    }>();
    expect(settings.providers.google).toEqual({
      clientId: "google-id",
      clientSecret: SECRET_VALUE,
    });
  });

  it("refuses a value the schema rejects, writing nothing", async () => {
    const store = memoryStore();
    await expect(
      service(store).set({ port: "not a number" } as never)
    ).rejects.toSatisfy(
      (e: unknown) => NextlyError.is(e) && e.code === "VALIDATION_ERROR"
    );
    expect(store.rows).toHaveLength(0);
  });

  it("refuses an unknown key instead of writing undefined into the row", async () => {
    // A plain zod object STRIPS what it does not know, so this parsed happily
    // and `parsed.data.typo` was undefined; `JSON.stringify(undefined)` is the
    // value undefined, not a string, and the column is NOT NULL. A misspelled
    // or stale field therefore surfaced as a database error rather than as an
    // answer naming the field.
    const store = memoryStore();
    await expect(service(store).set({ typo: 1 } as never)).rejects.toSatisfy(
      (e: unknown) => NextlyError.is(e) && e.code === "VALIDATION_ERROR"
    );
    expect(store.rows).toHaveLength(0);
  });

  it("names the unknown key in the refusal", async () => {
    // Which key is the only useful part of the answer: the caller sent an
    // object, and "something in it is wrong" does not locate the typo.
    const store = memoryStore();
    const error = await service(store)
      .set({ prot: 443 } as never)
      .catch((e: unknown) => e);
    const data = NextlyError.is(error)
      ? (error.publicData as { errors?: { path?: string }[] } | undefined)
      : undefined;
    expect(data?.errors?.[0]?.path).toBe("prot");
  });

  it("still writes every key the schema does declare", async () => {
    // The control. Refusing any patch that mentions an unfamiliar key would
    // satisfy both tests above while making ordinary writes fail.
    const store = memoryStore();
    await service(store).set({ port: 8443 });
    expect(store.rows.map(r => r.key)).toEqual(["port"]);
  });

  it("records the acting user on the row it writes", async () => {
    // `updated_by` exists to retain who changed a plugin's configuration.
    const store = memoryStore();
    await service(store).set({ port: 8443 }, { actorUserId: "user-7" });
    expect(store.rows[0]?.updatedBy).toBe("user-7");
  });

  it("reads a value written under a retired secret, after rotation", async () => {
    // Without this a secret rotation silently breaks every stored credential,
    // and the failure surfaces as the provider rejecting a login.
    const store = memoryStore();
    await service(store, [KEY_A]).set({ clientSecret: SECRET_VALUE });

    const afterRotation = await service(store, [KEY_B, KEY_A]).get<{
      clientSecret: string;
    }>();
    expect(afterRotation.clientSecret).toBe(SECRET_VALUE);
  });

  it("re-encrypts under the current secret on the next write", async () => {
    const store = memoryStore();
    await service(store, [KEY_A]).set({ clientSecret: SECRET_VALUE });
    await service(store, [KEY_B, KEY_A]).set({ clientSecret: SECRET_VALUE });

    // Readable with the new key alone, which the old ciphertext would not be.
    const settings = await service(store, [KEY_B]).get<{
      clientSecret: string;
    }>();
    expect(settings.clientSecret).toBe(SECRET_VALUE);
  });

  it("never returns a secret to the admin, only whether one is set", async () => {
    const store = memoryStore();
    await service(store).set({
      clientSecret: SECRET_VALUE,
      providers: {
        google: { clientId: "google-id", clientSecret: SECRET_VALUE },
      },
    });

    const redacted = await service(store).getRedacted();
    const asJson = JSON.stringify(redacted);
    expect(asJson).not.toContain(SECRET_VALUE);
    expect(redacted).toMatchObject({
      clientSecret: { set: true },
      providers: {
        google: { clientId: "google-id", clientSecret: { set: true } },
      },
    });
  });

  it("reports an unset secret as not set rather than omitting it", async () => {
    const redacted = await service(memoryStore()).getRedacted();
    expect(redacted).toMatchObject({ clientSecret: { set: false } });
  });

  it("leaves a non-secret key readable in the row", async () => {
    // The positive control for the encryption tests: if everything were
    // encrypted, "does not contain the plaintext" would pass trivially.
    const store = memoryStore();
    await service(store).set({ port: 8443 });
    const stored = store.rows.find(r => r.key === "port");
    expect(stored?.isSecret).toBe(false);
    expect(stored?.value).toContain("8443");
  });
});

/**
 * Whether a secret is set is a fact about what was SAVED.
 *
 * `getRedacted` parses the stored settings to give the admin every declared
 * key, and parsing fills in defaults. Judging presence on the parse reported
 * a secret with a non-empty default as `{ set: true }` before anything had
 * been saved, and an operator could skip a credential nothing stores.
 */
describe("a secret with a schema default", () => {
  const defaulted = z.object({
    apiKey: z.string().default("sk-placeholder"),
  });
  const svc = (store: PluginSettingsStore) =>
    new PluginSettingsService({
      owner: "@test/p",
      schema: defaulted,
      secretPaths: ["apiKey"],
      store,
      secrets: () => [KEY_A],
    });

  it("is reported as not set until it has been saved", async () => {
    expect(await svc(memoryStore()).getRedacted()).toEqual({
      apiKey: { set: false },
    });
  });

  it("is reported as set once saved", async () => {
    // The control: judging presence on the stored value must not stop a
    // saved secret from being reported.
    const store = memoryStore();
    await svc(store).set({ apiKey: SECRET_VALUE });
    expect(await svc(store).getRedacted()).toEqual({ apiKey: { set: true } });
  });
});

/**
 * A secret the schema READS from an older layout is still a saved one.
 *
 * A field can reshape its own stored value: a flat `auth: "<key>"` read by a
 * newer schema as `auth: { apiKey }`. Nothing is stored at `auth.apiKey`, yet
 * the credential there is the saved one, and reporting it unset invites an
 * operator to replace a key that works.
 */
describe("a secret the schema moves from an older layout", () => {
  const current = z.object({
    auth: z.preprocess(
      stored => (typeof stored === "string" ? { apiKey: stored } : stored),
      z
        .object({ apiKey: z.string().default("sk-placeholder") })
        .default({ apiKey: "sk-placeholder" })
    ),
  });
  const reading = (store: PluginSettingsStore) =>
    new PluginSettingsService({
      owner: "@test/p",
      schema: current,
      secretPaths: ["auth.apiKey"],
      store,
      secrets: () => [KEY_A],
    });

  it("is reported as set when the older layout saved it", async () => {
    const store = memoryStore();
    // Saved by the plugin's earlier manifest, as a flat secret.
    await new PluginSettingsService({
      owner: "@test/p",
      schema: z.object({ auth: z.string() }),
      secretPaths: ["auth"],
      store,
      secrets: () => [KEY_A],
    }).set({ auth: SECRET_VALUE });

    expect(await reading(store).getRedacted()).toEqual({
      auth: { apiKey: { set: true } },
    });
  });

  it("is still reported as not set when only its default fills it", async () => {
    // The control: the new rule must not make a default look saved.
    expect(await reading(memoryStore()).getRedacted()).toEqual({
      auth: { apiKey: { set: false } },
    });
  });

  it("is not reported as set when its default is generated", async () => {
    // A generated default differs on every parse, so it never equals the one
    // compared against — and still is not something anyone saved.
    let n = 0;
    const generated = new PluginSettingsService({
      owner: "@test/p",
      schema: z.object({
        token: z.string().default(() => `generated-${++n}`),
      }),
      secretPaths: ["token"],
      store: memoryStore(),
      secrets: () => [KEY_A],
    });

    expect(await generated.getRedacted()).toEqual({ token: { set: false } });
  });

  it("is not reported as set by a default when empty settings do not parse", async () => {
    // A required sibling leaves nothing to compare the default against, and
    // the default must still not read as a saved credential.
    const store = memoryStore();
    const schema = z.object({
      region: z.string(),
      apiKey: z.string().default("sk-placeholder"),
    });
    const service = new PluginSettingsService({
      owner: "@test/p",
      schema,
      secretPaths: ["apiKey"],
      store,
      secrets: () => [KEY_A],
    });
    await service.set({ region: "eu" });

    expect(await service.getRedacted()).toEqual({
      region: "eu",
      apiKey: { set: false },
    });
  });
});

/**
 * A patch touching one field of a nested group keeps the rest of it.
 *
 * `{ ...current, ...patch }` replaces a nested object wholesale, so patching
 * only `clientId` dropped the `clientSecret` beside it. The admin cannot
 * resend that value — it only ever receives `{ set: true }` for a secret — so
 * a required secret failed validation and a defaulted one was silently reset
 * over its stored ciphertext.
 */
describe("patching one field of a nested group", () => {
  it("keeps a sibling secret the patch did not mention", async () => {
    const store = memoryStore();
    const svc = service(store);

    await svc.set({
      providers: { google: { clientId: "id-1", clientSecret: SECRET_VALUE } },
    });
    // The premise: the secret is stored before the patch that must preserve it.
    const before = (await svc.get()) as {
      providers: Record<string, { clientId: string; clientSecret: string }>;
    };
    expect(before.providers.google.clientSecret).toBe(SECRET_VALUE);

    await svc.set({ providers: { google: { clientId: "id-2" } } });

    const after = (await svc.get()) as {
      providers: Record<string, { clientId: string; clientSecret: string }>;
    };
    expect(after.providers.google.clientId).toBe("id-2");
    expect(after.providers.google.clientSecret).toBe(SECRET_VALUE);
  });

  it("still REPLACES a value the patch does name", async () => {
    // The control. A merge that preserved everything would satisfy the test
    // above while making it impossible to change a secret at all.
    const store = memoryStore();
    const svc = service(store);

    await svc.set({
      providers: { google: { clientId: "id-1", clientSecret: SECRET_VALUE } },
    });
    await svc.set({
      providers: { google: { clientSecret: ROTATED_SECRET_VALUE } },
    });

    const after = (await svc.get()) as {
      providers: Record<string, { clientSecret: string }>;
    };
    expect(after.providers.google.clientSecret).toBe(ROTATED_SECRET_VALUE);
  });
});

describe("a top-level wildcard in a secret declaration", () => {
  /** A schema whose secrets are only ever reachable through a wildcard. */
  const wildcardSchema = z.object({
    google: z.object({ apiKey: z.string(), label: z.string() }).optional(),
  });

  function wildcardService(store: PluginSettingsStore) {
    return new PluginSettingsService({
      owner: "@test/p",
      schema: wildcardSchema,
      secretPaths: ["*.apiKey"],
      store,
      secrets: () => [KEY_A],
    });
  }

  it("ENCRYPTS the row a wildcard declaration covers", async () => {
    // `*.apiKey` contributed the literal `"*"` to the set of secret-bearing
    // top-level keys, which no concrete key equals — so the row was written as
    // plain text and marked non-secret, while the traversal that decides what
    // to encrypt honoured the same wildcard. Asserted on the STORED row, since
    // `get()` returns the value either way and cannot tell the two apart.
    const store = memoryStore();
    await wildcardService(store).set({
      google: { apiKey: SECRET_VALUE, label: "Google" },
    });

    const row = store.rows.find(r => r.key === "google");
    expect(row?.isSecret).toBe(true);
    expect(row?.value).not.toContain(SECRET_VALUE);
  });

  it("still reads the value back", async () => {
    // The control: marking every row secret and never decrypting would satisfy
    // the assertion above while making the setting unreadable.
    const store = memoryStore();
    const svc = wildcardService(store);
    await svc.set({ google: { apiKey: SECRET_VALUE, label: "Google" } });

    const after = (await svc.get()) as {
      google: { apiKey: string; label: string };
    };
    expect(after.google.apiKey).toBe(SECRET_VALUE);
    expect(after.google.label).toBe("Google");
  });

  it("leaves a row no declaration covers in plain text", async () => {
    // The other control. A wildcard must not make EVERY row a secret: the
    // encryption assertion above is satisfied by a store that encrypts
    // unconditionally, and that would be a different defect with the same green.
    const store = memoryStore();
    await new PluginSettingsService({
      owner: "@test/p",
      schema: wildcardSchema,
      secretPaths: ["*.apiKey"],
      store,
      secrets: () => [KEY_A],
    }).set({ google: { apiKey: SECRET_VALUE, label: "Google" } });

    const row = store.rows.find(r => r.key === "google");
    // The non-secret sibling inside the same row stays readable.
    expect(row?.value).toContain("Google");
  });
});

describe("secrets held inside an array", () => {
  /** Providers as a LIST, which is where the traversal used to stop. */
  const listSchema = z.object({
    providers: z
      .array(z.object({ id: z.string(), clientSecret: z.string() }))
      .default([]),
  });

  function listService(store: PluginSettingsStore) {
    return new PluginSettingsService({
      owner: "@test/p",
      schema: listSchema,
      secretPaths: ["providers.*.clientSecret"],
      store,
      secrets: () => [KEY_A],
    });
  }

  it("ENCRYPTS a secret inside an array element", async () => {
    // An array is not a plain object, so the traversal returned it unchanged
    // and every secret in a list was stored as plain text. Asserted on the
    // STORED row, since `get()` returns the value either way.
    const store = memoryStore();
    await listService(store).set({
      providers: [{ id: "google", clientSecret: SECRET_VALUE }],
    });

    const row = store.rows.find(r => r.key === "providers");
    expect(row?.isSecret).toBe(true);
    expect(row?.value).not.toContain(SECRET_VALUE);
    // The non-secret sibling is untouched, so the whole array was not simply
    // encrypted wholesale — which would pass the assertion above.
    expect(row?.value).toContain("google");
  });

  it("reads the value back, and as an ARRAY", async () => {
    // The control. It also pins the shape: mapping an array through the
    // object branch would return `{ "0": ... }`, which still round-trips a
    // value while breaking every consumer that indexes or iterates it.
    const store = memoryStore();
    const svc = listService(store);
    await svc.set({
      providers: [{ id: "google", clientSecret: SECRET_VALUE }],
    });

    const after = (await svc.get()) as {
      providers: Array<{ id: string; clientSecret: string }>;
    };
    expect(Array.isArray(after.providers)).toBe(true);
    expect(after.providers).toHaveLength(1);
    expect(after.providers[0].clientSecret).toBe(SECRET_VALUE);
    expect(after.providers[0].id).toBe("google");
  });

  it("REDACTS a secret inside an array element", async () => {
    // The same traversal serves redaction, so the admin was handed the
    // credential verbatim instead of `{ set: true }`.
    const store = memoryStore();
    const svc = listService(store);
    await svc.set({
      providers: [{ id: "google", clientSecret: SECRET_VALUE }],
    });

    const shown = JSON.stringify(await svc.getRedacted());
    expect(shown).not.toContain(SECRET_VALUE);
    expect(shown).toContain('"set":true');
  });
});

describe("the empty key is not a settings key", () => {
  it("REFUSES a patch naming it", async () => {
    // The store contends on a row keyed with the empty string to serialize
    // writers for one plugin, and deletes that row before committing — so a
    // settings key spelled the same way would be silently removed by the next
    // write. Refusing it is what makes the store's sentinel safe rather than
    // merely unlikely.
    const store = memoryStore();
    await expect(
      service(store).set({ "": "anything" } as Record<string, unknown>)
    ).rejects.toSatisfy(NextlyError.is);
  });

  it("still accepts an ordinary key", async () => {
    // The control: refusing every patch would satisfy the test above.
    const store = memoryStore();
    await expect(service(store).set({ port: 8443 })).resolves.toEqual(["port"]);
  });
});

describe("a key that became secret in a newer manifest", () => {
  it("re-encrypts the stored plaintext row on the next write of ANY key", async () => {
    // The row predates the declaration: written while the key was public, it
    // holds the credential in plain text. Nothing rewrites a key the patch
    // does not mention, and the admin is never handed the plaintext to echo
    // back — so without this migration the at-rest encryption the manifest
    // promises is never applied to the old value.
    const store = memoryStore();
    store.rows.push({
      owner: "@test/p",
      key: "clientSecret",
      value: JSON.stringify(SECRET_VALUE),
      isSecret: false,
      updatedAt: new Date(),
      updatedBy: null,
    });

    // An unrelated key: the migration must run on the write, not on the read
    // of the key it concerns.
    await service(store).set({ port: 8443 });

    const stored = store.rows.find(r => r.key === "clientSecret");
    expect(stored?.isSecret).toBe(true);
    expect(stored?.value).not.toContain(SECRET_VALUE);

    // And the value survives the migration readable.
    const settings = await service(store).get<{ clientSecret: string }>();
    expect(settings.clientSecret).toBe(SECRET_VALUE);
  });

  it("leaves rows the manifest still treats as public in plain text", async () => {
    // The control: the migration is driven by the DECLARATION, not by a
    // blanket re-encryption of every row.
    const store = memoryStore();
    await service(store).set({ port: 8443 });

    const stored = store.rows.find(r => r.key === "port");
    expect(stored?.isSecret).toBe(false);
    expect(stored?.value).toBe(JSON.stringify(8443));
  });
});

describe("values that cannot live in a settings row", () => {
  /** A service over a schema that accepts values JSON cannot carry back. */
  function exoticService(
    exotic: z.ZodObject<z.ZodRawShape>,
    store: PluginSettingsStore
  ): PluginSettingsService {
    return new PluginSettingsService({
      owner: "@test/p",
      schema: exotic,
      secretPaths: [],
      store,
      secrets: () => [KEY_A],
    });
  }

  it("REFUSES a z.date() value rather than making every later read fail", async () => {
    // The value parses, serializes — and the string it becomes is what the
    // field rejects on the next read. Stored once, unreadable forever.
    const store = memoryStore();
    const svc = exoticService(z.object({ since: z.date() }), store);
    await expect(
      svc.set({ since: new Date("2026-01-02T03:04:05Z") })
    ).rejects.toSatisfy(err => {
      if (!NextlyError.is(err)) return false;
      // The refusal must name the key, so the plugin author can find it.
      return JSON.stringify(err.publicData ?? err.logContext).includes("since");
    });
    // And write nothing.
    expect(store.rows).toHaveLength(0);
  });

  it("REFUSES a value that only parses on the way IN, like a transform", async () => {
    // `z.string().transform(Number)` accepts "5" and stores 5; the next read
    // feeds 5 to the same schema, which rejects it. The round trip is what
    // catches it.
    const store = memoryStore();
    const svc = exoticService(
      z.object({ retries: z.string().transform(Number) }),
      store
    );
    await expect(svc.set({ retries: "5" })).rejects.toSatisfy(NextlyError.is);
    expect(store.rows).toHaveLength(0);
  });

  it("REFUSES a bigint, which JSON cannot serialize at all", async () => {
    const store = memoryStore();
    const svc = exoticService(z.object({ count: z.bigint() }), store);
    await expect(svc.set({ count: 10n })).rejects.toSatisfy(NextlyError.is);
    expect(store.rows).toHaveLength(0);
  });

  it("still stores the JSON-native values plugins actually declare", async () => {
    // The control: strings, numbers, booleans, arrays and objects all
    // round-trip, and refusing them would make the feature unusable.
    const store = memoryStore();
    await service(store).set({
      port: 8443,
      providers: {
        google: { clientId: "google-id", clientSecret: SECRET_VALUE },
      },
    });
    expect(store.rows.length).toBeGreaterThan(0);
  });
});

describe("a newly secret key that the SAME patch updates", () => {
  it("keeps the patched value; the migration does not overwrite it", async () => {
    // The store upserts rows in order. Emitting a migration row for a key the
    // patch also wrote put the OLD stored value after the new one, so the
    // first rotation of a newly protected credential was silently discarded
    // while the API reported success.
    const store = memoryStore();
    store.rows.push({
      owner: "@test/p",
      key: "clientSecret",
      value: JSON.stringify(SECRET_VALUE),
      isSecret: false,
      updatedAt: new Date(),
      updatedBy: null,
    });

    await service(store).set({ clientSecret: ROTATED_SECRET_VALUE });

    const settings = await service(store).get<{ clientSecret: string }>();
    expect(settings.clientSecret).toBe(ROTATED_SECRET_VALUE);
    const stored = store.rows.find(r => r.key === "clientSecret");
    expect(stored?.isSecret).toBe(true);
    expect(stored?.value).not.toContain(SECRET_VALUE);
    expect(stored?.value).not.toContain(ROTATED_SECRET_VALUE);
  });
});

describe("a stored envelope the current manifest no longer names", () => {
  it("is still DECRYPTED on read, not handed back as enc: text", async () => {
    // A plugin update can remove or rename a secret path; a path-driven
    // decode then left the old encrypted leaf as its literal `enc:...`
    // envelope — get() returned corrupted configuration, and a later patch
    // could persist that ciphertext as a public value, losing the
    // credential. The envelope is self-describing, so decoding follows it.
    const store = memoryStore();
    // Written under a manifest that declared the path secret.
    await service(store, [KEY_A], ["clientSecret"]).set({
      clientSecret: SECRET_VALUE,
    });
    const stored = store.rows.find(r => r.key === "clientSecret");
    expect(stored?.isSecret).toBe(true);

    // The newer manifest no longer names the path. What is stored still
    // opens: the row was written as secret, and its envelopes decrypt.
    const settings = await service(store, [KEY_A], []).get<{
      clientSecret: string;
    }>();
    expect(settings.clientSecret).toBe(SECRET_VALUE);
  });

  it("leaves plaintext leaves in the same secret row untouched", async () => {
    // The control: decoding follows envelopes, not the row's flag — a value
    // that never encrypted (the pre-migration plaintext shape) passes
    // through as itself.
    const store = memoryStore();
    store.rows.push({
      owner: "@test/p",
      key: "providers",
      value: JSON.stringify({
        google: { clientId: "google-id", clientSecret: "plain" },
      }),
      isSecret: true,
      updatedAt: new Date(),
      updatedBy: null,
    });

    const settings = await service(store).get<{
      providers: Record<string, { clientId: string; clientSecret: string }>;
    }>();
    expect(settings.providers.google).toEqual({
      clientId: "google-id",
      clientSecret: "plain",
    });
  });
});

describe("a plaintext value that claims the envelope prefix", () => {
  it("round-trips beside an encrypted sibling, in a secret row", async () => {
    // The envelope walk opens every enc:-shaped leaf in a secret row, so a
    // public sibling beginning with the prefix has to be distinguishable
    // from ciphertext. Writes escape it, reads strip the escape: the value
    // comes back exactly as sent, and nothing was refused.
    const store = memoryStore();
    await service(store).set({
      providers: {
        google: { clientId: "enc:example", clientSecret: SECRET_VALUE },
      },
    });

    const settings = await service(store).get<{
      providers: Record<string, { clientId: string; clientSecret: string }>;
    }>();
    expect(settings.providers.google.clientId).toBe("enc:example");
    expect(settings.providers.google.clientSecret).toBe(SECRET_VALUE);
    // And the stored row never carries the claim unescaped.
    const stored = store.rows.find(r => r.key === "providers");
    expect(stored?.value).not.toContain('"enc:example"');
  });

  it("round-trips a value claiming the ESCAPE marker itself", async () => {
    // Doubling: a value that already begins with the escape marker keeps
    // it, because the read strips exactly one.
    const store = memoryStore();
    await service(store).set({
      providers: { google: { clientId: "enc!already", clientSecret: "s" } },
    });

    const settings = await service(store).get<{
      providers: Record<string, { clientId: string }>;
    }>();
    expect(settings.providers.google.clientId).toBe("enc!already");
  });

  it("is ordinary text in a row stored as PUBLIC", async () => {
    // The control: the markers only matter where decoding follows
    // envelopes. A public row never passes the whole-row decoder.
    const store = memoryStore();
    await service(store, [KEY_A], []).set({
      providers: { google: { clientId: "enc:example", clientSecret: "s" } },
    });

    const settings = await service(store, [KEY_A], []).get<{
      providers: Record<string, { clientId: string }>;
    }>();
    expect(settings.providers.google.clientId).toBe("enc:example");
    const stored = store.rows.find(r => r.key === "providers");
    expect(stored?.isSecret).toBe(false);
  });

  it("fails the read EXPLICITLY when no generation can open an envelope", async () => {
    // A credential encrypted under a key the install no longer configures
    // is a lost secret, and handing its ciphertext back as configuration
    // would have the plugin authenticate with the envelope text. The read
    // refuses, naming the path to enter again.
    const store = memoryStore();
    // Written under KEY_B; read under a service configured with KEY_A only.
    await service(store, [KEY_B]).set({ clientSecret: SECRET_VALUE });

    await expect(service(store, [KEY_A]).get()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: expect.objectContaining({
        reason: "stored-secret-unreadable",
        paths: ["clientSecret"],
      }),
    });
  });
});

describe("a declared SECRET whose own text claims a marker", () => {
  it("round-trips an enc:-prefixed credential exactly", async () => {
    // The escape walk covers the whole row value, secret leaves included —
    // the marker is inside the encrypted plaintext, and the decrypt output
    // must strip it again or the plugin receives a changed credential.
    const store = memoryStore();
    await service(store).set({ clientSecret: "enc:realkey" });

    const settings = await service(store).get<{ clientSecret: string }>();
    expect(settings.clientSecret).toBe("enc:realkey");
  });

  it("round-trips an escape-marker-prefixed credential exactly", async () => {
    // Doubling survives the envelope too: one marker stripped, one kept.
    const store = memoryStore();
    await service(store).set({ clientSecret: "enc!realkey" });

    const settings = await service(store).get<{ clientSecret: string }>();
    expect(settings.clientSecret).toBe("enc!realkey");
  });

  it("round-trips an ordinary credential without touching it", async () => {
    // The control: the symmetric strip changes nothing that never claimed.
    const store = memoryStore();
    await service(store).set({ clientSecret: SECRET_VALUE });

    const settings = await service(store).get<{ clientSecret: string }>();
    expect(settings.clientSecret).toBe(SECRET_VALUE);
  });
});

describe("the read-repair for newly secret rows", () => {
  it("re-encrypts a plaintext row on GET, without any patch", async () => {
    // The write path migrated only on PATCH; an install that upgraded and
    // kept READING held the credential in plain text at rest indefinitely —
    // in the database and in every backup — despite the manifest promising
    // encryption. The read now repairs what it reaches.
    const store = memoryStore();
    store.rows.push({
      owner: "@test/p",
      key: "clientSecret",
      value: JSON.stringify(SECRET_VALUE),
      isSecret: false,
      updatedAt: new Date(),
      updatedBy: null,
    });

    await service(store).get();

    const stored = store.rows.find(r => r.key === "clientSecret");
    expect(stored?.isSecret).toBe(true);
    expect(stored?.value).not.toContain(SECRET_VALUE);
    // And the read itself still answered the plaintext value it had.
    const settings = await service(store).get<{ clientSecret: string }>();
    expect(settings.clientSecret).toBe(SECRET_VALUE);
  });

  it("leaves public rows and untouched-secret rows alone", async () => {
    // The control: the repair is driven by the declaration, same as the
    // write-side migration, and reads of healthy rows write nothing.
    const store = memoryStore();
    await service(store).set({ port: 8443 });
    const before = JSON.stringify(store.rows.find(r => r.key === "port"));

    await service(store).get();

    expect(JSON.stringify(store.rows.find(r => r.key === "port"))).toBe(before);
  });
});

/**
 * A fresh install has an empty store, and a required key with no default
 * rejects it — the admin settings page still has to open, showing every
 * declared secret unset, or the form can never be filled in the first time.
 */
describe("an empty store a required key rejects", () => {
  it("still renders every declared secret unset", async () => {
    const store = memoryStore();
    const service = new PluginSettingsService({
      owner: "@test/p",
      schema: z.object({ apiKey: z.string() }),
      secretPaths: ["apiKey"],
      store,
      secrets: () => [KEY_A],
    });

    expect(await service.getRedacted()).toEqual({ apiKey: { set: false } });
  });

  it("skips a wildcard path nothing was ever saved to", async () => {
    const store = memoryStore();
    const service = new PluginSettingsService({
      owner: "@test/p",
      schema: z.object({ apiKey: z.string() }),
      secretPaths: ["providers.*.clientSecret"],
      store,
      secrets: () => [KEY_A],
    });

    expect(await service.getRedacted()).toEqual({});
  });
});

describe("an empty store a required key rejects", () => {
  it("keeps the defaults the schema still offers", async () => {
    const store = memoryStore();
    const service = new PluginSettingsService({
      owner: "@test/p",
      schema: z.object({
        apiKey: z.string(),
        region: z.string().default("eu"),
      }),
      secretPaths: ["apiKey"],
      store,
      secrets: () => [KEY_A],
    });

    expect(await service.getRedacted()).toEqual({
      apiKey: { set: false },
      region: "eu",
    });
  });
});

describe("an empty store a required key rejects", () => {
  it("prunes the secret a group default carries, keeps its sibling", async () => {
    const store = memoryStore();
    const service = new PluginSettingsService({
      owner: "@test/p",
      schema: z.object({
        apiKey: z.string(),
        providers: z
          .array(z.object({ clientId: z.string(), clientSecret: z.string() }))
          .default([{ clientId: "acme", clientSecret: "sk-baked-in" }]),
      }),
      secretPaths: ["providers.*.clientSecret"],
      store,
      secrets: () => [KEY_A],
    });

    expect(await service.getRedacted()).toEqual({
      providers: [{ clientId: "acme", clientSecret: { set: false } }],
    });
  });

  it("redacts a flat default a secret path names", async () => {
    const store = memoryStore();
    const service = new PluginSettingsService({
      owner: "@test/p",
      schema: z.object({
        apiKey: z.string().default("sk-baked-in"),
        region: z.string().default("eu"),
      }),
      secretPaths: ["apiKey"],
      store,
      secrets: () => [KEY_A],
    });

    expect(await service.getRedacted()).toEqual({
      apiKey: { set: false },
      region: "eu",
    });
  });
});

/**
 * Where a secret is stored is part of what authenticates it, so a value moved
 * to another plugin or another path is unreadable there instead of being read
 * as that other setting.
 */
describe("the encrypted envelope", () => {
  it("names the key generation that sealed it", async () => {
    const store = memoryStore();
    await service(store, [KEY_A]).set({ clientSecret: SECRET_VALUE });
    await service(store, [KEY_B]).set({ port: 1 });
    const sealedA = JSON.parse(
      store.rows.find(r => r.key === "clientSecret")?.value ?? '""'
    ) as string;
    await service(store, [KEY_B]).set({ clientSecret: SECRET_VALUE });
    const sealedB = JSON.parse(
      store.rows.find(r => r.key === "clientSecret")?.value ?? '""'
    ) as string;

    const kid = (envelope: string) =>
      /^enc:v2:([0-9a-f]{16}):/.exec(envelope)?.[1];
    expect(kid(sealedA)).toBeDefined();
    expect(kid(sealedB)).toBeDefined();
    expect(kid(sealedA)).not.toBe(kid(sealedB));
  });

  it("does not decrypt in ANOTHER plugin's row", async () => {
    const store = memoryStore();
    await service(store).set({ clientSecret: SECRET_VALUE });
    const row = store.rows.find(r => r.key === "clientSecret");
    if (!row) throw new Error("expected a stored row");
    store.rows.push({ ...row, owner: "@test/other" });

    const other = new PluginSettingsService({
      owner: "@test/other",
      schema,
      secretPaths: ["clientSecret"],
      store,
      secrets: () => [KEY_A],
    });
    await expect(other.get()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: expect.objectContaining({
        reason: "stored-secret-unreadable",
        paths: ["clientSecret"],
        reasons: { clientSecret: "auth-failed" },
      }),
    });
  });

  it("does not decrypt at ANOTHER path of the same plugin", async () => {
    const store = memoryStore();
    await service(store).set({
      providers: { google: { clientId: "g", clientSecret: SECRET_VALUE } },
    });
    const row = store.rows.find(r => r.key === "providers");
    if (!row) throw new Error("expected a stored row");
    const value = JSON.parse(row.value) as Record<
      string,
      { clientId: string; clientSecret: string }
    >;
    // The google envelope copied under github, as a database edit would.
    value.github = { clientId: "h", clientSecret: value.google.clientSecret };
    row.value = JSON.stringify(value);

    await expect(service(store).get()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: expect.objectContaining({
        reason: "stored-secret-unreadable",
        paths: ["providers.github.clientSecret"],
      }),
    });
  });

  it("still decrypts where it was sealed", async () => {
    // The control for the two above: the same row, unmoved, reads.
    const store = memoryStore();
    await service(store).set({
      providers: { google: { clientId: "g", clientSecret: SECRET_VALUE } },
    });
    const settings = await service(store).get<{
      providers: Record<string, { clientSecret: string }>;
    }>();
    expect(settings.providers.google.clientSecret).toBe(SECRET_VALUE);
  });
});

describe("a read with a retired generation", () => {
  it("re-seals the value under the current one, without any write", async () => {
    // Re-sealing only on a write of that key left the retired secret needed
    // for as long as nobody edited the setting.
    const store = memoryStore();
    await service(store, [KEY_A]).set({ clientSecret: SECRET_VALUE });

    await service(store, [KEY_B, KEY_A]).get();

    const settings = await service(store, [KEY_B]).get<{
      clientSecret: string;
    }>();
    expect(settings.clientSecret).toBe(SECRET_VALUE);
  });

  it("leaves a value sealed by the current generation untouched", async () => {
    // The control: a read of a current value writes nothing.
    const store = memoryStore();
    await service(store, [KEY_A]).set({ clientSecret: SECRET_VALUE });
    const before = store.rows.find(r => r.key === "clientSecret")?.value;

    await service(store, [KEY_A, KEY_B]).get();

    expect(store.rows.find(r => r.key === "clientSecret")?.value).toBe(before);
  });
});

/**
 * A secret sealed under a key the install no longer has. The operator must be
 * able to see it and replace it: failing every read and write of the plugin's
 * settings left no way to enter the credential again.
 */
describe("a secret no configured generation can open", () => {
  async function lostSecretStore() {
    const store = memoryStore();
    await service(store, [KEY_B]).set({
      clientSecret: SECRET_VALUE,
      providers: { google: { clientId: "g", clientSecret: SECRET_VALUE } },
    });
    return store;
  }

  it("is shown to the admin as set but unreadable", async () => {
    const store = await lostSecretStore();
    const view = await service(store, [KEY_A]).view();
    expect(view.settings).toMatchObject({
      clientSecret: { set: true, readable: false },
      providers: {
        google: { clientId: "g", clientSecret: { set: true, readable: false } },
      },
    });
  });

  it("makes get() log that its key is not configured", async () => {
    // Told apart from a tampered value, which fails authentication under a
    // key the install does have.
    const store = await lostSecretStore();
    await expect(service(store, [KEY_A]).get()).rejects.toMatchObject({
      logContext: expect.objectContaining({
        reasons: {
          clientSecret: "unknown-key",
          "providers.google.clientSecret": "unknown-key",
        },
      }),
    });
  });

  it("does not block a write of an unrelated key", async () => {
    const store = await lostSecretStore();
    await service(store, [KEY_A]).set({ port: 8443 });
    expect(store.rows.find(r => r.key === "port")?.value).toBe("8443");
  });

  it("is replaced by a write that enters it again", async () => {
    const store = await lostSecretStore();
    await service(store, [KEY_A]).set({
      clientSecret: ROTATED_SECRET_VALUE,
      providers: {
        google: { clientId: "g", clientSecret: ROTATED_SECRET_VALUE },
      },
    });
    const settings = await service(store, [KEY_A]).get<{
      clientSecret: string;
      providers: Record<string, { clientSecret: string }>;
    }>();
    expect(settings.clientSecret).toBe(ROTATED_SECRET_VALUE);
    expect(settings.providers.google.clientSecret).toBe(ROTATED_SECRET_VALUE);
  });

  it("refuses a write that would keep it without entering it", async () => {
    // Patching the sibling would carry the unreadable leaf into the new row,
    // where it would be sealed as if it were the credential.
    const store = await lostSecretStore();
    await expect(
      service(store, [KEY_A]).set({
        providers: { google: { clientId: "changed" } },
      } as never)
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "providers.google.clientSecret",
            code: "UNREADABLE_SECRET",
          }),
        ],
      },
    });
  });
});

/**
 * The same lost secret under a schema with an object-level rule. zod refuses
 * to make keys of a refined object optional, and that refusal must not cost
 * the operator the form or every unrelated save.
 */
describe("a lost secret under a refined schema", () => {
  const refined = z
    .object({
      clientSecret: z.string().default(""),
      port: z.number().default(443),
      tls: z.boolean().default(true),
    })
    .refine(value => value.tls || value.port !== 443, {
      message: "Port 443 needs TLS.",
    });
  function refinedService(store: PluginSettingsStore, secrets: string[]) {
    return new PluginSettingsService({
      owner: "@test/p",
      schema: refined,
      secretPaths: ["clientSecret"],
      store,
      secrets: () => secrets,
    });
  }
  async function lostStore() {
    const store = memoryStore();
    await refinedService(store, [KEY_B]).set({ clientSecret: SECRET_VALUE });
    return store;
  }

  it("still renders the view", async () => {
    const store = await lostStore();
    const view = await refinedService(store, [KEY_A]).view();
    expect(view.settings).toMatchObject({
      clientSecret: { set: true, readable: false },
      port: 443,
    });
  });

  it("does not block a write of an unrelated key", async () => {
    const store = await lostStore();
    await refinedService(store, [KEY_A]).set({ port: 8443 });
    expect(store.rows.find(r => r.key === "port")?.value).toBe("8443");
  });

  it("is still held to the rule while every key is readable", async () => {
    // The control: the rule is set aside only for a read or write that
    // cannot see every key, not for every write.
    const store = memoryStore();
    await expect(
      refinedService(store, [KEY_A]).set({ tls: false })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

/**
 * A lost secret under a key the current schema no longer declares. Nothing
 * of the current schema is missing, so its object-level rule still holds.
 */
describe("a lost secret under a key a plugin update dropped", () => {
  const v1 = z.object({
    legacy: z.string().default(""),
    port: z.number().default(443),
    tls: z.boolean().default(true),
  });
  const v2 = z
    .object({
      port: z.number().default(443),
      tls: z.boolean().default(true),
    })
    .refine(value => value.tls || value.port !== 443, {
      message: "Port 443 needs TLS.",
    });
  function make(
    store: PluginSettingsStore,
    schemaFor: typeof v1 | typeof v2,
    secretPaths: string[],
    secrets: string[]
  ) {
    return new PluginSettingsService({
      owner: "@test/p",
      schema: schemaFor,
      secretPaths,
      store,
      secrets: () => secrets,
    });
  }

  it("still refuses a write that breaks the current rule", async () => {
    // Setting the rule aside here accepted the write, and every read after
    // it then failed as stored-settings-invalid.
    const store = memoryStore();
    await make(store, v1, ["legacy"], [KEY_B]).set({ legacy: SECRET_VALUE });
    const current = make(store, v2, [], [KEY_A]);

    await expect(current.set({ tls: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(store.rows.find(r => r.key === "tls")).toBeUndefined();
    await expect(current.get()).resolves.toEqual({ port: 443, tls: true });
  });

  it("accepts a write the current rule allows", async () => {
    // The control: a service refusing every write while a dropped key is
    // unreadable passes the case above too.
    const store = memoryStore();
    await make(store, v1, ["legacy"], [KEY_B]).set({ legacy: SECRET_VALUE });

    await make(store, v2, [], [KEY_A]).set({ tls: false, port: 8443 });

    expect(store.rows.find(r => r.key === "tls")?.value).toBe("false");
  });
});

/**
 * A root `.passthrough()` keeps undeclared keys. Setting aside a lost secret
 * must not quietly change that into the default strip, which refuses them.
 */
describe("a lost secret under a passthrough schema", () => {
  it("still accepts an undeclared key", async () => {
    const passthrough = z
      .object({ clientSecret: z.string().default("") })
      .passthrough();
    const make = (secrets: string[]) =>
      new PluginSettingsService({
        owner: "@test/p",
        schema: passthrough,
        secretPaths: ["clientSecret"],
        store,
        secrets: () => secrets,
      });
    const store = memoryStore();
    await make([KEY_B]).set({ clientSecret: SECRET_VALUE });

    await make([KEY_A]).set({ region: "eu" });

    expect(store.rows.find(r => r.key === "region")?.value).toBe('"eu"');
  });
});

/** RFC 7396: `null` removes a member, at any depth. */
describe("a patch naming a key with null", () => {
  it("removes one entry of a record and keeps the others", async () => {
    const store = memoryStore();
    await service(store).set({
      providers: {
        google: { clientId: "g", clientSecret: SECRET_VALUE },
        github: { clientId: "h", clientSecret: SECRET_VALUE },
      },
    });

    await service(store).set({ providers: { github: null } } as never);

    const settings = await service(store).get<{
      providers: Record<string, unknown>;
    }>();
    expect(Object.keys(settings.providers)).toEqual(["google"]);
  });

  it("deletes a top-level key's row, so its default applies again", async () => {
    const store = memoryStore();
    await service(store).set({ port: 8443 });

    await service(store).set({ port: null } as never);

    expect(store.rows.find(r => r.key === "port")).toBeUndefined();
    expect((await service(store).get<{ port: number }>()).port).toBe(443);
  });

  it("still refuses a removal the schema cannot do without", async () => {
    // The merged result is validated as before: removing a required member
    // is a change that makes the settings invalid.
    const store = memoryStore();
    await service(store).set({
      providers: { google: { clientId: "g", clientSecret: SECRET_VALUE } },
    });
    await expect(
      service(store).set({
        providers: { google: { clientId: null } },
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("an unknown key below the top level", () => {
  it("is refused, naming its full path", async () => {
    // A plain zod object strips what it does not declare, so a misspelled
    // nested field answered 200 and its value was silently dropped.
    const store = memoryStore();
    await expect(
      service(store).set({
        providers: {
          google: { clientId: "g", clientSecret: "s", clientSecrett: "x" },
        },
      } as never)
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "providers.google.clientSecrett",
            code: "UNKNOWN_KEY",
          }),
        ],
      },
    });
    expect(store.rows).toHaveLength(0);
  });
});

/**
 * An unknown key inside a list item. A patch replaces an array whole, so a
 * dropped key there is not merged back from storage: a misspelled credential
 * field lost the stored credential with no error.
 */
describe("an unknown key inside an array element", () => {
  const listSchema = z.object({
    tokens: z
      .array(z.object({ name: z.string(), token: z.string().optional() }))
      .default([]),
  });
  function listService(store: PluginSettingsStore) {
    return new PluginSettingsService({
      owner: "@test/p",
      schema: listSchema,
      secretPaths: ["tokens.*.token"],
      store,
      secrets: () => [KEY_A],
    });
  }

  it("is refused, naming the element, and the stored list is kept", async () => {
    const store = memoryStore();
    await listService(store).set({
      tokens: [{ name: "ci", token: SECRET_VALUE }],
    });

    await expect(
      listService(store).set({
        tokens: [{ name: "ci", tokenn: ROTATED_SECRET_VALUE }],
      } as never)
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "tokens.0.tokenn",
            code: "UNKNOWN_KEY",
          }),
        ],
      },
    });
    const settings = await listService(store).get<{
      tokens: Array<{ name: string; token?: string }>;
    }>();
    expect(settings.tokens).toEqual([{ name: "ci", token: SECRET_VALUE }]);
  });

  it("is not looked for when a transform changed the list's length", async () => {
    // Index `i` of the patch is no longer index `i` of the result, so a
    // declared key would be reported against an unrelated element.
    const filtered = z.object({
      tags: z
        .array(z.object({ name: z.string(), note: z.string().optional() }))
        .transform(tags => tags.filter(tag => tag.name !== "drop"))
        .default([]),
    });
    const store = memoryStore();
    await new PluginSettingsService({
      owner: "@test/p",
      schema: filtered,
      secretPaths: [],
      store,
      secrets: () => [KEY_A],
    }).set({ tags: [{ name: "drop", note: "n" }, { name: "keep" }] });

    expect(store.rows.find(r => r.key === "tags")?.value).toBe(
      '[{"name":"keep"}]'
    );
  });
});

describe("a setting larger than every dialect can hold alike", () => {
  it("is refused", async () => {
    const store = memoryStore();
    await expect(
      service(store).set({
        providers: {
          big: { clientId: "x".repeat(300 * 1024), clientSecret: "s" },
        },
      })
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({ path: "providers", code: "TOO_LARGE" }),
        ],
      },
    });
  });

  it("is stored when it fits", async () => {
    const store = memoryStore();
    await service(store).set({
      providers: {
        big: { clientId: "x".repeat(200 * 1024), clientSecret: "s" },
      },
    });
    expect(store.rows.find(r => r.key === "providers")).toBeDefined();
  });
});

/**
 * Stored settings a newer plugin version no longer accepts — it added a
 * required key. The form is how that gets fixed, so it has to render.
 */
describe("stored settings that no longer fit the schema", () => {
  const v2 = z.object({
    clientSecret: z.string().default(""),
    port: z.number().default(443),
    tenantId: z.string(),
  });
  function v2Service(store: PluginSettingsStore) {
    return new PluginSettingsService({
      owner: "@test/p",
      schema: v2,
      secretPaths: ["clientSecret"],
      store,
      secrets: () => [KEY_A],
    });
  }

  it("still render, with what is stored and the issue beside it", async () => {
    const store = memoryStore();
    await service(store).set({ port: 8443, clientSecret: SECRET_VALUE });

    const view = await v2Service(store).view();

    expect(view.settings).toEqual({
      port: 8443,
      clientSecret: { set: true },
    });
    expect(view.issues.map(issue => issue.path)).toEqual(["tenantId"]);
  });

  it("make get() refuse with an internal error that logs the key", async () => {
    // Internal, not a 400: this is the install's configuration, and a public
    // plugin route must not hand setting paths to whoever called it.
    const store = memoryStore();
    await service(store).set({ port: 8443 });

    const error = await v2Service(store)
      .get()
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: expect.objectContaining({
        reason: "stored-settings-invalid",
        issues: [expect.objectContaining({ path: "tenantId" })],
      }),
    });
    expect(NextlyError.is(error) && error.publicData).toBeFalsy();
  });

  it("report no issue once the missing key is saved", async () => {
    // The control: the issue list reflects the stored state, not the schema.
    const store = memoryStore();
    await service(store).set({ port: 8443 });
    await v2Service(store).set({ tenantId: "t-1" });

    expect((await v2Service(store).view()).issues).toEqual([]);
  });
});

/** What `set()` reports changed: what an audit entry and a listener act on. */
describe("the keys an update reports changed", () => {
  it("names a key whose value moved", async () => {
    const store = memoryStore();
    expect(await service(store).set({ port: 8443 })).toEqual(["port"]);
  });

  it("leaves out a resent value, a secret included", async () => {
    // A secret's stored text differs on every write, so this is judged on
    // the decoded value, not the row.
    const store = memoryStore();
    await service(store).set({ port: 8443, clientSecret: SECRET_VALUE });

    expect(
      await service(store).set({ port: 8443, clientSecret: SECRET_VALUE })
    ).toEqual([]);
  });

  it("names a changed secret", async () => {
    const store = memoryStore();
    await service(store).set({ clientSecret: SECRET_VALUE });

    expect(
      await service(store).set({ clientSecret: ROTATED_SECRET_VALUE })
    ).toEqual(["clientSecret"]);
  });

  it("names a removed key that was stored, and not one that never was", async () => {
    const store = memoryStore();
    await service(store).set({ port: 8443 });

    expect(
      await service(store).set({ port: null, clientSecret: null } as never)
    ).toEqual(["port"]);
  });
});

/**
 * A credential stored encrypted stays secret after the manifest stops naming
 * it: a plugin update that renames, drops or un-declares a secret must not
 * make the stored value readable in the admin, or plaintext at rest.
 */
describe("a secret the current manifest no longer declares", () => {
  const v1 = z.object({ apiKey: z.string().default("") });
  function versioned(
    store: PluginSettingsStore,
    schema: z.ZodObject<z.ZodRawShape>,
    secretPaths: string[],
    secrets: string[] = [KEY_A]
  ) {
    return new PluginSettingsService({
      owner: "@test/p",
      schema,
      secretPaths,
      store,
      secrets: () => secrets,
    });
  }

  it("is not sent to the admin when a newer schema no longer parses", async () => {
    const store = memoryStore();
    await versioned(store, v1, ["apiKey"]).set({ apiKey: SECRET_VALUE });

    const v2 = z.object({ token: z.string() });
    const view = await versioned(store, v2, ["token"]).view();

    expect(JSON.stringify(view)).not.toContain(SECRET_VALUE);
    // Not even as a marker: the key is not this version's configuration.
    expect(view.settings).not.toHaveProperty("apiKey");
  });

  it("is redacted when the manifest stops declaring its path", async () => {
    const store = memoryStore();
    await service(store).set({
      providers: { google: { clientId: "g", clientSecret: SECRET_VALUE } },
    });

    const view = await service(store, [KEY_A], []).view();

    expect(JSON.stringify(view)).not.toContain(SECRET_VALUE);
    expect(view.settings).toMatchObject({
      providers: { google: { clientId: "g", clientSecret: { set: true } } },
    });
  });

  it("stays encrypted when a rotation re-seals its row", async () => {
    const store = memoryStore();
    const legacy = z.object({ legacyKey: z.string().default("") });
    await versioned(store, legacy, ["legacyKey"], [KEY_A]).set({
      legacyKey: SECRET_VALUE,
    });

    // v2 dropped the key from the schema and the manifest; the secret rotated.
    const v2 = z.object({ port: z.number().default(443) });
    await versioned(store, v2, [], [KEY_B, KEY_A]).get();
    await versioned(store, v2, [], [KEY_B, KEY_A]).set({ port: 1 });

    const row = store.rows.find(r => r.key === "legacyKey");
    expect(row?.isSecret).toBe(true);
    expect(row?.value).not.toContain(SECRET_VALUE);
  });

  it("stays encrypted when a sibling of an undeclared leaf is written", async () => {
    const store = memoryStore();
    await service(store).set({
      providers: { google: { clientId: "g", clientSecret: SECRET_VALUE } },
    });

    await service(store, [KEY_A], []).set({
      providers: { google: { clientId: "changed" } },
    } as never);

    const row = store.rows.find(r => r.key === "providers");
    expect(row?.value).toContain("changed");
    expect(row?.value).not.toContain(SECRET_VALUE);
  });

  it("does not block reads when it is lost under a key the schema dropped", async () => {
    const store = memoryStore();
    const legacy = z.object({
      legacyKey: z.string().default(""),
      port: z.number().default(443),
    });
    await versioned(store, legacy, ["legacyKey"], [KEY_B]).set({
      legacyKey: SECRET_VALUE,
    });

    const v2 = z.object({ port: z.number().default(443) });
    await expect(versioned(store, v2, [], [KEY_A]).get()).resolves.toEqual({
      port: 443,
    });
    const view = await versioned(store, v2, [], [KEY_A]).view();
    expect(view.settings).not.toHaveProperty("legacyKey");
  });
});

describe("a null inside a group the store does not hold yet", () => {
  it("removes the member rather than storing null", async () => {
    // RFC 7396 applies the patch to `{}` there; storing the null failed the
    // documented `set({ providers: { github: null } })` on a fresh store.
    const store = memoryStore();
    await service(store).set({ providers: { github: null } } as never);

    const settings = await service(store).get<{
      providers: Record<string, unknown>;
    }>();
    expect(settings.providers).toEqual({});
  });
});
