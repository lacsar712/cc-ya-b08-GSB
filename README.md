# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

顶栏另有一道**阵风滤波闸**：强阵风会把单点读数拉飞，开闸后对相对窗内中位突变过大的读数整单退回，专页可设开关、窗长、中位倍数并查看过滤流水。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交、可改滤波闸 |
| observer | obs123456 | 只读（可看记录与过滤流水，不可提交、不可改开关） |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 阵风滤波闸

判定口径（后端 `gust.py`，写口与专页指示灯共用同一份，前端只展示、不自算中位）：

1. 取最近「窗长」条**已入队**读数的偏航误差，求窗内中位 `m`；
2. 容差带 `tol = max(保底宽度, 中位倍数 × |m|)`。偏航正常值本就在 0° 附近，中位接近 0 时倍数带宽会塌成 0，故用保底宽度（默认 0.5°，可用环境变量 `GUST_FLOOR_DEG` 调）避免误杀一切小波动；
3. 开闸时，若 `|本次读数 − m| > tol`，判为阵风尖峰，**整单退回**：不进待处理队列，写入过滤流水 `gust_filter_events`，接口返回 `422`；否则正常入队。
4. 窗内尚无已入队读数（没有基线）时不拦截；被拒收的读数不进入窗内中位，尖峰不会污染基线。
5. **关闸只停止新增拦截，历史过滤流水保留。**

临界并发：判定 + 入队 + 落流水在同一事务内的 `pg_advisory_xact_lock` 临界区完成，临界附近两笔同时到达时串行处理，**至多一笔进入队列**，另一笔退回并落流水。

接口：

| 方法/路径 | 权限 | 说明 |
|------|------|------|
| `GET /api/gust-filter` | 登录 | 专页与顶栏指示灯唯一口径来源，含后端实算 `window_median_deg`、`tolerance_deg`、待处理数 |
| `PUT /api/gust-filter` | technician | 改 `enabled` / `window_size`(1~200) / `median_multiplier`(>0) |
| `GET /api/gust-filter/events` | 登录 | 过滤流水（所有被拒收读数，observer 可见） |
| `POST /api/logs` | technician | 开闸时按上述口径拦截，拒收返回 `422` 并落流水 |

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. **阵风闸**：technician 在「阵风滤波」专页开闸并设窗长/倍数；顶栏指示灯亮「开启」。此时提交一笔相对窗内中位极端突变的读数应被整单退回（`422`，不进对中记录），该笔出现在过滤流水；关闸后再提交同类极端读数应正常进入待处理队列，且旧流水仍在。
5. observer 打开阵风滤波专页只能看，开关/窗长/倍数与保存按钮均禁用，直接调 `PUT` 返回 `403`。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 阵风闸：`gust.py` 纯函数口径 + `pg_advisory_xact_lock` 临界区，`gust_filter_settings` / `gust_filter_events` 两表
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
