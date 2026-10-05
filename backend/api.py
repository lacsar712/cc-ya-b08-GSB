import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import DEFAULT_MULTIPLIER, DEFAULT_WINDOW, SCHEMA, connect
from rules import evaluate_gust, judge, normalize_multiplier, normalize_window

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

# 阵风滤波闸临界串行锁：保证「取窗口 → 判定 → 入队/拒收」原子，
# 临界附近两笔同时到达时至多一笔进入队列。
GUST_LOCK_KEY = 735701

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, 'done', %s, %s, %s, %s, %s)""",
            (code, err, verdict, reason, "technician", now, now),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可执行此操作，观察员只读"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


def settings_dict(row):
    return {
        "enabled": row["enabled"],
        "window_size": row["window_size"],
        "median_multiplier": row["median_multiplier"],
        "updated_by": row["updated_by"],
        "updated_at": row["updated_at"],
    }


def get_settings(conn):
    return conn.execute(
        """SELECT enabled, window_size, median_multiplier, updated_by, updated_at
           FROM gust_filter_settings WHERE id = 1"""
    ).fetchone()


def fetch_window(conn, need):
    rows = conn.execute(
        """SELECT yaw_err_deg FROM yaw_logs
           ORDER BY id DESC LIMIT %s""",
        (need,),
    ).fetchall()
    return [float(r["yaw_err_deg"]) for r in rows]


def record_rejection(conn, *, turbine_code, yaw_err_deg, settings, result, username, now):
    conn.execute(
        """INSERT INTO gust_filter_rejections
           (turbine_code, yaw_err_deg, window_size, median_multiplier,
            window_median, window_mad, deviation, threshold, reason,
            created_by, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            turbine_code,
            yaw_err_deg,
            settings["window_size"],
            float(settings["median_multiplier"]),
            result["median"],
            result["mad"],
            result["deviation"],
            result["threshold"],
            result["reason"],
            username,
            now,
        ),
    )


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, status, verdict, reason,
                          created_by, created_at, processed_at
                   FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            with conn.transaction():
                # 与专页试算指示灯共用同一把锁、同一个 evaluate_gust，
                # 保证写口与指示灯同口径。
                conn.execute(
                    "SELECT pg_advisory_xact_lock(%s)", (GUST_LOCK_KEY,)
                )
                settings = get_settings(conn)
                if settings["enabled"]:
                    window_values = fetch_window(
                        conn, settings["window_size"] - 1
                    )
                    result = evaluate_gust(
                        yaw_err_deg,
                        window_values,
                        settings["window_size"],
                        float(settings["median_multiplier"]),
                    )
                    if not result["accepted"]:
                        record_rejection(
                            conn,
                            turbine_code=turbine_code,
                            yaw_err_deg=yaw_err_deg,
                            settings=settings,
                            result=result,
                            username=user["username"],
                            now=now,
                        )
                        return {
                            "outcome": "rejected",
                            "detail": result["reason"],
                            "filter": {
                                "window_size": settings["window_size"],
                                "median_multiplier": float(
                                    settings["median_multiplier"]
                                ),
                                "window_median": result["median"],
                                "window_mad": result["mad"],
                                "deviation": result["deviation"],
                                "threshold": result["threshold"],
                                "sample_count": len(window_values),
                            },
                        }

                row = conn.execute(
                    """INSERT INTO yaw_logs
                       (turbine_code, yaw_err_deg, status, verdict, reason,
                        created_by, created_at)
                       VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                       RETURNING id, turbine_code, yaw_err_deg, status, verdict,
                                 reason, created_by, created_at, processed_at""",
                    (turbine_code, yaw_err_deg, user["username"], now),
                ).fetchone()
                return {"outcome": "accepted", "row": row}

    payload = await run_db(insert)
    if payload["outcome"] == "rejected":
        return jsonify(payload), 422
    return jsonify(payload["row"]), 201


@app.get("/api/gust-filter")
@require_login
async def gust_filter_settings(user):
    def query():
        with connect() as conn:
            return get_settings(conn)

    row = await run_db(query)
    return jsonify(settings_dict(row))


@app.put("/api/gust-filter")
@require_writer
async def update_gust_filter(user):
    body = await request.get_json(force=True, silent=True) or {}
    enabled = bool(body.get("enabled"))
    try:
        window_size = normalize_window(body.get("window_size"))
        multiplier = normalize_multiplier(body.get("median_multiplier"))
    except ValueError as exc:
        return jsonify({"detail": str(exc)}), 400

    now = datetime.now(timezone.utc)

    def update():
        with connect() as conn:
            with conn.transaction():
                # 与写口同锁串行：配置切换不会与正在判定的提交互相穿插。
                conn.execute(
                    "SELECT pg_advisory_xact_lock(%s)", (GUST_LOCK_KEY,)
                )
                conn.execute(
                    """INSERT INTO gust_filter_settings
                       (id, enabled, window_size, median_multiplier,
                        updated_by, updated_at)
                       VALUES (1, %s, %s, %s, %s, %s)
                       ON CONFLICT (id) DO UPDATE SET
                           enabled = EXCLUDED.enabled,
                           window_size = EXCLUDED.window_size,
                           median_multiplier = EXCLUDED.median_multiplier,
                           updated_by = EXCLUDED.updated_by,
                           updated_at = EXCLUDED.updated_at
                       RETURNING enabled, window_size, median_multiplier,
                                 updated_by, updated_at""",
                    (enabled, window_size, multiplier, user["username"], now),
                )
                row = get_settings(conn)
            return row

    row = await run_db(update)
    return jsonify(settings_dict(row))


@app.get("/api/gust-filter/rejections")
@require_login
async def list_rejections(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, window_size,
                          median_multiplier, window_median, window_mad,
                          deviation, threshold, reason, created_by, created_at
                   FROM gust_filter_rejections
                   ORDER BY id DESC LIMIT 200"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/gust-filter/preview")
@require_login
async def preview_gust_filter(user):
    """专页指示灯试算：服务端取窗、服务端算中位/MAD，前端只亮灯。

    与写口共用 evaluate_gust 与同一把咨询锁，保证「灯亮拦截」时
    写口也必然拦截（同口径）。
    """
    body = await request.get_json(force=True, silent=True) or {}
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    def preview():
        with connect() as conn:
            with conn.transaction():
                conn.execute(
                    "SELECT pg_advisory_xact_lock(%s)", (GUST_LOCK_KEY,)
                )
                settings = get_settings(conn)
                window_values = fetch_window(
                    conn, settings["window_size"] - 1
                )
                result = evaluate_gust(
                    yaw_err_deg,
                    window_values,
                    settings["window_size"],
                    float(settings["median_multiplier"]),
                )
                return settings_dict(settings), result, len(window_values)

    settings, result, sample_count = await run_db(preview)
    return jsonify(
        {
            "settings": settings,
            "sample_count": sample_count,
            "evaluation": {
                "accepted": result["accepted"],
                "insufficient": result["insufficient"],
                "window_median": result["median"],
                "window_mad": result["mad"],
                "deviation": result["deviation"],
                "threshold": result["threshold"],
                "reason": result["reason"],
            },
        }
    )
