# Toast

Wrap notifications in `Toast.Provider`, render `Toast.Root` with a title or
description, and include `Toast.Viewport`. Use actions only when they are safe
to ignore. The provider and viewport use pt-BR accessibility labels by default;
pass `label` to either component to override them. The viewport label may include
`{hotkey}` for the keyboard shortcut.

```tsx
<Toast.Provider>
  <Toast.Root><Toast.Title>Salvo</Toast.Title></Toast.Root>
  <Toast.Viewport />
</Toast.Provider>
```
