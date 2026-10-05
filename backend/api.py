import asyncio
import math
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from gust import evaluate, tolerance_band, window_median
from rules import judge

# 阵风闸临界区用的咨询锁键（pg_advisory_xact_lock 的单 bigint 实参），任选常量。
GUST_LOCK_KEY = 747823
MAX_WINDOW_SIZE = 200
MAX_MULTIPLIER = 100.0

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
            return jsonify({"detail": "仅现场技师可提交偏航记录"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


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
    if not math.isfinite(yaw_err_deg):
        return jsonify({"detail": "偏航误差必须是有限数字"}), 400

    now = datetime.now(timezone.utc)

    def gate_and_insert():
        """开闸则按统一口径判定；整个判定+入队+落流水在同一事务/同一把咨询锁内。

        临界附近两笔同时到达时，pg_advisory_xact_lock 让它们串行：先到者入队
        并把读数计入窗内中位，后到者看到的是更新后的中位，因此两笔极端突变
        至多一笔进入队列，另一笔被退回。
        """
        with connect() as conn:
            with conn.transaction():
                conn.execute("SELECT pg_advisory_xact_lock(%s)", (GUST_LOCK_KEY,))
                settings = conn.execute(
                    """SELECT enabled, window_size, median_multiplier, floor_deg
                       FROM gust_filter_settings WHERE id = 1"""
                ).fetchone()

                rejected = None
                verdict_row = None

                if settings["enabled"]:
                    window = conn.execute(
                        """SELECT yaw_err_deg FROM yaw_logs
                           ORDER BY id DESC LIMIT %s""",
                        (settings["window_size"],),
                    ).fetchall()
                    result = evaluate(
                        yaw_err_deg,
                        [r["yaw_err_deg"] for r in window],
                        window_size=settings["window_size"],
                        median_multiplier=settings["median_multiplier"],
                        floor_deg=settings["floor_deg"],
                    )
                    if not result["accepted"]:
                        conn.execute(
                            """INSERT INTO gust_filter_events
                               (turbine_code, yaw_err_deg, window_median_deg,
                                deviation_deg, tolerance_deg, window_size,
                                median_multiplier, submitted_by, reason, created_at)
                               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                            (
                                turbine_code,
                                yaw_err_deg,
                                result["median"],
                                result["deviation"],
                                result["tolerance"],
                                settings["window_size"],
                                settings["median_multiplier"],
                                user["username"],
                                result["reason"],
                                now,
                            ),
                        )
                        rejected = result
                    # 被拒收时不插入 yaw_logs：整单退回，读数不进入队列也不污染窗口。

                if rejected is None:
                    verdict_row = conn.execute(
                        """INSERT INTO yaw_logs
                           (turbine_code, yaw_err_deg, status, verdict, reason,
                            created_by, created_at)
                           VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                           RETURNING id, turbine_code, yaw_err_deg, status, verdict,
                                     reason, created_by, created_at, processed_at""",
                        (turbine_code, yaw_err_deg, user["username"], now),
                    ).fetchone()

                # 事务块干净退出时自动提交；不可在此显式 commit。
                return rejected, verdict_row

    rejected, row = await run_db(gate_and_insert)
    if rejected is not None:
        # 整单退回：不产生待处理记录，只在过滤流水留痕。
        return (
            jsonify(
                {
                    "detail": rejected["reason"],
                    "rejected": True,
                    "window_median_deg": rejected["median"],
                    "deviation_deg": rejected["deviation"],
                    "tolerance_deg": rejected["tolerance"],
                }
            ),
            422,
        )
    return jsonify(row), 201


@app.get("/api/gust-filter")
@require_login
async def get_gust_filter(user):
    """专页与顶栏指示灯的唯一口径来源（后端实算，前端不自填中位）。"""

    def query():
        with connect() as conn:
            # 与写口共用同一把咨询锁、同一事务快照：指示灯展示的配置/窗口/队列
            # 必定是某个写口临界区的一致状态，杜绝「灯亮却放过提交口」的口径漂移。
            with conn.transaction():
                conn.execute(
                    "SELECT pg_advisory_xact_lock(%s)", (GUST_LOCK_KEY,)
                )
                settings = conn.execute(
                    """SELECT enabled, window_size, median_multiplier, floor_deg,
                              updated_by, updated_at
                       FROM gust_filter_settings WHERE id = 1"""
                ).fetchone()
                window = conn.execute(
                    """SELECT yaw_err_deg FROM yaw_logs
                       ORDER BY id DESC LIMIT %s""",
                    (settings["window_size"],),
                ).fetchall()
                queued = conn.execute(
                    "SELECT COUNT(*) AS n FROM yaw_logs WHERE status = 'pending'"
                ).fetchone()["n"]
            return settings, [r["yaw_err_deg"] for r in window], queued

    settings, window_values, queued = await run_db(query)
    med = window_median(window_values)
    tol = tolerance_band(
        med, settings["median_multiplier"], settings["floor_deg"]
    )
    return jsonify(
        {
            "enabled": settings["enabled"],
            "window_size": settings["window_size"],
            "median_multiplier": settings["median_multiplier"],
            "floor_deg": settings["floor_deg"],
            "updated_by": settings["updated_by"],
            "updated_at": settings["updated_at"],
            # 以下为后端按 gust.py 统一口径实算的指示灯依据：
            "window_median_deg": med,
            "tolerance_deg": tol,
            "window_samples": len(window_values),
            "pending_count": queued,
        }
    )


@app.put("/api/gust-filter")
@require_writer
async def update_gust_filter(user):
    """开关 / 窗长 / 中位倍数。仅 writer（现场技师）可改，observer 只读。"""
    body = await request.get_json(force=True, silent=True) or {}

    fields = {}
    if "enabled" in body:
        if not isinstance(body["enabled"], bool):
            return jsonify({"detail": "enabled 必须是布尔值"}), 400
        fields["enabled"] = body["enabled"]

    if "window_size" in body:
        try:
            window_size = int(body["window_size"])
        except (TypeError, ValueError):
            return jsonify({"detail": "窗长必须是正整数"}), 400
        if not 1 <= window_size <= MAX_WINDOW_SIZE:
            return jsonify(
                {"detail": f"窗长需在 1~{MAX_WINDOW_SIZE} 之间"}
            ), 400
        fields["window_size"] = window_size

    if "median_multiplier" in body:
        try:
            multiplier = float(body["median_multiplier"])
        except (TypeError, ValueError):
            return jsonify({"detail": "中位倍数必须是数字"}), 400
        if not math.isfinite(multiplier) or not 0 < multiplier <= MAX_MULTIPLIER:
            return jsonify(
                {"detail": f"中位倍数需在 0~{MAX_MULTIPLIER} 之间且大于 0"}
            ), 400
        fields["median_multiplier"] = multiplier

    if not fields:
        return jsonify({"detail": "没有可更新的字段"}), 400

    now = datetime.now(timezone.utc)

    def save():
        # 与写口同一把锁，避免配置切换与正在判定的提交互相穿插。
        with connect() as conn:
            with conn.transaction():
                conn.execute("SELECT pg_advisory_xact_lock(%s)", (GUST_LOCK_KEY,))
                assignments = ", ".join(f"{key} = %s" for key in fields)
                params = list(fields.values()) + [user["username"], now]
                row = conn.execute(
                    f"""UPDATE gust_filter_settings
                        SET {assignments}, updated_by = %s, updated_at = %s
                        WHERE id = 1
                        RETURNING enabled, window_size, median_multiplier,
                                  floor_deg, updated_by, updated_at""",
                    params,
                ).fetchone()
                # 事务块退出时自动提交。
                return row

    row = await run_db(save)
    return jsonify(row)


@app.get("/api/gust-filter/events")
@require_login
async def list_gust_events(user):
    """过滤流水：所有被拒收的读数，登录用户（含 observer）均可查看。"""

    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, window_median_deg,
                          deviation_deg, tolerance_deg, window_size,
                          median_multiplier, submitted_by, reason, created_at
                   FROM gust_filter_events ORDER BY id DESC LIMIT 200"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)
