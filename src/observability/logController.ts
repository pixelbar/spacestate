import { LogController, type FastifyReply, type FastifyRequest } from "fastify";

/**
 * Fastify's own per-request lines, moved below `info`. By default it logs
 * "incoming request" and "request completed" for every request, and "Route
 * … not found" for every 404 — nearly all of it polls and scanners (see
 * policy.ts). Routes log what actually happened; these lines come back with
 * `LOG_LEVEL=debug` ("incoming request" with `trace`).
 *
 * Requests that fail still log at `error`, whatever the level.
 */
export class RoutineRequestLogController extends LogController {
  override incomingRequest(request: FastifyRequest): void {
    if (this.isLogDisabled(request)) return;
    request.log.trace({ req: request }, "incoming request");
  }

  override requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply): void {
    if (error) {
      super.requestCompleted(error, request, reply);
      return;
    }
    if (this.isLogDisabled(request)) return;
    reply.log.debug({ res: reply, responseTime: reply.elapsedTime }, "request completed");
  }

  override routeNotFound(request: FastifyRequest): void {
    if (this.isLogDisabled(request)) return;
    const { url, method } = request.raw;
    request.log.debug(`Route ${method}:${url} not found`);
  }
}
