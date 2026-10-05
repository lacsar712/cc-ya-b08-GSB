# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交 |
| observer | obs123456 | 只读 |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. 阵风滤波（见下）：开闸后极端突变读数整单退回（422，不入队）并写入过滤流水；关闸后同类读数可入队，旧流水保留。

## 阵风滤波闸

顶栏「阵风滤波」专页提供可关的滤波闸，防止强阵风把单点读数拉飞：

- **开关 / 窗长 / 中位倍数**：technician 可改（窗长 3..51 的奇数，默认 5；倍数 0.1..20，默认 3×MAD），observer 只读。
- **规则**：取最近 N-1 笔**已入队**读数为窗，计算窗内中位数与中位绝对偏差（MAD）；候选读数偏差超过「倍数 × MAD」即判为阵风突变，写口整单退回（HTTP 422），该笔不进 `yaw_logs`、不进 worker 队列。窗内读数不足 N-1 笔时放行；MAD 为 0 时任何非零偏差都拦截。
- **过滤流水**：每笔拒收写入 `gust_filter_rejections`（读数、窗长、倍数、窗内中位、MAD、偏差、阈值、原因、提交人、时间），专页可见；关闸只停止新增拦截，旧流水保留。
- **指示灯同口径**：专页「试算指示灯」与写口共用同一服务端判定函数（`rules.evaluate_gust`）与同一把 `pg_advisory_xact_lock`，灯判拦截则提交必被拒。中位/MAD/阈值全部由服务端计算返回，前端不自填、不估算。
- **并发**：判定在「取窗 → 判定 → 入队/拒收」单事务 + 咨询锁内完成，临界附近两笔同时到达时串行处理，至多一笔进入队列。

接口：`GET/PUT /api/gust-filter`、`GET /api/gust-filter/rejections`、`POST /api/gust-filter/preview`（均需登录；PUT 仅 writer）。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
