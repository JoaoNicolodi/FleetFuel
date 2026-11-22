-- Banco EXCLUSIVO do Serviço A (database-per-service). Nenhum outro serviço acessa.

CREATE TABLE IF NOT EXISTS vehicles (
  id                     UUID PRIMARY KEY,
  plate                  VARCHAR(7)  NOT NULL UNIQUE,
  model                  TEXT        NOT NULL,
  department             TEXT        NOT NULL,
  fuel_type              VARCHAR(10) NOT NULL CHECK (fuel_type IN ('GASOLINA', 'ETANOL', 'DIESEL')),
  expected_km_per_liter  NUMERIC(5,2) NOT NULL,
  last_odometer_km       INTEGER     NULL CHECK (last_odometer_km >= 0),
  active                 BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monthly_quotas (
  id          UUID PRIMARY KEY,
  vehicle_id  UUID       NOT NULL REFERENCES vehicles(id),
  month       CHAR(7)    NOT NULL,           -- YYYY-MM
  limit_ml    BIGINT     NOT NULL CHECK (limit_ml > 0),
  used_ml     BIGINT     NOT NULL DEFAULT 0,
  version     INTEGER    NOT NULL DEFAULT 0,
  UNIQUE (vehicle_id, month),
  -- Última linha de defesa: mesmo que um bug passe pelo domínio, o banco recusa saldo negativo.
  CONSTRAINT quota_not_exceeded CHECK (used_ml >= 0 AND used_ml <= limit_ml)
);

CREATE TABLE IF NOT EXISTS refuels (
  id                     UUID PRIMARY KEY,
  client_id              UUID        NOT NULL UNIQUE,  -- chave de idempotência do app offline
  vehicle_id             UUID        NOT NULL REFERENCES vehicles(id),
  plate                  VARCHAR(7)  NOT NULL,
  driver_name            TEXT        NOT NULL,
  station_name           TEXT        NOT NULL,
  month                  CHAR(7)     NOT NULL,
  liters_ml              BIGINT      NOT NULL,
  odometer_km            INTEGER     NOT NULL,
  price_per_liter_cents  INTEGER     NOT NULL,
  total_cents            BIGINT      NOT NULL,
  occurred_at            TIMESTAMPTZ NOT NULL,
  received_at            TIMESTAMPTZ NOT NULL,
  offline                BOOLEAN     NOT NULL,
  photo_key              TEXT        NOT NULL,
  lat                    DOUBLE PRECISION NULL,
  lng                    DOUBLE PRECISION NULL,
  status                 VARCHAR(10) NOT NULL CHECK (status IN ('ACCEPTED', 'FLAGGED', 'REJECTED')),
  distance_km            INTEGER     NULL,
  km_per_liter           NUMERIC(7,2) NULL,
  review_reason          TEXT        NULL,
  rejection_code         TEXT        NULL,
  quota_remaining_ml     BIGINT      NULL
);
CREATE INDEX IF NOT EXISTS refuels_vehicle_idx ON refuels (vehicle_id, received_at DESC);

-- Transactional Outbox
CREATE TABLE IF NOT EXISTS outbox (
  id            UUID PRIMARY KEY,
  type          TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  published_at  TIMESTAMPTZ NULL,
  attempts      INTEGER     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (created_at) WHERE published_at IS NULL;
