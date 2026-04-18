import { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function createHost(request: { method: string; url: string; headers?: Record<string, unknown> }) {
  const normalizedRequest = {
    headers: {},
    ...request
  };
  const json = jest.fn();
  const response = {
    status: jest.fn().mockImplementation(() => ({ json }))
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => normalizedRequest
    })
  } as unknown as ArgumentsHost;

  return { host, response, json };
}

describe("AllExceptionsFilter", () => {
  it("keeps default 500 response for non-admin routes", () => {
    const filter = new AllExceptionsFilter();
    const { host, response, json } = createHost({
      method: "GET",
      url: "/api/v1/public/predictions",
    });

    filter.catch(new Error("relation prediction_runs does not exist"), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false
      })
    );
  });

  it("returns safe empty payload for admin read schema compatibility errors", () => {
    const filter = new AllExceptionsFilter();
    const { host, response, json } = createHost({
      method: "GET",
      url: "/api/v1/admin/security/phase4/environment-checks",
    });

    filter.catch(new Error("relation rate_limit_buckets does not exist"), host);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: [],
      meta: {
        degraded: true,
        fallback: "admin_read_schema_compatibility",
        path: "/api/v1/admin/security/phase4/environment-checks"
      },
      error: null
    });
  });

  it("does not fallback for admin write routes", () => {
    const filter = new AllExceptionsFilter();
    const { host, response, json } = createHost({
      method: "POST",
      url: "/api/v1/admin/security/phase4/secret-rotations",
    });

    filter.catch(new Error("relation secret_rotation_events does not exist"), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false
      })
    );
  });
});
