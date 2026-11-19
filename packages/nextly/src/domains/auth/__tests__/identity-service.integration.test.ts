/**
 * The identity service over each configured dialect, as the table's first
 * real reader and writer: a linked identity resolving to its account, the
 * explicit link attaching its row through a real completing session, a
 * refused hand-off leaving the table exactly as it was, a case-variant
 * subject resolving nothing under each dialect's real collation, a repeated
 * link answering with the standing row, and the provisioning branch creating
 * a real account through the real creation primitive with exactly the
 * configured roles — its refusals leaving every table untouched.
 *
 * The provisioning races: two first sign-ins for one issuerless identity
 * held at the creation primitive's door until both have passed the read
 * that precedes it, then released together — the read-then-write window the
 * unique index exists to decide — and, on the dialects with a second
 * connection to hold one on, a sign-in colliding with an attach still
 * uncommitted.
 *
 * The linking policy is the port, answered here by fakes that enable every
 * key: the policy's own matrix is another change's, and what these legs
 * prove is the service's behaviour on each database. Everything else is
 * real — the completing session (a token signed with the instance's secret,
 * judged by core's own session read), the role slug lookup, and the
 * user-creation primitive — because the link's session rule and the
 * provisioning refusals are only proven by the machinery that will enforce
 * them.
 */

// Sessions sign with keys derived from this; set before any module reads env.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { COOKIE_NAMES } from "../../../auth/cookies/cookie-config";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { verifyAccessToken } from "../../../auth/jwt/verify";
import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { NextlyError } from "../../../errors/nextly-error";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { externalIdentityKeyDigest } from "../../../schemas/external-identities";
import { ServiceContainer } from "../../../services/index";
import {
  IdentityService,
  pluginIdentityBinding,
  type ExternalIdentityHandOff,
  type ExternalUserCreator,
  type LinkingPolicyPort,
} from "../services/identity-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The plugin whose stamp every hand-off here carries: `acme-auth:`. */
const ACME: PluginDefinition = {
  name: "acme-auth",
  version: "1.0.0",
  nextly: "*",
};

/** A linking policy that enables every key: the matrix is another change's. */
const EVERY_KEY_ENABLED: LinkingPolicyPort = {
  policyFor() {
    return { enabled: true };
  },
  requireEnabled(providerKey: string) {
    return {
      providerKey,
      trustedForImplicitLinking: false,
      provisioning: { mayProvision: false },
    };
  },
};

/**
 * A linking policy that enables every key to provision exactly the roles
 * named — as the real policy would answer for a configured `provision.roles`.
 */
function provisioningPolicy(roles: readonly string[]): LinkingPolicyPort {
  return {
    policyFor() {
      return { enabled: true };
    },
    requireEnabled(providerKey: string) {
      return {
        providerKey,
        trustedForImplicitLinking: false,
        provisioning: { mayProvision: true, roles },
      };
    },
  };
}

/** A linking policy that enables only the keys it is handed. */
function enablingOnly(...keys: string[]): LinkingPolicyPort {
  return {
    policyFor(providerKey: string) {
      return { enabled: keys.includes(providerKey) };
    },
    requireEnabled(providerKey: string) {
      if (!keys.includes(providerKey)) {
        throw NextlyError.forbidden({
          logContext: { reason: "provider-key-not-enabled", providerKey },
        });
      }
      return EVERY_KEY_ENABLED.requireEnabled(providerKey);
    },
  };
}

/** The service on the booted instance's adapter, with the real provisioning deps. */
function serviceOn(
  handle: TestNextly,
  linkingPolicy: LinkingPolicyPort = EVERY_KEY_ENABLED
): IdentityService {
  const services = new ServiceContainer(handle.adapter);
  return new IdentityService(handle.adapter, handle.getService("logger"), {
    linkingPolicy,
    roles: services.roles,
    users: services.users,
  });
}

/**
 * A gate both racing unlinks pass through at their delete, after their
 * check: each arrival waits, and the second opens the way for both. An
 * unlink that held no lock across its check would let both arrive and both
 * delete, each having read the other's identity as still there. Under the
 * account's lock the second never reaches the gate while the first holds
 * it, so the first is let through by the timeout instead and the second
 * reads what it left.
 */
function startGate(timeoutMs = 1500): { enter: () => Promise<void> } {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>(resolve => (open = resolve));
  return {
    async enter(): Promise<void> {
      arrived += 1;
      if (arrived === 2) open();
      await Promise.race([
        gate,
        new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
      ]);
    },
  };
}

/** The adapter, every transaction's delete held at `gate` first. */
function gatedAtTheDelete(
  adapter: DrizzleAdapter,
  gate: { enter: () => Promise<void> }
): DrizzleAdapter {
  const gatedTransaction = (tx: object): object =>
    new Proxy(tx, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        if (property === "delete") {
          return async (...args: unknown[]) => {
            await gate.enter();
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });
  return new Proxy(adapter, {
    get(target, property) {
      if (property === "transaction") {
        return (work: (tx: object) => Promise<unknown>, ...rest: unknown[]) =>
          (target.transaction as (...a: unknown[]) => Promise<unknown>).call(
            target,
            (tx: object) => work(gatedTransaction(tx)),
            ...rest
          );
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A booted instance, with the core auth tables the SQLite auto-sync leaves unmade. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  if (dialect === "sqlite") {
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }
  }
  return current;
}

/** A well-formed hand-off, overridable field by field. */
function handOff(
  overrides: Partial<ExternalIdentityHandOff> = {}
): ExternalIdentityHandOff {
  return {
    providerKey: "google",
    issuer: "https://accounts.google.com",
    subject: "subject-one",
    address: "person@example.com",
    addressProved: true,
    passedAdmissionRestriction: true,
    ...overrides,
  };
}

/** One identity row, written straight to the table as the fixture does. Its id. */
async function insertIdentity(
  handle: TestNextly,
  row: {
    providerKey: string;
    issuer: string;
    subject: string;
    userId: string;
    address?: string;
    /** When the link was made; the fixed moment unless a test says otherwise. */
    createdAt?: Date;
  }
): Promise<string> {
  const id = randomUUID();
  await handle.adapter.insert("nextly_external_identities", {
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
    ...(row.address !== undefined ? { address: row.address } : {}),
    userId: row.userId,
    createdAt: row.createdAt ?? new Date("2020-01-01T00:00:00Z"),
  });
  return id;
}

/** Every identity row the table holds, for before-and-after counts. */
async function identityRows(handle: TestNextly): Promise<unknown[]> {
  return handle.adapter.select("nextly_external_identities");
}

/**
 * A role row, written directly — the `create-external-user` suite's seeding:
 * what is under test is which roles a provisioned account ends up with, not
 * how a role is built.
 */
async function seedRole(handle: TestNextly, slug: string): Promise<string> {
  const db = handle.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (v: unknown) => Promise<unknown> };
  };
  const { roles } = getDialectTables();
  const id = `role-${slug}`;
  await db.insert(roles).values({
    id,
    name: slug,
    slug,
    level: 10,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

/** The rows the three tables a provisioning writes hold, for before/after. */
async function provisioningFootprint(handle: TestNextly): Promise<{
  users: number;
  identities: number;
  userRoles: number;
}> {
  const [users, identities, userRoles] = await Promise.all([
    handle.adapter.select("users"),
    handle.adapter.select("nextly_external_identities"),
    handle.adapter.select("user_roles"),
  ]);
  return {
    users: users.length,
    identities: identities.length,
    userRoles: userRoles.length,
  };
}

/**
 * Resolve one provisioning hand-off and expect the refusal named, with every
 * table exactly as it was: a refusal that had written anything shows in the
 * footprint even when the thrown error is the right one.
 */
async function refusedWritingNothing(
  handle: TestNextly,
  policy: LinkingPolicyPort,
  payload: ExternalIdentityHandOff,
  expected: { code: string; reason?: string }
): Promise<void> {
  const before = await provisioningFootprint(handle);
  const error = await serviceOn(handle, policy)
    .resolveSignInIdentity(pluginIdentityBinding(ACME), payload)
    .then(
      () => {
        throw new Error("expected the provisioning to be refused");
      },
      (err: unknown) => err
    );
  expect(error).toBeInstanceOf(NextlyError);
  expect(error).toMatchObject({ code: expected.code });
  if (expected.reason !== undefined) {
    expect(error).toMatchObject({ logContext: { reason: expected.reason } });
  }
  expect(await provisioningFootprint(handle)).toEqual(before);
}

/**
 * A request whose session cookie carries a freshly signed token for `user`,
 * and the token's `jti` — the session id a link context records.
 */
async function signedInAs(
  handle: TestNextly,
  userId: string
): Promise<{ request: Request; sessionJti: string }> {
  const secret = process.env.NEXTLY_SECRET as string;
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: "Linked Person",
      image: null,
      roleIds: [],
    }),
    secret
  );
  const verified = await verifyAccessToken(token, secret);
  if (!verified.valid) throw new Error("the test's token did not verify");
  const request = new Request("https://app.example/callback", {
    headers: { cookie: `${COOKIE_NAMES.accessToken}=${token}` },
  });
  return { request, sessionJti: verified.payload.jti };
}

/**
 * A gate both racing sign-ins pass through at the creation primitive's
 * door: each arrival waits, and the second opens the way for both. Every
 * writer held there has already passed the identity lookup that precedes
 * the primitive, so opening the gate releases two writers that both read
 * "no such identity" and are both about to write — the read-then-write
 * window two first sign-ins race in, deterministic rather than left to
 * timing, with the write phase itself exactly what production runs.
 */
function startSignInGate(): { enter: () => Promise<void> } {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>(resolve => (open = resolve));
  return {
    async enter(): Promise<void> {
      arrived += 1;
      if (arrived === 2) open();
      await gate;
    },
  };
}

/** The service on the booted instance, its creation primitive held at the gate. */
function racingServiceOn(
  handle: TestNextly,
  linkingPolicy: LinkingPolicyPort,
  gate: { enter: () => Promise<void> }
): IdentityService {
  const services = new ServiceContainer(handle.adapter);
  const real = services.users;
  const users: ExternalUserCreator = {
    createExternalUser: async input => {
      await gate.enter();
      return real.createExternalUser(input);
    },
  };
  return new IdentityService(handle.adapter, handle.getService("logger"), {
    linkingPolicy,
    roles: services.roles,
    users,
  });
}

/**
 * Resolves once another statement on this test's database waits for a lock,
 * or after `timeoutMs` when none does — the same probe the super-admin
 * grant suite uses, copied for the same purpose: to show the two writers of
 * a race genuinely met in the database rather than one after the other.
 * SQLite serializes write transactions on the one shared connection, so
 * there a writer queues rather than waits, and the probe is never asked.
 */
async function untilAnotherWaitsOnALock(
  handle: TestNextly,
  dialect: TestDialect,
  timeoutMs = 5000
): Promise<boolean> {
  if (dialect === "sqlite") {
    await new Promise(resolve => setTimeout(resolve, 100));
    return false;
  }
  const probe =
    dialect === "postgresql"
      ? `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`
      : `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST
         WHERE DB = DATABASE() AND ID <> CONNECTION_ID()
           AND COMMAND = 'Query' AND TIME >= 1`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await handle.adapter.executeQuery<{ n: number | string }>(
      probe
    );
    if (Number(rows[0]?.n ?? 0) > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

describe.each(getConfiguredTestDialects())(
  "the identity service (%s)",
  (dialect: TestDialect) => {
    it("resolves a planted linked identity to its user", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "owner",
        email: "owner@example.com",
        isActive: true,
      });
      await insertIdentity(handle, {
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "subject-one",
        userId: "owner",
        address: "owner@example.com",
      });

      const resolved = await serviceOn(handle).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff()
      );

      expect(resolved).toEqual({ userId: "owner" });
    });

    it("attaches the link's identity row, without matching addresses", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      // Active, so the session the link completes in still stands; the
      // account's address deliberately differs from the provider's.
      await handle.adapter.insert("users", {
        id: "linker",
        email: "linker@example.com",
        isActive: true,
      });
      const { request, sessionJti } = await signedInAs(handle, "linker");

      const attached = await serviceOn(handle).completeExplicitLink(
        pluginIdentityBinding(ACME),
        {
          identity: handOff({
            subject: "link-subject",
            address: "provider-asserted@example.com",
          }),
          context: { userId: "linker", sessionJti },
          completingRequest: request,
        }
      );

      // The row the link wrote, under the plugin's stamped key, holding the
      // provider's address rather than the account's.
      expect(attached.identity).toMatchObject({
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "link-subject",
        address: "provider-asserted@example.com",
        userId: "linker",
      });
      const rows = (await identityRows(handle)) as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        providerKey: "acme-auth:google",
        subject: "link-subject",
        userId: "linker",
        // The digest the link stamped the row's uniqueness by, derived from
        // exactly the facts it handed over.
        keyDigest: externalIdentityKeyDigest(
          "acme-auth:google",
          "https://accounts.google.com",
          "link-subject"
        ),
      });
    });

    it("resolves no identity for a case-variant of a stored subject", async () => {
      // The proof the digest exists for, against a real collation: MySQL's
      // default folds `User42` into `user42` in the text columns, so a
      // lookup over those would hand the variant an account the provider
      // never named it by. The digest compares bytewise everywhere.
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "owner",
        email: "owner@example.com",
        isActive: true,
      });
      await insertIdentity(handle, {
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "user42",
        userId: "owner",
      });

      const service = serviceOn(handle);
      expect(
        await service.resolveSignInIdentity(
          pluginIdentityBinding(ACME),
          handOff({ subject: "User42" })
        )
      ).toEqual({ userId: null });

      // The control: the subject exactly as stored still resolves.
      expect(
        await service.resolveSignInIdentity(
          pluginIdentityBinding(ACME),
          handOff({ subject: "user42" })
        )
      ).toEqual({ userId: "owner" });
    });

    it("answers a repeated link by the same user with the standing row", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "linker",
        email: "linker@example.com",
        isActive: true,
      });
      const { request, sessionJti } = await signedInAs(handle, "linker");

      const service = serviceOn(handle);
      const link = {
        identity: handOff({ subject: "link-subject" }),
        context: { userId: "linker" as const, sessionJti },
        completingRequest: request,
      };
      const first = await service.completeExplicitLink(
        pluginIdentityBinding(ACME),
        link
      );
      const again = await service.completeExplicitLink(
        pluginIdentityBinding(ACME),
        link
      );

      // The same row answered twice — its own id, not a fresh one — and the
      // table still holds exactly one row for the identity.
      expect(again).toEqual(first);
      const rows = (await identityRows(handle)) as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first.identity.id });
    });

    it("writes nothing when the hand-off refuses", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "owner",
        email: "owner@example.com",
        isActive: true,
      });
      await insertIdentity(handle, {
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "subject-one",
        userId: "owner",
      });
      const before = await identityRows(handle);
      expect(before).toHaveLength(1);

      const service = serviceOn(handle);
      const refusedPayloads = [
        handOff({ subject: "" }),
        handOff({ addressProved: "yes" as unknown as boolean }),
        handOff({
          passedAdmissionRestriction: undefined as unknown as boolean,
        }),
        handOff({ passedAdmissionRestriction: false }),
        handOff({
          passedAdmissionRestriction: "admitted" as unknown as boolean,
        }),
      ];
      for (const payload of refusedPayloads) {
        const error = await service
          .resolveSignInIdentity(pluginIdentityBinding(ACME), payload)
          .then(
            () => undefined,
            (err: unknown) => err
          );
        expect(error).toBeInstanceOf(NextlyError);
      }

      // The control: the same hand-off, well-formed, still resolves — the
      // refusals above were the payload's, not the table's or the
      // connection's.
      expect(
        await service.resolveSignInIdentity(
          pluginIdentityBinding(ACME),
          handOff()
        )
      ).toEqual({ userId: "owner" });
      expect(await identityRows(handle)).toHaveLength(1);
    });

    it("provisions a first sign-in: an active, verified, passwordless account with exactly the configured roles, the identity attached", async () => {
      const handle = await boot(dialect);
      // An account, so the install is not empty; a role the configuration names.
      await handle.adapter.insert("users", {
        id: "founder",
        email: "founder@example.com",
        isActive: true,
      });
      const editor = await seedRole(handle, "editor");

      const resolved = await serviceOn(
        handle,
        provisioningPolicy(["editor"])
      ).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "new-person" })
      );

      expect(resolved.userId).toBeTypeOf("string");
      // The account, exactly as the creation primitive shapes it.
      const users = (await handle.adapter.select("users")) as Array<
        Record<string, unknown>
      >;
      const provisioned = users.find(row => row.email === "person@example.com");
      expect(provisioned).toMatchObject({
        id: resolved.userId,
        isActive: true,
        passwordHash: null,
      });
      expect(provisioned?.emailVerified).not.toBeNull();
      // Exactly the configured roles, and no other.
      expect(
        await new ServiceContainer(handle.adapter).userRoles.listUserRoles(
          String(resolved.userId)
        )
      ).toEqual([editor]);
      // The identity attached to the account it made, under the stamped key,
      // stamped with the digest the next sign-in will look it up by.
      const rows = (await identityRows(handle)) as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        providerKey: "acme-auth:google",
        subject: "new-person",
        address: "person@example.com",
        userId: resolved.userId,
        // The digest the provisioning stamped the row's uniqueness by,
        // derived from exactly the facts it handed over — the same spelling
        // the link's row carries.
        keyDigest: externalIdentityKeyDigest(
          "acme-auth:google",
          "https://accounts.google.com",
          "new-person"
        ),
      });
    });

    it("refuses each provisioning refusal, writing nothing", async () => {
      const handle = await boot(dialect);
      await handle.adapter.insert("users", {
        id: "founder",
        email: "founder@example.com",
        isActive: true,
      });
      await seedRole(handle, "editor");
      // The real administrator role, so the configuration naming it is
      // refused by the creation, not by the slug mapping.
      const { id: superAdminId } = await new ServiceContainer(
        handle.adapter
      ).roles.ensureSuperAdminRole();
      expect(superAdminId).toBeTruthy();
      // An account holding the address the hand-off will carry.
      await handle.adapter.insert("users", {
        id: "holder",
        email: "person@example.com",
        isActive: true,
      });

      await refusedWritingNothing(
        handle,
        provisioningPolicy([]),
        handOff({ subject: "empty-roles" }),
        { code: "VALIDATION_ERROR", reason: "provisioning-roles-empty" }
      );
      await refusedWritingNothing(
        handle,
        provisioningPolicy(["editor", "ghost-role"]),
        handOff({ subject: "unknown-role" }),
        { code: "VALIDATION_ERROR", reason: "provisioning-role-unknown" }
      );
      // A case-variant of a role that exists names no role on any dialect:
      // the slugs are matched bytewise, not by MySQL's case-insensitive
      // collation alone.
      await refusedWritingNothing(
        handle,
        provisioningPolicy(["EDITOR"]),
        handOff({ subject: "case-variant-role" }),
        { code: "VALIDATION_ERROR", reason: "provisioning-role-unknown" }
      );
      await refusedWritingNothing(
        handle,
        provisioningPolicy(["super-admin"]),
        // A fresh address: this refusal must be the role's, not the held
        // address's — the duplicate check runs before the role checks.
        handOff({ subject: "escalate", address: "escalate@example.com" }),
        { code: "FORBIDDEN" }
      );
      await refusedWritingNothing(
        handle,
        provisioningPolicy(["editor"]),
        handOff({ subject: "taken-address" }),
        { code: "DUPLICATE" }
      );

      // The control: the same key, after every refusal, still provisions an
      // address nobody holds — the refusals refused the provisioning, not the
      // table or the connection.
      const resolved = await serviceOn(
        handle,
        provisioningPolicy(["editor"])
      ).resolveSignInIdentity(
        pluginIdentityBinding(ACME),
        handOff({ subject: "after-refusals", address: "fresh@example.com" })
      );
      const users = (await handle.adapter.select("users")) as Array<
        Record<string, unknown>
      >;
      expect(users.find(row => row.email === "fresh@example.com")?.id).toBe(
        resolved.userId
      );
    });

    it("refuses to provision on an install with no user, writing nothing", async () => {
      const handle = await boot(dialect);
      await seedRole(handle, "editor");

      await refusedWritingNothing(
        handle,
        provisioningPolicy(["editor"]),
        handOff({ subject: "first-ever" }),
        { code: "FORBIDDEN", reason: "external-user-on-empty-install" }
      );
    });

    it("lists and unlinks an account's identities, scoped to that account", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;
      const service = serviceOn(handle);

      await handle.adapter.insert("users", {
        id: "owner",
        email: "owner@example.com",
        isActive: true,
      });
      await handle.adapter.insert("users", {
        id: "other",
        email: "other@example.com",
        isActive: true,
      });
      await insertIdentity(handle, {
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "first-linked",
        userId: "owner",
        createdAt: new Date("2020-01-01T00:00:00Z"),
      });
      const removed = await insertIdentity(handle, {
        providerKey: "acme-auth:github",
        issuer: "",
        subject: "second-linked",
        userId: "owner",
        createdAt: new Date("2021-01-01T00:00:00Z"),
      });
      const theirs = await insertIdentity(handle, {
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "someone-elses",
        userId: "other",
        createdAt: new Date("2019-01-01T00:00:00Z"),
      });

      // The listing names the owner's two, in link order, and neither row
      // of the other account.
      const listed = await service.listExternalIdentities("owner");
      expect(listed.map(identity => identity.subject)).toEqual([
        "first-linked",
        "second-linked",
      ]);
      expect(listed[0]).toMatchObject({
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        userId: "owner",
      });
      expect(listed.map(identity => identity.createdAt.getTime())).toEqual([
        new Date("2020-01-01T00:00:00Z").getTime(),
        new Date("2021-01-01T00:00:00Z").getTime(),
      ]);

      // The unlink removes the named row alone, on the real table.
      await service.unlinkExternalIdentity("owner", removed);
      expect(
        (await service.listExternalIdentities("owner")).map(
          identity => identity.subject
        )
      ).toEqual(["first-linked"]);

      // A second unlink of the same identity: a clean not-found, writing
      // nothing.
      await expect(
        service.unlinkExternalIdentity("owner", removed)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      // An identity the other account holds is refused the same way, and
      // the other account keeps it.
      await expect(
        service.unlinkExternalIdentity("owner", theirs)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await service.listExternalIdentities("other")).toHaveLength(1);
    });

    it("refuses to unlink the last way in when the other identity's provider is disabled", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;
      // No password: the account signs in only through its identities.
      await handle.adapter.insert("users", {
        id: "owner",
        email: "owner@example.com",
        isActive: true,
      });
      await insertIdentity(handle, {
        providerKey: "acme-auth:github",
        issuer: "",
        subject: "at-a-disabled-provider",
        userId: "owner",
      });
      const target = await insertIdentity(handle, {
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "target",
        userId: "owner",
      });

      // The identity left behind is at a provider the policy no longer
      // enables, so it is no way in, and the unlink is refused.
      await expect(
        serviceOn(
          handle,
          enablingOnly("acme-auth:google")
        ).unlinkExternalIdentity("owner", target)
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await identityRows(handle)).toHaveLength(2);

      // The control: with the other provider enabled, the same unlink runs.
      await serviceOn(
        handle,
        enablingOnly("acme-auth:google", "acme-auth:github")
      ).unlinkExternalIdentity("owner", target);
      expect(await identityRows(handle)).toHaveLength(1);
    });

    it("unlinks an account's only identity when it has a password", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;
      await handle.adapter.insert("users", {
        id: "owner",
        email: "owner@example.com",
        isActive: true,
        // In the shape core's bcrypt writes: a password sign-in takes.
        passwordHash:
          "$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      const only = await insertIdentity(handle, {
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "only",
        userId: "owner",
      });

      await serviceOn(handle).unlinkExternalIdentity("owner", only);
      expect(await identityRows(handle)).toHaveLength(0);
    });

    it("two unlinks at once of a password-less account's two usable identities: exactly one succeeds", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;
      await handle.adapter.insert("users", {
        id: "racer",
        email: "racer@example.com",
        isActive: true,
      });
      const first = await insertIdentity(handle, {
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject: "race-one",
        userId: "racer",
      });
      const second = await insertIdentity(handle, {
        providerKey: "acme-auth:github",
        issuer: "",
        subject: "race-two",
        userId: "racer",
      });
      const services = new ServiceContainer(handle.adapter);
      const service = new IdentityService(
        gatedAtTheDelete(handle.adapter, startGate()),
        handle.getService("logger"),
        {
          linkingPolicy: EVERY_KEY_ENABLED,
          roles: services.roles,
          users: services.users,
        }
      );

      // Each alone is allowed (the other identity is a way in) but not
      // both: whichever goes second must read the first's removal.
      const results = await Promise.allSettled([
        service.unlinkExternalIdentity("racer", first),
        service.unlinkExternalIdentity("racer", second),
      ]);

      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      );
      expect(refused?.reason).toMatchObject({ code: "CONFLICT" });
      expect(await identityRows(handle)).toHaveLength(1);
    });

    it("two first sign-ins race for one issuerless identity: one identity, one account, the loser resolves to the winner's", async () => {
      const handle = await boot(dialect);
      await handle.adapter.insert("users", {
        id: "founder",
        email: "founder@example.com",
        isActive: true,
      });
      await seedRole(handle, "editor");
      const before = await provisioningFootprint(handle);

      const service = racingServiceOn(
        handle,
        provisioningPolicy(["editor"]),
        startSignInGate()
      );
      const binding = pluginIdentityBinding(ACME);
      // Issuerless — R-22's own case — and asserting different addresses, so
      // the race is decided by the identity's uniqueness and not the
      // address's: exactly the backstop the key digest's unique index exists
      // to be.
      const [one, two] = await Promise.all([
        service.resolveSignInIdentity(
          binding,
          handOff({
            issuer: undefined,
            subject: "raced",
            address: "racer-one@example.com",
          })
        ),
        service.resolveSignInIdentity(
          binding,
          handOff({
            issuer: undefined,
            subject: "raced",
            address: "racer-two@example.com",
          })
        ),
      ]);

      // The loser resolved to the winner's account; neither promise
      // rejected, so no constraint violation surfaced as a crash.
      expect(one.userId).toBeTypeOf("string");
      expect(two.userId).toBe(one.userId);
      // Exactly the rows one sign-in writes: one account more, one identity,
      // one role grant — the loser's account and grant rolled back with its
      // refused identity insert, leaving no account the identity will never
      // resolve to.
      const after = await provisioningFootprint(handle);
      expect(after.users).toBe(before.users + 1);
      expect(after.identities).toBe(before.identities + 1);
      expect(after.userRoles).toBe(before.userRoles + 1);
      const rows = (await identityRows(handle)) as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(before.identities + 1);
      expect(rows[0]).toMatchObject({
        providerKey: "acme-auth:google",
        issuer: "",
        subject: "raced",
        userId: one.userId,
      });
      expect(["racer-one@example.com", "racer-two@example.com"]).toContain(
        rows[0]?.address
      );
    });

    it("two first sign-ins racing under one address resolve to one account — the address's uniqueness refusing the second", async () => {
      const handle = await boot(dialect);
      await handle.adapter.insert("users", {
        id: "founder",
        email: "founder@example.com",
        isActive: true,
      });
      await seedRole(handle, "editor");
      const before = await provisioningFootprint(handle);

      const service = racingServiceOn(
        handle,
        provisioningPolicy(["editor"]),
        startSignInGate()
      );
      const binding = pluginIdentityBinding(ACME);
      // The same address from both hands: whichever backstop refuses the
      // loser — the creation's duplicate-address check, the users email
      // index inside the transaction, or the identity's own index — the
      // outcome is one account, and the loser resolves to it.
      const [one, two] = await Promise.all([
        service.resolveSignInIdentity(
          binding,
          handOff({
            issuer: undefined,
            subject: "one-mailbox",
            address: "one-mailbox@example.com",
          })
        ),
        service.resolveSignInIdentity(
          binding,
          handOff({
            issuer: undefined,
            subject: "one-mailbox",
            address: "one-mailbox@example.com",
          })
        ),
      ]);

      expect(one.userId).toBeTypeOf("string");
      expect(two.userId).toBe(one.userId);
      const after = await provisioningFootprint(handle);
      expect(after.users).toBe(before.users + 1);
      expect(after.identities).toBe(before.identities + 1);
      expect(after.userRoles).toBe(before.userRoles + 1);
    });

    // The held-attach race needs a second database connection to hold the
    // winner's row uncommitted while the sign-in runs, and SQLite runs
    // everything on the one shared connection: there the gate test above is
    // the dialect's own form of the race (writers queue behind the open
    // transaction rather than waiting on a lock).
    it.skipIf(dialect === "sqlite")(
      "a first sign-in whose identity loses to an attach still uncommitted resolves to the winner, its own account rolled back",
      async () => {
        const handle = await boot(dialect);
        await handle.adapter.insert("users", {
          id: "founder",
          email: "founder@example.com",
          isActive: true,
        });
        await seedRole(handle, "editor");
        // The winner's account, committed; only its identity row is held.
        await handle.adapter.insert("users", {
          id: "winner",
          email: "winner@example.com",
          isActive: true,
        });
        const before = await provisioningFootprint(handle);

        // The winner's attach, written and held UNCOMMITTED on a connection
        // of its own — exactly where a racing first sign-in stands between
        // its own identity insert and its commit. The sign-in under test
        // must BLOCK on the held row's uniqueness entry, which is the proof
        // its identity insert runs inside its own transaction; once the
        // hold commits, the whole sign-in creation refuses, rolls back, and
        // resolves to the winner.
        const { nextlyExternalIdentities } = getDialectTables();
        const db = handle.adapter.getDrizzle() as {
          transaction: (
            fn: (tx: {
              insert: (table: unknown) => {
                values: (v: unknown) => Promise<unknown>;
              };
            }) => Promise<void>
          ) => Promise<void>;
        };
        let release!: () => void;
        const released = new Promise<void>(resolve => (release = resolve));
        let held!: () => void;
        const isHeld = new Promise<void>(resolve => (held = resolve));
        const holding = db.transaction(async tx => {
          await tx.insert(nextlyExternalIdentities).values({
            id: randomUUID(),
            providerKey: "acme-auth:google",
            issuer: "",
            subject: "contested",
            // The same digest the sign-in below derives from the same
            // facts, so the two rows collide on the index that holds it.
            keyDigest: externalIdentityKeyDigest(
              "acme-auth:google",
              "",
              "contested"
            ),
            address: "winner@example.com",
            userId: "winner",
            createdAt: new Date(),
          });
          held();
          await released;
        });
        await isHeld;

        const signingIn = serviceOn(
          handle,
          provisioningPolicy(["editor"])
        ).resolveSignInIdentity(
          pluginIdentityBinding(ACME),
          handOff({
            issuer: undefined,
            subject: "contested",
            address: "fresh@example.com",
          })
        );
        const waited = await untilAnotherWaitsOnALock(handle, dialect);
        release();
        const resolved = await signingIn;
        await holding;

        // The two writers genuinely met: the sign-in's insert waited on the
        // held row's lock.
        expect(waited).toBe(true);
        // The loser resolved to the winner's account.
        expect(resolved.userId).toBe("winner");
        // And wrote nothing of its own: the fresh address has no account,
        // and the footprint grew by the winner's identity row alone.
        const after = await provisioningFootprint(handle);
        expect(after.users).toBe(before.users);
        expect(after.identities).toBe(before.identities + 1);
        expect(after.userRoles).toBe(before.userRoles);
        const users = (await handle.adapter.select("users")) as Array<
          Record<string, unknown>
        >;
        expect(users.find(row => row.email === "fresh@example.com")).toBe(
          undefined
        );
      }
    );
  }
);
