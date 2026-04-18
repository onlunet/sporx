import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private isAdminReadFallbackRoute(request: Request) {
    const path = request.url.toLowerCase();
    if (!path.startsWith("/api/v1/admin/")) {
      return false;
    }

    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD") {
      return true;
    }

    // Some admin read dashboards use POST for report generation.
    if (
      method === "POST" &&
      (path.startsWith("/api/v1/admin/security/compliance/retention/cleanup/dry-run") ||
        path.startsWith("/api/v1/admin/security/compliance/data-access-requests"))
    ) {
      return true;
    }

    return false;
  }

  private isPrismaSchemaCompatibilityError(exception: unknown) {
    const prismaCode = (exception as { code?: string } | null)?.code;
    if (prismaCode === "P2021" || prismaCode === "P2022" || prismaCode === "P2010") {
      return true;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2021" || exception.code === "P2022" || exception.code === "P2010") {
        return true;
      }
    }

    const message =
      exception instanceof Error
        ? exception.message
        : typeof exception === "string"
          ? exception
          : "";

    return /relation .* does not exist|table .* does not exist|column .* does not exist|no such table|unknown column|invalid `prisma/i.test(
      message.toLowerCase()
    );
  }

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
    const shouldUseReadFallback =
      status >= HttpStatus.INTERNAL_SERVER_ERROR &&
      this.isAdminReadFallbackRoute(request) &&
      this.isPrismaSchemaCompatibilityError(exception);

    if (shouldUseReadFallback) {
      response.status(HttpStatus.OK).json({
        success: true,
        data: [],
        meta: {
          degraded: true,
          fallback: "admin_read_schema_compatibility",
          path: request.url
        },
        error: null
      });
      return;
    }

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
