// Minimal structured logging for server code: "[scope] message {json details}".
type Details = Record<string, unknown>

function format(scope: string, message: string, details?: Details): string {
  return details ? `[${scope}] ${message} ${JSON.stringify(details)}` : `[${scope}] ${message}`
}

export const log = {
  info: (scope: string, message: string, details?: Details) => console.log(format(scope, message, details)),
  warn: (scope: string, message: string, details?: Details) => console.warn(format(scope, message, details)),
  error: (scope: string, message: string, details?: Details) => console.error(format(scope, message, details)),
}
