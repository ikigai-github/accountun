import typia, { tags } from "typia";

export type U64String = string & tags.Pattern<"^[0-9]+$">;
export type Hex16OrUUID = string &
  tags.Pattern<"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F-]{36})$">;

export type CurrencyEntryInput = {
  timestamp: U64String; // seconds since epoch in string form
  entityId: Hex16OrUUID;
  amount: U64String;
};

export type FundingRequest = {
  entries: CurrencyEntryInput[] & tags.MinItems<1>;
};

export type ReceiptsRequest = {
  entries: CurrencyEntryInput[] & tags.MinItems<1>;
};

export type ResultsRequest = {
  placements: string[] & tags.MinItems<1> & tags.MaxItems<16>;
};

export type RegisterRequest = {
  id: string;
  cash?: string;
};

export const assertFunding = typia.createAssert<FundingRequest>();
export const assertReceipts = typia.createAssert<ReceiptsRequest>();
export const assertResults = typia.createAssert<ResultsRequest>();
export const assertRegister = typia.createAssert<RegisterRequest>();
