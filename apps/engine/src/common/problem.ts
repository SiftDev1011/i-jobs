/**
 * An error the API returns as application/problem+json (RFC 9457).
 * `code` is the stable, machine-readable reason clients build on.
 */
export interface FieldError {
  field: string;
  message: string;
}

export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
  ) {
    super(title);
    this.name = 'Problem';
  }

  static badRequest(code: string, title: string, errors?: FieldError[]) {
    return new Problem(400, code, title, undefined, errors);
  }
  static unauthorized(code = 'unauthorized', title = 'Sign in to continue') {
    return new Problem(401, code, title);
  }
  static forbidden(code: string, title: string) {
    return new Problem(403, code, title);
  }
  static notFound(code = 'not_found', title = 'Not found') {
    return new Problem(404, code, title);
  }
  static conflict(code: string, title: string) {
    return new Problem(409, code, title);
  }
  static unprocessable(code: string, title: string, errors?: FieldError[]) {
    return new Problem(422, code, title, undefined, errors);
  }
  static unavailable(code: string, title: string) {
    return new Problem(503, code, title);
  }
  static tooMany(retryAfterSeconds: number, title = 'Too many requests. Try again shortly.') {
    return new Problem(429, 'rate_limited', title, undefined, undefined, {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
    });
  }

  toBody() {
    return {
      type: 'about:blank',
      title: this.title,
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.errors?.length ? { errors: this.errors } : {}),
    };
  }
}
