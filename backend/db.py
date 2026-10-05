import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


# 阵风滤波闸全局唯一设置行（id 固定为 1）。
DEFAULT_WINDOW = 5
DEFAULT_MULTIPLIER = 3.0

SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS gust_filter_settings (
    id smallint PRIMARY KEY DEFAULT 1,
    enabled boolean NOT NULL DEFAULT false,
    window_size int NOT NULL DEFAULT 5,
    median_multiplier double precision NOT NULL DEFAULT 3.0,
    updated_by text,
    updated_at timestamptz NOT NULL,
    CONSTRAINT gust_filter_singleton CHECK (id = 1),
    CONSTRAINT gust_filter_window_range CHECK (window_size BETWEEN 3 AND 51),
    CONSTRAINT gust_filter_window_odd CHECK (window_size % 2 = 1),
    CONSTRAINT gust_filter_mult_pos CHECK (median_multiplier > 0 AND median_multiplier <= 20)
);

INSERT INTO gust_filter_settings (id, enabled, window_size, median_multiplier, updated_at)
VALUES (1, false, 5, 3.0, now())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS gust_filter_rejections (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    window_size int NOT NULL,
    median_multiplier double precision NOT NULL,
    window_median double precision,
    window_mad double precision,
    deviation double precision,
    threshold double precision,
    reason text NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gust_rejections_created
    ON gust_filter_rejections (id DESC);
"""
