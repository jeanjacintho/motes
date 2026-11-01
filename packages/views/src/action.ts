import { useState } from 'react';

/** Runs an async action and remembers whether the last attempt failed. */
export function useAction() {
  const [failed, setFailed] = useState(false);
  async function run(action: () => Promise<void>): Promise<boolean> {
    setFailed(false);
    try {
      await action();
      return true;
    } catch {
      setFailed(true);
      return false;
    }
  }
  return { failed, run };
}

/** Failures from the bridge carry a protocol error code; anything else has none. */
export function failureCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
