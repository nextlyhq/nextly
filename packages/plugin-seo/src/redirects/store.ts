/**
 * Saving and removing redirects, on a transaction the caller holds: a
 * person's add or edit, a file's import, and a page's own move all come
 * through here, so one set of rules decides every redirect.
 *
 * A redirect is stored to the end of its chain, so a visitor takes one hop,
 * and the redirects that pointed at its From address are pointed on to where
 * it now goes. Its From address is held in the address record by the
 * redirect itself, through `ctx.publicAddresses.move`, so an address a
 * published page holds is refused, and no page can later share it.
 *
 * @module redirects/store
 */
import { createHash } from "node:crypto";

import {
  NextlyError,
  languageAddressOf,
  type HeldAddress,
  type ParticipantTransaction,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { forgetNotFound } from "../not-found/log";

import { checkTarget, parseSource, storedTarget } from "./addresses";
import { followChain } from "./chains";
import { redirectsSlug } from "./collection";

type Transaction = ParticipantTransaction["transaction"];

/** Who added a redirect. */
export type RedirectOrigin = "automatic" | "person" | "import";

/** A redirect, read back. */
export interface StoredRedirect {
  id: string;
  locale: string;
  source: string;
  target: string;
  permanent: boolean;
  origin: RedirectOrigin;
  addedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** What a redirect is saved from. */
export interface RedirectInput {
  locale: string;
  source: string;
  target: string;
  /** Permanent unless a person chooses otherwise. */
  permanent?: boolean;
  origin: RedirectOrigin;
  addedBy?: string | null;
}

/** Why a redirect was not saved. */
export type RefusalReason = "invalid" | "duplicate" | "held" | "loop";

/** What saving a redirect did. */
export type RedirectOutcome =
  | {
      saved: StoredRedirect;
      /** Every address the To address passed on its way to where it ends. */
      chain: string[];
      /** How many other redirects now go straight to the same place. */
      repointed: number;
    }
  | { refused: string; reason: RefusalReason; existing?: string };

/** The stored key of an exact address in a language. */
export function redirectKey(locale: string, path: string): string {
  return createHash("sha256").update(`${locale}|${path}`, "utf8").digest("hex");
}

/** A timestamp column read back as ISO text. */
function isoOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

/** A stored redirect read back, every column checked rather than trusted. */
export function redirectOf(entry: unknown): StoredRedirect {
  const row = entry as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const origin = row.origin;
  return {
    id: String(row.id),
    locale: text(row.locale),
    source: text(row.source),
    target: text(row.target),
    // Stored as a boolean, or 0/1 where the dialect keeps one as a number.
    permanent: row.permanent !== false && row.permanent !== 0,
    origin:
      origin === "automatic" || origin === "import" ? origin : "person",
    addedBy: typeof row.addedBy === "string" ? row.addedBy : null,
    createdAt: isoOf(row.createdAt),
    updatedAt: isoOf(row.updatedAt),
  };
}

/** The key of a To address an exact redirect can be joined on, or null. */
function targetKeyOf(locale: string, target: string): string | null {
  return target.startsWith("/") && !target.includes("*")
    ? redirectKey(locale, target)
    : null;
}

/** Reading the redirects on a transaction. */
function reads(ctx: PluginContext, transaction: Transaction) {
  const slug = redirectsSlug(ctx);
  const own = ctx.services.ownCollections;

  async function where(
    filter: Record<string, unknown>,
    limit: number
  ): Promise<StoredRedirect[]> {
    const { data } = await own.listEntriesInTransaction(
      transaction,
      slug,
      { where: filter, pagination: { limit, page: 1 }, depth: 0 },
      { lock: "update" }
    );
    return (data as unknown[]).map(redirectOf);
  }

  return {
    slug,
    /** The redirect from `path` in `locale`, if there is one. */
    async from(locale: string, path: string) {
      const [found] = await where(
        { sourceKey: { equals: redirectKey(locale, path) } },
        1
      );
      return found;
    },
    /** A page of the redirects going to `path` in `locale`. */
    to(locale: string, path: string) {
      return where({ targetKey: { equals: redirectKey(locale, path) } }, 200);
    },
    async byId(id: string) {
      const [found] = await where({ id: { equals: id } }, 1);
      return found;
    },
  };
}

/** The address a From address is held at. */
function heldOf(
  locale: string,
  address: { path: string; range?: true }
): HeldAddress {
  return {
    locale,
    path: address.path,
    ...(address.range ? { range: true } : {}),
  };
}

/**
 * Save a redirect from `input.source` to `input.target`, new or, with
 * `editing`, in place of that redirect's To address and type. Answers what
 * was saved, or why it was refused; a refusal leaves nothing changed.
 */
export async function putRedirect(
  ctx: PluginContext,
  transaction: Transaction,
  input: RedirectInput,
  editing?: string
): Promise<RedirectOutcome> {
  const parsed = parseSource(input.source);
  if (!parsed.ok) return { refused: parsed.error, reason: "invalid" };
  const targetProblem = checkTarget(input.target, parsed.source);
  if (targetProblem !== null) {
    return { refused: targetProblem, reason: "invalid" };
  }
  const { locale } = input;
  const read = reads(ctx, transaction);
  const existing = await read.from(locale, parsed.source);
  if (existing !== undefined && existing.id !== editing) {
    return {
      refused: `${parsed.source} already has a redirect. Remove it first, or edit it in the list.`,
      reason: "duplicate",
      existing: existing.id,
    };
  }
  const editedRow = editing === undefined ? undefined : await read.byId(editing);
  if (editing !== undefined && editedRow === undefined) {
    throw NextlyError.notFound({ logContext: { reason: "redirect-gone", id: editing } });
  }

  const end = await followChain(
    parsed.source,
    storedTarget(input.target),
    async path => {
      const next = await read.from(locale, path);
      return next === undefined || next.id === editing ? null : next.target;
    }
  );
  if ("error" in end) return { refused: end.error, reason: "loop" };

  const fields = {
    target: end.final,
    targetKey: targetKeyOf(locale, end.final),
    permanent: input.permanent ?? true,
  };
  let saved: StoredRedirect;
  if (editedRow !== undefined) {
    saved = redirectOf(
      await ctx.services.collections.updateEntryInTransaction(
        transaction,
        read.slug,
        editedRow.id,
        { ...fields, _overwrite: true }
      )
    );
  } else {
    saved = redirectOf(
      await ctx.services.collections.createEntryInTransaction(
        transaction,
        read.slug,
        {
          ...fields,
          sourceKey: redirectKey(locale, parsed.source),
          source: parsed.source,
          locale,
          origin: input.origin,
          addedBy: input.addedBy ?? null,
        }
      )
    );
    const { refused } = await ctx.publicAddresses.move(
      [
        {
          holder: { collection: read.slug, id: saved.id, label: parsed.source },
          holds: [heldOf(locale, parsed.address)],
        },
      ],
      transaction
    );
    if (refused.length > 0) {
      await ctx.services.collections.deleteEntryInTransaction(
        transaction,
        read.slug,
        saved.id
      );
      return {
        refused: `${parsed.source} is the address of a published page, so it can't redirect. Give that page another address first.`,
        reason: "held",
      };
    }
  }

  // Every redirect that went to this From address now goes where it ends.
  let repointed = 0;
  if (!parsed.address.range) {
    // Each page read is pointed on before the next is read, so the first page
    // is read again until none is left; a chain never ends where it began,
    // so every update moves a redirect out of what is read.
    for (;;) {
      const page = (await read.to(locale, parsed.source)).filter(
        before => before.id !== saved.id
      );
      if (page.length === 0 || fields.targetKey === redirectKey(locale, parsed.source)) {
        break;
      }
      for (const before of page) {
        await ctx.services.collections.updateEntryInTransaction(
          transaction,
          read.slug,
          before.id,
          { target: end.final, targetKey: fields.targetKey, _overwrite: true }
        );
      }
      repointed += page.length;
    }
    // The address answers now, so it no longer belongs in the not-found log.
    const served = await languageAddressOf(parsed.source, locale);
    if (served.status === "resolved") {
      await forgetNotFound(ctx, transaction, served.path);
    }
  }
  return { saved, chain: end.path, repointed };
}

/** Remove a redirect, and let go of the address it held. */
export async function removeRedirect(
  ctx: PluginContext,
  transaction: Transaction,
  id: string
): Promise<StoredRedirect> {
  const read = reads(ctx, transaction);
  const found = await read.byId(id);
  if (found === undefined) {
    throw NextlyError.notFound({ logContext: { reason: "redirect-gone", id } });
  }
  await ctx.publicAddresses.move(
    [{ holder: { collection: read.slug, id }, holds: [] }],
    transaction
  );
  await ctx.services.collections.deleteEntryInTransaction(
    transaction,
    read.slug,
    id
  );
  return found;
}

/**
 * Remove the redirect holding a From address a published page now takes:
 * the page is meant to live there. Called by the address record inside the
 * page's save, which has already let the address go.
 */
export async function dropReplacedRedirect(
  ctx: PluginContext,
  transaction: Transaction,
  id: string
): Promise<void> {
  await ctx.services.collections.deleteEntryInTransaction(
    transaction,
    redirectsSlug(ctx),
    id
  );
}
