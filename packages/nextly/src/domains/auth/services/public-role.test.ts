/**
 * The Public role is made once, on its own slug, by boot seeding. A role the
 * site makes on the slug while that runs, not built in, is moved off it
 * rather than taken for the Public role.
 */
import { describe, expect, it } from "vitest";

import type { Logger } from "../../../services/shared";

import { seedPublicRole } from "./public-role";

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

/** `nextly_meta` in memory. */
function memoryMeta() {
  const rows = new Map<string, string>();
  return {
    rows,
    async get<T>(key: string): Promise<T | null> {
      const raw = rows.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async set(key: string, value: unknown): Promise<void> {
      rows.set(key, JSON.stringify(value));
    },
    async insertIfAbsent(key: string, value: unknown): Promise<void> {
      if (!rows.has(key)) rows.set(key, JSON.stringify(value));
    },
    async compareAndSet(
      key: string,
      expected: unknown,
      next: unknown
    ): Promise<boolean> {
      if (rows.get(key) !== JSON.stringify(expected)) return false;
      rows.set(key, JSON.stringify(next));
      return true;
    },
  };
}

describe("seedPublicRole", () => {
  it("moves a role the site makes on the slug meanwhile, rather than taking it for Public", async () => {
    let onSlug: { id: string; builtIn: boolean } | null = null;
    let raced = false;
    const moved: string[] = [];
    const meta = memoryMeta();

    await seedPublicRole({
      publicSlugHolder: async () => onSlug,
      moveRoleOffPublicSlug: async (id: string) => {
        moved.push(id);
        if (onSlug?.id === id) onSlug = null;
        return "public-1";
      },
      ensurePublicRole: async () => {
        // Another instance makes a role of the site's own on the slug just
        // before the Public role is made, once.
        if (!raced) {
          raced = true;
          onSlug = { id: "racer", builtIn: false };
        }
        onSlug ??= { id: "public", builtIn: true };
      },
      meta,
      logger: quiet,
    });

    expect(moved).toEqual(["racer"]);
    expect(onSlug).toEqual({ id: "public", builtIn: true });
    expect(await meta.get("public-role-created")).toBe("created");
  });
});
