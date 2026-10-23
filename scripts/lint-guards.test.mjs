// The shapes each repository lint rule in lint/guards.mjs must tell apart,
// run through oxlint's own rule tester. Which files a rule applies to is the
// configuration's business, and lint-config.test.mjs holds that.
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import guards from "../lint/guards.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

// TypeScript source, as every file these rules run on is.
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

tester.run("no-bare-error", guards.rules["no-bare-error"], {
  valid: [
    // A coded error, and a subclass of one: what the rule asks for.
    "throw NextlyError.validation({ message: 'x' });",
    "throw new NextlyError({ code: 'X', publicMessage: 'x' });",
    "class GoneError extends NextlyError {} throw new GoneError();",
    // Built here and thrown elsewhere, or not thrown at all: constructing an
    // Error is legitimate, it normalises an unknown and feeds onError.
    "const e = new Error('x'); throw e;",
    "onError(new Error('x'));",
    // A member call that happens to be named Error is not the constructor.
    "throw errors.Error('x');",
  ],
  invalid: [
    { code: "throw new Error('x');", errors: 1 },
    { code: "throw Error('x');", errors: 1 },
    // Every built-in constructor, not only Error.
    ...[
      "TypeError",
      "RangeError",
      "SyntaxError",
      "EvalError",
      "ReferenceError",
      "URIError",
      "AggregateError",
    ].map(name => ({ code: `throw new ${name}('x');`, errors: 1 })),
  ],
});

tester.run("api-key-scope", guards.rules["api-key-scope"], {
  valid: [
    // An object that only names an actorType: the webhook outbox row and
    // its column definitions carry that field and are not scopes.
    'const w = { actorType: "apiKey" };',
    "const row = { actorType: envelope.actor.type, actorId: envelope.id };",
    // An activity-log row records what kind of caller wrote it and spreads
    // its optional columns. It is no kind of scope.
    'const rest = {}; const row = { actorType: "user" as string, userId: "u", ...rest };',
    // An access-control context, and a config overlay: permissions without
    // an actor are not a scope.
    "const ctx = { permissions: p, roles: r, operation: op, collection: c };",
    "const merged = { ...base, plugins: b.plugins, permissions: b.permissions };",
  ],
  invalid: [
    // The pair, which is what every instance looked like, in either order,
    // with something between, and in shorthand.
    { code: 'const s = { actorType: "apiKey", permissions: [] };', errors: 1 },
    { code: 'const s = { permissions: [], actorType: "apiKey" };', errors: 1 },
    {
      code: 'const s = { actorType: "apiKey", meta: { k: 1 }, permissions: p };',
      errors: 1,
    },
    { code: "const s = { actorType, permissions };", errors: 1 },
    // The second half hidden behind a spread, plain and `as const`.
    {
      code: 'const a = {}; const s = { actorType: "apiKey", ...a };',
      errors: 1,
    },
    {
      code: 'const a = {}; const s = { actorType: "apiKey" as const, ...a };',
      errors: 1,
    },
  ],
});

tester.run("no-keyboard-listener", guards.rules["no-keyboard-listener"], {
  valid: [
    // Other events, other targets, and a listener on an element.
    'document.addEventListener("click", onClick);',
    'element.addEventListener("keydown", onKey);',
    'window.addEventListener("resize", onResize);',
  ],
  invalid: [
    { code: 'document.addEventListener("keydown", onKey);', errors: 1 },
    { code: 'window.addEventListener("keyup", onKey);', errors: 1 },
    { code: 'document.addEventListener("keypress", onKey);', errors: 1 },
  ],
});

const MIGRATE_ONLY = {
  patterns: [
    {
      group: ["**/cli/commands/migrate", "**/cli/commands/migrate-*"],
      message: "no static migrate import",
    },
  ],
};

tester.run(
  "no-static-restricted-import",
  guards.rules["no-static-restricted-import"],
  {
    valid: [
      // The lazy load the boot path is allowed, and modules the patterns
      // do not name.
      {
        code: 'const m = await import("../cli/commands/migrate");',
        options: [MIGRATE_ONLY],
      },
      {
        code: 'import { x } from "../cli/commands/other";',
        options: [MIGRATE_ONLY],
      },
      // `migrate-*` matches within one segment only.
      {
        code: 'import { x } from "../cli/commands/migrate-x/deep";',
        options: [MIGRATE_ONLY],
      },
    ],
    invalid: [
      // Every static form, at any depth the `**/` prefix allows.
      {
        code: 'import { run } from "../cli/commands/migrate";',
        options: [MIGRATE_ONLY],
        errors: 1,
      },
      {
        code: 'import "../../src/cli/commands/migrate-down";',
        options: [MIGRATE_ONLY],
        errors: 1,
      },
      {
        code: 'export { run } from "../cli/commands/migrate";',
        options: [MIGRATE_ONLY],
        errors: 1,
      },
      {
        code: 'export * from "../cli/commands/migrate-status";',
        options: [MIGRATE_ONLY],
        errors: 1,
      },
    ],
  }
);

tester.run("no-legacy-lifecycle", guards.rules["no-legacy-lifecycle"], {
  valid: [
    // The lifecycles React kept, and the deliberate UNSAFE_ spelling.
    "class A extends React.Component { componentDidMount() {} componentDidUpdate() {} }",
    "class A extends Component { UNSAFE_componentWillMount() {} }",
    // A class that is not a React component may name its methods anything.
    "class Queue { componentWillMount() {} }",
    "class Queue extends Base { componentWillUpdate() {} }",
  ],
  invalid: [
    {
      code: "class A extends React.Component { componentWillMount() {} }",
      errors: 1,
    },
    {
      code: "class A extends PureComponent { componentWillReceiveProps() {} }",
      errors: 1,
    },
    {
      // A class field holding the method is the same lifecycle.
      code: "const A = class extends Component { componentWillUpdate = () => {}; };",
      errors: 1,
    },
  ],
});
