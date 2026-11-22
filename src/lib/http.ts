// Small helpers for the JSON API routes.

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Turns an error into a JSON response. Expected errors (HttpError) keep their message;
// anything else is logged and returned as a generic 500 so internals don't leak to clients.
export function errorResponse(error: unknown, context: string): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, ...error.body }, error.status)
  }
  console.error(`${context}:`, error)
  return json({ error: 'Something went wrong. Please try again.' }, 500)
}
