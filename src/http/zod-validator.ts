import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { ValidationError } from "./errors";

type ValidationTarget = "json" | "form" | "query" | "param" | "header" | "cookie";

export function zv<T extends ZodType>(target: ValidationTarget, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw ValidationError.fromZodError(result.error, {
        detail: `${target} validation failed`,
        fieldPathPrefix: target,
      });
    }
  });
} 