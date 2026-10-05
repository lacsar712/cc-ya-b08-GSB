import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

type GustFilter = {
  enabled: boolean;
  window_size: number;
  median_multiplier: number;
  floor_deg: number;
  updated_by: string;
  updated_at: string;
  // 以下两项由后端按 gust.py 统一口径实算，前端只展示、绝不自填中位做演示。
  window_median_deg: number | null;
  tolerance_deg: number | null;
  window_samples: number;
  pending_count: number;
};

type GustEvent = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  window_median_deg: number | null;
  deviation_deg: number | null;
  tolerance_deg: number | null;
  window_size: number;
  median_multiplier: number;
  submitted_by: string;
  reason: string;
  created_at: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input[type="text"],
    input[type="password"],
    input:not([type]) {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    input[type="number"] {
      width: 120px;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    input:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button.active {
      background: #0369a1;
      outline: 1px solid #38bdf8;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
      vertical-align: top;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .ok-msg {
      color: #86efac;
      margin-top: 0.5rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    /* 顶栏 */
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }
    .topbar h1 {
      margin: 0;
      font-size: 1.35rem;
    }
    .nav {
      display: flex;
      gap: 0.5rem;
      margin-left: auto;
      align-items: center;
    }
    .lamp {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      padding: 0.3rem 0.6rem;
      border-radius: 999px;
      border: 1px solid #334155;
      background: #0f172a;
    }
    .dot {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.on {
      background: #f59e0b;
      box-shadow: 0 0 8px #f59e0b;
    }
    .dot.off {
      background: #64748b;
    }
    .lamp.on {
      border-color: #f59e0b;
      color: #fde68a;
    }
    .lamp.off {
      color: #94a3b8;
    }
    .grid2 {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      align-items: flex-end;
    }
    .grid2 > div {
      flex: 1 1 160px;
    }
    .switch-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .switch-row input[type="checkbox"] {
      width: 1.1rem;
      height: 1.1rem;
      margin: 0;
    }
    .stat {
      display: inline-block;
      margin-right: 1.5rem;
      font-size: 0.9rem;
      color: #cbd5e1;
    }
    .stat b {
      color: #f1f5f9;
    }
    .readonly-note {
      color: #fde68a;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }
    .muted {
      color: #94a3b8;
      font-size: 0.85rem;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: "logs" | "gust" = "logs";
  @state() private logs: LogRow[] = [];

  @state() private gust: GustFilter | null = null;
  @state() private events: GustEvent[] = [];
  // 专页表单（仅 writer 可编辑）；中位/容差不进表单，完全取自后端。
  @state() private gustEnabled = false;
  @state() private gustWindow = "5";
  @state() private gustMultiplier = "0.5";
  @state() private gustFormInited = false;
  @state() private gustSaving = false;
  @state() private gustMsg = "";

  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.startPolling();
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _pollTimer?: number;

  private async startPolling() {
    await this.tick();
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = window.setInterval(() => void this.tick(), 2000);
  }

  private async tick() {
    // 指示灯口径任何页都需要；在滤波专页时额外刷新流水；首页刷新对中记录。
    await Promise.all([
      this.refreshGust(),
      this.view === "gust" ? this.refreshEvents() : Promise.resolve(),
      this.refreshLogs(),
    ]);
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async refreshLogs() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/logs", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.logs = (await res.json()) as LogRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshGust() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/gust-filter", {
        headers: this.authHeaders(),
      });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.gust = (await res.json()) as GustFilter;
      // 仅在尚未初始化或刚保存后同步表单，避免轮询打断正在输入的内容。
      if (!this.gustFormInited) {
        this.syncGustForm(this.gust);
        this.gustFormInited = true;
      }
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshEvents() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/gust-filter/events", {
        headers: this.authHeaders(),
      });
      if (!res.ok) return;
      this.events = (await res.json()) as GustEvent[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private syncGustForm(g: GustFilter) {
    this.gustEnabled = g.enabled;
    this.gustWindow = String(g.window_size);
    this.gustMultiplier = String(g.median_multiplier);
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      this.gustFormInited = false;
      await this.startPolling();
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.gust = null;
    this.events = [];
    this.gustFormInited = false;
    this.view = "logs";
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async submitLog() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 422 = 阵风闸整单退回；detail 是后端按统一口径给出的拒收原因。
        this.error = data.detail || "提交失败";
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      await this.tick();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private async saveGust() {
    this.gustMsg = "";
    const windowSize = Number(this.gustWindow);
    const multiplier = Number(this.gustMultiplier);
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      this.gustMsg = "窗长必须是不小于 1 的整数";
      return;
    }
    if (!(multiplier > 0)) {
      this.gustMsg = "中位倍数必须是大于 0 的数字";
      return;
    }
    this.gustSaving = true;
    try {
      const res = await fetch("/api/gust-filter", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          enabled: this.gustEnabled,
          window_size: windowSize,
          median_multiplier: multiplier,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.gustMsg = data.detail || "保存失败";
        return;
      }
      this.syncGustForm(data as GustFilter);
      this.gustMsg = this.gustEnabled
        ? "已开闸：相对窗内中位突变超过容差的读数将被整单退回"
        : "已关闸：停止新增拦截，历史过滤流水保留";
      await Promise.all([this.refreshGust(), this.refreshEvents()]);
    } catch {
      this.gustMsg = "保存时网络异常";
    } finally {
      this.gustSaving = false;
    }
  }

  private fmt(v: number | null | undefined, digits = 3): string {
    return v === null || v === undefined ? "—" : Number(v).toFixed(digits);
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private renderTopBar() {
    const on = this.gust?.enabled ?? false;
    return html`
      <div class="topbar">
        <h1>风机偏航对中台</h1>
        <span
          class="lamp ${on ? "on" : "off"}"
          title=${on
            ? "阵风滤波闸开启：写口正在拦截突变读数"
            : "阵风滤波闸关闭：写口直通"}
        >
          <span class="dot ${on ? "on" : "off"}"></span>
          阵风闸·${on ? "开启" : "关闭"}
        </span>
        <div class="nav">
          <span class="muted"
            >${this.session!.username}（${this.isWriter ? "可提交" : "只读"}）</span
          >
          <button
            class="secondary ${this.view === "logs" ? "active" : ""}"
            @click=${() => (this.view = "logs")}
          >
            对中记录
          </button>
          <button
            class="secondary ${this.view === "gust" ? "active" : ""}"
            @click=${() => (this.view = "gust")}
          >
            阵风滤波
          </button>
          <button class="secondary" @click=${this.logout}>退出</button>
        </div>
      </div>
    `;
  }

  private renderGustPage() {
    const g = this.gust;
    return html`
      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">阵风滤波闸</h2>
        <p class="muted" style="margin-top:0;">
          强阵风会把单点读数拉飞。开闸后，读数相对最近「窗长」条已入队读数的
          <b>窗内中位</b>突变超过 <b>容差＝中位倍数×|中位|</b>（0 附近有保底宽度）时，
          整单退回、不进入待处理队列，并写入下方过滤流水。关闸只停止新增拦截，旧流水保留。
        </p>

        <div class="switch-row">
          <input
            type="checkbox"
            id="gust-enabled"
            .checked=${this.gustEnabled}
            ?disabled=${!this.isWriter || this.gustSaving}
            @change=${(e: Event) =>
              (this.gustEnabled = (e.target as HTMLInputElement).checked)}
          />
          <label for="gust-enabled" style="margin:0;">开启阵风滤波闸</label>
        </div>

        <div class="grid2">
          <div>
            <label>窗长（取中位的已入队读数条数）</label>
            <input
              type="number"
              min="1"
              step="1"
              .value=${this.gustWindow}
              ?disabled=${!this.isWriter || this.gustSaving}
              @input=${(e: Event) =>
                (this.gustWindow = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <label>中位倍数（容差＝倍数×|中位|）</label>
            <input
              type="number"
              min="0"
              step="0.1"
              .value=${this.gustMultiplier}
              ?disabled=${!this.isWriter || this.gustSaving}
              @input=${(e: Event) =>
                (this.gustMultiplier = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        ${this.isWriter
          ? html`
              <button
                ?disabled=${this.gustSaving}
                @click=${this.saveGust}
              >
                ${this.gustSaving ? "保存中…" : "保存设置"}
              </button>
            `
          : html`<p class="readonly-note">观察员为只读账号，不可修改开关与参数。</p>`}
        ${this.gustMsg ? html`<p class="ok-msg">${this.gustMsg}</p>` : null}
      </section>

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">当前判定口径（后端实算）</h2>
        ${g
          ? html`
              <div>
                <span class="stat">状态：<b>${g.enabled ? "开闸" : "关闸"}</b></span>
                <span class="stat">窗内样本：<b>${g.window_samples}</b></span>
                <span class="stat">待处理队列：<b>${g.pending_count}</b></span>
              </div>
              <div style="margin-top:0.5rem;">
                <span class="stat">窗内中位：<b>${this.fmt(g.window_median_deg)}°</b></span>
                <span class="stat">容差带：<b>${this.fmt(g.tolerance_deg)}°</b></span>
                <span class="stat">0 附近保底：<b>${this.fmt(g.floor_deg)}°</b></span>
              </div>
              <p class="muted" style="margin-bottom:0;">
                ${g.window_samples === 0
                  ? "窗内暂无已入队读数作为基线：开闸期间新读数也会直接放行，待有基线后才开始拦截。"
                  : `下一笔读数若相对窗内中位偏差 > ${this.fmt(g.tolerance_deg)}°，将被整单退回。`}
                中位与容差由后端统一计算，与写口、指示灯同口径。
              </p>
              <p class="muted">
                最后更新：${g.updated_by} · ${g.updated_at}
              </p>
            `
          : html`<p class="muted">正在加载滤波状态…</p>`}
      </section>

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">过滤流水（被拒收读数）</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>时间</th>
              <th>机组</th>
              <th>读数°</th>
              <th>窗内中位°</th>
              <th>突变°</th>
              <th>容差°</th>
              <th>窗长/倍数</th>
              <th>提交人</th>
              <th>拒收原因</th>
            </tr>
          </thead>
          <tbody>
            ${this.events.length === 0
              ? html`<tr>
                  <td colspan="10" class="muted">暂无被拒收的读数（关闸或尚无尖峰）。</td>
                </tr>`
              : this.events.map(
                  (e) => html`
                    <tr>
                      <td>${e.id}</td>
                      <td>${e.created_at}</td>
                      <td>${e.turbine_code}</td>
                      <td><span class="tag bad">${this.fmt(e.yaw_err_deg, 2)}</span></td>
                      <td>${this.fmt(e.window_median_deg)}</td>
                      <td>${this.fmt(e.deviation_deg)}</td>
                      <td>${this.fmt(e.tolerance_deg)}</td>
                      <td>${e.window_size} / ${e.median_multiplier}</td>
                      <td>${e.submitted_by}</td>
                      <td>${e.reason}</td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </section>
    `;
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    return html`
      ${this.renderTopBar()}
      ${this.view === "gust" ? this.renderGustPage() : null}

      ${this.view === "logs"
        ? html`
            ${this.isWriter
              ? html`
                  <section>
                    <h2 style="margin-top:0;font-size:1.1rem;">提交偏航记录</h2>
                    ${this.gust?.enabled
                      ? html`<p class="muted" style="margin-top:0;">
                          阵风滤波闸已开启：突变读数会被整单退回（详见「阵风滤波」专页）。
                        </p>`
                      : null}
                    <label>机组编号</label>
                    <input
                      placeholder="例如 W12"
                      .value=${this.turbineCode}
                      @input=${(e: Event) =>
                        (this.turbineCode = (e.target as HTMLInputElement).value)}
                    />
                    <label>偏航误差（度，可正可负）</label>
                    <input
                      type="number"
                      step="0.1"
                      .value=${this.yawErr}
                      @input=${(e: Event) =>
                        (this.yawErr = (e.target as HTMLInputElement).value)}
                    />
                    <button ?disabled=${this.loading} @click=${this.submitLog}>
                      提交（进入待认领队列）
                    </button>
                    ${this.error ? html`<p class="err">${this.error}</p>` : null}
                  </section>
                `
              : null}

            <section>
              <h2 style="margin-top:0;font-size:1.1rem;">对中记录</h2>
              <table>
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>机组</th>
                    <th>误差°</th>
                    <th>状态</th>
                    <th>结论</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.logs.map(
                    (row) => html`
                      <tr>
                        <td>${row.id}</td>
                        <td>${row.turbine_code}</td>
                        <td>${row.yaw_err_deg}</td>
                        <td>
                          <span
                            class="tag ${row.status === "pending" ? "pending" : "ok"}"
                          >
                            ${row.status === "pending" ? "待处理" : "已完成"}
                          </span>
                        </td>
                        <td>
                          ${row.verdict
                            ? html`<span class="tag ${this.verdictClass(row)}"
                                >${row.verdict}</span
                              >`
                            : "—"}
                        </td>
                        <td>${row.reason ?? "—"}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </section>
          `
        : null}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
