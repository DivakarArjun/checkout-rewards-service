import { NextFunction, Request, Response } from "express";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details }
    });
  }
  if (typeof error === "object" && error !== null && "issues" in error) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error
      }
    });
  }
  console.error(error);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" }
  });
}
