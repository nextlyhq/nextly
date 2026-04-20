## Summary

<!-- What does this PR do and why? Keep it short. -->

## Type of change

<!-- Check all that apply -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would change existing behavior)
- [ ] Documentation update
- [ ] Refactor / chore (no user-facing change)

## Related issues

<!-- e.g. Closes #123, Refs #456 -->

## Changeset

This repo uses [Changesets](https://github.com/changesets/changesets). If your PR changes any publishable package under `packages/*`, you **must** include a changeset:

```bash
pnpm changeset
```

Then commit the generated `.changeset/*.md` file.

- [ ] I added a changeset (or this PR only touches non-publishable code: docs, tests, internal tooling, `apps/*`)
- [ ] I selected the correct semver bump (patch / minor / major)

> The `changeset-check` CI job will fail if a publishable package is modified without a changeset.

## Test plan

<!-- How did you verify this works? Commands run, scenarios tested, screenshots, etc. -->

- [ ] `pnpm lint`
- [ ] `pnpm check-types`
- [ ] `pnpm build`
- [ ] Manually verified the change

## Checklist

- [ ] I read [CONTRIBUTING](../CONTRIBUTING.md) (if it exists)
- [ ] My commits follow the [Conventional Commits](https://www.conventionalcommits.org/) spec (enforced by commitlint)
- [ ] I targeted the `dev` branch (not `main`)
- [ ] I updated relevant documentation

## Screenshots / recordings

<!-- Optional. Drag images or videos here for UI changes. -->

## Notes for reviewers

<!-- Anything reviewers should pay extra attention to? Migration risks, perf concerns, etc. -->
