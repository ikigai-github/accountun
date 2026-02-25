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

export const DustReconcileAllocationSchema = z
  .object({
    dustAddress: z.string(),
    targetSpecks: U64String,
  })
  .openapi("DustReconcileAllocation");

export const DustReconcileRequestSchema = z
  .object({
    requestId: z.string(),
    mainReservePercent: U64String,
    allocations: z.array(DustReconcileAllocationSchema).default([]),
    options: z
      .object({
        timeoutMs: z.number().int().positive().optional(),
        refreshBalances: z.boolean().optional(),
        targetWindowMs: z.number().int().positive().optional(),
        rebalanceTolerancePercent: U64String.optional(),
      })
      .optional(),
  })
  .openapi("DustReconcileRequest");

export const DustReconcileActionSchema = z
  .object({
    walletIndex: z.number().int(),
    op: z.enum(["assign", "rebalance", "register", "sweep", "noop"]),
    dustAddress: z.string().optional(),
    amountNight: U64String.optional(),
    reason: z.string().optional(),
  })
  .openapi("DustReconcileAction");

export const DustReconcileExecutionResultSchema = z
  .object({
    walletIndex: z.number().int(),
    op: z.enum(["assign", "rebalance", "register", "sweep", "noop"]),
    dustAddress: z.string().optional(),
    status: z.enum(["executed", "skipped", "failed"]),
    txId: z.string().optional(),
    reason: z.string().optional(),
  })
  .openapi("DustReconcileExecutionResult");

export const DustReconcileResponseSchema = z
  .object({
    requestId: z.string(),
    serviceDustAddress: z.string(),
    reservePercent: U64String,
    totalNight: U64String,
    mainMinNight: U64String,
    mainActualNight: U64String,
    requestedSpecks: U64String,
    allocatedSpecks: U64String,
    shortfallSpecks: U64String,
    actions: z.array(DustReconcileActionSchema),
    execution: z.object({
      requestId: z.string(),
      results: z.array(DustReconcileExecutionResultSchema),
    }),
    deallocated: z.array(
      z.object({ walletIndex: z.number().int(), sweptNight: U64String }),
    ),
  })
  .openapi("DustReconcileResponse");

export const DustRegisterRequestSchema = z
  .object({
    dustReceiverAddress: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .openapi("DustRegisterRequest");

export const DustRegisterResponseSchema = z
  .object({
    txId: z.string(),
    registeredCoins: z.number().int(),
  })
  .nullable()
  .openapi("DustRegisterResponse");

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
