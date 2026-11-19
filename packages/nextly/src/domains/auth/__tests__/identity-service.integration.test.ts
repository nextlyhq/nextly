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
    requireEnabled(providerKey: string) {
      return {
        providerKey,
        trustedForImplicitLinking: false,
        provisioning: { mayProvision: true, roles },
      };
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

/** One identity row, written straight to the table as the fixture does. */
async function insertIdentity(
  handle: TestNextly,
  row: {
    providerKey: string;
    issuer: string;
    subject: string;
    userId: string;
    address?: string;
  }
): Promise<void> {
  await handle.adapter.insert("nextly_external_identities", {
    id: randomUUID(),
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
    createdAt: new Date("2020-01-01T00:00:00Z"),
  });
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
  }
);
