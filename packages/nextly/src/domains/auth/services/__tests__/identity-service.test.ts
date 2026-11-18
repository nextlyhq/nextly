/**
 * The sign-in hand-off's refusals and resolutions, and the explicit link's
 * session rules — each test named as the property it proves, with the
 * control beside it that a plausible but broken implementation would fail.
 *
 * The refusals are proven "before any lookup and with nothing written" by
 * counting the reads and writes the service makes through a proxy around
 * its own database handle: a refusal that had read the table first, or
 * written a row, shows up in the count even when the thrown error is the
 * right one. The linking policy is the port, faked here as the real policy
 * would answer from a configuration; the session is the port too, faked as
 * core's own session read would answer a request.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../../../__tests__/fixtures/db";
import { loadDialectTables } from "../../../../database/dialect-tables";
import { NextlyError } from "../../../../errors/nextly-error";
import type { PluginDefinition } from "../../../../plugins/plugin-context";

import {
  IdentityService,
  pluginIdentityBinding,
  type CompletingSession,
  type ExternalIdentityHandOff,
  type LinkingPolicyPort,
} from "../identity-service";

/** The plugin whose hand-offs most tests stand in for: stamps `acme-auth:`. */
const ACME: PluginDefinition = {
  name: "acme-auth",
  version: "1.0.0",
  nextly: "*",
};
/** A second plugin, proving the stamping keeps namespaces apart: `orbit-sso:`. */
const ORBIT: PluginDefinition = {
  name: "@orbit/sso",
  version: "1.0.0",
  nextly: "*",
};

const GOOGLE_ISSUER = "https://accounts.google.com";

let testDb: TestDb;
/** Every read and write the service made, counted at its database handle. */
let seen: { selects: number; inserts: number };

// The service resolves its identity table from the loaded dialect bundle at
// construction; the fixture's adapter does not load it (core's `createAdapter`
// does), so this suite loads the one dialect it runs on, as an app's adapter
// would.
beforeAll(async () => {
  await loadDialectTables("sqlite");
});

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

/**
 * The database as the service sees it, counting every select and insert.
 *
 * The proxy pattern `api-key-last-use.test.ts` uses to hold writes, minus
 * the holding: the count alone is what these tests need.
 */
function countedAdapter() {
  seen = { selects: 0, inserts: 0 };
  const db = new Proxy(testDb.db, {
    get(target, property) {
      // The counter's key per intercepted method, so a read or write the
      // service makes lands on the number the assertions read — the mapping
      // is written out rather than derived, because a derived key that
      // mismatched would count into a missing field and every "zero"
      // assertion would pass on nothing.
      if (property === "select" || property === "insert") {
        const counted: "selects" | "inserts" =
          property === "select" ? "selects" : "inserts";
        return (...args: unknown[]) => {
          seen[counted] += 1;
          const method = target[property] as (...a: unknown[]) => unknown;
          return method.apply(target, args);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(testDb.adapter, {
    get(target, property) {
      if (property === "getDrizzle") return () => db;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A linking policy that enables only the keys it is handed, recording each question. */
function policyEnabling(
  ...keys: string[]
): LinkingPolicyPort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    requireEnabled(providerKey: string) {
      asked.push(providerKey);
      if (!keys.includes(providerKey)) {
        throw NextlyError.forbidden({
          logContext: { reason: "provider-key-not-enabled", providerKey },
        });
      }
      return {
        providerKey,
        trustedForImplicitLinking: false,
        provisioning: { mayProvision: false },
      };
    },
  };
}

/** A session reader answering one fixed session, or nobody. */
function sessionReading(
  session: CompletingSession | null
): () => Promise<CompletingSession | null> {
  return async () => session;
}

/** A well-formed hand-off, overridable field by field. */
function handOff(
  overrides: Partial<ExternalIdentityHandOff> = {}
): ExternalIdentityHandOff {
  return {
    providerKey: "google",
    issuer: GOOGLE_ISSUER,
    subject: "subject-one",
    address: "person@example.com",
    addressProved: true,
    passedAdmissionRestriction: true,
    ...overrides,
  };
}

/** The service under test, wired to the counting adapter. */
function service(deps: {
  linkingPolicy: LinkingPolicyPort;
  sessionOf?: () => Promise<CompletingSession | null>;
}): IdentityService {
  return new IdentityService(countedAdapter(), testLogger, {
    // A link completing where nobody is signed in, unless the test says
    // otherwise: an unset reader must refuse rather than wave a link through.
    sessionOf: sessionReading(null),
    ...deps,
  });
}

/** A user row the identity table's foreign key can point at. */
async function plantUser(id: string): Promise<void> {
  await testDb.db
    .insert(testDb.schema.users)
    .values({ id, email: `${id}@example.com`, isActive: true });
}

/** One identity row, written straight to the table as the fixture does. */
async function plantIdentity(row: {
  providerKey: string;
  issuer: string;
  subject: string;
  userId: string;
  address?: string | null;
}): Promise<void> {
  await testDb.db.insert(testDb.schema.nextlyExternalIdentities).values({
    id: randomUUID(),
    providerKey: row.providerKey,
    issuer: row.issuer,
    subject: row.subject,
    address: row.address ?? null,
    userId: row.userId,
    createdAt: new Date("2020-01-01T00:00:00Z"),
  });
}

/** The identity rows one user holds, read straight from the table. */
async function identitiesOf(userId: string): Promise<number> {
  const rows = await testDb.db
    .select({ id: testDb.schema.nextlyExternalIdentities.id })
    .from(testDb.schema.nextlyExternalIdentities)
    .where(eq(testDb.schema.nextlyExternalIdentities.userId, userId));
  return rows.length;
}

/** The refusal a promise settled to, failing the test when it resolved. */
async function refusalOf(work: Promise<unknown>): Promise<NextlyError> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(NextlyError);
    return error as NextlyError;
  }
  throw new Error("expected the hand-off to be refused");
}

describe("the sign-in hand-off intake", () => {
  it("resolves a linked identity to its user", async () => {
    // The control the refusal tests lean on: a planted row, handed over by
    // the plugin whose name is stamped on it, resolves to its account.
    await plantUser("owner");
    await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "subject-one",
      userId: "owner",
    });

    const result = await service({
      linkingPolicy: policyEnabling("acme-auth:google"),
    }).resolveSignInIdentity(pluginIdentityBinding(ACME), handOff());

    expect(result).toEqual({ userId: "owner" });
  });

  it("refuses a missing subject before any lookup or write", async () => {
    const refused = service({ linkingPolicy: policyEnabling() });
    const error = await refusalOf(
      refused.resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: undefined as unknown as string })
      )
    );

    expect(error.logContext).toMatchObject({
      reason: "identity-subject-missing",
    });
    expect(seen).toEqual({ selects: 0, inserts: 0 });
  });

  it("refuses an empty subject before any lookup or write", async () => {
    const error = await refusalOf(
      service({ linkingPolicy: policyEnabling() }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "" })
      )
    );

    expect(error.logContext).toMatchObject({
      reason: "identity-subject-missing",
    });
    expect(seen).toEqual({ selects: 0, inserts: 0 });
  });

  it("refuses a malformed proof flag, strictly boolean", async () => {
    // A truthy value of another type is the plausible bug: a plugin handing
    // the address back as a string, or core defaulting a missing flag to
    // true. Both must refuse, and so must a flag that is simply absent.
    for (const malformed of ["yes", 1, undefined] as unknown as boolean[]) {
      seen = { selects: 0, inserts: 0 };
      const error = await refusalOf(
        service({ linkingPolicy: policyEnabling() }).resolveSignInIdentity(
          pluginIdentityBinding(ACME),
          handOff({ addressProved: malformed })
        )
      );

      expect(error.logContext).toMatchObject({
        reason: "identity-address-proof-malformed",
      });
      expect(seen).toEqual({ selects: 0, inserts: 0 });
    }
  });

  describe("the admission statement a plugin must make", () => {
    // The same three refusals for a linked identity and a new one: whether
    // anything is stored under the key changes nothing, because the check
    // runs before the table is ever read.
    const cases = [
      {
        named: "refuses a missing admission statement",
        statement: undefined as unknown as boolean,
        reason: "identity-admission-statement-malformed",
      },
      {
        named: "refuses a negative admission statement",
        statement: false,
        reason: "identity-admission-statement-negative",
      },
      {
        named: "refuses a malformed admission statement",
        statement: "admitted" as unknown as boolean,
        reason: "identity-admission-statement-malformed",
      },
    ];

    for (const { named, statement, reason } of cases) {
      it(`${named}, linked or new, writing nothing`, async () => {
        // Linked: the identity the hand-off names is already stored.
        await plantUser("owner");
        await plantIdentity({
          providerKey: "acme-auth:google",
          issuer: GOOGLE_ISSUER,
          subject: "subject-one",
          userId: "owner",
        });
        seen = { selects: 0, inserts: 0 };
        const linked = await refusalOf(
          service({
            linkingPolicy: policyEnabling("acme-auth:google"),
          }).resolveSignInIdentity(
            pluginIdentityBinding(ACME),
            handOff({
              passedAdmissionRestriction: statement,
            })
          )
        );
        expect(linked.logContext).toMatchObject({ reason });
        // Nothing written, and nothing read: linked or not never came up.
        expect(seen).toEqual({ selects: 0, inserts: 0 });
        expect(await identitiesOf("owner")).toBe(1);

        // New: nothing is stored under the key at all.
        seen = { selects: 0, inserts: 0 };
        const fresh = await refusalOf(
          service({
            linkingPolicy: policyEnabling("acme-auth:google"),
          }).resolveSignInIdentity(
            pluginIdentityBinding(ACME),
            handOff({
              passedAdmissionRestriction: statement,
              subject: "subject-nobody-holds",
            })
          )
        );
        expect(fresh.logContext).toMatchObject({ reason });
        expect(seen).toEqual({ selects: 0, inserts: 0 });
      });
    }
  });

  it("refuses a key the configuration doesn't enable before any lookup", async () => {
    // A linked identity sits under the key, so a gate that ran after the
    // lookup would have found it and answered. The port records its
    // question and the counting adapter records none: the gate ran, the
    // table was never read.
    await plantUser("owner");
    await plantIdentity({
      providerKey: "acme-auth:github",
      issuer: "",
      subject: "subject-one",
      userId: "owner",
    });

    const policy = policyEnabling("acme-auth:google");
    const error = await refusalOf(
      service({ linkingPolicy: policy }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ providerKey: "github", issuer: undefined })
      )
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(policy.asked).toEqual(["acme-auth:github"]);
    expect(seen).toEqual({ selects: 0, inserts: 0 });
  });

  it("cannot sign in under another plugin's provider key", async () => {
    // Orbit's identity, stored under Orbit's stamp. Acme hands over Orbit's
    // already-stamped key — the most a plugin could do to ride another's
    // namespace — and then the plain key, and neither may resolve: Acme's
    // own stamp goes on whatever it says, putting both lookups somewhere
    // nothing is stored. Orbit handing over its own key is the control.
    await plantUser("orbit-owner");
    await plantIdentity({
      providerKey: "orbit-sso:google",
      issuer: GOOGLE_ISSUER,
      subject: "subject-one",
      userId: "orbit-owner",
    });

    // Each lookup's gate is honest to its own key: Acme's lookups ask about
    // Acme-stamped keys, so the fake enables those, and Orbit's control
    // asks about the key Orbit really holds.
    const acme = service({
      linkingPolicy: policyEnabling(
        "acme-auth:orbit-sso:google",
        "acme-auth:google"
      ),
    });
    expect(
      await acme.resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ providerKey: "orbit-sso:google" })
      )
    ).toEqual({ userId: null });
    expect(
      await acme.resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ providerKey: "google" })
      )
    ).toEqual({ userId: null });

    expect(
      await service({
        linkingPolicy: policyEnabling("orbit-sso:google"),
      }).resolveSignInIdentity(pluginIdentityBinding(ORBIT), handOff())
    ).toEqual({ userId: "orbit-owner" });
  });

  it("resolves no identity for a subject another issuer asserted under the same key", async () => {
    // The subject is held — just not by the issuer this hand-off names.
    // A lookup that ignored the issuer would resolve the other issuer's
    // account, which is a different identity the provider never conflated.
    await plantUser("owner");
    await plantIdentity({
      providerKey: "acme-auth:oidc",
      issuer: "https://issuer-one.example",
      subject: "shared-subject",
      userId: "owner",
    });

    const refused = service({
      linkingPolicy: policyEnabling("acme-auth:oidc"),
    });
    expect(
      await refused.resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({
          providerKey: "oidc",
          issuer: "https://issuer-two.example",
          subject: "shared-subject",
        })
      )
    ).toEqual({ userId: null });

    // The control: the issuer that did assert the subject resolves it.
    expect(
      await refused.resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({
          providerKey: "oidc",
          issuer: "https://issuer-one.example",
          subject: "shared-subject",
        })
      )
    ).toEqual({ userId: "owner" });
  });

  it("never attaches its identity to whoever is signed in at the time", async () => {
    // The person operating the browser is signed in as `bystander`; the
    // hand-off is for an identity nobody holds. The hand-off resolves no
    // one and writes nothing — an unlinked identity is never silently
    // attached to the account that happened to be signed in, which is the
    // implicit-linking branch another slice owns, on its own rules.
    await plantUser("bystander");

    const result = await service({
      linkingPolicy: policyEnabling("acme-auth:google"),
    }).resolveSignInIdentity(
      pluginIdentityBinding(ACME),
      handOff({ subject: "unlinked-subject" })
    );

    expect(result).toEqual({ userId: null });
    expect(seen.inserts).toBe(0);
    expect(await identitiesOf("bystander")).toBe(0);
  });
});

describe("the explicit link operation", () => {
  /** A link request for one identity, completing in one session. */
  function linkInput(options: {
    userId: string;
    sessionJti: string;
    subject?: string;
    address?: string | null;
  }) {
    return {
      identity: handOff({
        subject: options.subject ?? "link-subject",
        ...(options.address === undefined ? {} : { address: options.address }),
      }),
      context: { userId: options.userId, sessionJti: options.sessionJti },
      completingRequest: new Request("https://app.example/callback"),
    };
  }

  it("completes for the same user in the same session, attaching one identity row and issuing no session", async () => {
    await plantUser("linker");

    const attached = await service({
      linkingPolicy: policyEnabling(),
      sessionOf: sessionReading({ userId: "linker", sessionJti: "token-a" }),
    }).completeExplicitLink(
      pluginIdentityBinding(ACME),
      linkInput({ userId: "linker", sessionJti: "token-a" })
    );

    // The row the operation attached, stamped with the plugin's own name.
    expect(await identitiesOf("linker")).toBe(1);
    // Issuing no session is structural here: the operation's whole answer
    // is the identity it attached — no session, token or cookie key exists
    // on it — and the one write it made is the identity row itself.
    expect(Object.keys(attached).sort()).toEqual(["identity"]);
    expect(Object.keys(attached.identity).sort()).toEqual([
      "address",
      "id",
      "issuer",
      "providerKey",
      "subject",
      "userId",
    ]);
    expect(attached.identity).toMatchObject({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "link-subject",
      userId: "linker",
    });
    expect(seen).toEqual({ selects: 1, inserts: 1 });
  });

  it("attaches without matching addresses", async () => {
    // The provider asserts one address and the account holds another: the
    // person's own request vouches for the pairing, so the link attaches
    // anyway. A precondition comparing the addresses is the plausible bug.
    await plantUser("linker");

    await service({
      linkingPolicy: policyEnabling(),
      sessionOf: sessionReading({ userId: "linker", sessionJti: "token-a" }),
    }).completeExplicitLink(
      pluginIdentityBinding(ACME),
      linkInput({
        userId: "linker",
        sessionJti: "token-a",
        address: "provider-asserted@example.com",
      })
    );

    expect(await identitiesOf("linker")).toBe(1);
  });

  it("refuses a link completed in another session", async () => {
    await plantUser("linker");

    const error = await refusalOf(
      service({
        linkingPolicy: policyEnabling(),
        // The same user, signed in on a different token than the one the
        // link started with.
        sessionOf: sessionReading({ userId: "linker", sessionJti: "token-b" }),
      }).completeExplicitLink(
        pluginIdentityBinding(ACME),
        linkInput({ userId: "linker", sessionJti: "token-a" })
      )
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(error.logContext).toMatchObject({
      reason: "link-completing-session-wrong-token",
    });
    expect(seen.inserts).toBe(0);
    expect(await identitiesOf("linker")).toBe(0);
  });

  it("refuses a link completed by another user", async () => {
    await plantUser("linker");
    await plantUser("other");

    const error = await refusalOf(
      service({
        linkingPolicy: policyEnabling(),
        // A valid session, but it belongs to somebody else: the link still
        // belongs to whoever started it.
        sessionOf: sessionReading({ userId: "other", sessionJti: "token-a" }),
      }).completeExplicitLink(
        pluginIdentityBinding(ACME),
        linkInput({ userId: "linker", sessionJti: "token-a" })
      )
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(error.logContext).toMatchObject({
      reason: "link-completing-session-wrong-user",
    });
    expect(seen.inserts).toBe(0);
    expect(await identitiesOf("linker")).toBe(0);
    expect(await identitiesOf("other")).toBe(0);
  });

  it("refuses a link completed after sign-out", async () => {
    await plantUser("linker");

    const error = await refusalOf(
      service({
        linkingPolicy: policyEnabling(),
        // The completing request carries no session anyone still holds.
        sessionOf: sessionReading(null),
      }).completeExplicitLink(
        pluginIdentityBinding(ACME),
        linkInput({ userId: "linker", sessionJti: "token-a" })
      )
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(error.logContext).toMatchObject({
      reason: "link-completing-session-invalid",
    });
    expect(seen.inserts).toBe(0);
    expect(await identitiesOf("linker")).toBe(0);
  });

  it("refuses to move an identity another account already holds", async () => {
    await plantUser("holder");
    await plantUser("linker");
    await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "link-subject",
      userId: "holder",
    });

    const error = await refusalOf(
      service({
        linkingPolicy: policyEnabling(),
        sessionOf: sessionReading({ userId: "linker", sessionJti: "token-a" }),
      }).completeExplicitLink(
        pluginIdentityBinding(ACME),
        linkInput({ userId: "linker", sessionJti: "token-a" })
      )
    );

    expect(error.code).toBe("CONFLICT");
    expect(seen.inserts).toBe(0);
    // The holder keeps what it holds; the linker gained nothing.
    expect(await identitiesOf("holder")).toBe(1);
    expect(await identitiesOf("linker")).toBe(0);
  });
});
