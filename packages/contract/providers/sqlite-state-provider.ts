import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as superjson from "superjson";

import type {
  MidnightConfig,
  PrivateStateId,
  PrivateState,
  NetworkName,
} from "../types";
import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import type {
  ContractAddress,
  SigningKey,
} from "@midnight-ntwrk/compact-runtime";

const PENDING = "__pending__";

function promotePendingTo(
  db: Database,
  network: NetworkName,
  currentAddress: string | undefined,
  nextAddress: string,
) {
  if (currentAddress === nextAddress) return;
  if (currentAddress === PENDING) {
    db.run(
      `UPDATE private_state SET contract=?1 WHERE network=?2 AND contract=?3`,
      [nextAddress, network, PENDING],
    );
    db.run(
      `UPDATE private_keys SET contract=?1 WHERE network=?2 AND contract=?3`,
      [nextAddress, network, PENDING],
    );
  }
}

export function createSqlitePrivateStateProvider(
  config: MidnightConfig,
): PrivateStateProvider<PrivateStateId, PrivateState> & { close: () => void } {
  const file = path.join(config.cacheDir, "midnight_private_state.sqlite3");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file, { create: true });
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA synchronous=NORMAL;");

  db.run(`
    CREATE TABLE IF NOT EXISTS private_state (
      network  TEXT NOT NULL,
      contract TEXT NOT NULL,
      id       TEXT NOT NULL,
      state    TEXT NOT NULL, 
      PRIMARY KEY (network, contract, id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS private_keys (
      network  TEXT NOT NULL,
      contract TEXT NOT NULL,
      address  TEXT NOT NULL,
      skey     TEXT NOT NULL,
      PRIMARY KEY (network, contract, address)
    );
  `);

  let currentAddress = PENDING;

  const setState = db.query(
    `INSERT INTO private_state (network, contract, id, state)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(network, contract, id) DO UPDATE SET state=excluded.state`,
  );

  const getState = db.query(
    `SELECT state FROM private_state WHERE network=?1 AND contract=?2 AND id=?3`,
  );

  const removeState = db.query(
    `DELETE FROM private_state WHERE network=?1 AND contract=?2 AND id=?3`,
  );

  const clearState = db.query(
    `DELETE FROM private_state WHERE network=?1 AND contract=?2`,
  );

  const setKey = db.query(
    `INSERT INTO private_keys (network, contract, address, skey)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(network, contract, address) DO UPDATE SET skey=excluded.skey`,
  );

  const getKey = db.query(
    `SELECT skey FROM private_keys WHERE network=?1 AND contract=?2 AND address=?3`,
  );

  const removeKey = db.query(
    `DELETE FROM private_keys WHERE network=?1 AND contract=?2 AND address=?3`,
  );

  const clearKeys = db.query(
    `DELETE FROM private_keys WHERE network=?1 AND contract=?2`,
  );

  const provider: PrivateStateProvider<PrivateStateId, PrivateState> & {
    close: () => void;
  } = {
    async set(id, state) {
      setState.run(
        config.network,
        currentAddress,
        id,
        superjson.stringify(state),
      );
    },

    async get(id) {
      const row = getState.get(config.network, currentAddress, id) as
        | { state?: string }
        | undefined;
      return row?.state ? (superjson.parse(row.state) as PrivateState) : null;
    },

    async remove(id) {
      removeState.run(config.network, currentAddress, id);
    },

    async clear() {
      clearState.run(config.network, currentAddress);
    },

    async setSigningKey(address: ContractAddress, signingKey: SigningKey) {
      promotePendingTo(db, config.network, currentAddress, address);
      currentAddress = address;
      setKey.run(config.network, currentAddress, address, signingKey);
    },

    async getSigningKey(address: ContractAddress) {
      const row = getKey.get(config.network, currentAddress, address) as
        | { skey?: string }
        | undefined;
      if (row?.skey != null) {
        currentAddress = address;
        return row.skey;
      }
      return null;
    },

    async removeSigningKey(address: ContractAddress) {
      removeKey.run(config.network, currentAddress, address);
      if (currentAddress === address) currentAddress = PENDING;
    },

    async clearSigningKeys() {
      clearKeys.run(config.network, currentAddress);
      currentAddress = PENDING;
    },

    close() {
      db.close();
    },
  };

  return provider;
}
