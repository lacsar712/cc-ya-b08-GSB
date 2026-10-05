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

type GustSettings = {
  enabled: boolean;
  window_size: number;
  median_multiplier: number;
  updated_by: string | null;
  updated_at: string | null;
};

type RejectionRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  window_size: number;
  median_multiplier: number;
  window_median: number | null;
  window_mad: number | null;
  deviation: number | null;
  threshold: number | null;
  reason: string;
  created_by: string;
  created_at: string;
};

type PreviewEvaluation = {
  accepted: boolean;
  insufficient: boolean;
  window_median: number | null;
  window_mad: number | null;
  deviation: number | null;
  threshold: number | null;
  reason: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type View = "logs" | "filter";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}

function fmtNum(v: number | null, digits = 3): string {
  return v === null || v === undefined ? "—" : Number(v).toFixed(digits);
}

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 1080px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1rem;
    }
    nav {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    nav button {
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
      border-radius: 8px 8px 0 0;
      border-bottom: none;
    }
    nav button.active {
      background: #0f172a;
      color: #38bdf8;
      border-color: #38bdf8;
      font-weight: 700;
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
    input[type="number"] {
      width: 100%;
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
    }
    .inline-input {
      width: 8rem;
      margin: 0 0.5rem 0 0.35rem;
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
      white-space: nowrap;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    td.wrap {
      white-space: normal;
      min-width: 16rem;
    }
    .table-scroll {
      overflow-x: auto;
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
    .ok-text {
      color: #86efac;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .field-row {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem 2rem;
      align-items: flex-end;
      margin-bottom: 0.5rem;
    }
    .field {
      display: flex;
      flex-direction: column;
    }
    .switch-line {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.95rem;
      color: #e2e8f0;
      margin-bottom: 0.75rem;
    }
    .lamp {
      display: inline-block;
      width: 0.85rem;
      height: 0.85rem;
      border-radius: 50%;
      margin-right: 0.4rem;
      vertical-align: -0.1rem;
      box-shadow: 0 0 6px currentColor;
    }
    .lamp.green {
      background: #22c55e;
      color: #22c55e;
    }
    .lamp.red {
      background: #ef4444;
      color: #ef4444;
    }
    .lamp.amber {
      background: #f59e0b;
      color: #f59e0b;
    }
    .lamp.gray {
      background: #64748b;
      color: #64748b;
      box-shadow: none;
    }
    .lamp-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      margin: 0.5rem 0;
      font-size: 0.9rem;
    }
    .metrics {
      color: #94a3b8;
      font-size: 0.85rem;
      margin-top: 0.35rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.8rem;
      margin-top: 0.35rem;
    }
    h2 {
      margin-top: 0;
      font-size: 1.1rem;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: View = "logs";
  @state() private logs: LogRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  // 阵风滤波专页状态
  @state() private settings: GustSettings | null = null;
  @state() private rejections: RejectionRow[] = [];
  @state() private formEnabled = false;
  @state() private formWindow = "5";
  @state() private formMultiplier = "3";
  @state() private saving = false;
  @state() private settingsMsg = "";
  @state() private previewValue = "";
  @state() private preview: PreviewEvaluation | null = null;
  @state() private previewSampleCount = 0;
  @state() private previewLoading = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.pollActiveView();
        this._pollTimer = window.setInterval(
          () => void this.pollActiveView(),
          2000
        );
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

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async pollActiveView() {
    if (!this.session) return;
    // 设置始终刷新，保证顶栏闸门状态灯与提交页提示在任意页面都反映真实状态。
    await this.refreshSettings();
    if (this.view === "logs") {
      await this.refreshLogs();
    } else {
      await this.refreshRejections();
    }
  }

  private async switchView(view: View) {
    this.view = view;
    this.error = "";
    if (view === "filter") {
      await this.refreshSettings();
      // 进入专页时表单跟随服务端当前值；进入后的编辑不被轮询覆盖。
      this.syncFormFromSettings();
      await this.refreshRejections();
    } else {
      await this.refreshLogs();
    }
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

  private async refreshSettings() {
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
      this.settings = (await res.json()) as GustSettings;
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshRejections() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/gust-filter/rejections", {
        headers: this.authHeaders(),
      });
      if (!res.ok) return;
      this.rejections = (await res.json()) as RejectionRow[];
    } catch {
      /* ignore transient network errors */
    }
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
      await this.pollActiveView();
      this._pollTimer = window.setInterval(
        () => void this.pollActiveView(),
        2000
      );
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
    this.settings = null;
    this.rejections = [];
    this.preview = null;
    localStorage.removeItem("yaw_session");
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
        // 422：阵风滤波闸拒收，原因与流水均由服务端给出
        this.error = data.detail || "提交失败";
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      await this.refreshLogs();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private syncFormFromSettings() {
    if (!this.settings) return;
    this.formEnabled = this.settings.enabled;
    this.formWindow = String(this.settings.window_size);
    this.formMultiplier = String(this.settings.median_multiplier);
  }

  private async saveSettings() {
    if (!this.isWriter || !this.settings) return;
    this.settingsMsg = "";
    this.saving = true;
    try {
      const res = await fetch("/api/gust-filter", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          enabled: this.formEnabled,
          window_size: Number(this.formWindow),
          median_multiplier: Number(this.formMultiplier),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.settingsMsg = data.detail || "保存失败";
        return;
      }
      this.settings = data as GustSettings;
      this.settingsMsg = "已保存";
    } catch {
      this.settingsMsg = "保存时网络异常";
    } finally {
      this.saving = false;
    }
  }

  private async runPreview() {
    if (!this.session) return;
    this.preview = null;
    this.previewLoading = true;
    try {
      const res = await fetch("/api/gust-filter/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ yaw_err_deg: Number(this.previewValue) }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.preview = {
          accepted: true,
          insufficient: true,
          window_median: null,
          window_mad: null,
          deviation: null,
          threshold: null,
          reason: data.detail || "试算失败",
        };
        return;
      }
      this.settings = data.settings as GustSettings;
      this.previewSampleCount = data.sample_count as number;
      this.preview = data.evaluation as PreviewEvaluation;
    } catch {
      this.preview = {
        accepted: true,
        insufficient: true,
        window_median: null,
        window_mad: null,
        deviation: null,
        threshold: null,
        reason: "试算时网络异常",
      };
    } finally {
      this.previewLoading = false;
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private renderLogin() {
    return html`
      <h1>风机偏航对中台</h1>
      <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>
      <section>
        <label>用户名</label>
        <input
          type="text"
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

  private renderTopBar() {
    return html`
      <h1>风机偏航对中台</h1>
      <p class="sub">
        已登录：${this.session!.username}
        (${this.isWriter ? "可提交" : "只读"})
      </p>
      <nav>
        <button
          class=${this.view === "logs" ? "active" : ""}
          @click=${() => this.switchView("logs")}
        >
          对中记录
        </button>
        <button
          class=${this.view === "filter" ? "active" : ""}
          @click=${() => this.switchView("filter")}
        >
          阵风滤波
          ${this.settings?.enabled
            ? html`<span class="lamp green" style="margin-left:0.4rem"></span>`
            : html`<span class="lamp gray" style="margin-left:0.4rem"></span>`}
        </button>
        <button class="secondary" @click=${this.logout}>退出</button>
      </nav>
    `;
  }

  private renderLogsView() {
    return html`
      ${this.isWriter
        ? html`
            <section>
              <h2>提交偏航记录</h2>
              <div class="hint" style="margin-bottom:0.6rem">
                阵风滤波闸当前：
                ${this.settings?.enabled
                  ? html`<strong class="ok-text">开启</strong>，相对窗内中位突变过大的读数将整单退回`
                  : html`<strong>关闭</strong>，读数直接进入待认领队列（历史过滤流水保留）`}
              </div>
              <label>机组编号</label>
              <input
                type="text"
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
              ${this.error
                ? html`<p class="err">
                    ${this.error}（该笔未入队，已写入过滤流水）
                  </p>`
                : null}
            </section>
          `
        : null}

      <section>
        <h2>对中记录</h2>
        <div class="row-actions" style="margin-bottom:0.5rem">
          <button class="secondary" ?disabled=${this.loading} @click=${this.refreshLogs}>
            刷新列表
          </button>
        </div>
        <div class="table-scroll">
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
                    <td class="wrap">${row.reason ?? "—"}</td>
                  </tr>
                `
              )}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  private renderPreviewLamp() {
    if (!this.preview) {
      return html`<div class="lamp-box">
        <span class="lamp gray"></span>尚未试算：输入一笔读数后点击「试算指示灯」。
        <div class="hint">中位、MAD、阈值全部由服务端按当前窗口计算，本页不自行估算。</div>
      </div>`;
    }
    const p = this.preview;
    const gateOn = this.settings?.enabled ?? false;
    let cls = "green";
    let title = "放行";
    if (p.insufficient) {
      cls = "amber";
      title = "窗口不足，放行";
    } else if (!p.accepted) {
      cls = "red";
      title = gateOn ? "拦截：提交将整单退回" : "若开闸将拦截（当前闸门关闭，提交可入队）";
    } else {
      title = gateOn
        ? "放行：提交可入队"
        : "若开闸也会放行（当前闸门关闭，提交可入队）";
    }
    return html`
      <div class="lamp-box">
        <span class="lamp ${cls}"></span><strong>${title}</strong>
        <div class="metrics">
          样本数 ${this.previewSampleCount} ·
          窗内中位 ${fmtNum(p.window_median)}° ·
          MAD ${fmtNum(p.window_mad)}° ·
          偏差 ${fmtNum(p.deviation)}° ·
          阈值 ${fmtNum(p.threshold)}°
        </div>
        <div class="hint">${p.reason}</div>
      </div>
    `;
  }

  private renderFilterView() {
    if (!this.settings) {
      return html`<section>设置加载中…</section>`;
    }
    return html`
      <section>
        <h2>阵风滤波闸</h2>
        <div class="lamp-box">
          闸门状态：
          ${this.settings.enabled
            ? html`<span class="lamp green"></span><strong class="ok-text">已开启</strong>
                ——突变读数在写口被整单退回`
            : html`<span class="lamp gray"></span><strong>已关闭</strong>
                ——停止新增拦截，历史过滤流水保留`}
          <div class="metrics">
            窗长 ${this.settings.window_size}（取最近
            ${this.settings.window_size - 1} 笔入队读数）·
            中位倍数 ${this.settings.median_multiplier}×MAD
          </div>
          <div class="hint">
            最近修改：${this.settings.updated_by ?? "—"}
            ${fmtTime(this.settings.updated_at)}
          </div>
        </div>

        <div class="switch-line">
          <input
            type="checkbox"
            id="gate-enabled"
            ?checked=${this.formEnabled}
            ?disabled=${!this.isWriter || this.saving}
            @change=${(e: Event) =>
              (this.formEnabled = (e.target as HTMLInputElement).checked)}
          />
          <label for="gate-enabled" style="margin:0">闸门开关</label>
        </div>
        <div class="field-row">
          <div class="field">
            <label>窗长（3..51 的奇数）</label>
            <input
              class="inline-input"
              type="number"
              min="3"
              max="51"
              step="2"
              .value=${this.formWindow}
              ?disabled=${!this.isWriter || this.saving}
              @input=${(e: Event) =>
                (this.formWindow = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label>中位倍数（×MAD，0.1..20）</label>
            <input
              class="inline-input"
              type="number"
              min="0.1"
              max="20"
              step="0.1"
              .value=${this.formMultiplier}
              ?disabled=${!this.isWriter || this.saving}
              @input=${(e: Event) =>
                (this.formMultiplier = (e.target as HTMLInputElement).value)}
            />
          </div>
          ${this.isWriter
            ? html`
                <button
                  ?disabled=${this.saving}
                  @click=${this.saveSettings}
                >
                  ${this.saving ? "保存中…" : "保存设置"}
                </button>
                <button
                  class="secondary"
                  ?disabled=${this.saving}
                  @click=${this.syncFormFromSettings}
                >
                  重置为当前值
                </button>
              `
            : html`<span class="hint">观察员只读，不能修改开关与参数</span>`}
        </div>
        ${this.settingsMsg
          ? html`<p
              class=${this.settingsMsg === "已保存" ? "ok-text" : "err"}
              style="margin:0.25rem 0 0"
            >
              ${this.settingsMsg}
            </p>`
          : null}
      </section>

      <section>
        <h2>试算指示灯</h2>
        <label>拟提交读数（度）</label>
        <div class="row-actions">
          <input
            class="inline-input"
            type="number"
            step="0.1"
            style="margin:0"
            .value=${this.previewValue}
            @input=${(e: Event) =>
              (this.previewValue = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.runPreview();
            }}
          />
          <button
            ?disabled=${this.previewLoading}
            @click=${this.runPreview}
          >
            ${this.previewLoading ? "试算中…" : "试算指示灯"}
          </button>
        </div>
        ${this.renderPreviewLamp()}
      </section>

      <section>
        <h2>过滤流水（被阵风闸退回的读数）</h2>
        <div class="hint" style="margin-bottom:0.5rem">
          仅记录闸门开启期间写口实际拒收的单据；关闭闸门后停止新增，旧流水保留，共
          ${this.rejections.length} 笔。
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>时间</th>
                <th>机组</th>
                <th>读数°</th>
                <th>窗长</th>
                <th>倍数</th>
                <th>窗内中位°</th>
                <th>MAD°</th>
                <th>偏差°</th>
                <th>阈值°</th>
                <th>原因</th>
                <th>提交人</th>
              </tr>
            </thead>
            <tbody>
              ${this.rejections.map(
                (r) => html`
                  <tr>
                    <td>${r.id}</td>
                    <td>${fmtTime(r.created_at)}</td>
                    <td>${r.turbine_code}</td>
                    <td>${fmtNum(r.yaw_err_deg, 2)}</td>
                    <td>${r.window_size}</td>
                    <td>${r.median_multiplier}</td>
                    <td>${fmtNum(r.window_median)}</td>
                    <td>${fmtNum(r.window_mad)}</td>
                    <td>${fmtNum(r.deviation)}</td>
                    <td>${fmtNum(r.threshold)}</td>
                    <td class="wrap">${r.reason}</td>
                    <td>${r.created_by}</td>
                  </tr>
                `
              )}
            </tbody>
          </table>
          ${this.rejections.length === 0
            ? html`<p class="hint">暂无拒收记录。</p>`
            : null}
        </div>
      </section>
    `;
  }

  render() {
    if (!this.session) {
      return this.renderLogin();
    }
    return html`
      ${this.renderTopBar()}
      ${this.view === "logs" ? this.renderLogsView() : this.renderFilterView()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
