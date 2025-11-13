import { Contract as ManagedContract } from "./managed/contract/index.cjs";
import {
  deployContract as internalDeployContract,
  findDeployedContract,
  type DeployContractOptionsWithPrivateState,
} from "@midnight-ntwrk/midnight-js-contracts";

import type {
  Contract,
  InitialStateParams,
  MidnightClient,
  PrivateState,
  Providers,
} from "./types";
import { witnesses } from "./witnesses";
import type { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { readFile, rotateWriteFile } from "@accountun/common";

import path from "node:path";
import { PrivateStateKey } from "./constants";

/**
 * Creates a new contract instance.
 * @returns The newly created contract instance.
 */
export function createContract(): Contract {
  return new ManagedContract<PrivateState>(witnesses);
}

/**
 * Utility wrapper to deploy the tournament accounting contract
 * @param secretKey the secret key to use when initializing the contract
 * @param contract the contract instance to deploy
 * @param providers the providers to use when deploying the contract
 * @param state the initial private state to use when deploying the contract
 * @returns The deployed contract instance
 */
export async function deployContract(
  secretKey: Uint8Array,
  contract: Contract,
  providers: Providers,
  state: PrivateState,
) {
  const args: InitialStateParams = [secretKey];
  const options: DeployContractOptionsWithPrivateState<Contract> = {
    privateStateId: PrivateStateKey,
    contract,
    initialPrivateState: state,
    args,
  };

  return await internalDeployContract<Contract>(providers, options);
}

/**
 * Utility wrapper to find and return a deployed contract instance by a known address
 * @param contractAddress The address of the deployed contract to find
 * @param contract The contract instance to use when finding the associated deployed contract
 * @param providers The providers to use when finding the deployed contract
 * @returns The found deployed contract instance
 */
export async function joinKnownContract(
  contractAddress: ContractAddress,
  contract: Contract,
  providers: Providers,
) {
  return await findDeployedContract<Contract>(providers, {
    contractAddress,
    contract,
    privateStateId: PrivateStateKey,
  });
}

/**
 * Utility wrapper to find and return a deployed contract instance using the saved address in the state directory
 * @param context The Midnight client context containing configuration, contract, and providers
 * @param options Optional parameters including an override address
 * @returns The joined deployed contract instance
 */
export async function joinContract(
  context: MidnightClient,
  options?: { address?: string },
) {
  const address =
    options?.address ??
    (await loadAddress(context.config.cacheDir, context.config.network));

  console.log("Joining contract at address:", address);
  return await joinKnownContract(address, context.contract, context.providers);
}

/**
 * Saves the contract address to a file in the state directory
 * @param cacheDir The state directory to save the address file in
 * @param network The network name to use in the address file name
 * @param address The contract address to save
 */
export async function saveAddress(
  cacheDir: string,
  network: string,
  address: string,
) {
  await rotateWriteFile(
    path.join(cacheDir, `${network}-contract-address.json`),
    JSON.stringify(
      {
        address,
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

/**
 * Loads the contract address from a file in the state directory
 * @param cacheDir The state directory to load the address file from
 * @param network The network name to use in the address file name
 * @returns The contract address loaded from the address file
 */
export async function loadAddress(cacheDir: string, network: string) {
  const addressFile = path.join(cacheDir, `${network}-contract-address.json`);
  const data = await readFile(addressFile);
  const parsed = JSON.parse(data);
  if (!parsed.address || typeof parsed.address !== "string") {
    throw new Error(`Invalid contract address file: ${addressFile}`);
  }
  return parsed.address as string;
}

/**
 * Utility function to fetch the private state of the tournament contract from the private state provider
 * @param providers The providers to use to fetch the private state
 * @returns The private state if it exists, otherwise null
 */
export async function getPrivateState(
  providers: Providers,
): Promise<PrivateState | null> {
  return await providers.privateStateProvider.get(PrivateStateKey);
}
