import type { DustReconcileRequest } from "../../../wallet-dust";

const TARGET_DUST_ADDRESS =
  "mn_dust_undeployed1w0396rjqywasjktk02cj93k950a2rww3t3a492xhdh95s3r5h9gyy4gpzyv";
const TARGET_DUST_ADDRESS_2 =
  "mn_dust_undeployed1w0396rjqywasjktk02cj93k950a2rww3t3a492xhdh95s3r5h9gyy4gpzyv";

export type DustAllocationFixture = {
  requests: DustReconcileRequest[];
};

export function createDustAllocationFixture(): DustAllocationFixture {
  return {
    requests: [
      {
        dustAddress: TARGET_DUST_ADDRESS,
        targetSpecks: 1_000n,
      },
      {
        dustAddress: TARGET_DUST_ADDRESS_2,
        targetSpecks: 2_000n,
      },
    ],
  };
}
