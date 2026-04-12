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
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : "Internal server error";
    const message = typeof payload === "string" ? payload : (payload as Record<string, unknown>).message ?? "Error";

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
          path: request.url
        }
      }
    });
  }
}
