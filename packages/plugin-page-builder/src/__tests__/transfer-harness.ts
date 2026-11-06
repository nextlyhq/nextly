/**
 * What the transfer suites share: a booted instance, people holding only what
 * they are granted, calls through Nextly's own request handler with a signed
 * session, and a source site holding one of everything an export carries.
 *
 * @module __tests__/transfer-harness
 */
import {
  COMPONENT_INSTANCE_TYPE,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import type { TestNextly } from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { expect } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { SITE_STYLE_SLUG } from "../site-style-storage";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

/** A 1×1 PNG, the image every source site shows. */
export const PNG: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

/** The permissions an author who may read everything a file carries holds. */
export const READS_EVERYTHING: readonly string[] = [
  "read-components",
  "read-patterns",
  "read-layouts",
  "read-site-style",
  "read-media",
];

let made = 0;

/** A name no other row in this run has. */
export function unique(stem: string): string {
  made += 1;
  return `${stem}-${String(Date.now())}-${String(made)}`;
}

/** A user, with no role yet. */
export async function person(t: TestNextly, name: string): Promise<string> {
  const created = await t.nextly.users.create({
    email: `${unique(name)}@example.com`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  return created.item.id;
}

/** Give `userId` a role holding exactly `slugs`. */
export async function grant(
  t: TestNextly,
  userId: string,
  slugs: readonly string[]
): Promise<void> {
  const permissions = await t.nextly.permissions.find({ limit: 500 });
  const ids = slugs.map(slug => {
    const found = permissions.items.find(item => item.slug === slug);
    if (found === undefined) throw new Error(`${slug} is not seeded`);
    return found.id;
  });
  const name = unique("role");
  const role = await t.nextly.roles.create({
    data: { name, slug: name, permissionIds: ids },
  });
  const assigned = await new ServiceContainer(
    t.adapter
  ).userRoles.assignRoleToUser(userId, role.item.id);
  expect(assigned.success).toBe(true);
}

/** A session cookie for `userId`. */
export async function sessionOf(
  t: TestNextly,
  userId: string
): Promise<string> {
  const user = await t.nextly.users.findByID({ id: userId });
  if (user === null) throw new Error(`no user ${userId}`);
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: user.email,
      name: user.name ?? "",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

/** A person holding exactly `slugs`, signed in. */
export async function holding(
  t: TestNextly,
  slugs: readonly string[]
): Promise<{ id: string; cookie: string }> {
  const id = await person(t, "author");
  await grant(t, id, slugs);
  return { id, cookie: await sessionOf(t, id) };
}

/** POST to one of the plugin's routes. */
export async function post(
  /** A session cookie, or an API key sent as a bearer token. */
  as: string | { readonly bearer: string },
  route: readonly string[],
  body: unknown = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  return call("POST", as, route, { body });
}

/**
 * Call a plugin's route through Nextly's own request handler: this plugin's
 * unless another is named, with a body for a POST.
 */
export async function call(
  method: "GET" | "POST",
  /** A session cookie, or an API key sent as a bearer token. */
  as: string | { readonly bearer: string },
  route: readonly string[],
  options: {
    readonly body?: unknown;
    readonly plugin?: string;
    readonly query?: string;
  } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const handlers = createDynamicHandlers();
  const plugin = options.plugin ?? PAGE_BUILDER_PLUGIN_NAME;
  const url = `${ORIGIN}/api/plugins/${plugin}/${route.join("/")}${options.query ?? ""}`;
  const auth: Record<string, string> =
    typeof as === "string"
      ? { cookie: `${as}; nextly_csrf=${CSRF}`, "x-csrf-token": CSRF }
      : { authorization: `Bearer ${as.bearer}` };
  const context = {
    params: Promise.resolve({
      params: ["plugins", ...plugin.split("/"), ...route],
    }),
  };
  const response =
    method === "GET"
      ? await handlers.GET(
          new Request(url, {
            method: "GET",
            headers: { ...auth, origin: ORIGIN },
          }),
          context
        )
      : await handlers.POST(
          new Request(url, {
            method: "POST",
            headers: {
              ...auth,
              origin: ORIGIN,
              "content-type": "application/json",
            },
            body: JSON.stringify(options.body ?? {}),
          }),
          context
        );
  const text = await response.text();
  return {
    status: response.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

/** Create a row as the system and answer its id. */
export async function created(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const row = await t.nextly.create({ collection, data, overrideAccess: true });
  return String(row.item.id);
}

/** What one source site holds, by id. */
export interface SourceSite {
  readonly mediaId: string;
  /** Placed by `outer`, showing the image, hidden on phones. */
  readonly inner: string;
  /** Wears the card style and places `inner`. */
  readonly outer: string;
  readonly pattern: string;
  readonly layout: string;
}

/** The breakpoints a source site defines; `wide` is used by nothing. */
export const SOURCE_BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 991 },
    { id: "phone", label: "Phone", maxWidth: 479 },
    { id: "wide", label: "Wide", maxWidth: 1400 },
  ],
  container: [],
};

/**
 * A source site: a shared style using a variable under a breakpoint, an edit
 * of the image's own look, an image,
 * two components (one placing the other), a pattern placing the outer one and
 * a Layout whose header is the outer one.
 */
export async function sourceSite(t: TestNextly): Promise<SourceSite> {
  await t.nextly.updateSingle({
    slug: SITE_STYLE_SLUG,
    data: {
      tokens: {
        tokens: [
          { name: "color.brand", kind: "color", values: { light: "#123456" } },
          { name: "color.unused", kind: "color", values: { light: "#654321" } },
        ],
      },
      classes: [
        {
          id: "c-card",
          slug: "card",
          orderIndex: 0,
          styles: { base: { tablet: { color: { $token: "color.brand" } } } },
        },
        { id: "c-unused", slug: "unused", orderIndex: 1, styles: {} },
        // The site's edit of the image's own look. It stays with this site:
        // an export never carries it, nor the variable only it uses.
        {
          id: "look:core/image:square",
          slug: "image-square",
          orderIndex: 2,
          blockType: "core/image",
          isDefault: true,
          styles: { base: { base: { color: { $token: "color.unused" } } } },
        },
      ],
      breakpoints: SOURCE_BREAKPOINTS,
    },
  });
  const media = await t.nextly.media.upload({
    file: {
      data: PNG,
      name: "dot.png",
      mimetype: "image/png",
      size: PNG.length,
    },
    altText: "A dot",
  });
  await t.nextly.media.update({ id: media.id, data: { caption: "One dot" } });
  const inner = await created(t, COMPONENTS_SLUG, {
    title: "Badge",
    slug: unique("badge"),
    status: "published",
    content: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "img",
          type: "core/image",
          version: 1,
          props: { mediaId: media.id, alt: "" },
          visibility: { devices: { phone: false } },
        },
      ],
      exposed: [
        {
          id: "photo",
          label: "Photo",
          nodeId: "img",
          propPath: "mediaId",
          type: "image",
        },
      ],
      variants: { "v-dark": { label: "Dark", overrides: { photo: media.id } } },
    },
  });
  const outer = await created(t, COMPONENTS_SLUG, {
    title: "Card",
    slug: unique("card"),
    status: "published",
    content: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "box",
          type: "core/heading",
          version: 1,
          props: { text: "Card", level: "h2" },
          classes: ["c-card"],
        },
        {
          id: "place",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: inner, variant: "v-dark" },
        },
      ],
    },
  });
  const pattern = await created(t, PATTERNS_SLUG, {
    title: "Hero",
    slug: unique("hero"),
    granularity: "section",
    status: "published",
    content: {
      formatVersion: 1,
      kind: "pattern",
      nodes: [
        {
          id: "hp",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: outer },
        },
      ],
    },
  });
  const layout = await created(t, LAYOUTS_SLUG, {
    title: "Marketing",
    slug: unique("marketing"),
    status: "published",
    areas: [{ area: "header", component: outer }],
  });
  return { mediaId: media.id, inner, outer, pattern, layout };
}
