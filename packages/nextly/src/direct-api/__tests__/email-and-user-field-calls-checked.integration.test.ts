/**
 * The Direct API's email providers, email templates and user fields are
 * checked when the call asks to be.
 *
 * A Nextly instance with `overrideAccess: false` is judged as the REST route
 * for the same operation judges its caller: `read-`, `create-`, `update-` or
 * `delete-` on `email-providers` and `email-templates`, and on `settings` for
 * user fields. A test send and a template preview ask create; making a
 * provider the default, a template's ownership changes and reordering user
 * fields ask update. Each person below holds exactly one permission, so an
 * operation that asked the wrong one is told apart: its holder is let through,
 * and the holders of the other three on the same resource are refused.
 *
 * A refused call is refused before any work: it answers forbidden and writes
 * nothing. A call naming no user is refused as unauthenticated. A trusted
 * instance, the default, is unchanged.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { Nextly } from "../nextly";

import { account, role, seedPermissions } from "./checked-access-fixtures";

type Resource = "email-providers" | "email-templates" | "settings";
type Action = "read" | "create" | "update" | "delete";

const RESOURCES: readonly Resource[] = [
  "email-providers",
  "email-templates",
  "settings",
];
const ACTIONS: readonly Action[] = ["read", "create", "update", "delete"];

/** A person holding exactly `<action>-<resource>`, named by that slug. */
type Holder = `${Action}-${Resource}`;
type Person = Holder | "lacker";

/** What a call needs in hand: rows made by trusted code. */
interface Subjects {
  providerId: string;
  templateId: string;
  templateSlug: string;
  fieldId: string;
}

let made = 0;
/** A name no other call has used, marked with whether it may be written. */
const fresh = (mark: string) => `${mark}${++made}`;

/** A provider, a template and a user field made by trusted code. */
async function newProvider(trusted: Nextly): Promise<string> {
  const { item } = await trusted.emailProviders.create({
    data: {
      name: fresh("subject-provider-"),
      type: "log",
      fromEmail: "from@example.com",
      configuration: {},
    },
  });
  return item.id;
}
async function newTemplate(
  trusted: Nextly
): Promise<{ id: string; slug: string }> {
  const slug = fresh("subject-template-");
  const { item } = await trusted.emailTemplates.create({
    data: { name: slug, slug, subject: "Hello", htmlContent: "<p>Hello</p>" },
  });
  return { id: item.id, slug };
}
async function newField(trusted: Nextly): Promise<string> {
  const { item } = await trusted.userFields.create({
    data: { name: fresh("subjectField"), label: "Subject", type: "text" },
  });
  return item.id;
}

/** A version of a template, as an undo carries it. */
const VERSION = {
  subject: "Hello",
  htmlContent: "<p>Hello</p>",
  plainTextContent: null,
  preheader: null,
};

/**
 * Each call, the permission REST asks for it, and how it is made. `mark` is
 * the prefix for anything the call creates: `refused` when the caller is to be
 * refused, so a write that ran before its refusal is found afterwards.
 */
const CALLS: readonly {
  name: string;
  asks: Holder;
  call: (
    n: Nextly,
    s: Subjects,
    trusted: Nextly,
    mark: string
  ) => Promise<unknown>;
}[] = [
  {
    name: "emailProviders.find",
    asks: "read-email-providers",
    call: n => n.emailProviders.find(),
  },
  {
    name: "emailProviders.findByID",
    asks: "read-email-providers",
    call: (n, s) => n.emailProviders.findByID({ id: s.providerId }),
  },
  {
    name: "emailProviders.create",
    asks: "create-email-providers",
    call: (n, _s, _t, mark) =>
      n.emailProviders.create({
        data: {
          name: fresh(`${mark}-provider-`),
          type: "log",
          fromEmail: "from@example.com",
          configuration: {},
        },
      }),
  },
  {
    name: "emailProviders.update",
    asks: "update-email-providers",
    call: (n, s, _t, mark) =>
      n.emailProviders.update({
        id: s.providerId,
        data: { name: fresh(`${mark}-provider-`) },
      }),
  },
  {
    name: "emailProviders.delete",
    asks: "delete-email-providers",
    call: async (n, _s, trusted) =>
      n.emailProviders.delete({ id: await newProvider(trusted) }),
  },
  {
    name: "emailProviders.setDefault",
    asks: "update-email-providers",
    call: (n, s) => n.emailProviders.setDefault({ id: s.providerId }),
  },
  {
    name: "emailProviders.test",
    asks: "create-email-providers",
    call: (n, s) =>
      n.emailProviders.test({ id: s.providerId, to: "to@example.com" }),
  },
  {
    name: "emailTemplates.find",
    asks: "read-email-templates",
    call: n => n.emailTemplates.find(),
  },
  {
    name: "emailTemplates.findByID",
    asks: "read-email-templates",
    call: (n, s) => n.emailTemplates.findByID({ id: s.templateId }),
  },
  {
    name: "emailTemplates.findBySlug",
    asks: "read-email-templates",
    call: (n, s) => n.emailTemplates.findBySlug({ slug: s.templateSlug }),
  },
  {
    name: "emailTemplates.compare",
    asks: "read-email-templates",
    call: (n, s) => n.emailTemplates.compare({ id: s.templateId }),
  },
  {
    name: "emailTemplates.create",
    asks: "create-email-templates",
    call: (n, _s, _t, mark) => {
      const slug = fresh(`${mark}-template-`);
      return n.emailTemplates.create({
        data: { name: slug, slug, subject: "Hi", htmlContent: "<p>Hi</p>" },
      });
    },
  },
  {
    name: "emailTemplates.update",
    asks: "update-email-templates",
    call: (n, s, _t, mark) =>
      n.emailTemplates.update({
        id: s.templateId,
        data: { name: fresh(`${mark}-template-`) },
      }),
  },
  {
    name: "emailTemplates.delete",
    asks: "delete-email-templates",
    call: async (n, _s, trusted) =>
      n.emailTemplates.delete({ id: (await newTemplate(trusted)).id }),
  },
  {
    name: "emailTemplates.preview",
    asks: "create-email-templates",
    call: (n, s) => n.emailTemplates.preview({ id: s.templateId }),
  },
  {
    name: "emailTemplates.override",
    asks: "update-email-templates",
    call: (n, s) => n.emailTemplates.override({ id: s.templateId }),
  },
  {
    name: "emailTemplates.reset",
    asks: "update-email-templates",
    call: (n, s) => n.emailTemplates.reset({ id: s.templateId }),
  },
  {
    name: "emailTemplates.applyUpdate",
    asks: "update-email-templates",
    call: (n, s) =>
      n.emailTemplates.applyUpdate({
        id: s.templateId,
        choices: {},
        review: "no-review",
      }),
  },
  {
    name: "emailTemplates.undoUpdate",
    asks: "update-email-templates",
    call: (n, s) =>
      n.emailTemplates.undoUpdate({
        id: s.templateId,
        undo: {
          version: VERSION,
          base: VERSION,
          applied: "none",
          appliedBase: "none",
        },
      }),
  },
  {
    name: "userFields.find",
    asks: "read-settings",
    call: n => n.userFields.find(),
  },
  {
    name: "userFields.findByID",
    asks: "read-settings",
    call: (n, s) => n.userFields.findByID({ id: s.fieldId }),
  },
  {
    name: "userFields.create",
    asks: "create-settings",
    call: (n, _s, _t, mark) =>
      n.userFields.create({
        data: { name: fresh(`${mark}Field`), label: "Made", type: "text" },
      }),
  },
  {
    name: "userFields.update",
    asks: "update-settings",
    call: (n, s, _t, mark) =>
      n.userFields.update({
        id: s.fieldId,
        data: { label: fresh(`${mark}-label-`) },
      }),
  },
  {
    name: "userFields.delete",
    asks: "delete-settings",
    call: async (n, _s, trusted) =>
      n.userFields.delete({ id: await newField(trusted) }),
  },
  {
    name: "userFields.reorder",
    asks: "update-settings",
    call: (n, s) => n.userFields.reorder({ orderedIds: [s.fieldId] }),
  },
];

/** The codes of a refusal by the check, as against any later answer. */
const REFUSALS = ["FORBIDDEN", "AUTH_REQUIRED"];

/** The code a call failed with, or `undefined` when it succeeded. */
async function failureOf(
  pending: Promise<unknown>
): Promise<string | undefined> {
  try {
    await pending;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? "UNCODED";
  }
}

describe.each(getConfiguredTestDialects())(
  "the Direct API's email and user-field calls under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let subjects: Subjects;
    const ids = {} as Record<Person, string>;

    /** An instance that asks to be checked, as this person. */
    function checkedAs(person: Person): Nextly {
      return new Nextly({ overrideAccess: false, user: { id: ids[person] } });
    }

    beforeAll(async () => {
      t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      trusted = new Nextly();
      await seedPermissions(t);

      // The install's first account holds super-admin, which answers every
      // check; the people under test come after it.
      await account(t, "owner@example.com");
      const grants = {} as Record<Person, string[]>;
      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          grants[`${action}-${resource}`] = [`${action}-${resource}`];
        }
      }
      // A role, so a refusal is for want of the grant, not of any role.
      grants.lacker = ["read-api-keys"];
      for (const [person, slugs] of Object.entries(grants) as [
        Person,
        string[],
      ][]) {
        const roleId = await role(t, `${person}-role`, slugs);
        ids[person] = await account(t, `${person}@example.com`, [roleId]);
      }

      const template = await newTemplate(trusted);
      subjects = {
        providerId: await newProvider(trusted),
        templateId: template.id,
        templateSlug: template.slug,
        fieldId: await newField(trusted),
      };
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    for (const { name, asks, call } of CALLS) {
      const resource = RESOURCES.find(r => asks.endsWith(`-${r}`));
      // Everyone else on the same resource, and one on none of them.
      const refused: Person[] = [
        ...ACTIONS.map(a => `${a}-${resource}` as Holder).filter(
          h => h !== asks
        ),
        "lacker",
      ];

      describe(name, () => {
        it("is refused as unauthenticated to a call naming no user", async () => {
          await expect(
            call(
              new Nextly({ overrideAccess: false }),
              subjects,
              trusted,
              "refused"
            )
          ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
        });

        for (const person of refused) {
          it(`is refused to ${person}, who lacks what REST asks`, async () => {
            await expect(
              call(checkedAs(person), subjects, trusted, "refused")
            ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
          });
        }

        it(`goes past the check for ${asks}, who holds what REST asks`, async () => {
          // Past the check, a call answers whatever it deserves: a change of
          // ownership on a template no one owns is refused by the service,
          // never by the check.
          expect(REFUSALS).not.toContain(
            await failureOf(call(checkedAs(asks), subjects, trusted, "allowed"))
          );
        });

        it("is unchanged for trusted server code", async () => {
          expect(REFUSALS).not.toContain(
            await failureOf(call(trusted, subjects, trusted, "allowed"))
          );
        });
      });
    }

    it("reads for an allowed person what trusted code reads", async () => {
      // Each read ends as trusted code's does: the same rows, or the same
      // failure past the check (comparing a template no one owns is refused
      // by the service).
      const settle = (pending: Promise<unknown>) =>
        pending.then(
          value => ({ value }),
          (error: { code?: string }) => ({ failed: error.code })
        );
      const reads = CALLS.filter(c => c.asks.startsWith("read-"));
      let returned = 0;
      for (const { name, asks, call } of reads) {
        const checked = await settle(
          call(checkedAs(asks), subjects, trusted, "allowed")
        );
        const asTrusted = await settle(
          call(trusted, subjects, trusted, "allowed")
        );
        expect(checked, name).toEqual(asTrusted);
        if ("value" in asTrusted && asTrusted.value) returned++;
      }
      // The control: every read but the comparison returns rows, so what is
      // compared is data, not two failures.
      expect(returned).toBe(reads.length - 1);
    });

    it("wrote nothing for any refused call", async () => {
      // Every refused call above named what it would write `refused…`: a call
      // that wrote before its refusal left that name behind.
      const providers = await trusted.emailProviders.find();
      const templates = await trusted.emailTemplates.find();
      const fields = await trusted.userFields.find({ includeInactive: true });
      const names = [
        ...providers.items.map(p => p.name),
        ...templates.items.map(p => p.name),
        ...fields.items.flatMap(f => [f.name, f.label]),
      ];
      expect(names.filter(n => n.startsWith("refused"))).toEqual([]);
      // The control: an allowed call's write is found by the same lists.
      expect(names.some(n => n.startsWith("allowed"))).toBe(true);
    });
  }
);
