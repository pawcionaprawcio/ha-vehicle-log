import { LitElement, html, css, nothing, sheetStyles, fmtDate, fmtKm, todayIso, errorText } from "./ui.js";

const barClass = (p) => (p >= 100 ? "red" : p >= 80 ? "amber" : "");
const pct = (p) => (p === null || p === undefined ? "—" : `${Math.round(p)}%`);

function daysText(n) {
  const a = Math.abs(n);
  const unit = a === 1 ? "dzień" : "dni";
  return n < 0 ? `po terminie ${a} ${unit}` : `za ${a} ${unit}`;
}

function kmText(n) {
  return n < 0 ? `po terminie ${fmtKm(-n)}` : `za ${fmtKm(n)}`;
}

export class VlReminders extends LitElement {
  static properties = {
    hass: { attribute: false },
    vehicle: { attribute: false },
    serviceTypes: { attribute: false },
    narrow: { type: Boolean, reflect: true },
    _openId: { state: true },
    _confirmDelete: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };
  static styles = [
    sheetStyles,
    css`
      :host { display: block; }
      .banner {
        display: flex; flex-direction: column; gap: 8px; margin: 12px; padding: 12px 16px; border-radius: 12px;
        background: var(--warning-color, #f4a100); color: #000;
      }
      .banner button { background: rgba(255, 255, 255, 0.6); border-color: transparent; color: #000; }
      .card {
        display: block; width: calc(100% - 24px); margin: 12px; padding: 12px 16px; text-align: left; border-radius: 12px;
        background: var(--card-background-color, #fff); border: none; box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0, 0, 0, 0.2));
        min-height: 48px;
      }
      .top { display: flex; align-items: center; gap: 16px; }
      .top ha-icon { color: var(--secondary-text-color); flex: none; }
      .text { flex: 1; min-width: 0; }
      .name { font-size: 16px; word-break: break-word; }
      .sub { font-size: 12px; color: var(--secondary-text-color); word-break: break-word; }
      .late { color: var(--error-color, #db4437); }
      .bar { height: 8px; border-radius: 4px; background: var(--divider-color); margin: 10px 0 6px; overflow: hidden; }
      .bar i { display: block; height: 100%; background: var(--primary-color); }
      .bar i.amber { background: var(--warning-color, #f4a100); }
      .bar i.red { background: var(--error-color, #db4437); }
      .empty { padding: 32px 16px; text-align: center; color: var(--secondary-text-color); }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; }
      .stats b { display: block; font-size: 20px; font-weight: 500; }
    `,
  ];

  constructor() {
    super();
    this._openId = null;
    this._confirmDelete = false;
    this._busy = false;
    this._error = "";
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  _show(id) {
    this._openId = id;
    this._confirmDelete = false;
    this._error = "";
  }

  async _call(msg) {
    this._busy = true;
    this._error = "";
    try {
      const view = await this.hass.callWS(msg);
      this._emit("saved", view);
      this._openId = null;
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  _done(r) {
    return this._call({
      type: "vehicle_log/reminder/reset",
      reminder_id: r.id,
      date: todayIso(),
      odometer: this.vehicle.odometer ?? r.baseline_odometer,
    });
  }

  _lines(r) {
    const lines = [];
    if (r.days_left !== null && r.due_date) lines.push([daysText(r.days_left), fmtDate(r.due_date), r.days_left < 0]);
    if (r.km_left !== null && r.due_odometer !== null) lines.push([kmText(r.km_left), fmtKm(r.due_odometer), r.km_left < 0]);
    return lines.map(
      ([rel, abs, late]) => html`<div class="sub ${late ? "late" : ""}">${rel} · ${abs}</div>`,
    );
  }

  _card(r) {
    const type = this.serviceTypes?.[r.service_type];
    return html`<button class="card" @click=${() => this._show(r.id)}>
      <div class="top">
        <ha-icon icon=${type?.icon || "mdi:wrench"}></ha-icon>
        <div class="text">
          <div class="name">${r.text}</div>
          ${r.extra_text ? html`<div class="sub">${r.extra_text}</div>` : nothing}
        </div>
      </div>
      ${r.progress === null
        ? nothing
        : html`<div class="bar" role="progressbar" aria-valuenow=${Math.round(r.progress)} aria-valuemin="0" aria-valuemax="100">
            <i class=${barClass(r.progress)} style="width: ${Math.min(100, r.progress)}%"></i>
          </div>`}
      ${this._lines(r)}
    </button>`;
  }

  _detail(r) {
    const close = () => (this._openId = null);
    return html`<div class="overlay" @click=${close}>
      <div class="sheet" role="dialog" aria-label=${r.text} @click=${(e) => e.stopPropagation()}>
        <header>
          <h2>${r.text}</h2>
          <button class="close" aria-label="Zamknij" @click=${close}>✕</button>
        </header>
        <div class="body">
          ${r.extra_text ? html`<div class="sub">${r.extra_text}</div>` : nothing}
          <div class="stats">
            <div><b>${pct(r.progress_time)}</b><span class="sub">czas</span></div>
            <div><b>${pct(r.progress_km)}</b><span class="sub">przebieg</span></div>
            <div><b>${pct(r.progress_forecast)}</b><span class="sub">prognoza</span></div>
          </div>
          ${this._lines(r)}
        </div>
        <footer>
          ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}
          ${this._confirmDelete
            ? html`<div>Na pewno usunąć to przypomnienie?</div>
                <div class="row">
                  <button @click=${() => (this._confirmDelete = false)}>Anuluj</button>
                  <button class="danger solid" ?disabled=${this._busy} @click=${() => this._call({ type: "vehicle_log/reminder/delete", reminder_id: r.id })}>Usuń</button>
                </div>`
            : html`<button class="primary" ?disabled=${this._busy} @click=${() => this._done(r)}>Wykonane</button>
                <div class="row">
                  <button @click=${() => { close(); this._emit("edit-reminder", r); }}>Edytuj</button>
                  <button class="danger" @click=${() => (this._confirmDelete = true)}>Usuń</button>
                </div>`}
        </footer>
      </div>
    </div>`;
  }

  render() {
    const v = this.vehicle;
    if (!v) return nothing;
    const open = v.reminders.find((r) => r.id === this._openId);
    const od = v.odometer_update;
    return html`${od?.is_due
        ? html`<div class="banner" role="status">
            Zaktualizuj przebieg — ostatni wpis ${od.days_since} dni temu
            <button @click=${() => this._emit("add-odometer")}>Aktualizuj przebieg</button>
          </div>`
        : nothing}
      ${v.reminders.length
        ? v.reminders.map((r) => this._card(r))
        : html`<div class="empty">Brak przypomnień. Użyj przycisku +, aby dodać pierwsze.</div>`}
      <div style="height: 88px"></div>
      ${open ? this._detail(open) : nothing}`;
  }
}
customElements.define("vl-reminders", VlReminders);
