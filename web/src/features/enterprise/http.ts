import { type NextApiRequest, type NextApiResponse } from "next";

/**
 * Method whitelist for a route. Returns true when the request method is
 * allowed (nothing is written); otherwise answers 405 with the allowed
 * methods and returns false so the caller can return early.
 */
export function allowMethods(
  req: NextApiRequest,
  res: NextApiResponse,
  allowed: readonly string[],
): boolean {
  const method = req.method ?? "";

  if (allowed.includes(method)) {
    return true;
  }

  res.status(405).json({
    error: `Method not allowed. Allowed methods: ${allowed.join(", ")}`,
  });
  return false;
}

/**
 * Dispatches to the handler registered under the request method. The
 * handler's return value (including a promise) is passed through untouched;
 * unknown methods produce a 405 listing the registered method names.
 */
export function routeByMethod(
  req: NextApiRequest,
  res: NextApiResponse,
  handlers: Record<
    string,
    (req: NextApiRequest, res: NextApiResponse) => unknown
  >,
): unknown {
  const handler = handlers[req.method ?? ""];

  if (handler) {
    return handler(req, res);
  }

  return res.status(405).json({
    error: `Method not allowed. Allowed methods: ${Object.keys(handlers).join(", ")}`,
  });
}
