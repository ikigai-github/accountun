#!/usr/bin/env bun

import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";

import {
  reconcileDustAllocation,
  planDustAllocations,
  registerTournament,
  recordFunding,
  postResults,
  payoutReady,
  recordReceipt,
  completeTournament,
  cancelTournament,
  planPayout,
  registerAvailableDustCoins,
} from "@accountun/contract";

import { attachDeployedContract, attachMidnightClient } from "./middleware";
import {
  DustReconcileRequestSchema,
  DustReconcileResponseSchema,
  DustRegisterRequestSchema,
  DustRegisterResponseSchema,
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

type TxRef = { txHash: string; txId: string };
type SubmittedTx = { public: TxRef };

function toTxRef(tx: SubmittedTx): TxRef {
  return { txHash: tx.public.txHash, txId: tx.public.txId };
}

async function executeEntryBatch<TEntry>(
  entries: readonly TEntry[],
  options: {
    beforeLogPrefix: string;
    afterLogPrefix: string;
    execute: (entry: TEntry) => Promise<SubmittedTx>;
  },
): Promise<TxRef[]> {
  const results: TxRef[] = [];
  for (const entry of entries) {
    console.log(options.beforeLogPrefix, entry);
    const tx = await options.execute(entry);
    console.log(options.afterLogPrefix, tx.public.txHash);
    results.push(toTxRef(tx));
  }

  return results;
}

// register bearer security scheme once (shows lock icon in UIs)
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

// Simple token auth
app.use("/v1/*", bearerAuth({ token: process.env.BEAR_TOKEN ?? "" }));

// Attach midnight client and deployed contract context for routes that need them
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
    console.log("Registering tournament with ID:", id);
    console.log("Using cash asset name:", cash);
    const tx = await registerTournament(contract, id, cash);
    console.log("Tournament registered, tx hash:", tx.public.txHash);
    return context.json(toTxRef(tx));
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
    console.log("Recording funding for tournament ID:", id);

    const results = await executeEntryBatch(entries, {
      beforeLogPrefix: "++Recording funding entry:",
      afterLogPrefix: "--Funding recorded, tx hash:",
      execute: (entry) => recordFunding(contract, id, entry),
    });

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
    console.log("Posting results for tournament ID:", id);
    console.log("Placements:", placements);
    const tx = await postResults(contract, id, placements);
    console.log("Results posted, tx hash:", tx.public.txHash);
    return context.json(toTxRef(tx));
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

    const results = await executeEntryBatch(entries, {
      beforeLogPrefix: "++Planning payout entry:",
      afterLogPrefix: "--Payout planned, tx hash:",
      execute: (entry) => planPayout(contract, id, entry),
    });

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
    console.log("Marking tournament ID as payout ready:", id);
    const tx = await payoutReady(contract, id);
    console.log(
      "Tournament marked as payout ready, tx hash:",
      tx.public.txHash,
    );
    return context.json(toTxRef(tx));
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

    console.log("Recording receipts for tournament ID:", id);

    const results = await executeEntryBatch(entries, {
      beforeLogPrefix: "++Recording receipt entry:",
      afterLogPrefix: "--Receipt recorded, tx hash:",
      execute: (entry) => recordReceipt(contract, id, entry),
    });

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
    console.log("Completing tournament ID:", id);
    const tx = await completeTournament(contract, id);
    console.log("Tournament completed, tx hash:", tx.public.txHash);
    return context.json(toTxRef(tx));
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
    console.log("Cancelling tournament ID:", id);
    const tx = await cancelTournament(contract, id);
    console.log("Tournament cancelled, tx hash:", tx.public.txHash);
    return context.json(toTxRef(tx));
  },
);

// Dust allocation planning
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/dust/allocations/reconcile",
    request: {
      body: {
        content: { "application/json": { schema: DustReconcileRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": { schema: DustReconcileResponseSchema },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const payload = context.req.valid("json");
    const client = context.get("client");
    const requests = payload.allocations.map((allocation) => ({
      dustAddress: allocation.dustAddress,
      targetSpecks: BigInt(allocation.targetSpecks),
    }));
    console.log(
      `Reconciling dust allocations for request ID: ${payload.requestId} with ${requests.length} allocation(s)`,
    );

    const summary = await planDustAllocations(client.config, requests, {
      requestId: payload.requestId,
      timeoutMs: payload.options?.timeoutMs,
      mainReservePercent: BigInt(payload.mainReservePercent),
      refreshBalances: payload.options?.refreshBalances,
      targetWindowMs: payload.options?.targetWindowMs,
    });

    const execution = await reconcileDustAllocation(
      client.config,
      summary.actions,
      {
        requestId: `${summary.requestId}-execute`,
        timeoutMs: payload.options?.timeoutMs,
      },
    );

    return context.json({
      requestId: summary.requestId,
      serviceDustAddress: summary.serviceDustAddress,
      reservePercent: summary.reservePercent.toString(),
      totalNight: summary.totalNight.toString(),
      mainMinNight: summary.mainMinNight.toString(),
      mainActualNight: summary.mainActualNight.toString(),
      requestedSpecks: summary.requestedSpecks.toString(),
      allocatedSpecks: summary.allocatedSpecks.toString(),
      shortfallSpecks: summary.shortfallSpecks.toString(),
      actions: summary.actions.map((action) => ({
        walletIndex: action.walletIndex,
        op: action.op,
        dustAddress: action.dustAddress,
        amountNight: action.amountNight?.toString(),
        reason: action.reason,
      })),
      execution: {
        requestId: execution.requestId,
        results: execution.results,
      },
      deallocated: summary.deallocated.map((entry) => ({
        walletIndex: entry.walletIndex,
        sweptNight: entry.sweptNight.toString(),
      })),
    });
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/dust/register",
    request: {
      body: {
        content: { "application/json": { schema: DustRegisterRequestSchema } },
        required: false,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: DustRegisterResponseSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const payload = context.req.valid("json");
    const client = context.get("client");

    const result = await registerAvailableDustCoins(client.wallet, {
      dustReceiverAddress: payload?.dustReceiverAddress,
      timeoutMs: payload?.timeoutMs,
    });

    if (!result) return context.json(null);

    return context.json({
      txId: result.txId,
      registeredCoins: result.registeredCoins,
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

const server = Bun.serve({ fetch: app.fetch, port, development: false });

console.log(`Listening on :${port}`);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("Shutting down");

  try {
    server.stop(true);
    await closeClient();
    console.log("Shutdown complete");
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
