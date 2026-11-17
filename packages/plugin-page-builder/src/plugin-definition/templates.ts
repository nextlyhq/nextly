/**
 * Collection templates: the guard that gives each collection one template and
 * names the one holding its place, the cascade of an entry's own design, the
 * holds a template write and a collection's delete take on each other, and
 * the routes for the template actions, previews, routing, collection choices
 * and an entry's designs.
 */
import {
  NextlyError,
  readableTitleText,
  type PluginCollectionTransaction,
  type PluginRoute,
} from "@nextlyhq/plugin-sdk";

import { TEMPLATES_SLUG } from "../collections/templates";
import { conditionsPreviewEntryRoute } from "../conditions-preview-route";
import { titleFieldIn } from "../entries-route";
import {
  holdTemplateCollection,
  templateCollectionDelete,
} from "../templates/collection-delete";
import {
  designUnderWhere,
  registerEntryDesignCascade,
} from "../templates/entry-design-cascade";
import { judgeTemplateInTransaction } from "../templates/entry-design-write";
import { entryDesignsRoute } from "../templates/entry-designs-route";
import {
  templateActionsRoute,
  templateCollectionRetargetRoute,
  templateRoutingRoute,
} from "../templates/template-actions-route";
import { templateCollectionChoicesRoute } from "../templates/template-collection-choices-route";
import {
  addressHolderReader,
  registerTemplateGuard,
  templateHolderReader,
} from "../templates/template-guard";
import {
  templatePreviewEntriesRoute,
  templatePreviewEntryRoute,
} from "../templates/template-preview-route";
import { unlinkCopies } from "../templates/unlink-copies";

import type { InitContext } from "./install-context";
import type { Definition } from "./state";

/**
 * The templates guard and the hooks around it, once the plugin is installed;
 * answers the templates collection's resolved slug.
 */
export function installTemplates(ctx: InitContext, def: Definition): string {
  const { state, declaredPaths } = def;
  // One template per collection: the guard that sets each template's
  // place and names the template already holding it. RESOLVED slugs, for
  // the reason the Layout component guard takes them (`layouts.ts`).
  const templates = ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG;
  state.templateGuard = {
    templatesCollection: templates,
    ownCollections: () => new Set(Object.values(ctx.self.collections)),
    readCollection: async slug => {
      try {
        return (await ctx.services.collections.getCollection(
          slug,
          undefined as never
        )) as unknown as Record<string, unknown>;
      } catch (error) {
        if (NextlyError.isNotFound(error)) return null;
        throw error;
      }
    },
    holderOf: templateHolderReader(ctx.services.ownCollections, templates),
    holdEntry: (tx, collection, id) =>
      ctx.services.collections.holdEntryInTransaction(tx, collection, id),
    // Read as the system and in any state: whether the entry exists is
    // the question, and who may see it is the action's to ask.
    entryExists: async (collection, id) => {
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      const nextly = (await getCachedNextly()) as unknown as {
        findByID(args: Record<string, unknown>): Promise<unknown>;
      };
      try {
        const row = await nextly.findByID({
          collection,
          id,
          overrideAccess: true,
          status: "all",
          depth: 0,
          select: { id: true },
        });
        return typeof row === "object" && row !== null;
      } catch (error) {
        if (NextlyError.isNotFound(error)) return false;
        throw error;
      }
    },
    declaredAddresses: declaredPaths,
    addressHolderOf: addressHolderReader(
      ctx.services.ownCollections,
      templates
    ),
  };
  registerTemplateGuard(ctx, state.templateGuard);
  // An entry's own design is deleted with its entry, in the delete's
  // transaction, and a deleted template's copies lose their link to it.
  registerEntryDesignCascade(ctx.hooks, {
    templates,
    ownCollections: () => new Set(Object.values(ctx.self.collections)),
    // On the delete's own transaction, for update: the design is deleted
    // next, and no second pooled connection is taken while the delete
    // holds one.
    designUnder: async (tx, key) => {
      const found = await ctx.services.ownCollections.listEntriesInTransaction(
        tx,
        templates,
        {
          where: designUnderWhere(key),
          pagination: { limit: 1 },
          depth: 0,
        },
        { lock: "update" }
      );
      const id = (found.data[0] as { id?: unknown } | undefined)?.id;
      return typeof id === "string" || typeof id === "number"
        ? String(id)
        : null;
    },
    unlinkCopiesOf: (tx, id) =>
      unlinkCopies<PluginCollectionTransaction>(
        {
          listForUpdate: (transaction, options) =>
            ctx.services.ownCollections.listEntriesInTransaction(
              transaction,
              templates,
              options,
              { lock: "update" }
            ),
          list: (transaction, options) =>
            ctx.services.ownCollections.listEntriesInTransaction(
              transaction,
              templates,
              options
            ),
          update: (transaction, copy, data) =>
            ctx.services.collections.updateEntryInTransaction(
              transaction,
              templates,
              copy,
              data
            ),
        },
        tx,
        id
      ),
    deleteInTransaction: (tx, slug, id) =>
      ctx.services.collections.deleteEntryInTransaction(tx, slug, id),
  });
  // A template written while its collection is deleted holds the
  // collection in its own transaction, so the two take turns: see
  // `holdTemplateCollection`.
  ctx.hooks.onInTransaction(
    templates,
    holdTemplateCollection<PluginCollectionTransaction>(
      (transaction, collection) =>
        ctx.services.collections.holdCollectionInTransaction(
          transaction,
          collection
        )
    )
  );
  // After the collection is held: the row a template write commits is
  // judged again on its transaction, a new own design holds its entry,
  // and a write linking a row to the template it was copied from holds
  // that template, so one written while either is deleted is refused or
  // seen by the delete, whichever path wrote it: see `entry-design-write`.
  ctx.hooks.onInTransaction(
    templates,
    judgeTemplateInTransaction<PluginCollectionTransaction>(
      (transaction, collection, id) =>
        ctx.services.collections.holdEntryInTransaction(
          transaction,
          collection,
          id
        ),
      templates
    )
  );
  // A collection's template and its entries' own designs go with the
  // collection: listed in its delete dialog, and removed in the delete's
  // transaction, so none is left drawing a collection that is gone.
  ctx.hooks.onCollectionDelete(
    templateCollectionDelete<PluginCollectionTransaction>({
      own: () => new Set(Object.values(ctx.self.collections)),
      services: {
        listTemplates: options =>
          ctx.services.ownCollections.listEntries(templates, options),
        listTemplatesInTransaction: (transaction, options) =>
          ctx.services.ownCollections.listEntriesInTransaction(
            transaction,
            templates,
            options,
            { lock: "update" }
          ),
        deleteTemplateInTransaction: (transaction, id) =>
          ctx.services.collections.deleteEntryInTransaction(
            transaction,
            templates,
            id,
            {}
          ),
        // Named by the field the collection names its entries by, and
        // its value read as core reads a title, so the dialog shows the
        // names people recognise.
        entryTitles: async (collection, ids) => {
          const config = await ctx.services.collections
            .getCollection(collection, undefined as never)
            .catch(() => null);
          const field =
            (typeof config === "object" && config !== null
              ? titleFieldIn(config)?.name
              : undefined) ?? "title";
          const found = await ctx.services.collections.listEntries(
            collection,
            {
              where: { id: { in: [...ids] } },
              pagination: { limit: ids.length },
              select: { id: true, [field]: true },
              depth: 0,
            },
            { as: "system" }
          );
          const titles = new Map<string, string>();
          for (const entry of found.data as Record<string, unknown>[]) {
            const title = readableTitleText(entry[field]);
            // An id is a string or a number, keyed as its text.
            const id = entry.id;
            if (
              (typeof id === "string" || typeof id === "number") &&
              title !== undefined
            ) {
              titles.set(String(id), title);
            }
          }
          return titles;
        },
      },
    })
  );
  return templates;
}

/** The routes templates contribute, by name. */
export function routesForTemplates(def: Definition): {
  readonly templateActions: PluginRoute;
  readonly templatePreviewEntries: PluginRoute;
  readonly templatePreviewEntry: PluginRoute;
  readonly conditionsPreviewEntry: PluginRoute;
  readonly templateRouting: PluginRoute;
  readonly templateCollectionRetarget: PluginRoute;
  readonly templateCollectionChoices: PluginRoute;
  readonly entryDesigns: PluginRoute;
} {
  const { templateActions, requireTemplateGuard } = def;
  return {
    // Give a collection its template, publish or delete it, set its address,
    // and give an entry its own design or take it away, each with a dry run.
    templateActions: templateActionsRoute(templateActions),
    // A template's preview in the editor: the entries of its collection
    // the author may preview, and the one being previewed, read as the
    // author asking. Reads only: which entry is previewed is not stored.
    templatePreviewEntries: templatePreviewEntriesRoute({
      guard: requireTemplateGuard,
    }),
    templatePreviewEntry: templatePreviewEntryRoute({
      guard: requireTemplateGuard,
    }),
    // What a visitor reads of the page being edited, for applying its
    // visibility conditions: published values and public fields only,
    // for a page the caller may open in the editor.
    conditionsPreviewEntry: conditionsPreviewEntryRoute({
      guard: requireTemplateGuard,
    }),
    // Whether this caller may set or change a template address: what the
    // template form asks before it offers the address for editing. Not a
    // security boundary: the field's rules and the action decide.
    templateRouting: templateRoutingRoute(),
    // Whether a saved template may be pointed at another collection, by
    // the guard's own rule, for a caller who may change that template:
    // what the template form asks before it offers the change, since the
    // collection list leaves out what the author may not read.
    templateCollectionRetarget: templateCollectionRetargetRoute({
      guard: requireTemplateGuard,
    }),
    // The collections the template form offers: those the caller may
    // read that the guard lets a template draw, judged by the guard's
    // own rule, for a caller who may create or change templates.
    templateCollectionChoices: templateCollectionChoicesRoute({
      guard: requireTemplateGuard,
    }),
    // A collection's own designs, its template and its names, read as
    // the caller: what the admin's Design section, Design column and the
    // template's own designs list draw from.
    entryDesigns: entryDesignsRoute({ guard: requireTemplateGuard }),
  };
}
