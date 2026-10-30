import {
  DropdownMenu,
  Dialog as RadixDialog,
  Toast as RadixToast,
  Tooltip as RadixTooltip,
} from 'radix-ui';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

export function Button({ type = 'button', ...props }: ComponentProps<'button'>) {
  return <button type={type} {...props} />;
}
export function IconButton(props: ComponentProps<'button'> & { 'aria-label': string }) {
  return <Button {...props} />;
}
export function Input(props: ComponentProps<'input'>) {
  return <input {...props} />;
}
export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} />;
}
export function Badge(props: ComponentProps<'span'>) {
  return <span {...props} />;
}
export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <span role="status" aria-label={label}>
      ◌
    </span>
  );
}

function DialogRoot({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactElement;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root>
      <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="motes-overlay" />
        <RadixDialog.Content
          className="motes-dialog"
          aria-modal="true"
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <RadixDialog.Title>{title}</RadixDialog.Title>
          {description && <RadixDialog.Description>{description}</RadixDialog.Description>}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
export const Dialog = Object.assign(DialogRoot, { Close: RadixDialog.Close });

function MenuRoot({ trigger, children }: { trigger: ReactElement; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="motes-popup">{children}</DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
export const Menu = Object.assign(MenuRoot, { Item: DropdownMenu.Item });
export function Tooltip({ trigger, children }: { trigger: ReactElement; children: ReactNode }) {
  return (
    <RadixTooltip.Provider>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{trigger}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content className="motes-popup">{children}</RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
function ToastProvider({
  label = 'Notificação',
  ...props
}: ComponentProps<typeof RadixToast.Provider>) {
  return <RadixToast.Provider label={label} {...props} />;
}
function ToastViewport({
  label = 'Notificações ({hotkey})',
  ...props
}: ComponentProps<typeof RadixToast.Viewport>) {
  return <RadixToast.Viewport label={label} {...props} />;
}
export const Toast = {
  Provider: ToastProvider,
  Root: RadixToast.Root,
  Title: RadixToast.Title,
  Description: RadixToast.Description,
  Action: RadixToast.Action,
  Close: RadixToast.Close,
  Viewport: ToastViewport,
};
