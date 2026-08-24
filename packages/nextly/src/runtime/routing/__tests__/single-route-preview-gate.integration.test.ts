/**
 * The join between a preview token and a real Single route.
 *
 * The Single half of `content-route-preview-gate.integration.test.ts`, and it
 * exists for the same reason: every unit test in this area mocks the identity
 * away, so none of them can observe field rules actually running inside the
 * read. What that hid is the defect this file covers — a granted draft read is
 * TRUSTED so the working draft appears at all, and trust switched field-level
 * read rules off with it, so the document came back carrying every field
 * including any the person who shared the link cannot see.
 */
import { afterEach, describe, expect, it } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import {
  defineCollection,
  defineSingle,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { PREVIEW_SCOPE_COOKIE } from "../../preview/preview-route";
import { previewSingleDraftGate } from "../../preview/preview-single-draft-gate";
import { createSingleRoute } from "../single-route";

const SECRET = "single-route-preview-gate-secret-32chars!!";
const GENERATION = 1;
const PRIVILEGED_EMAIL = "privileged@example.com";
const PLAIN_EMAIL = "plain@example.com";

const settings = () =>
  defineSingle({
    slug: "site-settings",
    status: true,
    versions: { drafts: true },
    fields: [
      text({ name: "siteName" }),
      // A field ONE person can read. The link is supposed to show what its
      // SENDER can see, so the same draft has to come back differently
      // depending on who shared it.
      text({
        name: "apiToken",
        access: { read: ({ req }) => req.user?.email === PRIVILEGED_EMAIL },
      }),
    ],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * A real, ACTIVE user to mint links as.
 *
 * Not a placeholder id: the gate resolves the sharer's identity so the document
 * can be judged by their field rules, and an id that resolves to nobody fails
 * closed. A user created through this API is inactive until an invite is
 * accepted, and an inactive account cannot open a session — so a fixture that
 * left the default would test the refusal path while claiming to test a
 * preview.
 */
async function sharer(
  nextly: TestNextly["nextly"],
  email: string
): Promise<string> {
  const created = await nextly.users.create({
    email,
    password: "PreviewTest123!",
    data: { name: "Sharer", isActive: true },
  });
  return String(created.item.id);
}

function cookies(token?: string) {
  return () => ({
    get: (name: string) =>
      name === PREVIEW_SCOPE_COOKIE && token !== undefined
        ? { value: encodeURIComponent(token) }
        : undefined,
  });
}

function route(nextly: TestNextly["nextly"], token?: string) {
  return createSingleRoute({
    slug: "site-settings",
    nextly,
    render: (document: Record<string, unknown>) => document,
    draft: previewSingleDraftGate({
      secret: SECRET,
      generation: GENERATION,
      cookies: cookies(token),
    }),
  });
}

async function seed(nextly: TestNextly["nextly"]): Promise<void> {
  await nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme", apiToken: "secret-token" },
  });
}

describe("createSingleRoute driven by previewSingleDraftGate", () => {
  it("hides a field the sharer cannot read", async () => {
    current = await createTestNextly({ singles: [settings()] });
    await seed(current.nextly);
    const { token } = await signPreviewToken(
      { kind: "single", single: "site-settings" },
      SECRET,
      {
        generation: GENERATION,
        minter: await sharer(current.nextly, PLAIN_EMAIL),
      }
    );

    const page = (await route(current.nextly, token).SinglePage()) as Record<
      string,
      unknown
    >;

    expect(page.apiToken).toBeUndefined();
    // Field-scoped, not a blanked document: a redaction that stripped
    // everything would satisfy the line above while breaking every preview.
    expect(page.siteName).toBe("Acme");
  });

  // The positive control, and it is what separates "the rules ran and denied"
  // from "the rules ran as nobody and denied everything". Same document, same
  // route, same field — a different sender.
  it("shows that same field to a sharer who can read it", async () => {
    current = await createTestNextly({ singles: [settings()] });
    await seed(current.nextly);
    const { token } = await signPreviewToken(
      { kind: "single", single: "site-settings" },
      SECRET,
      {
        generation: GENERATION,
        minter: await sharer(current.nextly, PRIVILEGED_EMAIL),
      }
    );

    const page = (await route(current.nextly, token).SinglePage()) as Record<
      string,
      unknown
    >;

    expect(page.apiToken).toBe("secret-token");
  });
  // Relationship expansion has its own copy of the question, and the identity
  // has to survive every rebuild on the way — the builder, the Single's own
  // literal, and the conversion into the relationship service. A field dropped
  // at any of them is a VALID access context describing a different caller:
  // one whose related rows are judged by nobody. The rule below permits the
  // anonymous bearer and denies the sharer precisely so those two readings
  // cannot both pass.
  it("judges a populated relationship as the sharer too", async () => {
    const authors = defineCollection({
      slug: "authors",
      fields: [
        text({ name: "slug" }),
        text({
          name: "name",
          access: { read: ({ req }) => req.user === undefined },
        }),
      ],
    });
    const withOwner = defineSingle({
      slug: "site-settings",
      status: true,
      versions: { drafts: true },
      fields: [
        text({ name: "siteName" }),
        relationship({ name: "owner", relationTo: "authors" }),
      ],
    });
    current = await createTestNextly({
      singles: [withOwner],
      collections: [authors],
    });
    const author = await current.nextly.create({
      collection: "authors",
      data: { slug: "ada", name: "Ada" },
    });
    await current.nextly.updateSingle({
      slug: "site-settings",
      data: {
        siteName: "Acme",
        owner: String(author.item.id),
        status: "published",
      },
    });
    // A PENDING edit on top, so the working-draft overlay is what the preview
    // renders rather than the published row. The overlay expands its own
    // relationships through a different builder, so a fixture that never
    // produced one leaves that path unexercised.
    await current.nextly.updateSingle({
      slug: "site-settings",
      data: { siteName: "Acme (pending)" },
    });
    const { token } = await signPreviewToken(
      { kind: "single", single: "site-settings" },
      SECRET,
      {
        generation: GENERATION,
        minter: await sharer(current.nextly, PLAIN_EMAIL),
      }
    );

    const page = (await route(current.nextly, token).SinglePage()) as Record<
      string,
      unknown
    >;
    const owner = page.owner as Record<string, unknown> | undefined;

    // The RIGHT related row expanded — otherwise the assertion below is
    // satisfied by there being no related row at all, which is the absence that
    // reads as a pass.
    // The OVERLAY won, so what follows is about the draft's own expansion.
    expect(page.siteName).toBe("Acme (pending)");
    expect(owner?.id).toBe(String(author.item.id));
    // And it was judged as the SHARER, whom the rule denies, rather than as the
    // anonymous bearer, whom it permits.
    expect(owner?.name).toBeUndefined();
  });
});
