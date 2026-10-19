# Skills for building with Nextly

Agent skills that teach a coding agent (Claude Code, Codex, Cursor, GitHub
Copilot and others that read `SKILL.md`) how to set up and use Nextly in a
Next.js app.

| Skill                   | What it covers                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `nextly-install`        | adding Nextly to an existing Next.js app, the admin panel and the first admin account |
| `nextly-collections`    | defining collections in code, types, migrations, and reading content in pages         |
| `nextly-authentication` | the admin sign-in, roles, access rules, API keys and the signed-in user               |
| `nextly-deploy`         | production database, migrations on deploy, environment variables and media storage    |

## Install

From your project's root:

```bash
npx skills add nextlyhq/nextly
```

The command asks which skills to install and for which agents. `--list`
shows them without installing. `--skill '*' --agent claude-code codex cursor -y`
installs all four for the agents you name; `--all` installs them for every
agent the command supports, not only the ones in your project.

These are the skills for people building **with** Nextly. The skills for
working on Nextly itself live in `.agents/skills/`, are marked
`metadata.internal: true`, and are not offered by the command above;
`pnpm check:agent-contract` keeps it that way.

Each skill names the Nextly version it was checked against. When your
project runs a newer one (`npx nextly --version`), the documentation at
<https://nextlyhq.com/docs> wins where the two disagree.
