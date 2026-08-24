/**
 * The join between a preview token and an ORDINARY content route.
 *
 * Every other draft test in this directory hands the route a decision function
 * written by hand, which proves the route consults its `draft` hook and proves
 * nothing about the hook a real site would pass. `previewDraftGate` is what a
 * real site passes, and until it is exercised through a route the two can agree
 * in a doc comment and disagree in fact — the gate reading one cookie name, the
 * route comparing a different entry, a token shape neither validates.
 *
 * The route here is deliberately NOT a blocks page. The page-builder factory
 * inherits `draft` by extending this config, so it is covered transitively; a
 * site rendering its own content with `createContentRoute` is the case nothing
 * else reaches.
 */
import { afterEach, describe, expect, it } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { PREVIEW_SCOPE_COOKIE } from "../../preview/preview-route";
import { previewDraftGate } from "../../preview/preview-draft-gate";
import { createContentRoute } from "../content-route";
import type { ContentEntry } from "../resolve-content";

const SECRET = "content-route-preview-gate-secret-32chars!!";
const GENERATION = 1;
const PRIVILEGED_EMAIL = "privileged@example.com";
const PLAIN_EMAIL = "plain@example.com";
const HIDDEN_SLUG_EMAIL = "no-slug@example.com";

const pages = () =>
  defineCollection({
    slug: "pages",
    status: true,
    versions: { drafts: true },
    fields: [
      // The slug itself carries a read rule, because it is an ordinary field
      // and nothing stops one being declared on it. Once the preview is judged
      // by the sharer, a denied slug is REMOVED from the document — and the
      // route decides whether the entry answers this path by reading it.
      text({
        name: "slug",
        access: { read: ({ req }) => req.user?.email !== HIDDEN_SLUG_EMAIL },
      }),
      text({ name: "title" }),
      // A field ONE person can read. The preview link is supposed to show what
      // its SENDER can see, so the same draft has to come back differently
      // depending on who shared it — which is the property no unit test in this
      // area can reach, because they all mock the identity away.
      text({
        name: "secret",
        access: {
          read: ({ req }) => req.user?.email === PRIVILEGED_EMAIL,
        },
      }),
    ],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A cookie jar holding one preview token, or nothing at all. */
function cookies(token?: string) {
  return () => ({
    get: (name: string) =>
      name === PREVIEW_SCOPE_COOKIE && token !== undefined
        ? { value: encodeURIComponent(token) }
        : undefined,
  });
}

/**
 * A real user to mint links as.
 *
 * Not a made-up id: the gate now resolves the sharer's identity so the draft
 * can be judged by their field rules, and an id that resolves to nobody fails
 * CLOSED. A fixture that kept using a placeholder would refuse every link and
 * the refusal tests below would pass for the wrong reason.
 */
async function sharer(
  nextly: TestNextly["nextly"],
  email = PLAIN_EMAIL
): Promise<string> {
  const created = await nextly.users.create({
    email,
    password: "PreviewTest123!",
    // ACTIVE explicitly. A user created through this API is inactive until an
    // invite is accepted, and an inactive account cannot open a session — so a
    // link minted "as" one is correctly refused, and a fixture that left the
    // default would have tested the refusal path while claiming to test the
    // preview.
    data: { name: "Sharer", isActive: true },
  });
  return String(created.item.id);
}

function route(nextly: TestNextly["nextly"], token?: string) {
  return createContentRoute({
    collections: ["pages"],
    nextly,
    render: (entry: ContentEntry) => entry,
    draft: previewDraftGate({
      secret: SECRET,
      generation: GENERATION,
      cookies: cookies(token),
    }),
  });
}

/**
 * The route answered NOT FOUND, rather than merely throwing.
 *
 * `.rejects.toThrow()` cannot tell the intended 404 from any other failure on
 * the way — a query guard refusing the lookup, a fixture that never booted, a
 * misspelled collection. Every refusal in this file is a NEGATIVE assertion,
 * and a negative assertion satisfied by the wrong error reads as coverage while
 * seeing nothing.
 *
 * Measured rather than argued: this collection declares a read rule on its slug
 * field, and for a period every one of these cases passed because a filter
 * guard was rejecting the slug lookup outright — the enforced route answered no
 * page at all, and the assertions could not tell that from the entry being
 * correctly absent.
 *
 * Next signals the not-found boundary by throwing a string-tagged error rather
 * than a typed one, so the tag is what there is to match.
 */
async function expectNotFound(page: Promise<unknown>): Promise<void> {
  await expect(page).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
}

describe("createContentRoute driven by previewDraftGate", () => {
  it("serves a never-published entry to the visitor whose token names it", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const created = await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(created.item.id) },
      SECRET,
      { generation: GENERATION, minter: await sharer(current.nextly) }
    );

    const page = (await route(current.nextly, token).ContentPage({
      params: { slug: ["unreleased"] },
    })) as ContentEntry;

    expect(page.title).toBe("Unreleased");
  });

  // The control for the assertion above. Without it, a resolve that returned a
  // document for reasons unrelated to the token — a lifecycle default, a
  // collection that never enforced status — would read as the gate working.
  it("404s that same entry for a visitor carrying no token", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    await expectNotFound(
      route(current.nextly).ContentPage({ params: { slug: ["unreleased"] } })
    );
  });

  // One link is a key to ONE document. A token minted for entry A must not open
  // entry B, even though both are unpublished rows of the same collection that
  // the same gate would answer `true` for.
  it("refuses a different unpublished entry in the same collection", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const a = await current.nextly.create({
      collection: "pages",
      data: { slug: "entry-a", title: "A", status: "draft" },
    });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "entry-b", title: "B", status: "draft" },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(a.item.id) },
      SECRET,
      { generation: GENERATION, minter: await sharer(current.nextly) }
    );

    await expectNotFound(
      route(current.nextly, token).ContentPage({
        params: { slug: ["entry-b"] },
      })
    );
  });

  // The leak this whole change exists to close. A draft read is TRUSTED so the
  // working-draft overlay appears at all, and trust switched field-level read
  // rules off with it — so the link handed its recipient every field, including
  // ones its sender cannot see. That made sharing a link a way to read past
  // your own permissions by sending yourself one.
  //
  // Reachable only from here: every unit test in this area mocks the identity,
  // so none of them can observe the rules actually running inside the read.
  it("hides a field the sharer cannot read", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const sharer = await current.nextly.users.create({
      email: PLAIN_EMAIL,
      password: "PreviewTest123!",
      data: { name: "Plain", isActive: true },
    });
    const created = await current.nextly.create({
      collection: "pages",
      data: {
        slug: "unreleased",
        title: "Unreleased",
        secret: "salary-band-4",
        status: "draft",
      },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(created.item.id) },
      SECRET,
      { generation: GENERATION, minter: String(sharer.item.id) }
    );

    const page = (await route(current.nextly, token).ContentPage({
      params: { slug: ["unreleased"] },
    })) as ContentEntry;

    expect(page.secret).toBeUndefined();
    // Field-scoped, not a blanked document: a redaction that stripped
    // everything would satisfy the line above while breaking every preview.
    expect(page.title).toBe("Unreleased");
  });

  // The positive control for the case above, and it is what separates "the
  // rules ran and denied" from "the rules ran as nobody and denied everything".
  // Same draft, same route, same field — a different sender.
  it("shows that same field to a sharer who can read it", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const sharer = await current.nextly.users.create({
      email: PRIVILEGED_EMAIL,
      password: "PreviewTest123!",
      data: { name: "Privileged", isActive: true },
    });
    const created = await current.nextly.create({
      collection: "pages",
      data: {
        slug: "unreleased",
        title: "Unreleased",
        secret: "salary-band-4",
        status: "draft",
      },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(created.item.id) },
      SECRET,
      { generation: GENERATION, minter: String(sharer.item.id) }
    );

    const page = (await route(current.nextly, token).ContentPage({
      params: { slug: ["unreleased"] },
    })) as ContentEntry;

    expect(page.secret).toBe("salary-band-4");
  });

  // A token naming a user who no longer exists cannot be rendered as anybody,
  // and rendering it as nobody applies no field rules at all — which is the
  // leak. So it fails CLOSED, exactly as an expired link does.
  it("refuses the draft when the sharer's account is gone", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const created = await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(created.item.id) },
      SECRET,
      { generation: GENERATION, minter: "user-that-never-existed" }
    );

    await expectNotFound(
      route(current.nextly, token).ContentPage({
        params: { slug: ["unreleased"] },
      })
    );
  });
  // A path decided from a REDACTED value is decided from an absence. Once the
  // draft is judged by the sharer, a read rule on the slug field removes it
  // from the document — and comparing that missing value against the requested
  // path fails, so a perfectly valid link answers 404 or silently serves the
  // published row instead of the draft it was minted for.
  it("serves the draft to a sharer who cannot read the slug field", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const created = await current.nextly.create({
      collection: "pages",
      data: {
        slug: "unreleased",
        title: "Unreleased",
        secret: "salary-band-4",
        status: "draft",
      },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(created.item.id) },
      SECRET,
      {
        generation: GENERATION,
        minter: await sharer(current.nextly, HIDDEN_SLUG_EMAIL),
      }
    );

    const page = (await route(current.nextly, token).ContentPage({
      params: { slug: ["unreleased"] },
    })) as ContentEntry;

    // The draft, not the published fall-through — and the slug is still absent
    // from what renders, so the path was settled without handing it back.
    expect(page.title).toBe("Unreleased");
    expect(page.slug).toBeUndefined();
  });
  // The sharer is a REDACTION BASIS, never the requester — the token's own
  // documentation says so, and this is that limit made observable.
  //
  // A hook branching on `req.user` that saw the sharer would add an
  // editor-only value and hand it to whoever holds the link. Worse than a
  // denied field surviving: a value a hook invents need not correspond to any
  // declared field, so the access pass cannot take it back afterwards.
  it("does not let a hook see the sharer as the visitor", async () => {
    const hooked = () =>
      defineCollection({
        slug: "pages",
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "slug" }),
          text({
            name: "title",
            hooks: {
              // Reads the caller the way an ordinary hook would — `user` is
              // top-level on the field-hook context. On a preview the caller is
              // the anonymous bearer, whatever the FIELDS are judged as.
              afterRead: [
                ({ value, user }: { value: unknown; user?: unknown }) =>
                  user === undefined ? value : `${String(value)} [staff]`,
              ],
            },
          }),
        ],
      });
    current = await createTestNextly({ collections: [hooked()] });
    const created = await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(created.item.id) },
      SECRET,
      { generation: GENERATION, minter: await sharer(current.nextly) }
    );

    const page = (await route(current.nextly, token).ContentPage({
      params: { slug: ["unreleased"] },
    })) as ContentEntry;

    // The draft resolved — otherwise this asserts nothing about the hook.
    expect(page.slug).toBe("unreleased");
    // And the hook saw nobody, so it produced the anonymous value.
    expect(page.title).toBe("Unreleased");
  });
});
