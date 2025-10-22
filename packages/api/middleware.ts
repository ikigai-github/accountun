import type { MiddlewareHandler } from "hono";
import { getClient, getContract } from "./client";

declare module "hono" {
  interface ContextVariableMap {
    client: Awaited<ReturnType<typeof getClient>>;
    contract: Awaited<ReturnType<typeof getContract>>;
  }
}

/**
 * Injects the midnight client into the context for routes that need it.
 * @param context the context to inject the client into
 * @param next the next middleware handler
 */
export const attachMidnightClient: MiddlewareHandler = async (
  context,
  next,
) => {
  const client = await getClient();
  context.set("client", client);
  await next();
};

/**
 * Injects the found deployed client contract into the context for routes that need it.
 * @param context the context to inject the contract into
 * @param next the next middleware handler
 */
export const attachDeployedContract: MiddlewareHandler = async (
  context,
  next,
) => {
  const contract = await getContract();
  context.set("contract", contract);
  await next();
};
