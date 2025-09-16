import { Contract } from "./managed/contract/index.cjs";
import { witnesses } from "./witnesses";

export * as Tournament from "./managed/contract/index.cjs";

export function createContract() {
  return new Contract(witnesses);
}
