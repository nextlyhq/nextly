/**
 * The From field and a save agree on which addresses may use a variable.
 *
 * The field checks as the author types (`from-address.ts`); the save is
 * checked by the server's `checkTemplateEnvelope`, which refuses a variable in
 * the address with `VARIABLE_ADDRESS`. Each value below goes through both, so
 * a change to the server's mailbox rule fails here instead of the field
 * approving what a save refuses, or warning about what it accepts.
 *
 * The server module is loaded at run time, by a path the type checker doesn't
 * follow: its own imports use the server package's path aliases, which the
 * admin's compiler settings don't resolve, and the test only needs one
 * function from it.
 */
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { fromAddressProblem } from "../from-address";

const SERVER_ENVELOPE = fileURLToPath(
  new URL(
    "../../../../../../../nextly/src/domains/email/template-envelope.ts",
    import.meta.url
  )
);

type CheckEnvelope = (
  input: { fromOverride: string },
  rules: { carriesSecret: boolean }
) => unknown;

let checkTemplateEnvelope: CheckEnvelope;
beforeAll(async () => {
  const server = (await import(/* @vite-ignore */ SERVER_ENVELOPE)) as {
    checkTemplateEnvelope: CheckEnvelope;
  };
  checkTemplateEnvelope = server.checkTemplateEnvelope;
}, 60_000);

/** Whether a save of this From is refused for a variable in its address. */
function serverRefusesAddress(fromOverride: string): boolean {
  try {
    checkTemplateEnvelope({ fromOverride }, { carriesSecret: false });
    return false;
  } catch (error) {
    const data = (error as { publicData?: { errors?: { code: string }[] } })
      .publicData;
    if (!data?.errors) throw error;
    return data.errors.some(e => e.code === "VARIABLE_ADDRESS");
  }
}

const VALUES = [
  // A variable in the address, however it's written.
  "{{ sender }}",
  "Shop <{{ sender }}>",
  "{{ name }} <{{ sender }}>",
  "Shop <shop@{% if eu %}eu.{% endif %}example.com>",
  // No closing bracket: the whole value is the address.
  "Shop <shop@example.com> {{ name }}",
  // A variable in the name only.
  "{{ name }} <shop@example.com>",
  "{% if vip %}VIP {% endif %}Shop <shop@example.com>",
  // A quoted name may hold brackets; they aren't the address's.
  '"{{ name }} <team>" <shop@example.com>',
  '"Shop <x>" <{{ sender }}>',
  // The last `<` is inside quotes, so it isn't where the address starts.
  '<shop@example.com "{{ name }} <team">',
  // No variables at all.
  "shop@example.com",
  "Shop <shop@example.com>",
];

describe("the From field's address check", () => {
  it.each(VALUES)("matches a save for %s", value => {
    expect(fromAddressProblem(value) !== null).toBe(
      serverRefusesAddress(value)
    );
  });
});
