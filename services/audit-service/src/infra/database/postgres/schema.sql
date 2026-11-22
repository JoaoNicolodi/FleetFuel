-- Banco EXCLUSIVO do Serviço C (database-per-service).

CREATE TABLE IF NOT EXISTS ledger_entries (
  sequence       BIGINT PRIMARY KEY,
  event_id       TEXT        NOT NULL UNIQUE,   -- deduplicação (entrega at-least-once)
  event_type     TEXT        NOT NULL,
  source         TEXT        NOT NULL,
  aggregate_id   TEXT        NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL,
  payload        JSONB       NOT NULL,
  previous_hash  CHAR(64)    NOT NULL,
  hash           CHAR(64)    NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ledger_aggregate_idx ON ledger_entries (aggregate_id, sequence DESC);
CREATE INDEX IF NOT EXISTS ledger_type_idx ON ledger_entries (event_type, sequence DESC);

-- Imutabilidade garantida pelo próprio banco: UPDATE/DELETE são proibidos.
CREATE OR REPLACE FUNCTION ledger_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries é append-only: % não permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_no_update ON ledger_entries;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_block_mutation();

DROP TRIGGER IF EXISTS ledger_no_truncate ON ledger_entries;
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_block_mutation();

-- Read model para relatórios (pode ser reconstruído a partir do ledger a qualquer momento).
CREATE TABLE IF NOT EXISTS refuel_facts (
  refuel_id       TEXT PRIMARY KEY,
  vehicle_id      TEXT    NOT NULL,
  plate           TEXT    NOT NULL,
  department      TEXT    NOT NULL,
  month           CHAR(7) NOT NULL,
  status          TEXT    NOT NULL,
  liters          NUMERIC(10,3) NOT NULL,
  total_cents     BIGINT  NOT NULL,
  distance_km     INTEGER NULL,
  offline         BOOLEAN NOT NULL,
  rejection_code  TEXT    NULL
);
CREATE INDEX IF NOT EXISTS refuel_facts_month_idx ON refuel_facts (month);
