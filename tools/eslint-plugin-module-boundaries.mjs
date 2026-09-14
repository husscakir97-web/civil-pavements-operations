// ESLint plugin enforcing CLAUDE.md §3 "A module may not import another
// module's code" and §10 "a lint rule failing the build on cross-module
// imports".
//
// Ownership and the grandfathered baseline both come from tools/module-map.mjs.

import {
  BASELINE,
  baselineKey,
  isAllowed,
  isEnforced,
  ownerOf,
  relativeToRoot,
  resolveSpecifier,
} from './module-map.mjs';

const noCrossModuleImport = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid a module from importing another module. Shared logic goes in the platform layer; cross-module behaviour goes through a seam (CLAUDE.md §3, §6).',
    },
    schema: [],
    messages: {
      crossModule:
        "'{{from}}' must not import '{{to}}' ({{specifier}}). A module may not import another module's code (CLAUDE.md §3). Move shared logic to the platform layer, or build this as a seam (CLAUDE.md §6).",
      platformToModule:
        "Platform must not import the '{{to}}' module ({{specifier}}). Platform is the foundation every module depends on; it cannot depend back (CLAUDE.md §4).",
      moduleToShell:
        "'{{from}}' must not import the app shell ({{specifier}}). The shell composes modules; modules must not reach back into it (CLAUDE.md §4).",
      unassignedSource:
        "'{{file}}' has no module assignment. Add it to FILE_OWNERS or PREFIX_OWNERS in tools/module-map.mjs so the boundary rule can be enforced (CLAUDE.md §3).",
      unassignedTarget:
        "Import '{{specifier}}' resolves to '{{target}}', which has no module assignment. Add it to tools/module-map.mjs (CLAUDE.md §3).",
    },
  },

  create(context) {
    const file = relativeToRoot(context.filename);
    if (!isEnforced(file)) return {};

    const from = ownerOf(file);
    if (!from) {
      return {
        Program(node) {
          context.report({ node, messageId: 'unassignedSource', data: { file } });
        },
      };
    }

    const check = (node, specifier) => {
      if (typeof specifier !== 'string') return;
      const target = resolveSpecifier(file, specifier);
      if (!target) return; // bare package, node: builtin, cloudflare:workers

      const to = ownerOf(target);
      if (!to) {
        context.report({ node, messageId: 'unassignedTarget', data: { specifier, target } });
        return;
      }
      if (isAllowed(from, to)) return;
      if (baselineKey(file, to) in BASELINE) return; // grandfathered, see tools/module-boundary-baseline.json

      const messageId =
        from === 'platform' ? 'platformToModule' : to === 'shell' ? 'moduleToShell' : 'crossModule';
      context.report({ node, messageId, data: { from, to, specifier } });
    };

    const fromSource = (node) => node.source && check(node.source, node.source.value);

    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression: (node) => node.source?.type === 'Literal' && check(node.source, node.source.value),
      CallExpression(node) {
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'require') return;
        const [argument] = node.arguments;
        if (argument?.type === 'Literal') check(argument, argument.value);
      },
    };
  },
};

const plugin = {
  meta: { name: 'module-boundaries' },
  rules: { 'no-cross-module-import': noCrossModuleImport },
};

export default plugin;
