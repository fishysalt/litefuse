import { type NextApiRequest, type NextApiResponse } from "next";

type MethodHandler = (req: NextApiRequest, res: NextApiResponse) => unknown;

/**
 * Early method allowlist check. Returns true when the request method is one of
 * `allowed`; otherwise writes a 405 and returns false so the caller can bail out
 * before doing auth or database work.
 */
export function allowMethods(
  req: NextApiRequest,
  res: NextApiResponse,
  allowed: readonly string[],
): boolean {
  if (allowed.includes(req.method ?? "")) return true;
  res.status(405).json({
    error: `Method not allowed. Allowed methods: ${allowed.join(", ")}`,
  });
  return false;
}

/**
 * Method allowlist + dispatch.
 *
 * Given a { method: handler } map:
 *   1. method not in the map → 405 (the error lists the allowed methods)
 *   2. method in the map → invoke the matching handler
 *
 * Adding a new HTTP method later only needs one new map entry; there is no
 * separate allowlist array or switch to keep in sync.
 */
export function routeByMethod(
  req: NextApiRequest,
  res: NextApiResponse,
  handlers: Record<string, MethodHandler>,
): unknown {
  const handler = handlers[req.method ?? ""];
  if (!handler) {
    const allowed = Object.keys(handlers).join(", ");
    return res
      .status(405)
      .json({ error: `Method not allowed. Allowed methods: ${allowed}` });
  }
  return handler(req, res);
}
