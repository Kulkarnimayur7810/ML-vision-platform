export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export const unauthorized = (m = "Sign in required") => new AppError(401, "unauthorized", m);
export const forbidden = (m = "You don't have permission to do that") => new AppError(403, "forbidden", m);
export const notFound = (m = "Not found") => new AppError(404, "not_found", m);
export const badRequest = (m: string, extra?: Record<string, unknown>) => new AppError(400, "bad_request", m, extra);
export const conflict = (m: string, extra?: Record<string, unknown>) => new AppError(409, "conflict", m, extra);
export const tooMany = (m: string) => new AppError(429, "rate_limited", m);
