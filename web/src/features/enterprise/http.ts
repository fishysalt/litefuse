import { type NextApiRequest, type NextApiResponse } from "next";

type MethodHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
) => unknown;

/**
 * 方法白名单 + 分发。
 *
 * 传入 { method: handler } 映射，自动做两件事：
 *   1. 方法不在映射里 → 405（错误信息自动列出允许的方法）
 *   2. 方法在映射里 → 调用对应 handler
 *
 * 好处：未来新增 HTTP 方法（如 PATCH）只需在映射里加一个 entry，
 * 白名单随之自动扩展，无需同时修改白名单数组和 switch 分支。
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
