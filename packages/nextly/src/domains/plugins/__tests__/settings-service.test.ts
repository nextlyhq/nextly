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
    write: async written => {
      for (const row of written) {
        const at = rows.findIndex(
          r => r.owner === row.owner && r.key === row.key
        );
        if (at === -1) rows.push(row);
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
