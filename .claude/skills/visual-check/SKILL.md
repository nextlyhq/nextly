---
name: visual-check
description: Use when a change touches an admin screen, before its pull request is opened or updated - capturing the touched routes signed in, at 390, 1024 and 1440 px in light and dark from a production build, reading every capture, fixing what it shows, and publishing the captures as the pull request's "The look" section.
metadata:
  internal: true
---

# Checking how an admin change looks

Unit tests pass on a component that renders wrong, and the pull request is
read on a phone by someone who cannot run the branch. So before the pull
request of any change that touches an admin screen, capture the screens it
touches, read them, and put them in the pull request.

## The loop

1. Build the packages if their `dist` is missing or older than your change:
   `pnpm build`. The playground is built against them.
2. Capture the routes the change touches, and any screen sharing the
   component you changed:

   ```sh
   pnpm visual-check /admin/collections/posts /admin/collections/posts/create
   ```

   The first run builds the playground for production and serves it, seeded,
   on this checkout's own port (`E2E_PROD_PORT`), exactly as the production
   browser suite does, signs in as the seeded user, and stops the server when
   done. Every route is captured at 390, 1024 and 1440 px, light and dark, as
   `<route>-<width>-<scheme>.png` in `e2e/.playwright/visual-check/`. Add
   `--full` for whole pages rather than the first screen. It shares the
   production suite's database, build folder and port, so never run the two at
   once in one checkout.

3. Read what it prints. Each view is checked for sideways scroll, elements
   whose box ends past the right edge (by selector), and axe's serious and
   critical violations (by rule and selector). A route that answered 400 or
   more, or was sent to sign-in, is captured not at all. Any of these exits
   non-zero.
4. Open and read EVERY capture, not a sample: the checks above find only what
   can be measured. What to look for is below.
5. Fix, and capture again. A fix to the code needs a new build, so run without
   `--reuse`. To capture more routes, or a state you set up by hand, from the
   same build, add `--keep` to a run: it leaves its server running and prints
   the `kill` that stops it; later runs pass `--reuse` and build nothing. Stop
   it when you are done, and never `--reuse` a server built before your last
   change: it captures that older build.
6. Publish once it reads right:

   ```sh
   pnpm visual-check /admin/collections/posts --publish posts-list
   ```

   This pushes the captures, alone, to `pr-screenshots/posts-list`, a branch
   with no history in common with `main`, under your own git credentials, and
   prints the "The look" section, 390 px first. Paste it into the pull request
   body. A capture over 1 MB is refused by name; capture without `--full`, or a
   shorter page. Publishing again under the same topic, from the same branch,
   replaces the images the section links to. The branch records which branch
   published it, and a topic another branch published is refused, naming that
   branch: pick another topic.

7. Once the pull request is merged or closed, delete its captures:

   ```sh
   pnpm visual-check --unpublish posts-list
   ```

   Deleting them breaks the images in that pull request's body, which is why
   it waits until the pull request is done. A topic never published, or
   already deleted, deletes nothing and says so.

## What the reader checks that the tool cannot

- **Every state the change covers**, not only the seeded one: empty, loading,
  an error, long content (a long title, many rows, a long word that will not
  wrap), and the screen with its dialog, menu or sheet open. Capture each
  (seed or set up the state first) and say in the pull request which are shown.
- **Tokens in both schemes**: nothing that stays light in dark, or vanishes
  against its background in either; borders and focus rings visible; no
  colour that is not a `--nx-*` token.
- **Text at least 12 px**, and nothing clipped, overlapping or truncated
  without a way to read the whole of it.
- The page's one `<h1>` is visible, and nothing is drawn under a header or
  banner.
