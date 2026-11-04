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

export type FailureIssue = { file: string; path: string; message: string };

/** The field-level problems a refused write carries, when the bridge passed them on. */
export function failureIssues(error: unknown): FailureIssue[] {
  if (typeof error !== 'object' || error === null || !('issues' in error)) return [];
  const { issues } = error;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue): FailureIssue[] =>
    typeof issue === 'object' &&
    issue !== null &&
    typeof issue.file === 'string' &&
    typeof issue.path === 'string' &&
    typeof issue.message === 'string'
      ? [{ file: issue.file, path: issue.path, message: issue.message }]
      : [],
  );
}
