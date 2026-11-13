import { createRequire } from "node:module";

// Generated from the SDK's STABILITY.md and its TSDoc release tags by
// `scripts/sdk-stability.mjs`; a test fails while it is out of date.
const manifest = createRequire(import.meta.url)("../sdk-stability.json");

const STABILITY_URL = "https://nextlyhq.com/docs/plugins/stability";
const SDK = "@nextlyhq/plugin-sdk";

/** `definePlugin` members called with the plugin context as their first argument. */
const LIFECYCLE = new Set([
  "init",
  "onReady",
  "onInstall",
  "onUninstall",
  "destroy",
]);

const experimentalImports = new Map(
  Object.entries(manifest.imports).map(([source, names]) => [
    source,
    new Set(names),
  ])
);
const experimentalContext = new Set(manifest.context);

/** The name an import or export specifier refers to in the SDK. */
function specifierName(node) {
  return node.name ?? node.value;
}

/** A dotted member path's next property name, or null when it is computed. */
function propertyName(member) {
  if (member.computed) return null;
  return member.property.name ?? null;
}

/**
 * Flag a plugin's use of an `@experimental` surface of `@nextlyhq/plugin-sdk`.
 *
 * An experimental surface carries no compatibility guarantee: it may change or
 * be removed in any release, with no deprecation period. That is the right
 * trade for something new, and a plugin may well want it, but the author
 * should choose it knowingly rather than find out from an upgrade. So this
 * names each use where it is written, and links to the stability ledger.
 *
 * What counts as experimental is not decided here: it is the SDK's own record,
 * read at build time into `sdk-stability.json`. When a surface graduates, the
 * next release of this plugin stops flagging it, with nothing to edit.
 *
 * What it sees without type information:
 * - imports and re-exports from the SDK's entry points, named or through a
 *   namespace (`sdk.getCachedNextly`);
 * - with `context: true`, members of the plugin context reached from a
 *   `definePlugin` lifecycle's first parameter (`init(ctx) { ctx.db }`), or
 *   from anything annotated `PluginContext`, destructured ones included.
 *   A context passed on through other names is not followed, which is why this
 *   part is opt-in: it finds most uses, and says nothing about the rest.
 *
 * `allow` lists surfaces the author has adopted on purpose: an export name, or
 * a context path such as `db` or `services.ownCollections`.
 */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag use of an @experimental surface of @nextlyhq/plugin-sdk",
      url: STABILITY_URL,
    },
    schema: [
      {
        type: "object",
        properties: {
          context: { type: "boolean" },
          allow: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      experimentalImport:
        "`{{name}}` from `{{source}}` is experimental: it may change or be removed in any release, with no deprecation period. Pin your Nextly version, or see " +
        STABILITY_URL,
      experimentalContext:
        "`ctx.{{path}}` is experimental: it may change or be removed in any release, with no deprecation period. Pin your Nextly version, or see " +
        STABILITY_URL,
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allow = new Set(options.allow ?? []);
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    /** Local names bound to an SDK namespace import, with its specifier. */
    const namespaces = new Map();
    /** Local names bound to the SDK's `definePlugin` and `PluginContext`. */
    const definePluginNames = new Set();
    const contextTypeNames = new Set();

    function checkImported(node, name, source) {
      if (allow.has(name)) return;
      if (!experimentalImports.get(source)?.has(name)) return;
      context.report({
        node,
        messageId: "experimentalImport",
        data: { name, source },
      });
    }

    function reportContextPath(node, path) {
      if (allow.has(path) || !experimentalContext.has(path)) return false;
      context.report({
        node,
        messageId: "experimentalContext",
        data: { path },
      });
      return true;
    }

    /** Walk `ctx.a.b` outward from a reference, reporting the first experimental path. */
    function checkMemberChain(identifier) {
      let node = identifier;
      let path = "";
      while (
        node.parent?.type === "MemberExpression" &&
        node.parent.object === node
      ) {
        const name = propertyName(node.parent);
        if (!name) return;
        path = path ? `${path}.${name}` : name;
        if (reportContextPath(node.parent.property, path)) return;
        node = node.parent;
      }
    }

    /** Destructured context members: `init({ db, services: { jobs } })`. */
    function checkPattern(pattern, prefix) {
      for (const property of pattern.properties) {
        if (property.type !== "Property" || property.computed) continue;
        const name = property.key.name ?? property.key.value;
        const path = `${prefix}${name}`;
        if (reportContextPath(property.key, path)) continue;
        if (property.value.type === "ObjectPattern") {
          checkPattern(property.value, `${path}.`);
        }
      }
    }

    /**
     * Check every use of a binding that holds the plugin context. `declarer`
     * is the node that declares it (the function, or the variable
     * declarator), which is what the scope manager is asked about.
     */
    function checkContextBinding(node, declarer) {
      if (node.type === "ObjectPattern") return checkPattern(node, "");
      if (node.type === "AssignmentPattern") {
        return checkContextBinding(node.left, declarer);
      }
      if (node.type !== "Identifier") return;
      for (const variable of sourceCode.getDeclaredVariables(declarer)) {
        if (variable.name !== node.name) continue;
        for (const reference of variable.references) {
          checkMemberChain(reference.identifier);
        }
      }
    }

    function isContextAnnotation(annotation) {
      const type = annotation?.typeAnnotation;
      return (
        type?.type === "TSTypeReference" &&
        type.typeName.type === "Identifier" &&
        contextTypeNames.has(type.typeName.name)
      );
    }

    function isDefinePluginCall(node) {
      return (
        node?.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        definePluginNames.has(node.callee.name)
      );
    }

    /** The first parameter of a lifecycle in the object `definePlugin` is given. */
    function lifecycleContextParam(fn) {
      const property = fn.parent;
      if (property?.type !== "Property" || property.value !== fn) return null;
      const name = property.key.name ?? property.key.value;
      if (!LIFECYCLE.has(name)) return null;
      const object = property.parent;
      if (
        !isDefinePluginCall(object?.parent) ||
        object.parent.arguments[0] !== object
      ) {
        return null;
      }
      return fn.params[0] ?? null;
    }

    function checkFunction(fn) {
      if (!options.context) return;
      const lifecycleParam = lifecycleContextParam(fn);
      for (const param of fn.params) {
        const target = param.type === "AssignmentPattern" ? param.left : param;
        if (
          param === lifecycleParam ||
          isContextAnnotation(target.typeAnnotation)
        ) {
          checkContextBinding(param, fn);
        }
      }
    }

    function isSdkSource(source) {
      return source === SDK || source.startsWith(`${SDK}/`);
    }

    function recordBinding(specifier) {
      const imported = specifierName(specifier.imported);
      if (imported === "definePlugin")
        definePluginNames.add(specifier.local.name);
      if (imported === "PluginContext")
        contextTypeNames.add(specifier.local.name);
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (!isSdkSource(source)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            namespaces.set(specifier.local.name, source);
          } else if (specifier.type === "ImportSpecifier") {
            recordBinding(specifier);
            checkImported(specifier, specifierName(specifier.imported), source);
          }
        }
      },
      ExportNamedDeclaration(node) {
        const source = node.source?.value;
        if (!source || !isSdkSource(source)) return;
        for (const specifier of node.specifiers) {
          checkImported(specifier, specifierName(specifier.local), source);
        }
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier") return;
        const source = namespaces.get(node.object.name);
        const name = propertyName(node);
        if (source && name) checkImported(node.property, name, source);
      },
      "FunctionDeclaration, FunctionExpression, ArrowFunctionExpression":
        checkFunction,
      VariableDeclarator(node) {
        if (options.context && isContextAnnotation(node.id.typeAnnotation)) {
          checkContextBinding(node.id, node);
        }
      },
    };
  },
};
