/**
 * Where the problem list keeps what its checks found, so the list opens
 * without checking anything and serving a page never runs a check.
 *
 * One row per checked page in each language it is published in (`page`),
 * holding its own problems and the title
 * and description it was checked with, which the list compares across pages
 * when it opens; and one row for the whole site (`meta`): when it was last
 * checked in full, how many pages that read, and whether a change since can
 * have altered another page's result.
 *
 * @module problems/store
 */
import { createHash } from "node:crypto";

import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  checkbox,
  defineCollection,
  json,
  number,
  text,
  textarea,
  type CollectionConfig,
} from "nextly/config";

import { isRecord, textOf } from "../plain-values";

import type { Problem, ProblemSubject } from "./contract";

export const PROBLEMS_SLUG = "nx_seo_problems";

/** The collection the list's rows are kept in. */
export function problemsCollection(): CollectionConfig {
  return defineCollection({
    slug: PROBLEMS_SLUG,
    labels: { singular: "SEO check", plural: "SEO checks" },
    // Bookkeeping the plugin keeps, never authored.
    internal: true,
    fields: [
      // A hash of the page's type and id, or of the site's own row: the one
      // unique column, which keeps a page to one row however two checks of
      // it race.
      text({ name: "rowKey", label: "Row key", required: true, unique: true }),
      text({ name: "kind", label: "Kind", required: true, index: true }),
      text({
        name: "holderCollection",
        label: "Holder collection",
        index: true,
      }),
      // Indexed with the collection, since a page's every language is read
      // together.
      text({ name: "holderId", label: "Holder id", index: true }),
      text({ name: "locale", label: "Language" }),
      // Long text: a title or address of any length fits on every dialect.
      textarea({ name: "label", label: "Label" }),
      textarea({ name: "path", label: "Path" }),
      textarea({ name: "title", label: "Title" }),
      textarea({ name: "description", label: "Description" }),
      json({ name: "problems", label: "Problems" }),
      // ISO text, which orders and compares alike on every dialect.
      text({ name: "checkedAt", label: "Checked at" }),
      checkbox({ name: "outOfDate", label: "Out of date" }),
      number({ name: "pagesChecked", label: "Pages checked" }),
    ],
    access: {
      // Constants rather than bare `false`: access rules are validated as
      // callables. The plugin's own writes run as the system, which these do
      // not apply to; they close the wire API, since the rows name every
      // public page and what is wrong with it.
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    // Every write would otherwise reach a site's `entry.*` webhooks.
    webhooks: false,
    admin: {
      description:
        "What the SEO checks found on each page. Maintained automatically.",
    },
  });
}

/** The list's collection as this site has it, renamed or not. */
function problemsSlug(ctx: PluginContext): string {
  return ctx.self.collections[PROBLEMS_SLUG] ?? PROBLEMS_SLUG;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** The key of a page's row in one language. */
export const pageKey = (type: string, id: string, locale: string): string =>
  sha256(`page:${type}:${id}:${locale}`);

/** The key of the site's own row. */
const META_KEY = sha256("meta:site-check");

/** How many rows one read takes. */
const READ_PAGE = 100;

/** A page in one language, as its last check left it. */
export interface PageRow {
  subject: ProblemSubject & { type: string; id: string };
  /** The language this version of the page is in. */
  locale: string;
  title?: string;
  description?: string;
  problems: Problem[];
  checkedAt: string;
}

/** The site's own row: the last full check. */
export interface SiteCheck {
  checkedAt?: string;
  pagesChecked: number;
  outOfDate: boolean;
  /** What the full check found that belongs to no page, such as a redirect chain. */
  problems: Problem[];
}

/** The problems a row holds; none where what is stored is not a list. */
function problemsOf(value: unknown): Problem[] {
  const parsed: unknown =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return undefined;
          }
        })()
      : value;
  return Array.isArray(parsed)
    ? parsed.filter(
        (item): item is Problem =>
          isRecord(item) &&
          typeof item.kind === "string" &&
          isRecord(item.subject) &&
          isRecord(item.fix)
      )
    : [];
}

/** A stored page row, read back. */
function pageRowOf(row: Record<string, unknown>): PageRow | undefined {
  const type = textOf(row.holderCollection);
  const id = textOf(row.holderId);
  if (type === undefined || id === undefined) return undefined;
  const path = textOf(row.path);
  const title = textOf(row.title);
  const description = textOf(row.description);
  return {
    subject: {
      type,
      id,
      label: textOf(row.label) ?? id,
      ...(path === undefined ? {} : { detail: path }),
    },
    locale: textOf(row.locale) ?? "",
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    problems: problemsOf(row.problems),
    checkedAt: textOf(row.checkedAt) ?? "",
  };
}

/** The row stored under `key`, with its id. */
async function rowAt(
  ctx: PluginContext,
  key: string
): Promise<Record<string, unknown> | undefined> {
  const { data } = await ctx.services.ownCollections.listEntries(
    problemsSlug(ctx),
    {
      where: { rowKey: { equals: key } },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  const [row] = data as unknown[];
  return isRecord(row) ? row : undefined;
}

/**
 * Write `fields` to the row `key`, made where it is not there yet. A row
 * another check made a moment before is written over, rather than refused.
 */
async function writeRow(
  ctx: PluginContext,
  key: string,
  fields: Record<string, unknown>
): Promise<void> {
  const slug = problemsSlug(ctx);
  const existing = await rowAt(ctx, key);
  if (existing === undefined) {
    try {
      await ctx.services.collections.createEntry(slug, {
        rowKey: key,
        ...fields,
      });
      return;
    } catch (error) {
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
    }
  }
  const row = existing ?? (await rowAt(ctx, key));
  if (row === undefined) return;
  await ctx.services.collections.updateEntry(slug, String(row.id), {
    ...fields,
    _overwrite: true,
  });
}

/** Keep what one page's check found. */
export async function savePage(
  ctx: PluginContext,
  row: PageRow
): Promise<void> {
  const { subject } = row;
  await writeRow(ctx, pageKey(subject.type, subject.id, row.locale), {
    kind: "page",
    holderCollection: subject.type,
    holderId: subject.id,
    locale: row.locale,
    label: subject.label,
    path: subject.detail ?? null,
    title: row.title ?? null,
    description: row.description ?? null,
    problems: row.problems,
    checkedAt: row.checkedAt,
  });
}

/** Forget a page in one language: it is gone, or no longer public there. */
export async function removePage(
  ctx: PluginContext,
  row: Pick<PageRow, "subject" | "locale">
): Promise<void> {
  const found = await rowAt(
    ctx,
    pageKey(row.subject.type, row.subject.id, row.locale)
  );
  if (found === undefined) return;
  try {
    await ctx.services.collections.deleteEntry(
      problemsSlug(ctx),
      String(found.id)
    );
  } catch (error) {
    // Another check removed it first.
    if (!NextlyError.isCode(error, "NOT_FOUND")) throw error;
  }
}

/**
 * The rows of each of `ids`, pages of `type`, one for each language it was
 * checked in, read together in pages of {@link READ_PAGE}.
 */
export async function readVersionsOf(
  ctx: PluginContext,
  type: string,
  ids: readonly string[]
): Promise<Map<string, PageRow[]>> {
  const byId = new Map<string, PageRow[]>();
  if (ids.length === 0) return byId;
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      problemsSlug(ctx),
      {
        where: {
          and: [
            { kind: { equals: "page" } },
            { holderCollection: { equals: type } },
            { holderId: { in: [...ids] } },
          ],
        },
        sort: { field: "rowKey", direction: "asc" },
        pagination: { limit: READ_PAGE, page },
        depth: 0,
      }
    );
    const found = data as unknown[];
    for (const item of found) {
      const row = isRecord(item) ? pageRowOf(item) : undefined;
      if (row === undefined) continue;
      const rows = byId.get(row.subject.id) ?? [];
      rows.push(row);
      byId.set(row.subject.id, rows);
    }
    if (found.length < READ_PAGE) return byId;
  }
}

/** The rows of the page `id` of `type`, one for each language it was checked in. */
export async function readVersions(
  ctx: PluginContext,
  type: string,
  id: string
): Promise<PageRow[]> {
  return (await readVersionsOf(ctx, type, [id])).get(id) ?? [];
}

/** Every page row, in pages of {@link READ_PAGE}. */
export async function readPages(ctx: PluginContext): Promise<PageRow[]> {
  const rows: PageRow[] = [];
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      problemsSlug(ctx),
      {
        where: { kind: { equals: "page" } },
        pagination: { limit: READ_PAGE, page },
        sort: { field: "rowKey", direction: "asc" },
        depth: 0,
      }
    );
    const found = data as unknown[];
    for (const item of found) {
      const row = isRecord(item) ? pageRowOf(item) : undefined;
      if (row !== undefined) rows.push(row);
    }
    if (found.length < READ_PAGE) return rows;
  }
}

/** The site's own row; a site never checked in full has an empty one. */
export async function readSiteCheck(ctx: PluginContext): Promise<SiteCheck> {
  const row = await rowAt(ctx, META_KEY);
  const checkedAt = textOf(row?.checkedAt);
  return {
    ...(checkedAt === undefined ? {} : { checkedAt }),
    pagesChecked: typeof row?.pagesChecked === "number" ? row.pagesChecked : 0,
    outOfDate: row?.outOfDate === true,
    problems: problemsOf(row?.problems),
  };
}

/** Record a full check, which brings the list up to date. */
export async function saveSiteCheck(
  ctx: PluginContext,
  check: { checkedAt: string; pagesChecked: number; problems: Problem[] }
): Promise<void> {
  await writeRow(ctx, META_KEY, {
    kind: "meta",
    checkedAt: check.checkedAt,
    pagesChecked: check.pagesChecked,
    problems: check.problems,
    outOfDate: false,
  });
}

/**
 * Say the last full check may no longer hold: a change can have altered
 * another page's result. Nothing to say before the first full check.
 */
export async function markOutOfDate(ctx: PluginContext): Promise<void> {
  const row = await rowAt(ctx, META_KEY);
  if (row === undefined || row.outOfDate === true) return;
  await ctx.services.collections.updateEntry(
    problemsSlug(ctx),
    String(row.id),
    {
      outOfDate: true,
      _overwrite: true,
    }
  );
}
