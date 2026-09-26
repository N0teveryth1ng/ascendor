import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not observe a rejected promise returned by a handler: the
 * rejection escapes to the process as an unhandled rejection and the request
 * hangs instead of reaching the error middleware. Every persistence-backed
 * handler is async now that the database is, so they are all mounted through
 * this to keep `errorHandler` as the single place errors surface.
 */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
