import { ApiError } from '@motes/core';
import { z } from 'zod';
import type { createPairingService } from './pairing';

type Frame = { url: string };
type Sender = { mainFrame: Frame };

const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('status') }),
  z.strictObject({
    action: z.literal('pair'),
    url: z.string().min(1).max(2048),
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(200),
  }),
  z.strictObject({ action: z.literal('devices') }),
  z.strictObject({ action: z.literal('revoke'), id: z.string().min(1).max(200) }),
]);
export type PairingRequest = z.infer<typeof requestSchema>;
export type PairingResult = { ok: true; value: unknown } | { ok: false; unauthorized: boolean };

export function createPairingHandler(
  sender: Sender,
  appUrl: string,
  service: ReturnType<typeof createPairingService>,
) {
  return async (
    event: { sender: Sender; senderFrame: Frame | null },
    ...args: unknown[]
  ): Promise<PairingResult> => {
    assertTrustedSender(event, sender.mainFrame, appUrl);
    const parsed = requestSchema.safeParse(args[0]);
    if (event.sender !== sender || args.length !== 1 || !parsed.success)
      throw new Error('Invalid IPC request');
    try {
      const request = parsed.data;
      switch (request.action) {
        case 'status':
          return { ok: true, value: await service.isPaired() };
        case 'pair':
          await service.pair(request.url, request.name, request.code);
          return { ok: true, value: null };
        case 'devices':
          return { ok: true, value: await service.devices() };
        case 'revoke':
          return { ok: true, value: await service.revoke(request.id) };
      }
    } catch (error) {
      return { ok: false, unauthorized: error instanceof ApiError && error.status === 401 };
    }
  };
}

export function createVersionHandler(sender: Sender, appUrl: string, version: () => string) {
  return createReadHandler(sender, appUrl, version);
}

export function createReadHandler<T>(sender: Sender, appUrl: string, read: () => T) {
  return (event: { sender: Sender; senderFrame: Frame | null }, ...args: unknown[]) => {
    assertTrustedSender(event, sender.mainFrame, appUrl);
    if (event.sender !== sender || args.length !== 0) throw new Error('Invalid IPC request');
    return read();
  };
}

export function isAllowedNavigation(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url);
    const app = new URL(appUrl);
    return (
      target.origin === app.origin &&
      target.protocol === app.protocol &&
      target.host === app.host &&
      target.pathname === app.pathname &&
      target.search === app.search
    );
  } catch {
    return false;
  }
}

export function assertTrustedSender(
  event: { senderFrame: Frame | null },
  mainFrame: Frame,
  appUrl: string,
): void {
  if (event.senderFrame !== mainFrame || !isAllowedNavigation(mainFrame.url, appUrl)) {
    throw new Error('Untrusted IPC sender');
  }
}
