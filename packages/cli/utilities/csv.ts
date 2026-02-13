import {
  bytes32FromHex,
  hexToBytes,
  readFile,
  uuidBytes,
  intToHex,
  blake2b32,
} from "@accountun/common";
import type {
  AccountKindType,
  CurrencyEntry,
  DustAllocationRequest,
} from "@accountun/contract";
import Papa from "papaparse";

/**
 * A row in the CSV file representing a currency entry for a player
 */
type CsvRow = {
  id: Uint8Array;
  amount?: bigint;
};

/**
 * Reads a CSV file and parses it into an array of CsvRow objects
 * @param csvPath the path to the CSV file to read
 * @returns a promise that resolves to an array of CsvRow objects
 */
async function readCsv(csvPath: string): Promise<CsvRow[]> {
  const csvContent = await readFile(csvPath);
  const parseConfig = {
    header: true,
    skipEmptyLines: true,
    transform: (value: string, column: string) => {
      switch (column) {
        case "id":
          return uuidBytes(value);
        case "amount":
          return BigInt(value);
        default:
          return value;
      }
    },
  };

  const results = Papa.parse<CsvRow>(csvContent, parseConfig);

  if (results.errors.length > 0) {
    throw new Error(
      `Error parsing CSV file ${csvPath}: ${results.errors
        .map((e) => e.message)
        .join(", ")}`,
    );
  }

  return results.data;
}

/**
 * Reads a CSV file and parses it into an array of player IDs
 * @param csvPath The path to the CSV file to read player ids from
 * @returns A promise that resolves to an array of player IDs as byte arrays
 */
export async function readPlayerIds(csvPath: string): Promise<Uint8Array[]> {
  const rows = await readCsv(csvPath);
  return rows.map((row) => row.id);
}

/**
 * Reads a CSV file and parses it into an array of currency entries
 * @param csvPath The path to the csv file to read entries from
 * @param kind The kind of currency entry to create
 * @param timestampSeconds The timestamp to associate with the currency entries
 * @returns A promise that resolves to an array of CurrencyEntry objects
 */
export async function readCurrencyEntries(
  csvPath: string,
  kind: AccountKindType,
  timestampSeconds = Math.floor(Date.now() / 1000),
): Promise<CurrencyEntry[]> {
  const rows = await readCsv(csvPath);
  const timestampBytes = hexToBytes(intToHex(timestampSeconds, 8));

  const entries: CurrencyEntry[] = [];
  for (const row of rows) {
    if (row.amount === undefined) {
      throw new Error(
        `Missing amount for player ${Buffer.from(row.id).toString("hex")}`,
      );
    }

    entries.push({
      entityId: row.id,
      timestamp: timestampBytes,
      amount: row.amount,
      kind,
    });
  }

  return entries;
}

type DustAllocationCsvRow = {
  dustAddress: string;
  targetDust: bigint;
  allocationId?: string;
};

export async function readDustAllocationRequests(
  csvPath: string,
): Promise<DustAllocationRequest[]> {
  const csvContent = await readFile(csvPath);
  const parseConfig = {
    header: true,
    skipEmptyLines: true,
    transform: (value: string, column: string) => {
      switch (column) {
        case "targetDust":
          return BigInt(value);
        case "allocationId":
          return value.trim() === "" ? undefined : value;
        default:
          return value;
      }
    },
  };

  const results = Papa.parse<DustAllocationCsvRow>(csvContent, parseConfig);
  if (results.errors.length > 0) {
    throw new Error(
      `Error parsing CSV file ${csvPath}: ${results.errors
        .map((e) => e.message)
        .join(", ")}`,
    );
  }

  return results.data.map((row, idx) => {
    if (!row.dustAddress || typeof row.dustAddress !== "string") {
      throw new Error(`Missing dustAddress at CSV row ${idx + 2}`);
    }
    if (row.targetDust === undefined) {
      throw new Error(`Missing targetDust at CSV row ${idx + 2}`);
    }

    return {
      dustAddress: row.dustAddress,
      targetDust: row.targetDust,
      allocationId: row.allocationId,
    };
  });
}
