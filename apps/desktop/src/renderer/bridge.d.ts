export {};

declare global {
  interface Window {
    motes: { version(): Promise<string> };
  }
}
