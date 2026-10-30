import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('defines each semantic token in both themes', () => {
  const css = readFileSync('packages/ui/styles/tokens.css', 'utf8');
  const light = css.match(/\[data-theme="light"\]\s*\{([^}]*)\}/)?.[1] ?? '';
  const dark = css.match(/\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? '';
  for (const token of [
    'bg',
    'fg',
    'muted',
    'accent',
    'danger',
    'text-sm',
    'text-md',
    'text-lg',
    'space-sm',
    'space-md',
    'space-lg',
    'radius-sm',
    'radius-md',
    'font-body',
  ]) {
    expect(light).toMatch(new RegExp(`--${token}:\\s*[^;]+;`));
    expect(dark).toMatch(new RegExp(`--${token}:\\s*[^;]+;`));
  }
});
