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
  sendNativeToken,
  getTokenBalance,
} from "@accountun/contract";

import { attachDeployedContract, attachMidnightClient } from "./middleware";
import {
  DustBonusRequestSchema,
  DustBonusResultsSchema,
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
    console.log("Recording funding for tournament ID:", id);

    const results: { txHash: string; txId: string }[] = [];
    for (const entry of entries) {
      console.log("++Recording funding entry:", entry);
      const tx = await recordFunding(contract, id, entry);
      console.log("--Funding recorded, tx hash:", tx.public.txHash);
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
    console.log("Posting results for tournament ID:", id);
    console.log("Placements:", placements);
    const tx = await postResults(contract, id, placements);
    console.log("Results posted, tx hash:", tx.public.txHash);
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
      console.log("++Planning payout entry:", entry);
      const tx = await planPayout(contract, id, entry);
      console.log("--Payout planned, tx hash:", tx.public.txHash);
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
    console.log("Marking tournament ID as payout ready:", id);
    const tx = await payoutReady(contract, id);
    console.log(
      "Tournament marked as payout ready, tx hash:",
      tx.public.txHash,
    );
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

    console.log("Recording receipts for tournament ID:", id);

    const results: { txHash: string; txId: string }[] = [];
    for (const entry of entries) {
      console.log("++Recording receipt entry:", entry);
      const tx = await recordReceipt(contract, id, entry);
      console.log("--Receipt recorded, tx hash:", tx.public.txHash);
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
    console.log("Completing tournament ID:", id);
    const tx = await completeTournament(contract, id);
    console.log("Tournament completed, tx hash:", tx.public.txHash);
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
    console.log("Cancelling tournament ID:", id);
    const tx = await cancelTournament(contract, id);
    console.log("Tournament cancelled, tx hash:", tx.public.txHash);
    return context.json({
      txHash: tx.public.txHash,
      txId: tx.public.txId,
    });
  },
);

// Bonus Dust payouts
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tournament/{id}/bonus",
    request: {
      params: TournamentIdParamSchema,
      body: {
        content: { "application/json": { schema: DustBonusRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Accepted",
        content: { "application/json": { schema: DustBonusResultsSchema } },
      },
    },
    security: [{ bearerAuth: [] }],
  }),
  async (context) => {
    const { id } = context.req.valid("param");
    const { players } = context.req.valid("json");
    const client = context.get("client");

    const bonusDustAmount = 10n;

    // Sync wallet state and get current balance
    const balance = await getTokenBalance(client.wallet, {
      maxBehind: 0n,
      timeoutMs: 30_000,
    });

    // Check balances
    const totalAmount = BigInt(players.length) * bonusDustAmount;

    if (balance < totalAmount) {
      throw new Error(
        `Insufficient tDust balance (${balance}) to pay bonuses (${totalAmount})`,
      );
    }

    const txs = [];
    for (const player of players) {
      console.log(
        `Sending bonus tDust to player ${player.playerId} at address ${player.address}`,
      );
      const tx = await sendNativeToken(
        client.wallet,
        player.address,
        bonusDustAmount,
      );

      txs.push(tx);
    }

    return context.json({
      ok: true,
      results: txs,
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
