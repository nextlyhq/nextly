# The SEO site

A small Nextly site with the SEO plugin, built with `next build` and served
with `next start` by `tests/production/seo-site.spec.ts`. It exists to prove,
on a real production build, what only a build and a first start can show:

| What it proves                                                                                         | Why it needs this site                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A sitemap made during `next build` lists the pages a route declares through `seoStaticParams`          | The plugin must be on while the site builds. The playground's production build runs with it off                                                                |
| A declared address whose page answers not found is left out of `/sitemap.xml` and `/llms.txt`          | The root files are rewritten to the plugin by `withNextly`, which the playground does not use, and the playground turns its sitemap off                        |
| robots.txt serves the site's own rules after the plugin's lines                                        | The playground ships its own `public/robots.txt`, which wins over the plugin's                                                                                 |
| An address no route matches is logged from Next.js's `global-not-found` page                           | The playground's catch-all route matches every address, so its `global-not-found` page could never be reached                                                  |
| A Gone address answers with the site's own page (`gonePage`), and with a plain page without one        | `gonePage` is a plugin option, read as the server starts: the spec starts this site twice from one build                                                       |
| Neither the build nor the first start logs a duplicate-row warning or a cache-expiry error             | The spec reads this site's own build log and first start's log. Parallel build workers record its code route, and the first start records its posts' addresses |
| The verification codes saved in the SEO settings are meta tags in the home page's head, and only there | Its home page and its other pages are built in code and answered by the plugin                                                                                 |

So it is not a candidate for folding into the playground: each row above is a
place the playground differs from a site the plugin is installed on, and
folding it in would test the playground's arrangement instead.

## What is in it

- `nextly.config.ts`: one collection, `posts`, at `/posts/{slug}`, and the SEO
  plugin. The posts have no page of their own: only their addresses matter,
  which the first start records.
- `app/`: the home page and `/about`, built in code; `/topics/[topic]`, whose
  pages come from `generateStaticParams` wrapped in `seoStaticParams`, the
  `empty` topic answering not found; `/gone`, the site's page for a Gone
  answer; `/pages-sitemap.xml`, a sitemap made once during the build from the
  plugin's `listedPages` service; `global-not-found.tsx`, logging as the
  plugin's guide shows; and Nextly's API handler.
- `proxy.ts`: the site's Proxy, where redirects and Gone answers are made.
- `scripts/setup.ts`: the account and the posts before the plugin is
  installed, then the SEO settings, all outside any request.

`site.ts` copies the fixture to `.run/` (ignored by git), readies its SQLite
database, installs its plugins, builds it and starts it; the spec removes the
copy when it is done. `SEO_SITE_KEEP_RUN=1` keeps it, with each step's log, to
look into a failure.
