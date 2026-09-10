import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ApiError } from "../lib/errors.js";

/**
 * Request validation.
 *
 * Parsed values are attached to `res.locals.validated` rather than written back
 * over `req.query` — Express 5 exposes `req.query` through a getter, so
 * assigning to it throws. Handlers read the typed result out of locals.
 */

export interface ValidatedLocals<TQuery = unknown, TParams = unknown, TBody = unknown> {
  query: TQuery;
  params: TParams;
  body: TBody;
}

export interface ValidationSchemas {
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  body?: ZodTypeAny;
}

function formatIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const validated: ValidatedLocals = { query: {}, params: {}, body: {} };

    for (const source of ["query", "params", "body"] as const) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (!result.success) {
        next(
          ApiError.validation(`Invalid request ${source}`, {
            source,
            issues: formatIssues(result.error),
          }),
        );
        return;
      }
      validated[source] = result.data;
    }

    res.locals.validated = validated;
    next();
  };
}

/** Typed accessor for a handler's validated input. */
export function validated<TQuery = unknown, TParams = unknown, TBody = unknown>(
  res: Response,
): ValidatedLocals<TQuery, TParams, TBody> {
  return (res.locals.validated ?? { query: {}, params: {}, body: {} }) as ValidatedLocals<
    TQuery,
    TParams,
    TBody
  >;
}

/** Infer the parsed type of a schema, for handler signatures. */
export type Infer<T extends ZodTypeAny> = z.infer<T>;
