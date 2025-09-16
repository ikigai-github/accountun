// packages/cli/clients.ts (or keep inside your CLI file)
import { startServiceWallet, saveServiceWallet } from "./wallet";
import { witnesses, type PrivateState } from "@accountun/contract/witnesses";
import ContractClient from "@accountun/contract/managed/contract/index.cjs";
import { CONFIG } from "./config";
import { bytes32FromHex } from "@accountun/common";

export async function loadClient() {
  // const wallet = await startServiceWallet();
  // const secretKey = bytes32FromHex(CONFIG.AUTH_SECRET_HEX);
  // const contract = new ContractClient({ witnesses });
  // return {
  //   contract,
  //   wallet,
  //   witnesses,
  //   save: () => saveServiceWallet(wallet),
  // };
}
