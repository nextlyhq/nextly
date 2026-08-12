# Admin UI tweaks — tracker

One row per task or coherent group from the admin UI tweaks list. Claim a row
before starting, so parallel sessions in separate worktrees do not collide.

**Claiming:** put your branch name in Branch/PR and set Status to `in-progress`.
An empty Branch/PR with status `open` means nobody holds it.

| #   | Task                                                                                                                      | Status      | Branch/PR                                              | Key decisions                                                         | Findings                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A   | Table & list consistency: pagination gap, search field, filters, columns, sorting, headers, CTAs, skeletons, empty states | in-progress | #689 (shell + users, plugins) · #692 (roles, webhooks) | `ListShell` over migrating onto `DataTable`, which nothing renders    | Renderer is already shared (16 surfaces on `DataTableView`); the SHELL is duplicated. See below |
| B   | Tab styling — rounded bottom border reads as a seam                                                                       | open        | —                                                      | —                                                                     | —                                                                                               |
| C   | Official plugins should follow the design token system                                                                    | open        | —                                                      | —                                                                     | —                                                                                               |
| D   | Sidebar logo: boxed variant, light/dark aware                                                                             | open        | —                                                      | —                                                                     | —                                                                                               |
| E   | Dashboard shows a double right border on the primary sidebar                                                              | open        | —                                                      | —                                                                     | —                                                                                               |
| F   | Page Builder canvas full screen: hide inner and document sidebars                                                         | open        | —                                                      | —                                                                     | Check the page-builder task files for existing instructions first                               |
| G   | Multilingual UI/UX revamp                                                                                                 | open        | —                                                      | —                                                                     | Prototypes / visual companion before implementation                                             |
| H   | Content versioning UI/UX revamp                                                                                           | open        | —                                                      | —                                                                     | Prototypes first; full page or large modal preferred over the sheet                             |
| I   | Plugins nav does not navigate; plugin directory / browse page                                                             | open        | —                                                      | —                                                                     | —                                                                                               |
| J   | Plugin activate/deactivate lifecycle, with disclosure of what a plugin adds                                               | open        | —                                                      | —                                                                     | —                                                                                               |
| K   | Plugin detail page revamp                                                                                                 | open        | —                                                      | —                                                                     | —                                                                                               |
| L   | Plugin icons / logos                                                                                                      | open        | —                                                      | —                                                                     | —                                                                                               |
| M   | Plugins showing package names instead of titles; what `style-fixture` is                                                  | open        | —                                                      | —                                                                     | **Root cause already measured — see below**                                                     |
| N   | Create Form page UI                                                                                                       | open        | —                                                      | —                                                                     | —                                                                                               |
| O   | Forms and fields consistency with the shipped styling                                                                     | open        | —                                                      | —                                                                     | Overlaps R                                                                                      |
| P   | Locate the deferred "kit extraction" task                                                                                 | open        | —                                                      | —                                                                     | Candidate: three kit-component extractions deferred from F-14 (#210)                            |
| Q   | Move users management after system settings; review settings nav order                                                    | open        | —                                                      | —                                                                     | —                                                                                               |
| R   | Revamp create/edit forms: user, role, general settings, API key, webhook, image size, providers                           | open        | —                                                      | —                                                                     | Raises whether a centralised form system should exist                                           |
| S   | PR #659 review feedback — confirm what is already done                                                                    | mostly done | #674 (merged)                                          | —                                                                     | Worked over six rounds; re-verify the remainder against `main`                                  |
| T   | Theme lab removal, now that theme support is dropped                                                                      | open        | —                                                      | Recommend deleting the lab, keeping the `packages/ui` contrast guards | Nothing shipped imports `apps/playground/src/theme-lab`; 65 files, ~4.8k lines                  |

## Answers already established

No work is needed to rediscover these.

**A — there is no duplicated table renderer.** 16 surfaces already render through
`DataTableView`, and there is exactly one `Pagination` and one `SearchBar`. What
is duplicated is the SHELL each surface hand-rolls around them: the card, where
pagination sits, the toolbar, the skeleton and the empty state.

Two incompatible shells are in production:

- **A — pagination inside the bordered card**, view rendered with
  `bordered={false}`, so pagination's own `border-t` is the divider and the gap
  is 0. Four surfaces: entries, media, user fields, and the unused `DataTable`.
- **B — pagination as a sibling under `space-y-4`**, outside a fully bordered
  card. Twelve surfaces. Gives a 16px gap plus a detached bar carrying a
  `border-t` with no other sides.

`DataTable.tsx:263-265` already prescribes A in a comment and warns that
bordering them separately "would double the outline and open a gap between
them". Twelve surfaces do exactly that.

**A — the batteries-included `DataTable` is never rendered in the admin.** The
only occurrence is inside a doc comment. It owns data fetching through
`DataFetcher`, while every real page fetches its own data, which is the likely
reason nobody adopted it. The missing piece is therefore a PRESENTATIONAL shell,
not another batteries component.

**A — every layout-B page shifts on load.** All six skeletons render shell A
(footer inside the card), so the loading state shows an attached footer and the
loaded state jumps to a detached bar 16px lower.

**A — `SearchBar`'s `className` never reaches the input.** It lands on the
wrapper. Fourteen call sites pass border and background classes in three
spellings; all are inert. Only width utilities do anything.

**A — `px-2 py-4 p-4` on the skeleton footer** in six files. **`p-4` is the dead
one**, and this entry originally said the opposite, which is the reason it is
written out here rather than left as a one-line conclusion.

Which class wins is decided by EMISSION ORDER in the built stylesheet, not by
how specific the selector looks or by which is written last in the `className`.
All three have equal specificity, and Tailwind emits them in this order:

```
.p-4    65517
.px-2   66148
.py-4   67031
```

Both axis utilities come after the shorthand, so `p-4` sets nothing that
survives. Removing the axis pair does not tidy a redundancy — it widens the
footer from 8px to 16px horizontally.

The general form, worth more than this instance: **"one of these classes is
redundant" is a claim about the compiled artifact.** Read the built CSS before
acting on it; the source cannot tell you.

### A — migration progress

`ListShell` shipped in #689. Surfaces moved onto it:

| Surface         | PR   |
| --------------- | ---- |
| users, plugins  | #689 |
| roles, webhooks | #692 |

Remaining on layout B, in rough order of similarity to one already done:
deliveries, image sizes, email templates, email providers, collections,
singles, field groups, API keys.

The recipe is proven on three different shapes, so the rest are mechanical:

1. Root `<div className="space-y-4">` becomes `<ListShell toolbar={…} pagination={…}>`.
2. The table moves inside as the child, with `bordered={false}` added — the
   shell draws the border, and a bordered view inside a bordered shell is the
   doubling the shell exists to prevent.
3. Dialogs and overlays stay OUTSIDE the shell, so the component returns a
   fragment wrapping `<ListShell>` plus the dialogs.
4. `pagination` takes `undefined` rather than `false` when a list has nothing to
   paginate, so the prop type stays `ReactNode`.

Run `pnpm exec eslint --fix` on each file afterwards: adding the import trips
`import-x/order` against the adjacent type import every time.

Migrating a surface also removes its load-shift for free, because the skeletons
already render layout A.

**M — why the page builder shows as `@nextlyhq/plugin-page-builder`.**
`PluginDefinition` has no `displayName`. The human-readable label lives at
`admin.appearance.label`: optional, and nested under _appearance_. Only
`plugin-form-builder` sets it, so every other plugin falls back to its package
name. This blocks a plugin directory, and it becomes a breaking change to a
published surface once one ships.

**M — what `style-fixture` is.** A deliberate e2e fixture in
`apps/playground/src/plugins/`, indistinguishable from a shipped plugin in the
admin. Its "Plugin Styling Showcase" renders inside `/admin/collections/posts`
by design, through `posts.afterList`. Whether to hide it is a judgement call:
hiding test fixtures also hides genuine breakage.

## Conventions

- Base branch is `main`. This repo has no `dev`.
- One changeset per PR covering every package in the fixed group, generated in
  node from `.changeset/config.json`, never hand-typed. Playground-, test- and
  docs-only changes get none — confirm by checking whether `dist` changes rather
  than by assuming.
- Update the row in the same PR as the work, not afterwards.
