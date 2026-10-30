export class NotFound extends Error {}
export class Conflict extends Error {}
export class Forbidden extends Error {}
export class ValidationFailed extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
