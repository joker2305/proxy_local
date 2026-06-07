import { FastifyRequest, FastifyReply } from "fastify";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  type?: string;
}

export function createApiError(
  message: string,
  statusCode: number = 500,
  code: string = "internal_error",
  type: string = "api_error"
): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.code = code;
  error.type = type;
  return error;
}

export function isAnthropicEndpoint(url: string): boolean {
  return url.startsWith("/v1/messages") || url === "/v1/messages/count_tokens";
}

export async function errorHandler(
  error: ApiError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error(error);

  const statusCode = error.statusCode || 500;

  if (isAnthropicEndpoint(request.url)) {
    const anthropicErrorType = mapStatusCodeToAnthropicErrorType(statusCode);
    return reply.code(statusCode).send({
      type: "error",
      error: {
        type: anthropicErrorType,
        message: error.message || "Internal Server Error",
      },
    });
  }

  return reply.code(statusCode).send({
    error: {
      message: error.message || "Internal Server Error",
      type: error.type || "api_error",
      code: error.code || "internal_error",
    },
  });
}

function mapStatusCodeToAnthropicErrorType(statusCode: number): string {
  switch (statusCode) {
    case 400: return "invalid_request_error";
    case 401: return "authentication_error";
    case 403: return "permission_error";
    case 404: return "not_found_error";
    case 429: return "rate_limit_error";
    case 500: return "api_error";
    case 529: return "overloaded_error";
    default: return "api_error";
  }
}
