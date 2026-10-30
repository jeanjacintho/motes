import { describe, expect, it } from 'vitest';
import { assertTrustedSender, createVersionHandler, isAllowedNavigation } from './security';

describe('desktop security', () => {
  it('rejects an IPC request from an unexpected frame in the handler', () => {
    const mainFrame = { url: 'http://localhost:5173/' };
    const sender = { mainFrame };
    const handler = createVersionHandler(sender, mainFrame.url, () => '1.0');
    expect(handler({ sender, senderFrame: mainFrame })).toBe('1.0');
    expect(() => handler({ sender, senderFrame: { url: mainFrame.url } })).toThrow(
      'Untrusted IPC sender',
    );
    expect(() => handler({ sender, senderFrame: mainFrame }, 'extra')).toThrow(
      'Invalid IPC request',
    );
  });
  it('rejects IPC from any frame other than the app main frame', () => {
    const mainFrame = { url: 'http://localhost:5173/' };
    expect(() =>
      assertTrustedSender({ senderFrame: mainFrame }, mainFrame, 'http://localhost:5173/'),
    ).not.toThrow();
    expect(() =>
      assertTrustedSender(
        { senderFrame: { url: mainFrame.url } },
        mainFrame,
        'http://localhost:5173/',
      ),
    ).toThrow();
    expect(() =>
      assertTrustedSender({ senderFrame: mainFrame }, mainFrame, 'http://localhost:9999/'),
    ).toThrow();
  });

  it('rejects external navigation and accepts only the app document', () => {
    expect(isAllowedNavigation('http://localhost:5173/', 'http://localhost:5173/')).toBe(true);
    expect(isAllowedNavigation('https://example.com/', 'http://localhost:5173/')).toBe(false);
    expect(isAllowedNavigation('http://localhost:5173/other', 'http://localhost:5173/')).toBe(
      false,
    );
  });
});
