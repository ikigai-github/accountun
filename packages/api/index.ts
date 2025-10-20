import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bearerAuth } from "hono/bearer-auth";
import {
  assertRegister,
  assertFunding,
  assertResults,
  assertReceipts,
  type CurrencyEntryInput,
} from "./types";
import {
  initializeClient,
  withClient,
  joinContract,
  registerTournament,
  recordFunding,
  postResults,
  payoutReady,
  recordReceipt,
  completeTournament,
  cancelTournament,
} from "@accountun/contract";

const app = new Hono();

app.use("*", bearerAuth({ token: process.env.WRITER_BEARER ?? "" }));
app.get("/health", (c) => c.json({ ok: true }));

// Register a tournament
app.post("/v1/tournaments", async (context) => {
  const body = await context.req.json();
  const { id, cash = "usd" } = assertRegister(body);

  return withClient(async (client) => {
    const deployed = await joinContract(client);
    const tx = await registerTournament(deployed, id, cash);
    return context.json({ txHash: tx.public.txHash, txId: tx.public.txId });
  });
});

// Record funding
app.post("/v1/tournaments/:id/funding", async (context) => {
  const id = context.req.param("id");
  const body = await context.req.json();
  const { entries } = assertFunding(body);

  return withClient(async (client) => {
    const deployed = await joinContract(client);
    const results: { txHash: string; txId: string }[] = [];
    for (const e of entries as CurrencyEntryInput[]) {
      const tx = await recordFunding(deployed, id, e);
      results.push({ txHash: tx.public.txHash, txId: tx.public.txId });
    }
    return context.json({ ok: true, results });
  });
});

// Post placements (results)
app.post("/v1/tournaments/:id/results", async (context) => {
  const id = context.req.param("id");
  const body = await context.req.json();
  const { placements } = assertResults(body);

  return withClient(async (client) => {
    const deployed = await joinContract(client);
    const tx = await postResults(deployed, id, placements);
    return context.json({ txHash: tx.public.txHash, txId: tx.public.txId });
  });
});

// Mark payout-ready
app.post("/v1/tournaments/:id/ready", async (context) => {
  const id = context.req.param("id");
  return withClient(async (client) => {
    const deployed = await joinContract(client);
    const tx = await payoutReady(deployed, id);
    return context.json({ txHash: tx.public.txHash, txId: tx.public.txId });
  });
});

// Record receipts
app.post("/v1/tournaments/:id/receipts", async (context) => {
  const id = context.req.param("id");
  const body = await context.req.json();
  const { entries } = assertReceipts(body);

  return withClient(async (client) => {
    const deployed = await joinContract(client);
    const results: { txHash: string; txId: string }[] = [];
    for (const e of entries as CurrencyEntryInput[]) {
      const tx = await recordReceipt(deployed, id, e);
      results.push({ txHash: tx.public.txHash, txId: tx.public.txId });
    }
    return context.json({ ok: true, results });
  });
});

// Complete tournament
app.post("/v1/tournaments/:id/complete", async (context) => {
  const id = context.req.param("id");
  return withClient(async (client) => {
    const deployed = await joinContract(client);
    const tx = await completeTournament(deployed, id);
    return context.json({ txHash: tx.public.txHash, txId: tx.public.txId });
  });
});

// Cancel tournament
app.post("/v1/tournaments/:id/cancel", async (context) => {
  const id = context.req.param("id");
  return withClient(async (client) => {
    const deployed = await joinContract(client);
    const tx = await cancelTournament(deployed, id);
    return context.json({ txHash: tx.public.txHash, txId: tx.public.txId });
  });
});

// Error handling
app.onError((err, context) => {
  console.error(err);
  if (err instanceof HTTPException) return err.getResponse();
  return context.json({ error: String((err as any)?.message ?? err) }, 500);
});

const port = Number(process.env.PORT || 8787);
export default { port };

console.log(`Accountun API listening on :${port}`);
Bun.serve({ fetch: app.fetch, port });
