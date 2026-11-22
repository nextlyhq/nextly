/**
 * What the blocks field refuses about a document AS A READER RECEIVES IT.
 *
 * The field's own rules judge the stored document. A document holding a
 * component placement is drawn as something else — the definition's tree in
 * the placement's place — and three rules are about that composed tree:
 *
 * - a component may not end up containing itself;
 * - every block of it must sit where it is allowed to, the definition's roots
 *   and the page content a placement fills it with included;
 * - and it may not be nested deeper than the limit, counted from the top of the
 *   document rather than from each definition's own top.
 *
 * And one is about the documents a component is composed INTO: saving a
 * component must not break a page, a Layout or another component that places
 * it.
 *
 * ## Why validation, and what it reads
 *
 * Validation is the one phase every write path runs — the editor, the API, a
 * batch, an import that skips hooks — so a rule judged here holds on all of
 * them. Core hands the validator the write's id and `readStored`, a read of
 * stored values of this field type on the write's own connection. So the
 * library judged is the one the write sees: inside a batch, the rows the batch
 * wrote before this one are in it; and no read hook or access rule hides a
 * component that still renders.
 *
 * The usage index is how a component's HOSTS are found, and it is a hint: it is
 * maintained after commit. A change that cannot make any host worse — the same
 * roots, no deeper, the same slots — needs no hosts at all, which is what lets
 * an ordinary edit to a component on a thousand pages save without reading
 * them. A change that could is judged inside every host the index lists, and
 * refused where one would break. A host it cannot judge — the index cannot
 * vouch for its whole population, a host cannot be read, there are more than
 * one save can judge — is REPORTED as unjudged rather than passed over in
 * silence, and does not refuse the save: refusing would leave a designer no
 * way at all to change a component the index cannot fully account for.
 *
 * ## Where each part lives
 *
 * - `blocks-composition-write.ts`: the two judgements a write runs, which
 *   compose the parts below.
 * - `blocks-composition-own-document.ts`: the written document's own
 *   composition.
 * - `blocks-composition-component-locks.ts`: a component's own save against
 *   the locks it holds.
 * - `blocks-composition-hosts.ts`: a component save judged inside every
 *   document that places it.
 * - `blocks-composition-footprint.ts`: whether a component change could make
 *   any host worse.
 * - `blocks-composition-faults.ts`: how faults are found, reported and
 *   compared.
 * - `blocks-composition-setup.ts`: what the judging needs to know, and the
 *   shapes it reports in.
 *
 * @module fields/blocks-composition
 */
export type {
  BindingsUnjudged,
  BrokenHosts,
  CompositionSetup,
  HostFinder,
  HostRef,
  LayersLockUnjudged,
  LockedExposures,
  PlacementUnjudged,
  SiteDefinitions,
  StillBrokenHosts,
  UnjudgedHosts,
  WrittenTo,
} from "./blocks-composition-setup";
export { documentOf } from "./blocks-composition-setup";
export {
  compositionGraphIssues,
  compositionIssues,
} from "./blocks-composition-write";
