/**
 * The device memory's rules, each held where a plausible broken store would
 * pass a weaker check:
 *
 * - **An allowed list.** Every kind it does not name is refused, and nothing
 *   is written for it: the assertion reads the whole of storage, so a store
 *   that wrote the entry under another key fails too. A schema is kept only
 *   for a schema read's address, never an entry's under the same prefix.
 * - **Labels.** Each label changed alone discards what was kept, and a match
 *   keeps it; read once the server's answer gave the labels, so a store that
 *   compared only some of them keeps the entry for the one it skipped.
 * - **Forgetting the person.** Everything goes but the public branding, and
 *   only the admin's own keys are touched.
 * - **The off switch.** What was kept is removed and nothing more is written,
 *   of any kind.
 * - **A plugin's preference store.** The same rules reach a preference kept
 *   under a key of the plugin's own spelling: nothing is written while
 *   remembering is off (the choice holds for the page alone), it is forgotten
 *   with the person, and it can never reach the admin's own records.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyRememberingSwitch,
  buildLabel,
  confirmLabels,
  DEVICE_MEMORY_PREFIX,
  forgetPerson,
  hasSignedInHere,
  isRememberedSchemaPath,
  recallBranding,
  recallLayout,
  recallMenu,
  recallPreference,
  recallSchema,
  remember,
  rememberBranding,
  rememberLayout,
  rememberMenu,
  rememberPreference,
  rememberSchema,
  rememberSignedInHere,
  REMEMBERED_BRANDING_KEY,
  resetDeviceMemoryForTests,
  SIGNED_IN_HERE_KEY,
  type RememberedMenu,
  type ServerLabels,
} from "../device-memory";
import { devicePreferenceStore } from "../preference-store";

const LABELS: ServerLabels = {
  user: "user-1",
  schemaVersion: "7",
  permissionVersion: "perm-a",
};

const MENU: RememberedMenu = {
  rail: [
    { id: "dashboard", label: "Dashboard", href: "/admin" },
    { id: "content", label: "Content", href: "/admin/collections" },
  ],
  parts: { collections: true, singles: true },
  collections: [{ slug: "posts", label: "Posts", icon: "FileText" }],
  singles: [{ slug: "homepage", label: "Homepage" }],
};

const SCHEMA_PATH = "/collections/posts";
const SCHEMA_BODY = { name: "posts", fields: [{ name: "title" }] };

/** Every key the admin left in this browser's storage, both kinds. */
function storedKeys(): string[] {
  const keys: string[] = [];
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null) keys.push(key);
    }
  }
  return keys.sort();
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetDeviceMemoryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what the device memory keeps", () => {
  it("keeps the menu, a schema and the branding once the labels are known", () => {
    confirmLabels(LABELS);
    expect(rememberMenu(MENU)).toBe(true);
    expect(rememberSchema(SCHEMA_PATH, 'W/"tag"', SCHEMA_BODY)).toBe(true);
    expect(rememberBranding({ logoText: "Acme", logoUrl: "/logo.svg" })).toBe(
      true
    );

    expect(recallMenu()).toEqual(MENU);
    expect(recallSchema(SCHEMA_PATH)).toEqual({
      etag: 'W/"tag"',
      body: SCHEMA_BODY,
    });
    expect(recallBranding()).toEqual({
      logoText: "Acme",
      logoUrl: "/logo.svg",
    });
  });

  it.each([
    ["entry", { id: "1", title: "Hello" }],
    ["entries", [{ id: "1" }]],
    ["media", { id: "m1", url: "/a.png" }],
    ["user", { id: "u1", email: "a@b.c" }],
    ["form", { title: "Draft" }],
    ["form-values", { title: "Draft" }],
    ["session", { token: "secret" }],
    ["token", "secret"],
    ["permissions", ["read-posts"]],
    ["capabilities", { canViewMedia: true }],
    ["toString", {}],
  ])("refuses a %s and writes nothing", (kind, data) => {
    confirmLabels(LABELS);
    expect(remember(kind, "", data)).toBe(false);
    expect(remember(kind, "1", data)).toBe(false);
    expect(storedKeys()).toEqual([]);
  });

  it.each([
    "/collections/posts/entries",
    "/collections/posts/entries/1",
    "/collections/posts/1",
    "/collections",
    "/singles/homepage",
    "/media/m1",
    "/users/u1",
    "/me/permissions",
    "/collections/posts?depth=2",
  ])("keeps no schema for %s, which is not a schema read", path => {
    confirmLabels(LABELS);
    expect(isRememberedSchemaPath(path)).toBe(false);
    expect(rememberSchema(path, 'W/"tag"', { id: "1" })).toBe(false);
    expect(storedKeys()).toEqual([]);
  });

  it.each([
    "/collections/posts",
    "/collections/schema/posts",
    "/singles/homepage/schema",
    "/field-groups/seo",
  ])("keeps the schema read at %s", path => {
    expect(isRememberedSchemaPath(path)).toBe(true);
  });

  it("keeps only the menu's own fields, never anything carried beside them", () => {
    confirmLabels(LABELS);
    const carrying = {
      ...MENU,
      permissions: ["read-posts"],
      collections: [{ ...MENU.collections[0], fields: [{ name: "title" }] }],
    };
    expect(rememberMenu(carrying as RememberedMenu)).toBe(true);
    const stored = window.localStorage.getItem(`${DEVICE_MEMORY_PREFIX}menu`);
    expect(stored).not.toContain("read-posts");
    expect(stored).not.toContain("title");
  });

  it("keeps only the public branding's own keys", () => {
    rememberBranding({
      logoText: "Acme",
      plugins: [{ name: "secret-plugin" }],
      showBuilder: true,
    });
    expect(window.localStorage.getItem(REMEMBERED_BRANDING_KEY)).not.toContain(
      "secret-plugin"
    );
    expect(recallBranding()).toEqual({ logoText: "Acme" });
  });

  it("holds what it learns before the server answers until the answer labels it", () => {
    expect(rememberMenu(MENU)).toBe(true);
    expect(
      window.localStorage.getItem(`${DEVICE_MEMORY_PREFIX}menu`)
    ).toBeNull();

    confirmLabels(LABELS);
    const stored = JSON.parse(
      window.localStorage.getItem(`${DEVICE_MEMORY_PREFIX}menu`) ?? "null"
    ) as { labels: Record<string, string> };
    expect(stored.labels).toEqual({ build: buildLabel(), ...LABELS });
  });
});

describe("how the admin's parts were drawn", () => {
  it("keeps a whole number per part, beside every other part kept", () => {
    confirmLabels(LABELS);
    expect(rememberLayout("list-rows:posts", 10)).toBe(true);
    expect(rememberLayout("list-rows:users", 3)).toBe(true);

    expect(recallLayout("list-rows:posts")).toBe(10);
    expect(recallLayout("list-rows:users")).toBe(3);
    expect(recallLayout("list-rows:tags")).toBeUndefined();
    expect(storedKeys()).toEqual([`${DEVICE_MEMORY_PREFIX}layout`]);
  });

  it.each([
    ["a fraction", 2.5],
    ["a negative", -1],
    ["not a number", Number.NaN],
  ])("refuses %s, which is no size", (_case, size) => {
    confirmLabels(LABELS);
    expect(rememberLayout("list-rows:posts", size)).toBe(false);
    expect(recallLayout("list-rows:posts")).toBeUndefined();
  });

  it("refuses anything but numbers carried in the entry itself", () => {
    confirmLabels(LABELS);
    expect(remember("layout", "", { "list-rows:posts": "Hello" })).toBe(false);
    expect(remember("layout", "posts", { "list-rows:posts": 3 })).toBe(false);
    expect(storedKeys()).toEqual([]);
  });

  it("is forgotten with the person, and by the site's off switch", () => {
    confirmLabels(LABELS);
    rememberSignedInHere();
    rememberLayout("list-rows:posts", 10);
    forgetPerson();
    expect(recallLayout("list-rows:posts")).toBeUndefined();

    resetDeviceMemoryForTests();
    confirmLabels(LABELS);
    rememberLayout("list-rows:posts", 10);
    applyRememberingSwitch(false);
    expect(storedKeys()).toEqual([]);
    expect(rememberLayout("list-rows:posts", 10)).toBe(false);
  });

  it("is not read for another person", () => {
    confirmLabels(LABELS);
    rememberLayout("list-rows:posts", 10);
    resetDeviceMemoryForTests();
    confirmLabels({ ...LABELS, user: "user-2" });
    expect(recallLayout("list-rows:posts")).toBeUndefined();
  });

  it("outlives a change to the site's schema or to anyone's access, for the same person", () => {
    // A size says how a part was drawn, not what may be read: another
    // person's role or a new field elsewhere leaves it as true as it was.
    confirmLabels(LABELS);
    rememberLayout("card-height:p1:20", 361);
    resetDeviceMemoryForTests();
    confirmLabels({
      ...LABELS,
      schemaVersion: "8",
      permissionVersion: "perm-b",
    });
    expect(recallLayout("card-height:p1:20")).toBe(361);
  });
});

describe("the labels", () => {
  /** Keep the menu and a schema under LABELS, as a page that has closed. */
  function keepUnder(labels: ServerLabels): void {
    confirmLabels(labels);
    rememberMenu(MENU);
    rememberSchema(SCHEMA_PATH, 'W/"tag"', SCHEMA_BODY);
    resetDeviceMemoryForTests();
  }

  it("reads what was kept before the server answers, the build alone checked", () => {
    keepUnder(LABELS);
    expect(recallMenu()).toEqual(MENU);
  });

  it("keeps what was kept when the server's labels all match", () => {
    keepUnder(LABELS);
    confirmLabels(LABELS);
    expect(recallMenu()).toEqual(MENU);
    expect(recallSchema(SCHEMA_PATH)?.body).toEqual(SCHEMA_BODY);
  });

  it.each([
    ["user", { ...LABELS, user: "user-2" }],
    ["schema version", { ...LABELS, schemaVersion: "8" }],
    ["permission version", { ...LABELS, permissionVersion: "perm-b" }],
  ])("discards everything kept when the %s differs", (_label, now) => {
    keepUnder(LABELS);
    confirmLabels(now);
    expect(
      window.localStorage.getItem(`${DEVICE_MEMORY_PREFIX}menu`)
    ).toBeNull();
    expect(
      window.localStorage.getItem(
        `${DEVICE_MEMORY_PREFIX}schema:${SCHEMA_PATH}`
      )
    ).toBeNull();
    expect(recallMenu()).toBeUndefined();
    expect(recallSchema(SCHEMA_PATH)).toBeUndefined();
  });

  it("discards what another build kept, before the server answers", () => {
    keepUnder(LABELS);
    const key = `${DEVICE_MEMORY_PREFIX}menu`;
    const entry = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
      labels: { build: string };
    };
    entry.labels.build = `${buildLabel()}-other`;
    window.localStorage.setItem(key, JSON.stringify(entry));

    expect(recallMenu()).toBeUndefined();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("discards what another build kept of the branding", () => {
    rememberBranding({ logoText: "Acme" });
    const entry = JSON.parse(
      window.localStorage.getItem(REMEMBERED_BRANDING_KEY) ?? "null"
    ) as { labels: { build: string } };
    entry.labels.build = `${buildLabel()}-other`;
    window.localStorage.setItem(REMEMBERED_BRANDING_KEY, JSON.stringify(entry));
    expect(recallBranding()).toEqual({});
  });
});

describe("forgetting the person", () => {
  it("removes everything but the public branding, and only the admin's own keys", () => {
    confirmLabels(LABELS);
    rememberMenu(MENU);
    rememberSchema(SCHEMA_PATH, 'W/"tag"', SCHEMA_BODY);
    rememberBranding({ logoText: "Acme" });
    rememberSignedInHere();
    rememberPreference("nextly:panel-open:forms", "1");
    rememberPreference("nextly-column-visibility-posts", "{}");
    window.sessionStorage.setItem("nextly:recovery-not-now:posts/1", "x");
    window.localStorage.setItem("someone-else", "kept");

    expect(forgetPerson()).toBe(true);

    expect(storedKeys()).toEqual([REMEMBERED_BRANDING_KEY, "someone-else"]);
    expect(recallBranding()).toEqual({ logoText: "Acme" });
    expect(hasSignedInHere()).toBe(false);
  });

  it("writes nothing labelled for the forgotten person afterwards", () => {
    confirmLabels(LABELS);
    forgetPerson();
    expect(rememberMenu(MENU)).toBe(false);
    expect(storedKeys()).toEqual([]);
  });

  it("says there was no one to forget in a browser with no sign-in record", () => {
    expect(forgetPerson()).toBe(false);
  });

  it("says there was someone where this tab confirmed a session but kept no record", () => {
    // As a page learns it: the session confirmed, then the server's switch,
    // which removes the record and keeps nothing.
    rememberSignedInHere();
    applyRememberingSwitch(false);
    expect(hasSignedInHere()).toBe(false);
    expect(forgetPerson()).toBe(true);
    // Forgotten, there is no one left to forget.
    expect(forgetPerson()).toBe(false);
  });
});

describe("the off switch", () => {
  it("removes everything kept, the branding too, and writes nothing more", () => {
    confirmLabels(LABELS);
    rememberMenu(MENU);
    rememberBranding({ logoText: "Acme" });
    rememberSignedInHere();
    rememberPreference("nextly:panel-open:forms", "1");

    applyRememberingSwitch(false);
    expect(storedKeys()).toEqual([]);

    confirmLabels(LABELS);
    expect(rememberMenu(MENU)).toBe(false);
    expect(rememberSchema(SCHEMA_PATH, 'W/"tag"', SCHEMA_BODY)).toBe(false);
    expect(rememberBranding({ logoText: "Acme" })).toBe(false);
    rememberSignedInHere();
    expect(rememberPreference("nextly:panel-open:forms", "1")).toBe(false);
    expect(storedKeys()).toEqual([]);
    expect(recallPreference("nextly:panel-open:forms")).toBeNull();
  });

  it("keeps remembering when the switch is on", () => {
    applyRememberingSwitch(true);
    confirmLabels(LABELS);
    expect(rememberMenu(MENU)).toBe(true);
    expect(recallMenu()).toEqual(MENU);
  });
});

describe("a plugin's preference store", () => {
  /** A key of a plugin's own spelling, outside the admin's. */
  const KEY = "acme:recent";

  it("keeps a preference in this browser's storage while remembering", () => {
    const store = devicePreferenceStore(KEY);
    store.write("x");
    expect(store.read()).toBe("x");
    expect(window.localStorage.getItem(KEY)).toBe("x");
  });

  it("writes nothing while remembering is off, and holds the choice for the page", () => {
    applyRememberingSwitch(false);
    const store = devicePreferenceStore(KEY);
    store.write("x");
    expect(storedKeys()).toEqual([]);
    expect(store.read()).toBe("x");
  });

  it("is forgotten with the person, kept or held for the page", () => {
    devicePreferenceStore(KEY).write("x");
    applyRememberingSwitch(false);
    const held = devicePreferenceStore("acme:held");
    held.write("y");

    forgetPerson();
    expect(devicePreferenceStore(KEY).read()).toBeNull();
    expect(held.read()).toBeNull();
    expect(storedKeys()).toEqual([]);
  });

  it("is removed by the off switch", () => {
    devicePreferenceStore(KEY).write("x");
    applyRememberingSwitch(false);
    expect(storedKeys()).toEqual([]);
  });

  it("keeps a tab's preference in its session storage, and none while off", () => {
    const store = devicePreferenceStore(KEY, { lifetime: "tab" });
    store.write("x");
    expect(window.sessionStorage.getItem(KEY)).toBe("x");
    expect(window.localStorage.getItem(KEY)).toBeNull();

    applyRememberingSwitch(false);
    store.write("y");
    expect(storedKeys()).toEqual([]);
    expect(store.read()).toBe("y");
  });

  it("removes what it holds", () => {
    const store = devicePreferenceStore(KEY);
    store.write("x");
    store.remove();
    expect(store.read()).toBeNull();
    expect(storedKeys()).toEqual([]);
  });

  it("never reaches the admin's own records", () => {
    devicePreferenceStore(SIGNED_IN_HERE_KEY).write("1");
    devicePreferenceStore(REMEMBERED_BRANDING_KEY).write("{}");
    devicePreferenceStore(`${DEVICE_MEMORY_PREFIX}menu`).write("{}");
    expect(storedKeys()).toEqual([]);
    expect(hasSignedInHere()).toBe(false);
  });

  it("holds the choice for the page when storage refuses it, and never throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException(
        "The quota has been exceeded.",
        "QuotaExceededError"
      );
    });
    const store = devicePreferenceStore(KEY);
    expect(() => store.write("x")).not.toThrow();
    expect(store.read()).toBe("x");
  });
});

describe("keys under the nextly name, of any spelling", () => {
  it("are forgotten with the person though nothing on this page registered them", () => {
    window.localStorage.setItem("nextly.builder.shell:u1", "{}");
    window.localStorage.setItem("nextly.builder.checklist.dismissed:u1", "1");
    window.localStorage.setItem("someone-else", "kept");
    forgetPerson();
    expect(storedKeys()).toEqual(["someone-else"]);
  });
});

describe("storage that refuses", () => {
  it("never throws, and remembers nothing", () => {
    const refused = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refused);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refused);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(refused);
    vi.spyOn(Storage.prototype, "key").mockImplementation(refused);

    expect(() => confirmLabels(LABELS)).not.toThrow();
    expect(rememberMenu(MENU)).toBe(false);
    expect(recallMenu()).toBeUndefined();
    expect(() => forgetPerson()).not.toThrow();
    expect(() => applyRememberingSwitch(false)).not.toThrow();
  });
});
