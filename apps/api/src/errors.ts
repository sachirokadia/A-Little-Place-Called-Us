import { randomUUID } from 'node:crypto';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const badRequest = (msg = 'Invalid request') => new ApiError(400, 'VALIDATION_ERROR', msg);
export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Not found');
export const forbidden = () => new ApiError(404, 'NOT_FOUND', 'Not found'); // generic: never leak existence
export const conflict = (code = 'CONFLICT', msg = 'Conflict') => new ApiError(409, code, msg);
export const rateLimited = () => new ApiError(429, 'RATE_LIMITED', 'Too many requests');

export function correlationId(): string {
  return randomUUID();
}
export function errorBody(err: ApiError, id: string) {
  return { error: { code: err.code, message: err.message, correlationId: id } };
}
