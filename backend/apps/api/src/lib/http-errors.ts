/** Errors that map to a specific client-facing HTTP status via the error handler. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly error: string,
    message: string,
  ) {
    super(message);
    this.name = error;
  }
}

export class NotFound extends HttpError {
  constructor(resource: string) {
    super(404, 'not_found', `${resource} not found`);
  }
}

export class Conflict extends HttpError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

/** 422 — request is well-formed but violates a domain rule. */
export class Unprocessable extends HttpError {
  constructor(message: string) {
    super(422, 'unprocessable_entity', message);
  }
}
