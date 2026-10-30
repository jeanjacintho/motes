import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const checker = fileURLToPath(new URL('./check-boundaries.ts', import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'motes-boundaries-'));
  roots.push(root);
  for (const [kind, names] of Object.entries({
    apps: ['server', 'daemon', 'desktop', 'web'],
    packages: [
      'protocol',
      'db',
      'domain',
      'decision',
      'bots',
      'channels',
      'security',
      'engines',
      'core',
      'ui',
      'views',
    ],
  })) {
    for (const name of names) {
      const directory = join(root, kind, name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({ name: `@motes/${name}`, type: 'module' }),
      );
    }
  }
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function check(files: Record<string, string>) {
  return spawnSync(process.execPath, [checker, '--root', fixture(files)], { encoding: 'utf8' });
}

test('reports every forbidden edge with its file, line and specifier', () => {
  const result = check({
    'packages/views/src/screen.tsx':
      '\nimport { secret } from "@motes/db";\nexport * from "@motes/domain";',
    'packages/core/src/index.ts': 'import "@motes/ui";',
    'packages/ui/src/index.ts': 'import "@motes/core/subpath";',
    'packages/domain/src/index.ts': 'import "@motes/views";',
    'packages/db/src/index.ts': 'import "@motes/server";',
    'apps/web/src/index.ts': 'import "@motes/desktop";',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('packages/views/src/screen.tsx:2:');
  expect(result.stderr).toContain('packages/views/src/screen.tsx:3:');
  for (const name of ['db', 'domain', 'ui', 'core/subpath', 'views', 'server', 'desktop']) {
    expect(result.stderr).toContain(`"@motes/${name}"`);
  }
});

test('accepts the allowed graph, same-package imports, type imports and external UI libraries', () => {
  const result = check({
    'apps/server/src/index.ts': 'import "@motes/domain"; import "./route.js";',
    'packages/views/src/index.tsx':
      'import "@motes/core"; import "@motes/ui"; import "@motes/protocol"; import { useStore } from "zustand";',
    'packages/core/src/index.ts': 'import "@motes/protocol"; import "zustand";',
    'packages/ui/src/index.tsx': 'import "react"; import "./button.js";',
    'packages/domain/src/index.ts':
      'import "@motes/db"; import "@motes/security"; import "@motes/decision"; import type { Id } from "@motes/protocol";',
    'packages/protocol/src/index.ts': 'import "zod";',
    'packages/channels/src/index.ts': 'import "@motes/protocol";',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test('blocks framework imports including subpaths, dynamic imports, require and import types', () => {
  const result = check({
    'packages/domain/src/index.ts':
      'import "fastify";\nexport * from "electron/main";\nconst ui = import("react/jsx-runtime");\nconst fastify = require("fastify/plugin");\ntype R = import("react").ReactNode;\nimport electron = require("electron");',
    'packages/core/src/index.ts': 'import "react-dom/client";',
  });
  expect(result.status).toBe(1);
  for (let line = 1; line <= 6; line++) {
    expect(result.stderr).toContain(`packages/domain/src/index.ts:${line}:`);
  }
  expect(result.stderr).toContain('packages/core/src/index.ts:1:');
});

test('blocks Zustand factory imports and aliases in views while allowing types', () => {
  const result = check({
    'packages/views/src/store.ts':
      'import { create as makeStore } from "zustand";\nimport { createStore } from "zustand/vanilla";\nexport { create } from "zustand";',
  });
  expect(result.status).toBe(1);
  for (let line = 1; line <= 3; line++) {
    expect(result.stderr).toContain(`packages/views/src/store.ts:${line}:`);
  }
  const types = check({
    'packages/views/src/types.ts':
      'import type { StoreApi } from "zustand"; import { type create } from "zustand";',
  });
  expect(types.status).toBe(0);
});

test.each([
  'import { createWithEqualityFn } from "zustand/traditional";',
  'import { createWithEqualityFn as makeStore } from "zustand/traditional";',
  'export { createWithEqualityFn } from "zustand/traditional";',
  'export { createWithEqualityFn as makeStore } from "zustand/traditional";',
])('rejects the equality store factory in views: %s', (statement) => {
  const result = check({ 'packages/views/src/store.ts': `\n${statement}` });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('packages/views/src/store.ts:2:1:');
  expect(result.stderr).toContain('views must not import Zustand store factories');
  expect(result.stderr).toContain('"zustand/traditional"');
});

test('allows equality hooks and type-only factory imports and re-exports in views', () => {
  const result = check({
    'packages/views/src/hooks.ts': [
      'import { useStoreWithEqualityFn } from "zustand/traditional";',
      'export { useStoreWithEqualityFn as useStore } from "zustand/traditional";',
      'import type { createWithEqualityFn } from "zustand/traditional";',
      'import { type createWithEqualityFn as Factory } from "zustand/traditional";',
      'export type { createWithEqualityFn } from "zustand/traditional";',
      'export { type createWithEqualityFn as Factory } from "zustand/traditional";',
    ].join('\n'),
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test('checks relative imports and tsconfig path aliases across boundaries', () => {
  const result = check({
    'packages/ui/tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '#core': ['../core/src/index.ts'] } },
    }),
    'packages/core/src/index.ts': 'export {};',
    'packages/ui/src/index.ts': 'import "../../core/src/index.js";\nimport "#core";',
    'packages/protocol/src/index.ts': 'export * from "../../../apps/server/src/index.js";',
    'apps/server/src/index.ts': 'export {};',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('packages/ui/src/index.ts:1:');
  expect(result.stderr).toContain('packages/ui/src/index.ts:2:');
  expect(result.stderr).toContain('packages/protocol/src/index.ts:1:');
});

test('keeps adapters and protocol isolated from implementation packages', () => {
  const result = check(
    Object.fromEntries(
      ['channels', 'bots', 'decision', 'protocol'].map((name) => [
        `packages/${name}/src/index.ts`,
        'import "@motes/domain";',
      ]),
    ),
  );
  expect(result.status).toBe(1);
  for (const name of ['channels', 'bots', 'decision', 'protocol']) {
    expect(result.stderr).toContain(`packages/${name}/src/index.ts:1:`);
  }
});

test('ignores build output and dependency trees, but scans tests and JavaScript sources', () => {
  const result = check({
    'packages/ui/dist/index.js': 'import "@motes/core";',
    'packages/ui/node_modules/example/index.js': 'import "@motes/core";',
    'packages/ui/src/example.test.ts': 'import "@motes/core";',
    'packages/domain/src/example.cjs': 'require("react");',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('packages/ui/src/example.test.ts:1:');
  expect(result.stderr).toContain('packages/domain/src/example.cjs:1:');
  expect(result.stderr).not.toContain('/dist/');
  expect(result.stderr).not.toContain('/node_modules/');
});
