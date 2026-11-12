-- migrate:up
CREATE TABLE IF NOT EXISTS health (id serial PRIMARY KEY, checked_at timestamptz NOT NULL DEFAULT now());

-- migrate:down
DROP TABLE IF EXISTS health;
