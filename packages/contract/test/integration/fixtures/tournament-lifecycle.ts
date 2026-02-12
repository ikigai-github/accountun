import type { RawCurrencyEntry } from "../../../types";

const TOURNAMENT_ID = "11111111-1111-4111-8111-111111111111";
const FUNDING_ENTITY_ID = "22222222-2222-4222-8222-222222222222";
const PLAYER_ONE_ID = "33333333-3333-4333-8333-333333333333";
const PLAYER_TWO_ID = "44444444-4444-4444-8444-444444444444";

export type TournamentLifecycleFixture = {
  tournamentId: string;
  cashAssetName: string;
  results: [string, string];
  funding: RawCurrencyEntry;
  payouts: [RawCurrencyEntry, RawCurrencyEntry];
  receipts: [RawCurrencyEntry, RawCurrencyEntry];
};

export function createTournamentLifecycleFixture(): TournamentLifecycleFixture {
  const t0 = Math.floor(Date.now() / 1000);

  return {
    tournamentId: TOURNAMENT_ID,
    cashAssetName: "usd",
    results: [PLAYER_ONE_ID, PLAYER_TWO_ID],
    funding: {
      timestamp: String(t0),
      entityId: FUNDING_ENTITY_ID,
      amount: "1000",
    },
    payouts: [
      {
        timestamp: String(t0 + 1),
        entityId: PLAYER_ONE_ID,
        amount: "600",
      },
      {
        timestamp: String(t0 + 1),
        entityId: PLAYER_TWO_ID,
        amount: "400",
      },
    ],
    receipts: [
      {
        timestamp: String(t0 + 2),
        entityId: PLAYER_ONE_ID,
        amount: "600",
      },
      {
        timestamp: String(t0 + 2),
        entityId: PLAYER_TWO_ID,
        amount: "400",
      },
    ],
  };
}
