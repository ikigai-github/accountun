import { z } from "@hono/zod-openapi";

const U64String = z
  .string()
  .regex(/^[0-9]+$/, "Expected unsigned integer string")
  .openapi({
    description: "Unsigned integer (as string)",
  });

const CurrencyEntrySchema = z
  .object({
    timestamp: U64String,
    entityId: z.uuid(),
    amount: U64String,
  })
  .openapi("CurrencyEntry");

export const FundingRequestSchema = z
  .object({
    entries: z.array(CurrencyEntrySchema).min(1),
  })
  .openapi("FundingRequest");

export const ReceiptsRequestSchema = z
  .object({
    entries: z.array(CurrencyEntrySchema).min(1),
  })
  .openapi("ReceiptsRequest");

export const ResultsRequestSchema = z
  .object({
    placements: z.array(z.string()).min(1).max(16),
  })
  .openapi("ResultsRequest");

export const RegisterRequestSchema = z
  .object({
    id: z.string(),
    cash: z.string().optional(),
  })
  .openapi("RegisterRequest");

export const DustBonusPlayerSchema = z
  .object({
    playerId: z.uuid(),
    address: z.string(),
  })
  .openapi("DustBonusPlayer");

export const DustBonusRequestSchema = z
  .object({
    players: z.array(DustBonusPlayerSchema),
  })
  .openapi("DustBonusRequest");

export const DustBonusResultsSchema = z
  .object({
    ok: z.boolean(),
    results: z.array(z.string()),
  })
  .openapi("DustBonusResults");

// Params
export const TournamentIdParamSchema = z
  .object({
    id: z.uuid(),
  })
  .openapi("TournamentIdParam");

// Responses
export const HealthResponseSchema = z
  .object({ ok: z.boolean() })
  .openapi("HealthResponse");

export const TxRefSchema = z
  .object({ txHash: z.string(), txId: z.string() })
  .openapi("TxRef");

export const OkResultsSchema = z
  .object({
    ok: z.boolean(),
    results: z.array(TxRefSchema),
  })
  .openapi("OkResults");
