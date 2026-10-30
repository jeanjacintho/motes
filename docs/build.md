# TypeScript build

Use Node 24 and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
```

Both root commands run through Turborepo across all 15 workspaces. Typecheck
builds dependency declarations first, so it also works before the first build.
Shared compiler configuration is part of each task hash. Build and typecheck
keep separate incremental metadata in `dist/` and `.turbo/` respectively.

`tsconfig.base.json` enables strict checking, unchecked-index access checking,
exact optional properties and verbatim ESM syntax. Its libraries contain no
DOM globals and ambient types are opt-in. Node workspaces add Node 24 types;
UI workspaces add DOM libraries and React JSX. `core` remains free of DOM globals.

## Outputs and package references

- Node workspaces use NodeNext resolution and `tsc -b`, emitting ESM JavaScript,
  declarations and declaration maps into their own `dist/` directories.
- `core`, `ui` and `views` use bundler resolution and export `src/index.ts`.
  Their build emits declarations only, satisfying TypeScript project references
  while leaving JavaScript generation to the application bundlers.
- Desktop and web use bundler resolution and check their source without emitting
  JavaScript. Their bundlers and executable application builds arrive in the
  respective application cards.

Workspace dependencies and TypeScript references describe the same graph.
The scaffold connects server packages through `protocol`, domain through its
allowed service packages, daemon through `engines`, and views through `core`,
`ui` and `protocol`. Adapters only reference `protocol`; composition belongs in
the apps. When a card adds an internal dependency, update both `dependencies`
and `references` together. Package exports resolve Node consumers to `dist/`
and client consumers to source; there are no aliases bypassing package exports.

The root `tsconfig.json` is a solution config for editors and `pnpm exec tsc -b`.
See the [TypeScript project reference documentation](https://www.typescriptlang.org/docs/handbook/project-references.html)
for why referenced projects emit declarations.

## Acceptance checks

After the successful root commands above, create a temporary file:

```sh
printf 'export const broken: string = 123;\n' > packages/protocol/src/build-probe.ts
pnpm typecheck
```

The command must exit nonzero and report TS2322 at `src/build-probe.ts` in
`@motes/protocol`. Delete that temporary file and run `pnpm typecheck` again;
it must pass. The probe is a manual acceptance check, not committed source.

For an output smoke check, Node packages must have `dist/index.js` and
`dist/index.d.ts`; client packages must have `dist/index.d.ts` and no emitted
JavaScript. Temporary typed imports along `protocol → core → views → web`
and `protocol → server` verify package resolution across both build modes.

The integrated `pnpm check`, lint, boundary checker, test runner and Postgres
scripts belong to later cards and are not available in this scaffold yet.
