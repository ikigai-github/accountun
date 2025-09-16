CREATE TABLE gauntlet_sponsor_contribution (
  id                 UUID PRIMARY KEY,
  gauntlet_id        UUID NOT NULL REFERENCES gauntlet(id) ON DELETE CASCADE,
  sponsor_id         UUID REFERENCES sponsor(id),
  sponsor_hash       BYTEA NOT NULL CHECK (octet_length(sponsor_hash) = 32),
  sponsor_salt       BYTEA, 
  leaf_hash          BYTEA NOT NULL CHECK (octet_length(leaf_hash) = 32),
  meta               JSONB,
  kind               TEXT NOT NULL CHECK (kind IN ('cash','item')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gauntlet_sponsor_contribution_cash (
  id            UUID PRIMARY KEY REFERENCES gauntlet_sponsor_contribution(id) ON DELETE CASCADE,
  amount        BIGINT NOT NULL CHECK (amount >= 0),
  amount_salt   BYTEA  NOT NULL,
  amount_commit BYTEA  NOT NULL UNIQUE, 
  currency      TEXT   NOT NULL
);

CREATE TABLE gauntlet_sponsor_contribution_item (
  id          UUID PRIMARY KEY REFERENCES gauntlet_sponsor_contribution(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,     
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  fingerprint TEXT            
);

CREATE TABLE gauntlet_entitlement (
  id                   UUID PRIMARY KEY, 
  gauntlet_id          UUID NOT NULL REFERENCES gauntlet(id) ON DELETE CASCADE,
  recipient_hash       BYTEA NOT NULL CHECK (octet_length(recipient_hash) = 32),
  recipient_salt       BYTEA,    
  kind                 TEXT NOT NULL CHECK (kind IN ('cash','item')),
  rule_tag             TEXT,  
  leaf_hash            BYTEA NOT NULL CHECK (octet_length(leaf_hash) = 32), 
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gauntlet_entitlement_cash (
  id            UUID PRIMARY KEY REFERENCES gauntlet_payout_plan(id) ON DELETE CASCADE,
  amount        BIGINT NOT NULL CHECK (amount >= 0),
  amount_salt   BYTEA  NOT NULL,
  amount_commit BYTEA  NOT NULL UNIQUE,  
  currency      TEXT   NOT NULL
);

CREATE TABLE gauntlet_entitlement_item (
  id          UUID PRIMARY KEY REFERENCES gauntlet_payout_plan(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,   
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  fingerprint TEXT                         
);


CREATE TABLE gauntlet_tree_snapshot (
  id             BIGSERIAL PRIMARY KEY,
  gauntlet_id    UUID NOT NULL REFERENCES gauntlet(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('FUNDING','PLAN','RECEIPTS')),
  root           BYTEA NOT NULL CHECK (octet_length(root) = 32),
  leaf_count     INTEGER NOT NULL CHECK (leaf_count >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  chain_tx_hash  TEXT,
  chain_block_no BIGINT,
  UNIQUE (gauntlet_id, kind, root)
);

CREATE TABLE gauntlet_tree_leaf (
  snapshot_id  BIGINT NOT NULL REFERENCES gauntlet_tree_snapshot(id) ON DELETE CASCADE,
  leaf_index   INTEGER NOT NULL,      
  leaf_hash    BYTEA NOT NULL CHECK (octet_length(leaf_hash) = 32),
  PRIMARY KEY (snapshot_id, leaf_index),
  
  UNIQUE (snapshot_id, leaf_hash)                          
);