type Frame = { url: string };
type Sender = { mainFrame: Frame };

export function createVersionHandler(sender: Sender, appUrl: string, version: () => string) {
  return (event: { sender: Sender; senderFrame: Frame | null }, ...args: unknown[]) => {
    assertTrustedSender(event, sender.mainFrame, appUrl);
    if (event.sender !== sender || args.length !== 0) throw new Error('Invalid IPC request');
    return version();
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
