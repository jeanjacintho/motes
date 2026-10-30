import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

type Workspace = { kind: 'apps' | 'packages'; name: string; directory: string };
type ModuleImport = { node: ts.Node; specifier: string; names: string[] };

// Unlisted server packages have no additional package graph restriction in DESIGN §8.
const allowedPackages: Readonly<Record<string, readonly string[]>> = {
  views: ['core', 'ui', 'protocol'],
  core: ['protocol'],
  ui: [],
  domain: ['db', 'protocol', 'security', 'decision'],
  protocol: [],
  channels: ['protocol'],
  bots: ['protocol'],
  decision: ['protocol'],
};
const forbiddenExternals: Readonly<Record<string, readonly string[]>> = {
  domain: ['fastify', 'electron', 'react'],
  core: ['react-dom'],
};
const ignoredDirectories = new Set(['node_modules', 'dist', 'coverage', 'generated']);
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith('.') || ignoredDirectories.has(entry.name)
        ? []
        : sourceFiles(path);
    }
    return entry.isFile() && sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function imports(source: ts.SourceFile): ModuleImport[] {
  const result: ModuleImport[] = [];
  function add(node: ts.Node, specifier: ts.Node | undefined, names: string[] = ['*']) {
    if (specifier && ts.isStringLiteralLike(specifier)) {
      result.push({ node, specifier: specifier.text, names });
    }
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const names = clause?.isTypeOnly
        ? []
        : bindings && ts.isNamedImports(bindings)
          ? bindings.elements
              .filter((item) => !item.isTypeOnly)
              .map((item) => (item.propertyName ?? item.name).text)
          : clause
            ? ['*']
            : [];
      if (clause?.name && !clause.isTypeOnly) names.push('*');
      add(node, node.moduleSpecifier, names);
    } else if (ts.isExportDeclaration(node)) {
      const names = node.isTypeOnly
        ? []
        : node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements
              .filter((item) => !item.isTypeOnly)
              .map((item) => (item.propertyName ?? item.name).text)
          : ['*'];
      add(node, node.moduleSpecifier, names);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node, node.moduleReference.expression, node.isTypeOnly ? [] : ['*']);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, []);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      add(node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function compilerOptions(directory: string): ts.CompilerOptions {
  const config = ts.findConfigFile(directory, ts.sys.fileExists);
  if (!config) return { moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!parsed) throw new Error(`Cannot parse ${config}`);
  if (parsed.errors.length) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => '\n',
      }),
    );
  }
  return parsed.options;
}

function isInside(file: string, directory: string) {
  const path = relative(directory, file);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function check(root: string): number {
  const workspaces = (['apps', 'packages'] as const).flatMap((kind) => {
    const parent = join(root, kind);
    return existsSync(parent)
      ? readdirSync(parent, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map(
            (entry): Workspace => ({ kind, name: entry.name, directory: join(parent, entry.name) }),
          )
      : [];
  });
  let violations = 0;
  for (const workspace of workspaces) {
    const options = compilerOptions(workspace.directory);
    for (const file of sourceFiles(workspace.directory)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const entry of imports(source)) {
        const specifier = entry.specifier;
        const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
          ?.resolvedFileName;
        const targetPath =
          resolved ?? (specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined);
        const target = workspaces.find(
          (candidate) =>
            specifier === `@motes/${candidate.name}` ||
            specifier.startsWith(`@motes/${candidate.name}/`) ||
            (targetPath !== undefined && isInside(targetPath, candidate.directory)),
        );
        let reason: string | undefined;
        if (target && target !== workspace) {
          if (target.kind === 'apps') {
            reason =
              'Only applications may compose packages; imports into another application are forbidden';
          } else if (workspace.kind === 'packages') {
            const allowed = allowedPackages[workspace.name];
            if (allowed && !allowed.includes(target.name)) {
              reason = `${workspace.name} may import only ${allowed.join(', ') || 'its own package'} internally`;
            }
          }
        }
        if (workspace.kind === 'packages') {
          const external = forbiddenExternals[workspace.name]?.find(
            (name) => specifier === name || specifier.startsWith(`${name}/`),
          );
          if (external) reason = `${workspace.name} must not import ${external}`;
          if (
            workspace.name === 'views' &&
            (specifier === 'zustand' || specifier.startsWith('zustand/')) &&
            entry.names.some((name) =>
              ['create', 'createStore', 'createWithEqualityFn', '*'].includes(name),
            )
          ) {
            reason =
              'views must not import Zustand store factories (use named hooks or types instead)';
          }
        }
        if (reason) {
          const { line, character } = source.getLineAndCharacterOfPosition(
            entry.node.getStart(source),
          );
          console.error(
            `${relative(root, file)}:${line + 1}:${character + 1}: ${reason}: "${specifier}"`,
          );
          violations++;
        }
      }
    }
  }
  return violations;
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1])) {
    throw new Error('Usage: node scripts/check-boundaries.ts [--root <workspace root>]');
  }
  const count = check(resolve(args[1] ?? process.cwd()));
  if (count) process.exitCode = 1;
  else console.log('Package boundaries passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
