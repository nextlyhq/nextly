<!--
Deliberately has NO `paths` frontmatter. Claude Code loads a rule without that
field at launch, unconditionally; a rule WITH it — including `paths: ["**/*"]` —
is conditional and triggers when a matching file is read. The failure this rule
is about is a shell redirect, which reads nothing, so the conditional form is
absent at exactly the moment it applies. A path-scoped rule is also not
re-injected after /compact until it next matches, which the unconditional form
avoids.
-->

## A whole-file write is a delete plus a create

`cat > f`, `>` and a full-file editor write all replace the file. When the file
already existed, its previous contents are gone, and nothing in the command
distinguishes "there was nothing here" from "I removed everything that was".

The belief that a file is new is the whole risk. Nobody overwrites a file they
know exists; they overwrite one they are sure does not. So the precaution is not
"be careful with destructive commands" — it is to establish that the path is
absent, and to treat anything short of that as a refusal to write blind.

**A failed read is not an absent file, and this is where the precaution leaks.**
"I tried to read it and got nothing back" covers a path that does not exist AND
a path that exists but could not be read — too large, binary, wrong permissions,
a tool that declines it. Both produce the same silence, and only one of them
makes a redirect safe. So the condition to require is an explicit NOT FOUND;
every other read failure aborts, because a file the reader could not open is
still a file the shell will happily truncate.

**Better still, do not separate the check from the write.** A probe followed by
a redirect is two operations, and anything that creates the path in between —
generated output, a concurrent tool, another session — is truncated by a check
that passed a moment earlier. An exclusive create refuses at write time instead,
which is a boundary rather than a look:

```sh
set -o noclobber; printf '%s' "$content" > path    # ONE command, both parts
```

**The option and the redirect must run in the same shell**, which for an agent
means the same tool call. Each invocation starts a fresh shell with the option
back at its default, so setting it in one call and redirecting in the next
protects nothing — measured: separate invocations truncate the file, the
compound command above fails with `cannot overwrite existing file`. `>|` opts
out where overwriting is the intent.

Node's equivalent has no such scoping problem, because the flag is an argument
to the write itself: `writeFileSync(path, data, { flag: "wx" })` throws `EEXIST`
rather than truncating. Prefer it when the choice is available.

Use one of these when the intent is genuinely "create", and keep the NOT FOUND
probe for deciding whether that is the intent at all.

Under an editing tool that requires a prior read, use it; reaching for the shell
to write a file the tool would have made you read is how the requirement gets
bypassed, and it is the bypass rather than the command that does the damage.

**A symlink anywhere in the path defeats every check below.** A shell redirect
follows links and truncates the RESOLVED target; the named path is untouched, so
`git diff -- <path>` reports nothing and each tell and proof clears a write that
destroyed a different file. Any component can be the link, and testing the leaf
does not find it: with `linkdir -> real`, `test -L linkdir/file.txt` is FALSE
because the file itself is regular, while the write still lands in
`real/file.txt`.

**The exclusive create above already answers this, which is why no path
canonicalisation is prescribed here.** Measured: with `link.txt -> real.txt`
holding content, both `set -o noclobber` and Node's `wx` flag refuse the write
and leave `real.txt` untouched; with a DANGLING `link.txt -> ghost.txt`, both
refuse as well and no `ghost.txt` is created. The refusal follows the link
without needing to be told about it, which a resolver written here cannot claim
— a leaf that exists, a leaf that is a link, a leaf that is a dangling link and
a leaf that is absent are four behaviours, and a routine short by one hands back
the wrong path silently.

That conservatism has one cost worth stating: a deliberate write through a
dangling symlink is refused too, because the link entry exists. Take that with
`>|`, or by writing the target directly, having decided it.

Resolution still matters for DIAGNOSIS — after a write, the file that changed is
the resolved target rather than the path you named, so that is what the tells
and the proof must inspect. Determine it with the platform's own tooling
(`realpath`, `fs.realpathSync`, `lstat` for the link entry itself) at the moment
you need it, rather than from a recipe transcribed here.

`turbo.json` in `packages/ui` was replaced this way. It lost
`dependsOn: ["$TURBO_EXTENDS$", "build"]` on both `test` and `test:coverage`,
plus three call-site input trees, and the result parsed, ran, and passed
everything.

Once a file HAS been clobbered, the recovery procedure — naming the baseline
that holds the pre-write content, the three tells, and proving the restore —
is the `recovering-a-clobbered-file` skill.
