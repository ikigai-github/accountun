import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

// Primitives
export const U64StringShape = Type.String({ pattern: "^[0-9]+$" });
export const Hex16OrUUIDShape = Type.String({
  pattern: "^(?:[0-9a-fA-F]{32}|[0-9a-fA-F-]{36})$",
});

// Schemas
export const CurrencyEntryShape = Type.Object({
  timestamp: U64StringShape, // seconds since epoch in string form
  entityId: Hex16OrUUIDShape, // UUID or 32-hex (Bytes<16>)
  amount: U64StringShape,
});

export const FundingRequestShape = Type.Object({
  entries: Type.Array(CurrencyEntryShape, { minItems: 1 }),
});

export const ReceiptsRequestShape = Type.Object({
  entries: Type.Array(CurrencyEntryShape, { minItems: 1 }),
});

export const ResultsRequestShape = Type.Object({
  placements: Type.Array(Type.String(), { minItems: 1, maxItems: 16 }),
});

export const RegisterRequestShape = Type.Object({
  id: Type.String(),
  cash: Type.Optional(Type.String()),
});

export type CurrencyEntry = Static<typeof CurrencyEntryShape>;
export type FundingRequest = Static<typeof FundingRequestShape>;
export type ReceiptsRequest = Static<typeof ReceiptsRequestShape>;
export type ResultsRequest = Static<typeof ResultsRequestShape>;
export type RegisterRequest = Static<typeof RegisterRequestShape>;

const FundingRequestCompiled = TypeCompiler.Compile(FundingRequestShape);
const ReceiptsRequestCompiled = TypeCompiler.Compile(ReceiptsRequestShape);
const ResultsRequestCompiled = TypeCompiler.Compile(ResultsRequestShape);
const RegisterRequestCompiled = TypeCompiler.Compile(RegisterRequestShape);

function assert<T>(
  check: ReturnType<typeof TypeCompiler.Compile>,
  data: unknown,
  what: string
): T {
  if (!check.Check(data)) {
    const first = check.Errors(data).First();
    const msg = first
      ? `${what} ${first.path} ${first.message}`
      : `Invalid ${what}`;
    throw new Error(msg);
  }
  return data as T;
}

export const assertFunding = (d: unknown) =>
  assert<FundingRequest>(FundingRequestCompiled, d, "FundingRequest:");
export const assertReceipts = (d: unknown) =>
  assert<ReceiptsRequest>(ReceiptsRequestCompiled, d, "ReceiptsRequest:");
export const assertResults = (d: unknown) =>
  assert<ResultsRequest>(ResultsRequestCompiled, d, "ResultsRequest:");
export const assertRegister = (d: unknown) =>
  assert<RegisterRequest>(RegisterRequestCompiled, d, "RegisterRequest:");
