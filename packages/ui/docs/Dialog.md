# Dialog

Provide a title and a focusable trigger. Use `Dialog.Close` around cancellation
or synchronous completion actions; it closes the dialog and returns focus to the
trigger. Escape also closes it. Use `description` for supporting text.

```tsx
<Dialog trigger={<Button>Editar</Button>} title="Editar">
  <Dialog.Close asChild><Button>Cancelar</Button></Dialog.Close>
  <Dialog.Close asChild><Button onClick={save}>Salvar</Button></Dialog.Close>
</Dialog>
```
