#!/usr/bin/env bun

import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import {
  registerTournament,
  recordFunding,
  postResults,
  payoutReady,
  recordReceipt,
  completeTournament,
  cancelTournament,
  planPayout,
} from "@accountun/contract";

import { attachDeployedContract, attachMidnightClient } from "./middleware";
import {
  FundingRequestSchema,
  HealthResponseSchema,
  OkResultsSchema,
  ReceiptsRequestSchema,
  RegisterRequestSchema,
  ResultsRequestSchema,
  TournamentIdParamSchema,
  TxRefSchema,
} from "./schema";
import { closeClient } from "./client";

const app = new OpenAPIHono();

// register bearer security scheme once (shows lock icon in UIs)
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

app.use("/v1/*", bearerAuth({ token: process.env.BEAR_TOKEN ?? "" }));
app.use("/v1/*", attachMidnightClient);
app.use("/v1/*", attachDeployedContract);

// Health
app.openapi(
  createRoute({
    method: "get",
    path: "/health",
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: HealthResponseSchema } },
      },
    },
  }),
  (context) => context.json({ ok: true }),
);

// Register tournament
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament",
    request: {
      body: {
        content: { "application/json": { schema: RegisterRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Accepted",
        content: { "application/json": { schema: TxRefSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id, cash = "usd" } = context.req.valid("json");
    const contract = context.get("contract");
    const tx = await registerTournament(contract, id, cash);
    return context.json({ txHash: tx.public.txHash, txId: tx.public.txId });
  },
);

// Record funding
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament/{id}/funding",
    request: {
      params: TournamentIdParamSchema,
      body: {
        content: { "application/json": { schema: FundingRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: OkResultsSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id } = context.req.valid("param");
    const { entries } = context.req.valid("json");
    const contract = context.get("contract");

    const results: { txHash: string; txId: string }[] = [];
    for (const entry of entries) {
      const tx = await recordFunding(contract, id, entry);
      results.push({ txHash: tx.public.txHash, txId: tx.public.txId });
    }
    return context.json({ ok: true, results });
  },
);

// Post placements (results)
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament/{id}/results",
    request: {
      params: TournamentIdParamSchema,
      body: {
        content: { "application/json": { schema: ResultsRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Accepted",
        content: { "application/json": { schema: TxRefSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id } = context.req.valid("param");
    const { placements } = context.req.valid("json");
    const contract = context.get("contract");
    const tx = await postResults(contract, id, placements);
    return context.json({ txHash: tx.public.txHash, txId: tx.public.txId });
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament/{id}/plan",
    request: {
      params: TournamentIdParamSchema,
      body: {
        content: { "application/json": { schema: ReceiptsRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: OkResultsSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id } = context.req.valid("param");
    const { entries } = context.req.valid("json");
    const contract = context.get("contract");

    const results: { txHash: string; txId: string }[] = [];
    for (const entry of entries) {
      const tx = await planPayout(contract, id, entry);
      results.push({ txHash: tx.public.txHash, txId: tx.public.txId });
    }
    return context.json({ ok: true, results });
  },
);

// Mark payout ready
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament/{id}/ready",
    request: { params: TournamentIdParamSchema },
    responses: {
      200: {
        description: "Accepted",
        content: { "application/json": { schema: TxRefSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id } = context.req.valid("param");
    const contract = context.get("contract");
    const tx = await payoutReady(contract, id);
    return context.json({
      txHash: tx.public.txHash,
      txId: tx.public.txId,
    });
  },
);

// Record receipts
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament/{id}/receipts",
    request: {
      params: TournamentIdParamSchema,
      body: {
        content: { "application/json": { schema: ReceiptsRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: OkResultsSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id } = context.req.valid("param");
    const { entries } = context.req.valid("json");
    const contract = context.get("contract");

    const results: { txHash: string; txId: string }[] = [];
    for (const entry of entries) {
      const tx = await recordReceipt(contract, id, entry);
      results.push({
        txHash: tx.public.txHash,
        txId: tx.public.txId,
      });
    }
    return context.json({
      ok: true,
      results,
    });
  },
);

// Complete tournament
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament/{id}/complete",
    request: { params: TournamentIdParamSchema },
    responses: {
      200: {
        description: "Accepted",
        content: { "application/json": { schema: TxRefSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id } = context.req.valid("param");
    const contract = context.get("contract");
    const tx = await completeTournament(contract, id);
    return context.json({
      txHash: tx.public.txHash,
      txId: tx.public.txId,
    });
  },
);

// Cancel tournament
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament/{id}/cancel",
    request: { params: TournamentIdParamSchema },
    responses: {
      200: {
        description: "Accepted",
        content: { "application/json": { schema: TxRefSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id } = context.req.valid("param");
    const contract = context.get("contract");
    const tx = await cancelTournament(contract, id);
    return context.json({
      txHash: tx.public.txHash,
      txId: tx.public.txId,
    });
  },
);

// Error handling
app.onError((err, context) => {
  console.error(err);
  if (err instanceof HTTPException) return err.getResponse();
  return context.json({ error: String((err as any)?.message ?? err) }, 500);
});

const port = Number(process.env.PORT || 8787);
const serverUrl = process.env.SERVER_URL ?? `http://localhost:${port}`;

// OpenAPI doc endpoint
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Accountun Tournament API",
    version: "1.0.0",
    description: "REST API for tournament accounting",
  },
  servers: [{ url: serverUrl }],
  security: [{ bearerAuth: [] }],
});

// Start Listening
const server = Bun.serve({ fetch: app.fetch, port });

console.log(`Listening on :${port}`);

// Shutdown handler
async function shutdown() {
  console.log("Shutting down…");
  await closeClient();
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
