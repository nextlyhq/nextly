export default {
  '*.{js,jsx,ts,tsx}': (files) => [
    `eslint --fix ${files.map((f) => JSON.stringify(f)).join(' ')}`,
    `prettier --write ${files.map((f) => JSON.stringify(f)).join(' ')}`,
  ],
  '*.{json,css,scss,md}': 'prettier --write',
  // A changeset is read by the release, and a malformed one — a frontmatter
  // that never closes, a package missing from the lockstep group — fails
  // `changeset version` for everybody once it is on main. The same checker
  // CI runs on a pull request's changesets runs here on the staged ones, so
  // the refusal reaches the author at commit time rather than after a merge
  // that happened while CI was still queued. Two such files landed on main
  // in one afternoon that way.
  '.changeset/*.md': (files) => [
    `node scripts/release/check-changesets.mjs ${files.map((f) => JSON.stringify(f)).join(' ')}`,
  ],
}
