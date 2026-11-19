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

import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../../../__tests__/fixtures/db";
import { loadDialectTables } from "../../../../database/dialect-tables";
import { NextlyError } from "../../../../errors/nextly-error";
import type { PluginDefinition } from "../../../../plugins/plugin-context";
import { externalIdentityKeyDigest } from "../../../../schemas/external-identities";

import { UserMutationService } from "../../../../domains/users/services/user-mutation-service";
import {
  IdentityService,
  pluginIdentityBinding,
  type CompletingSession,
  type ExternalIdentityHandOff,
  type ExternalUserCreator,
  type LinkingPolicyPort,
  type ProviderProvisioningPolicy,
  type ProvisioningRoleResolver,
} from "../identity-service";
import { RoleQueryService } from "../role/role-query-service";

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
let seen: { selects: number; inserts: number; deletes: number };

/**
 * The webhook recording activation singleton, snapshotted: the REAL creation
 * primitive the provisioning branch runs records `user.created` inside its
 * transaction, and recording chains a refresh onto the activation state — a
 * field this file would otherwise leave changed for the next file in the
 * worker. Put back exactly as found, field for field — and where it was
 * absent at the start, removed again, since a singleton this file created
 * would otherwise outlive it in a worker that does not isolate files.
 */
const globalForActivation = globalThis as {
  __nextly_webhookActivation?: Record<string, unknown>;
};
let activationAtStart: Record<string, unknown> | undefined;
let activationExistedAtStart = false;

// The service resolves its identity table from the loaded dialect bundle at
// construction; the fixture's adapter does not load it (core's `createAdapter`
// does), so this suite loads the one dialect it runs on, as an app's adapter
// would.
beforeAll(async () => {
  await loadDialectTables("sqlite");
  activationExistedAtStart =
    globalForActivation.__nextly_webhookActivation !== undefined;
  activationAtStart = globalForActivation.__nextly_webhookActivation
    ? { ...globalForActivation.__nextly_webhookActivation }
    : undefined;
});

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

afterAll(() => {
  if (!activationExistedAtStart) {
    delete globalForActivation.__nextly_webhookActivation;
  } else if (
    activationAtStart !== undefined &&
    globalForActivation.__nextly_webhookActivation !== undefined
  ) {
    Object.assign(
      globalForActivation.__nextly_webhookActivation,
      activationAtStart
    );
  }
});

/**
 * The database as the service sees it, counting every select and insert.
 *
 * The proxy pattern `api-key-last-use.test.ts` uses to hold writes, minus
 * the holding: the count alone is what these tests need.
 */
function countedAdapter() {
  seen = { selects: 0, inserts: 0, deletes: 0 };
  const db = new Proxy(testDb.db, {
    get(target, property) {
      // The counter's key per intercepted method, so a read or write the
      // service makes lands on the number the assertions read — the mapping
      // is written out rather than derived, because a derived key that
      // mismatched would count into a missing field and every "zero"
      // assertion would pass on nothing.
      if (
        property === "select" ||
        property === "insert" ||
        property === "delete"
      ) {
        const counted: "selects" | "inserts" | "deletes" =
          property === "select"
            ? "selects"
            : property === "insert"
              ? "inserts"
              : "deletes";
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
      // A transaction's reads and writes are counted the same way, at the
      // transaction handle the work is given.
      if (property === "transaction") {
        return (work: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
          (target.transaction as (...a: unknown[]) => Promise<unknown>).call(
            target,
            (tx: object) => work(countedTransaction(tx)),
            ...rest
          );
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A transaction handle counting its selects, inserts and deletes into `seen`. */
function countedTransaction(tx: object): object {
  const counters: Record<string, "selects" | "inserts" | "deletes"> = {
    select: "selects",
    insert: "inserts",
    delete: "deletes",
  };
  return new Proxy(tx, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      const counted =
        typeof property === "string" && Object.hasOwn(counters, property)
          ? counters[property]
          : undefined;
      return (...args: unknown[]) => {
        if (counted) seen[counted] += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
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
    policyFor(providerKey: string) {
      return { enabled: keys.includes(providerKey) };
    },
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

/**
 * A linking policy that enables every key with one branch answer, so a test
 * states exactly the provisioning (and, where it matters, the trust) its key
 * carries — as the real policy would answer from a configuration row.
 */
function policyProvisioning(
  provisioning: ProviderProvisioningPolicy,
  trustedForImplicitLinking = false
): LinkingPolicyPort {
  return {
    policyFor() {
      return { enabled: true };
    },
    requireEnabled(providerKey: string) {
      return { providerKey, trustedForImplicitLinking, provisioning };
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

/**
 * The service under test, wired to the counting adapter.
 *
 * The provisioning deps default to the REAL role slug lookup and the REAL
 * user-creation primitive on the same adapter — the composition the branch
 * ships with — so a test that proves a provisioning refusal proves it at the
 * layer that makes it, not at a fake that merely agrees. Tests that need a
 * stand-in pass their own.
 */
function service(deps: {
  linkingPolicy: LinkingPolicyPort;
  roles?: ProvisioningRoleResolver;
  users?: ExternalUserCreator;
  sessionOf?: () => Promise<CompletingSession | null>;
}): IdentityService {
  const adapter = countedAdapter();
  return new IdentityService(adapter, testLogger, {
    roles: new RoleQueryService(adapter, testLogger),
    users: new UserMutationService(adapter, testLogger),
    // A link completing where nobody is signed in, unless the test says
    // otherwise: an unset reader must refuse rather than wave a link through.
    sessionOf: sessionReading(null),
    ...deps,
  });
}

/** A user row the identity table's foreign key can point at, password-less unless given one. */
async function plantUser(
  id: string,
  email = `${id}@example.com`,
  options: { passwordHash?: string } = {}
): Promise<void> {
  await testDb.db.insert(testDb.schema.users).values({
    id,
    email,
    isActive: true,
    passwordHash: options.passwordHash ?? null,
  });
}

/** One identity row, written straight to the table as the fixture does. Its id. */
async function plantIdentity(row: {
  providerKey: string;
  issuer: string;
  subject: string;
  userId: string;
  address?: string | null;
  /** When the link was made; the fixed moment unless a test says otherwise. */
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await testDb.db.insert(testDb.schema.nextlyExternalIdentities).values({
    id,
    providerKey: row.providerKey,
    issuer: row.issuer,
    subject: row.subject,
    // The digest the unique index holds, derived exactly as the service
    // derives the ones it looks rows up by.
    keyDigest: externalIdentityKeyDigest(
      row.providerKey,
      row.issuer,
      row.subject
    ),
    address: row.address ?? null,
    userId: row.userId,
    createdAt: row.createdAt ?? new Date("2020-01-01T00:00:00Z"),
  });
  return id;
}

/** The identity rows one user holds, read straight from the table. */
async function identitiesOf(userId: string): Promise<number> {
  const rows = await testDb.db
    .select({ id: testDb.schema.nextlyExternalIdentities.id })
    .from(testDb.schema.nextlyExternalIdentities)
    .where(eq(testDb.schema.nextlyExternalIdentities.userId, userId));
  return rows.length;
}

/**
 * A role row, written straight to the table — the slug is what both the
 * mapping and the creation primitive's refusals read, so the rest of the row
 * is the minimum the table takes.
 */
async function plantRole(slug: string): Promise<string> {
  const id = `role-${slug}`;
  await testDb.db.insert(testDb.schema.roles).values({
    id,
    name: slug,
    slug,
    level: 10,
    isSystem: false,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2020-01-01T00:00:00Z"),
  });
  return id;
}

/** The account rows the users table holds, read straight from the table. */
async function usersCount(): Promise<number> {
  const rows = await testDb.db
    .select({ id: testDb.schema.users.id })
    .from(testDb.schema.users);
  return rows.length;
}

/** The one account holding an address, or none. */
async function userHolding(
  email: string
): Promise<Record<string, unknown> | undefined> {
  const rows = await testDb.db
    .select()
    .from(testDb.schema.users)
    .where(eq(testDb.schema.users.email, email));
  return rows[0];
}

/** The role ids one account was granted, read straight from the table. */
async function rolesOf(userId: string): Promise<string[]> {
  const rows = await testDb.db
    .select({ roleId: testDb.schema.userRoles.roleId })
    .from(testDb.schema.userRoles)
    .where(eq(testDb.schema.userRoles.userId, userId));
  return rows.map(row => row.roleId);
}

/** The identity row one stamped key and subject resolve, or none. */
async function identityRowOf(
  providerKey: string,
  subject: string
): Promise<Record<string, unknown> | undefined> {
  const rows = await testDb.db
    .select()
    .from(testDb.schema.nextlyExternalIdentities)
    .where(
      and(
        eq(testDb.schema.nextlyExternalIdentities.providerKey, providerKey),
        eq(testDb.schema.nextlyExternalIdentities.subject, subject)
      )
    );
  return rows[0];
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
  // The payload itself is the first thing parsed: a plugin that calls with
  // no object at all gets the same intake refusal a malformed field gets,
  // not a TypeError from the first field read.
  for (const [named, payload] of [
    ["null", null],
    ["undefined", undefined],
    ["a string", "acme-auth:google"],
  ] as const) {
    it(`refuses a hand-off that is ${named}, as validation rather than a crash`, async () => {
      const error = await refusalOf(
        service({ linkingPolicy: policyEnabling() }).resolveSignInIdentity(
          pluginIdentityBinding(ACME),
          payload as unknown as ExternalIdentityHandOff
        )
      );

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.logContext).toMatchObject({
        reason: "identity-handoff-malformed",
      });
      expect(seen).toEqual({ selects: 0, inserts: 0, deletes: 0 });
    });
  }

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
    expect(seen).toEqual({ selects: 0, inserts: 0, deletes: 0 });
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
    expect(seen).toEqual({ selects: 0, inserts: 0, deletes: 0 });
  });

  it("refuses a malformed proof flag, strictly boolean", async () => {
    // A truthy value of another type is the plausible bug: a plugin handing
    // the address back as a string, or core defaulting a missing flag to
    // true. Both must refuse, and so must a flag that is simply absent.
    for (const malformed of ["yes", 1, undefined] as unknown as boolean[]) {
      seen = { selects: 0, inserts: 0, deletes: 0 };
      const error = await refusalOf(
        service({ linkingPolicy: policyEnabling() }).resolveSignInIdentity(
          pluginIdentityBinding(ACME),
          handOff({ addressProved: malformed })
        )
      );

      expect(error.logContext).toMatchObject({
        reason: "identity-address-proof-malformed",
      });
      expect(seen).toEqual({ selects: 0, inserts: 0, deletes: 0 });
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
        seen = { selects: 0, inserts: 0, deletes: 0 };
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
        expect(seen).toEqual({ selects: 0, inserts: 0, deletes: 0 });
        expect(await identitiesOf("owner")).toBe(1);

        // New: nothing is stored under the key at all.
        seen = { selects: 0, inserts: 0, deletes: 0 };
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
        expect(seen).toEqual({ selects: 0, inserts: 0, deletes: 0 });
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
    expect(seen).toEqual({ selects: 0, inserts: 0, deletes: 0 });
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

  it("resolves no identity for a case-variant of a stored subject", async () => {
    // The lookup is by the digest of the key's exact bytes, never by the
    // text columns: `User42` and `user42` are different subjects however a
    // database's collation compares the columns themselves (MySQL's default
    // folds them, which is why the digest exists — the integration suite
    // proves it against that collation for real).
    await plantUser("owner");
    await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "user42",
      userId: "owner",
    });

    const resolver = service({
      linkingPolicy: policyEnabling("acme-auth:google"),
    });
    expect(
      await resolver.resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "User42" })
      )
    ).toEqual({ userId: null });

    // The control: the subject exactly as stored still resolves its account.
    expect(
      await resolver.resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "user42" })
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

describe("the provisioning branch", () => {
  // The roles and the creation primitive are the real ones (see `service`),
  // so every refusal below proves the layer that actually makes it: the
  // empty set, the unknown name and the unproved address at the service's
  // own mapping; the empty install, the held address and super-admin at the
  // creation primitive the branch runs.

  it("provisions on a first sign-in: active, verified, without a password, the identity attached, exactly the configured roles", async () => {
    await plantUser("first"); // the install is not empty
    const editor = await plantRole("editor");

    const result = await service({
      linkingPolicy: policyProvisioning({
        mayProvision: true,
        roles: ["editor"],
      }),
    }).resolveSignInIdentity(
      pluginIdentityBinding(ACME),
      handOff({ subject: "new-person" })
    );

    // The account, exactly as R-7 shapes it: usable at once, its address
    // already verified, no credential anywhere on it. Its name is the
    // address — the one string the provider vouched for.
    const account = await userHolding("person@example.com");
    expect(account).toMatchObject({
      id: result.userId,
      isActive: true,
      passwordHash: null,
      name: "person@example.com",
    });
    expect(
      (account as { emailVerified?: unknown } | undefined)?.emailVerified
    ).toBeInstanceOf(Date);

    // Exactly the configured roles, and no other.
    expect(await rolesOf(String(result.userId))).toEqual([editor]);

    // The identity attached to the account it made, under the plugin's
    // stamped key, holding the address the provider asserted.
    expect(await identitiesOf(String(result.userId))).toBe(1);
    expect(await identityRowOf("acme-auth:google", "new-person")).toMatchObject(
      {
        userId: result.userId,
        address: "person@example.com",
      }
    );
  });

  it("resolves every configured role in one read, however many the configuration names", async () => {
    await plantUser("first");
    const editor = await plantRole("editor");
    const author = await plantRole("author");
    const reviewer = await plantRole("reviewer");

    // The real slug lookup, every call to it recorded: a resolution that
    // asked once per name would show one call per role here, not one.
    const real = new RoleQueryService(testDb.adapter, testLogger);
    const asked: string[][] = [];
    const roles: ProvisioningRoleResolver = {
      findRoleIdsBySlugs(slugs) {
        asked.push([...slugs]);
        return real.findRoleIdsBySlugs(slugs);
      },
    };

    const result = await service({
      linkingPolicy: policyProvisioning({
        mayProvision: true,
        // A repeated name is one role, asked for once.
        roles: ["editor", "author", "reviewer", "editor"],
      }),
      roles,
    }).resolveSignInIdentity(
      pluginIdentityBinding(ACME),
      handOff({ subject: "new-person" })
    );

    expect(asked).toEqual([["editor", "author", "reviewer"]]);
    expect((await rolesOf(String(result.userId))).sort()).toEqual(
      [author, editor, reviewer].sort()
    );
  });

  it("names the first configured role no role carries, in the configuration's order", async () => {
    // Two names resolve to nothing; the refusal names the one the
    // configuration lists first — not the alphabetically first, and not
    // whichever the read happened to leave out first.
    await plantUser("first");
    await plantRole("editor");

    const error = await refusalOf(
      service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: ["zeta-ghost", "editor", "alpha-ghost"],
        }),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person" })
      )
    );

    expect(error.logContext).toMatchObject({
      reason: "provisioning-role-unknown",
      role: "zeta-ghost",
    });
    expect(seen.inserts).toBe(0);
    expect(await usersCount()).toBe(1);
  });

  it("attaches the provisioned identity under the digest the next sign-in resolves it by", async () => {
    // The account the branch makes is half of the first sign-in: the row it
    // attaches is the one the SAME identity's next sign-in must resolve,
    // and every lookup reads the digest — so the attach has to write
    // exactly the digest the intake derived, or the person arrives once and
    // is a stranger the second time.
    await plantUser("founder"); // the install is not empty
    await plantRole("editor");
    const first = await service({
      linkingPolicy: policyProvisioning({
        mayProvision: true,
        roles: ["editor"],
      }),
    }).resolveSignInIdentity(
      pluginIdentityBinding(ACME),
      handOff({ subject: "arriving-person" })
    );
    expect(first.userId).toBeTypeOf("string");

    // The second sign-in — the same identity, through a key with neither
    // branch answer — resolves the account the first one made and writes
    // nothing more: one account, one row, no second provisioning.
    const accounts = await usersCount();
    expect(
      await service({
        linkingPolicy: policyEnabling("acme-auth:google"),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "arriving-person" })
      )
    ).toEqual({ userId: first.userId });
    expect(await usersCount()).toBe(accounts);
    expect(await identitiesOf(String(first.userId))).toBe(1);

    // The row the branch attached carries exactly the digest the lookup
    // reads, derived from the stamped key, the issuer and the subject.
    expect(
      await identityRowOf("acme-auth:google", "arriving-person")
    ).toMatchObject({
      keyDigest: externalIdentityKeyDigest(
        "acme-auth:google",
        GOOGLE_ISSUER,
        "arriving-person"
      ),
    });

    // A case-variant of the provisioned subject is a different identity:
    // the digest the row was written under does not fold it together,
    // however the database's collation compares the text columns.
    expect(
      await service({
        linkingPolicy: policyEnabling("acme-auth:google"),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "Arriving-Person" })
      )
    ).toEqual({ userId: null });
  });

  it("signs a linked identity in through a key with neither trust nor provision — and without re-provisioning even when the key may", async () => {
    // The branch answers govern only their branches: a linked identity
    // resolves its own account through a key carrying neither, and — the
    // stronger case — through one that may provision, without a second
    // account being made for it.
    await plantUser("owner");
    await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "subject-one",
      userId: "owner",
    });

    expect(
      await service({
        linkingPolicy: policyProvisioning({ mayProvision: false }),
      }).resolveSignInIdentity(pluginIdentityBinding(ACME), handOff())
    ).toEqual({ userId: "owner" });

    expect(
      await service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: ["editor"],
        }),
      }).resolveSignInIdentity(pluginIdentityBinding(ACME), handOff())
    ).toEqual({ userId: "owner" });

    // No account was made for the linked identity, and its row is unchanged.
    expect(await usersCount()).toBe(1);
    expect(await identitiesOf("owner")).toBe(1);
  });

  it("refuses provisioning through a key that may not provision, writing nothing", async () => {
    await plantUser("first");
    await plantRole("editor");

    const result = await service({
      linkingPolicy: policyProvisioning({ mayProvision: false }),
    }).resolveSignInIdentity(
      pluginIdentityBinding(ACME),
      handOff({ subject: "new-person" })
    );

    expect(result).toEqual({ userId: null });
    expect(seen.inserts).toBe(0);
    expect(await usersCount()).toBe(1);
    expect(
      await identityRowOf("acme-auth:google", "new-person")
    ).toBeUndefined();
  });

  it("provisions nothing through a key trusted for implicit linking but not provisioning", async () => {
    // The negative side of the trust branch: trust governs implicit linking
    // alone, which is not built here, so a trusted key that may not
    // provision still provisions nothing.
    await plantUser("first");
    await plantRole("editor");

    const result = await service({
      linkingPolicy: policyProvisioning(
        { mayProvision: false },
        /* trustedForImplicitLinking: */ true
      ),
    }).resolveSignInIdentity(
      pluginIdentityBinding(ACME),
      handOff({ subject: "new-person" })
    );

    expect(result).toEqual({ userId: null });
    expect(seen.inserts).toBe(0);
    expect(await usersCount()).toBe(1);
  });

  it("refuses to provision a hand-off with no address, writing nothing", async () => {
    await plantUser("first");
    await plantRole("editor");

    const error = await refusalOf(
      service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: ["editor"],
        }),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person", address: null })
      )
    );

    expect(error.logContext).toMatchObject({
      reason: "provisioning-address-missing",
    });
    expect(seen.inserts).toBe(0);
    expect(await usersCount()).toBe(1);
  });

  it("refuses to provision an address the provider did not prove", async () => {
    // The account would be created with its address stamped verified; a
    // proof the provider never made would counterfeit that stamp.
    await plantUser("first");
    await plantRole("editor");

    const error = await refusalOf(
      service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: ["editor"],
        }),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person", addressProved: false })
      )
    );

    expect(error.logContext).toMatchObject({
      reason: "provisioning-address-unproved",
    });
    expect(seen.inserts).toBe(0);
    expect(await usersCount()).toBe(1);
  });

  it("refuses an empty configured role set before any account is made", async () => {
    await plantUser("first");

    const error = await refusalOf(
      service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: [],
        }),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person" })
      )
    );

    expect(error.logContext).toMatchObject({
      reason: "provisioning-roles-empty",
    });
    expect(seen.inserts).toBe(0);
    expect(await usersCount()).toBe(1);
  });

  it("refuses a configured role name no role carries, naming it", async () => {
    await plantUser("first");
    await plantRole("editor"); // the first name resolves; the second must not

    const error = await refusalOf(
      service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: ["editor", "ghost-role"],
        }),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person" })
      )
    );

    // Naming the role, so the operator can fix the configuration: the
    // refusal says which name resolved to nothing.
    expect(error.code).toBe("VALIDATION_ERROR");
    const errors = (
      error.publicData as { errors?: Array<{ message?: string }> } | undefined
    )?.errors;
    expect(errors?.[0]?.message).toContain("ghost-role");
    expect(error.logContext).toMatchObject({
      reason: "provisioning-role-unknown",
      role: "ghost-role",
    });
    expect(seen.inserts).toBe(0);
    expect(await usersCount()).toBe(1);
  });

  it("refuses the super-admin role the configuration names — the creation refuses it, not the mapping", async () => {
    // The slug resolves (the role exists), so the refusal is the primitive's
    // own: core still refuses what the configuration may name.
    await plantUser("first");
    await plantRole("super-admin");

    const error = await refusalOf(
      service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: ["super-admin"],
        }),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person" })
      )
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(error.logContext).toMatchObject({
      reason: "external-user-super-admin-refused",
    });
    expect(await userHolding("person@example.com")).toBeUndefined();
    expect(await usersCount()).toBe(1);
  });

  it("refuses to provision an address another account already holds", async () => {
    await plantUser("holder", "person@example.com");
    await plantRole("editor");

    const error = await refusalOf(
      service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: ["editor"],
        }),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person" })
      )
    );

    expect(error.code).toBe("DUPLICATE");
    // The holder keeps the address alone: no second account, no identity row.
    expect(await usersCount()).toBe(1);
    expect(
      await identityRowOf("acme-auth:google", "new-person")
    ).toBeUndefined();
  });

  it("refuses to provision on an install with no user", async () => {
    // The first account decides who administers the site; a provider must
    // never be what mints it.
    await plantRole("editor");

    const error = await refusalOf(
      service({
        linkingPolicy: policyProvisioning({
          mayProvision: true,
          roles: ["editor"],
        }),
      }).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person" })
      )
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(error.logContext).toMatchObject({
      reason: "external-user-on-empty-install",
    });
    expect(await usersCount()).toBe(0);
  });

  it("takes provisioning roles from the configuration, never from the hand-off", async () => {
    await plantUser("first");
    const editor = await plantRole("editor");
    await plantRole("intruder");

    // A hand-off carrying roles-shaped extra data — the most a plugin could
    // hand over — provisions only the configured set. The intruder role
    // exists, so an implementation that read the hand-off would grant it and
    // this assertion would see more than the configured role.
    const payload = Object.assign(handOff({ subject: "new-person" }), {
      roles: ["intruder"],
      provision: { roles: ["intruder"] },
    });

    const result = await service({
      linkingPolicy: policyProvisioning({
        mayProvision: true,
        roles: ["editor"],
      }),
    }).resolveSignInIdentity(pluginIdentityBinding(ACME), payload);

    const account = await userHolding("person@example.com");
    expect(account).toMatchObject({ id: result.userId });
    expect(await rolesOf(String(result.userId))).toEqual([editor]);
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
    expect(seen).toEqual({ selects: 1, inserts: 1, deletes: 0 });
  });

  it("returns the standing row when the same user links the same identity again", async () => {
    // A repeated link by the same account is neither an error nor a second
    // row: the link already stands, and the answer is the row exactly as it
    // is stored. (A different account holding the identity stays the
    // conflict the suite names separately.)
    await plantUser("linker");

    const asLinker = {
      linkingPolicy: policyEnabling(),
      sessionOf: sessionReading({ userId: "linker", sessionJti: "token-a" }),
    };
    const first = await service(asLinker).completeExplicitLink(
      pluginIdentityBinding(ACME),
      linkInput({ userId: "linker", sessionJti: "token-a" })
    );

    seen = { selects: 0, inserts: 0, deletes: 0 };
    const again = await service(asLinker).completeExplicitLink(
      pluginIdentityBinding(ACME),
      linkInput({ userId: "linker", sessionJti: "token-a" })
    );

    expect(again).toEqual(first);
    // One read to find the standing row, and no write of a second one.
    expect(seen).toEqual({ selects: 1, inserts: 0, deletes: 0 });
    expect(await identitiesOf("linker")).toBe(1);
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

describe("the listing of a user's identities", () => {
  it("returns exactly the owner's rows, oldest link first, and nobody else's", async () => {
    await plantUser("owner");
    await plantUser("other");
    await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "first-linked",
      userId: "owner",
      address: "person@example.com",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    });
    await plantIdentity({
      providerKey: "acme-auth:github",
      issuer: "",
      subject: "second-linked",
      userId: "owner",
      createdAt: new Date("2021-01-01T00:00:00Z"),
    });
    // A third identity another account holds: a listing scoped to the owner
    // leaves it out, whatever it is stored under.
    await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "someone-elses",
      userId: "other",
      createdAt: new Date("2019-01-01T00:00:00Z"),
    });

    const listed = await service({
      linkingPolicy: policyEnabling(),
    }).listExternalIdentities("owner");

    expect(listed.map(identity => identity.subject)).toEqual([
      "first-linked",
      "second-linked",
    ]);
    expect(listed[0]).toMatchObject({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      address: "person@example.com",
      userId: "owner",
    });
    expect(listed[0].createdAt).toEqual(new Date("2020-01-01T00:00:00Z"));
    // A listing asks nothing but the one read.
    expect(seen).toEqual({ selects: 1, inserts: 0, deletes: 0 });
  });

  it("answers an empty list for a user who holds none", async () => {
    await plantUser("owner");
    await plantUser("other");
    // Another account's identity exists; the owner's listing names none of
    // it, and no error either: holding nothing is an answer, not a refusal.
    await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "someone-elses",
      userId: "other",
    });

    const listed = await service({
      linkingPolicy: policyEnabling(),
    }).listExternalIdentities("owner");

    expect(listed).toEqual([]);
  });
});

describe("the unlink of one identity", () => {
  it("removes the named row and writes nothing else", async () => {
    await plantUser("owner");
    const kept = await plantIdentity({
      providerKey: "acme-auth:github",
      issuer: "",
      subject: "kept",
      userId: "owner",
    });
    const removed = await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "removed",
      userId: "owner",
    });

    // The kept identity's provider is enabled, so it is the account's way in.
    const unlinker = service({
      linkingPolicy: policyEnabling("acme-auth:github"),
    });
    await unlinker.unlinkExternalIdentity("owner", removed);

    // The named row alone: the sibling keeps its place, and the unlink made
    // no write of any other kind — its one delete statement, nothing else.
    expect(seen).toMatchObject({ inserts: 0, deletes: 1 });
    const held = await unlinker.listExternalIdentities("owner");
    expect(held.map(identity => identity.id)).toEqual([kept]);
  });

  it("refuses an identity another user holds, leaving both accounts as they were", async () => {
    await plantUser("owner", "owner@example.com", { passwordHash: "hash" });
    await plantUser("other");
    const theirs = await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "theirs",
      userId: "other",
    });

    const error = await refusalOf(
      service({
        linkingPolicy: policyEnabling(),
      }).unlinkExternalIdentity("owner", theirs)
    );

    // The same refusal a missing identity gets: whose row an id names is
    // not the caller's to learn from this door. Only the owner's own rows
    // were read, and nothing was written.
    expect(error.code).toBe("NOT_FOUND");
    expect(await identitiesOf("other")).toBe(1);
    expect(await identitiesOf("owner")).toBe(0);
    expect(seen).toMatchObject({ inserts: 0, deletes: 0 });
  });

  it("answers a second unlink of the same identity as a clean not-found", async () => {
    await plantUser("owner", "owner@example.com", { passwordHash: "hash" });
    const removed = await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "removed-once",
      userId: "owner",
    });
    const unlinker = service({ linkingPolicy: policyEnabling() });
    await unlinker.unlinkExternalIdentity("owner", removed);

    const error = await refusalOf(
      unlinker.unlinkExternalIdentity("owner", removed)
    );

    expect(error.code).toBe("NOT_FOUND");
    expect(await identitiesOf("owner")).toBe(0);
  });
});

describe("the unlink of the last way in (L8)", () => {
  it("refuses the only identity of an account with no password", async () => {
    await plantUser("owner");
    const only = await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "only",
      userId: "owner",
    });

    const error = await refusalOf(
      service({
        linkingPolicy: policyEnabling("acme-auth:google"),
      }).unlinkExternalIdentity("owner", only)
    );

    expect(error.code).toBe("CONFLICT");
    expect(error.logContext).toMatchObject({ reason: "identity-last-way-in" });
    expect(await identitiesOf("owner")).toBe(1);
    expect(seen).toMatchObject({ deletes: 0 });
  });

  it("refuses when the other identity's provider is disabled", async () => {
    await plantUser("owner");
    await plantIdentity({
      providerKey: "acme-auth:github",
      issuer: "",
      subject: "at-a-disabled-provider",
      userId: "owner",
    });
    const target = await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "target",
      userId: "owner",
    });

    // Only the target's own provider is enabled: the identity left behind
    // is at a disabled one, which is no way in.
    const error = await refusalOf(
      service({
        linkingPolicy: policyEnabling("acme-auth:google"),
      }).unlinkExternalIdentity("owner", target)
    );

    expect(error.code).toBe("CONFLICT");
    expect(await identitiesOf("owner")).toBe(2);
  });

  it("unlinks the only identity of an account that has a password", async () => {
    await plantUser("owner", "owner@example.com", { passwordHash: "hash" });
    const only = await plantIdentity({
      providerKey: "acme-auth:google",
      issuer: GOOGLE_ISSUER,
      subject: "only",
      userId: "owner",
    });

    await service({ linkingPolicy: policyEnabling() }).unlinkExternalIdentity(
      "owner",
      only
    );

    expect(await identitiesOf("owner")).toBe(0);
  });
});
