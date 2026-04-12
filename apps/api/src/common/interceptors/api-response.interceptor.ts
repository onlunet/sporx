import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { map, Observable } from "rxjs";

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(_: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === "object" && "success" in (data as Record<string, unknown>)) {
          return data;
        }

        return {
          success: true,
          data,
          meta: null,
          error: null
        };
      })
    );
  }
}
