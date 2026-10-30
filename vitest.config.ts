import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

const domSetup = fileURLToPath(new URL('./vitest.setup.dom.ts', import.meta.url));
const domWorkspaces = new Set(['packages/ui', 'packages/views', 'apps/web']);

const workspaces = ['apps', 'packages'].flatMap((directory) =>
  readdirSync(new URL(`./${directory}/`, import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${directory}/${entry.name}`),
);

export default defineConfig({
  test: {
    projects: workspaces.flatMap<TestProjectInlineConfiguration>((workspace) => {
      const root = fileURLToPath(new URL(`./${workspace}/`, import.meta.url));
      if (workspace === 'apps/desktop') {
        return [
          {
            test: {
              name: `${workspace}:node`,
              root,
              environment: 'node',
              include: ['src/**/*.test.{ts,tsx}'],
              exclude: ['src/renderer/**'],
            },
          },
          {
            test: {
              name: `${workspace}:renderer`,
              root,
              environment: 'jsdom',
              include: ['src/renderer/**/*.test.{ts,tsx}'],
              setupFiles: [domSetup],
            },
          },
        ];
      }
      const dom = domWorkspaces.has(workspace);
      return [
        {
          test: {
            name: workspace,
            root,
            environment: dom ? 'jsdom' : 'node',
            include: ['src/**/*.test.{ts,tsx}'],
            setupFiles: dom ? [domSetup] : [],
          },
        },
      ];
    }),
  },
});
