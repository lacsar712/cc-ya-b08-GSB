import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)

# 窗内中位数接近 0 时，倍数×|中位| 会退化成 0、把任何噪声都判成阵风，
# 因此容差带在 0 附近给一个保底宽度（度），可用环境变量覆盖。
DEFAULT_FLOOR_DEG = float(os.environ.get("GUST_FLOOR_DEG", "0.5"))
DEFAULT_WINDOW_SIZE = 5
DEFAULT_MEDIAN_MULTIPLIER = 0.5


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


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

-- 阵风滤波闸的单行配置（id 恒为 1）。enabled 为开闸/关闸总开关，
-- window_size 为取中位的滑窗条数，median_multiplier 为中位倍数。
CREATE TABLE IF NOT EXISTS gust_filter_settings (
    id smallint PRIMARY KEY DEFAULT 1,
    enabled boolean NOT NULL DEFAULT false,
    window_size integer NOT NULL DEFAULT 5,
    median_multiplier double precision NOT NULL DEFAULT 0.5,
    floor_deg double precision NOT NULL DEFAULT 0.5,
    updated_by text NOT NULL DEFAULT 'system',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gust_filter_settings_singleton CHECK (id = 1)
);

INSERT INTO gust_filter_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 被阵风闸拒收的读数全部落这张「过滤流水」，供专页审计；
-- 被放行（进入待处理队列）的读数不写本表。
CREATE TABLE IF NOT EXISTS gust_filter_events (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    window_median_deg double precision,
    deviation_deg double precision,
    tolerance_deg double precision,
    window_size integer NOT NULL,
    median_multiplier double precision NOT NULL,
    submitted_by text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gust_filter_events_created
    ON gust_filter_events (id DESC);
"""
