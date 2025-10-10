import {
  numberToHex,
  bytes32FromHex,
  hexToBytes,
  readFile,
  uuidBytes,
} from "@accountun/common";
import type { AccountKindType, CurrencyEntry } from "@accountun/contract";
import Papa from "papaparse";

/**
 * A row in the CSV file representing a currency entry for a player
 */
type CsvRow = {
  id: Uint8Array;
  amount?: bigint;
  salt?: Uint8Array;
};

/**
 * Reads a CSV file and parses it into an array of CsvRow objects
 * @param csvPath the path to the CSV file to read
 * @returns a promise that resolves to an array of CsvRow objects
 */
async function readCsv(csvPath: string): Promise<CsvRow[]> {
  const csvContent = await readFile(csvPath);
  const parseConfig = {
    header: false,
    skipEmptyLines: true,
    transform: (value: string, column: string) => {
      switch (column) {
        case "id":
          return uuidBytes(value);
        case "amount":
          return BigInt(value);
        case "salt":
          return bytes32FromHex(value);
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
  timestampSeconds = Date.now() / 1000,
): Promise<CurrencyEntry[]> {
  const rows = await readCsv(csvPath);
  const timestampBytes = hexToBytes(numberToHex(timestampSeconds, 8));

  const entries: CurrencyEntry[] = [];
  for (const row of rows) {
    if (row.amount === undefined) {
      throw new Error(
        `Missing amount for player ${Buffer.from(row.id).toString("hex")}`,
      );
    }

    if (row.salt === undefined) {
      throw new Error(
        `Missing salt for player ${Buffer.from(row.id).toString("hex")}`,
      );
    }

    entries.push({
      entityId: row.id,
      timestamp: timestampBytes,
      amount: row.amount,
      salt: row.salt,
      kind,
    });
  }

  return entries;
}
