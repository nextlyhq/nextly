/**
 * The collections and Singles the plugin contributes: the pages, the
 * composition stores, the usage indexes, the address claims, the retired ids,
 * the templates and the former backfill progress; and the Site Style, the
 * Page Builder settings and the site code Singles.
 */
import type { PluginContributions } from "@nextlyhq/plugin-sdk";

import { addressClaimsCollection } from "../collections/address-claims";
import { classUsageIndexCollection } from "../collections/class-usage-index";
import { componentRetiredCollection } from "../collections/component-retired-exposures";
import { componentUsageIndexCollection } from "../collections/component-usage-index";
import { componentsCollection } from "../collections/components";
import { layoutsCollection } from "../collections/layouts";
import { pagesCollection } from "../collections/pages";
import { patternsCollection } from "../collections/patterns";
import { templatesCollection } from "../collections/templates";
import { usageBackfillStateCollection } from "../collections/usage-backfill-state";
import { pageBuilderSettingsSingle } from "../default-layout/settings-single";
import { hostFetchPolicy } from "../host-policy";
import { layoutFenceFloor } from "../layout-removal/page-reference-guard";
import { siteCodeSingle } from "../site-code/storage";
import { siteStyleSingle } from "../site-style-storage";
import type { BreakpointRemovalParts } from "./breakpoints";
import { componentStoreOf, pagesOptions, storeIsOwn } from "./options";
import type { Definition } from "./state";

// The index is contributed unconditionally, alongside the pages it
// describes. Its table existing is what lets the maintenance path write
// to it without a first-run branch, exactly as the site style single is
// registered whether or not the host stated any defaults.
// The composition stores, contributed unconditionally beside the pages
// they serve. Each is a collection rather than a shape inside one,
// because a collection is what core seeds permissions for: the six
// actions on `patterns` are separate rows from the six on `components`,
// so "may create a pattern" and "may publish a component to every page
// that carries it" are already different grants on the day this ships.
// A single table discriminated by a column would leave both behind one
// permission and could not declare a slug unique per kind.
export function pluginCollections(
  def: Definition
): NonNullable<PluginContributions["collections"]> {
  const { opts, state, configStyle } = def;
  return [
    pagesCollection(
      pagesOptions(
        opts,
        configStyle,
        // Read per write through the holder `init` fills: the field is
        // declared before the plugin is installed.
        layoutFenceFloor(() => state.defaultLayoutSetup?.removals)
      )
    ),
    patternsCollection(),
    // The plugin's own collection is the store unless the host names one.
    componentsCollection({
      isStore: storeIsOwn(componentStoreOf(opts)),
    }),
    layoutsCollection(),
    classUsageIndexCollection(),
    componentUsageIndexCollection(),
    // Who holds each served address, so no two documents share one.
    addressClaimsCollection(),
    // Each component's retired field and slot ids, recorded when a
    // definition that drops one is published. Contributed unconditionally,
    // because every write to a page that places a component reads it.
    componentRetiredCollection(),
    // The designs a collection's entries are drawn with, one per
    // collection.
    templatesCollection(),
    // The backfill's former progress collection. Nothing reads or writes
    // it any more: progress lives in the plugin's own tables. Still
    // declared so an existing site keeps its table and registry row as
    // they are, rather than meeting a collection that disappeared.
    usageBackfillStateCollection(),
  ];
}

// The Site Style global: one versioned, access-controlled document the
// stored style tier lives in. Registered whether or not the host stated
// defaults, because the storage existing is what the style studios and
// the API write against.
// Given the SAME host list the published sheet, the canvas and the
// inspector are given, through the same derivation: a named class is
// emitted verbatim into every public page, so a `url()` stored here is a
// request every visitor makes. `hostFetchPolicy` is the one place that
// turns a pattern list into a predicate, so there is one answer to "may
// this be fetched" rather than one per surface. A host that configured
// no patterns gets today's behaviour: the engine treats an absent policy
// as unasked.
export function pluginSingles(
  def: Definition,
  removalService: BreakpointRemovalParts["removalService"]
): NonNullable<PluginContributions["singles"]> {
  const { opts, state, configStyle } = def;
  return [
    siteStyleSingle(
      {
        ...hostFetchPolicy(opts.remotePatterns),
        // The CONFIG tier this site states in code, so the write gate
        // judges what consumers actually compile. Without it a stored
        // class whose slug a config class already holds is accepted and
        // then dropped at render, and the node referencing it gets no
        // rule at all. The code tier, which always holds the core blocks'
        // looks.
        defaults: configStyle,
      },
      // A locked shared style may be stripped by an open removal, in the
      // settings write that stores its set: judged by every id it
      // removed, which the site still defines while that write is judged.
      () => removalService().openRemovalAsSaved(),
      // A write dropping a variable is judged by the remove route's check.
      () => state.variablesInUse
    ),
    // Where the site's default Layout is recorded. Contributed whether or
    // not any Layout exists yet, because the repair writes it on a site
    // that has none, and the make-default route writes it on every other.
    pageBuilderSettingsSingle(),
    // The code every published page carries, written only by the site
    // code route, which judges it first.
    siteCodeSingle(),
  ];
}
