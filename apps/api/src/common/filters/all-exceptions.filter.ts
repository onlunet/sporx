import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { Request, Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private sanitizeMessage(status: number, payload: unknown) {
    const sensitivePattern = /(secret|token|password|credential|apikey|api_key)/i;
    let rawMessage = "Request failed";
    if (typeof payload === "string") {
      rawMessage = payload;
    } else if (payload && typeof payload === "object" && "message" in payload) {
      const value = (payload as Record<string, unknown>).message;
      rawMessage = Array.isArray(value) ? value.join(", ") : String(value);
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return "Internal server error";
    }
    if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      return "Access denied";
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return "Too many requests. Please retry later.";
    }
    if (sensitivePattern.test(rawMessage)) {
      return "Request failed";
    }
    return rawMessage;
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : "Internal server error";
    const message = this.sanitizeMessage(status, payload);

    if (!(exception instanceof HttpException)) {
      // Keep minimal runtime diagnostics for unexpected server errors.
      // eslint-disable-next-line no-console
      console.error("[AllExceptionsFilter] Unexpected error", {
        method: request.method,
        path: request.url,
        message: exception instanceof Error ? exception.message : String(exception)
      });
    }

    response.status(status).json({
      success: false,
      data: {},
      meta: null,
      error: {
        code: `HTTP_${status}`,
        message,
        details: {
          path: request.url,
          requestId: request.headers["x-request-id"] ?? null
        }
      }
    });
  }
}
