import { LitElement, html, css, nothing, haStyles, sheetStyles, fmtDate, fmtKm, todayIso, errorText, reminderStatus, plural } from "./ui.js";

const pct = (p) => (p === null || p === undefined ? "—" : `${Math.round(p)}%`);

const daysUnit = (n) => plural(n, "dzień", "dni", "dni");

/** Relative text of the days limit: "za 9 dni" / "3 dni po terminie". */
function daysText(n) {
  const a = Math.abs(n);
  if (n === 0) return "dziś";
  return n < 0 ? `${a} ${daysUnit(a)} po terminie` : `za ${a} ${daysUnit(a)}`;
}

/** Relative text of the km limit: "za 9 800 km" / "1 200 km po terminie". */
function kmText(n) {
  return n < 0 ? `${fmtKm(-n)} po terminie` : `za ${fmtKm(n)}`;
}

/** The limit shown as the big line: the one with the higher progress. */
function mainLimit(r) {
  const time = r.days_left !== null && r.days_left !== undefined && r.due_date
    ? { rel: daysText(r.days_left), abs: fmtDate(r.due_date), late: r.days_left < 0, p: r.progress_time ?? -1 }
    : null;
  const km = r.km_left !== null && r.km_left !== undefined && r.due_odometer !== null && r.due_odometer !== undefined
    ? { rel: kmText(r.km_left), abs: fmtKm(r.due_odometer), late: r.km_left < 0, p: Math.max(r.progress_km ?? -1, r.progress_forecast ?? -1) }
    : null;
  if (time && km) return km.p > time.p ? { main: km, time, km } : { main: time, time, km };
  return { main: time || km, time, km };
}

export class VlReminders extends LitElement {
  static properties = {
    hass: { attribute: false },
    vehicle: { attribute: false },
    serviceTypes: { attribute: false },
    narrow: { type: Boolean, reflect: true },
    wide: { type: Boolean, reflect: true },
    openId: {},
    _openId: { state: true },
    _confirmDelete: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };
  static styles = [
    sheetStyles,
    haStyles,
    css`
      :host { display: block; }
      .col { display: flex; flex-direction: column; gap: 12px; }
      :host([wide]) .col { max-width: 640px; margin: 0 auto; }
      button.rcard {
        display: block; width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer;
        padding: 12px 16px 16px; min-height: 48px;
      }
      .top { display: flex; align-items: center; gap: 12px; }
      .top .m { flex: 1; min-width: 0; }
      .top .t1 { font-size: 16px; word-break: break-word; }
      .top .t2 { font-size: 13px; color: var(--secondary-text-color, #727272); word-break: break-word; }
      .big { margin-top: 12px; display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; }
      .big b { font-size: 22px; font-weight: 500; }
      .big .abs { font-size: 13px; color: var(--secondary-text-color, #727272); }
      .late { color: var(--error-color, #db4437); }
      .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
      .two .lbl { font-size: 12px; color: var(--secondary-text-color, #727272); }
      .two .v { font-size: 14px; }
      .bar { margin-top: 12px; }
      .errtxt { margin-top: 12px; }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; }
      .stats b { display: block; font-size: 20px; font-weight: 500; }
      .stats span, .sub { font-size: 13px; color: var(--secondary-text-color, #727272); word-break: break-word; }
      .lines { display: flex; flex-direction: column; gap: 4px; }
      .alert .btn { height: 48px; min-height: 48px; }
      .foot-btns { display: flex; gap: 8px; justify-content: center; }
      .foot-btns .btn { height: 48px; min-height: 48px; }
      .conf { text-align: center; }
    `,
  ];

  constructor() {
    super();
    this._openId = null;
    this.openId = null;
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

  updated(changed) {
    if (changed.has("openId") && this.openId) {
      const hit = this.vehicle?.reminders?.find((r) => r.id === this.openId);
      if (hit) this._show(hit.id);
      this._emit("reminder-opened");
    }
  }

  _card(r) {
    const type = this.serviceTypes?.[r.service_type];
    const st = r.error ? { key: "err", label: "Błąd" } : reminderStatus(r.progress);
    const { main, time, km } = mainLimit(r);
    return html`<button class="card rcard" @click=${() => this._show(r.id)}>
      <div class="top">
        <div class="badge ${st.key ? `b-${st.key}` : "b-service"}"><ha-icon icon=${type?.icon || "mdi:wrench"}></ha-icon></div>
        <div class="m">
          <div class="t1">${r.text}</div>
          ${r.extra_text ? html`<div class="t2">${r.extra_text}</div>` : nothing}
        </div>
        ${st.key && !r.error ? html`<span class="chip c-${st.key}">${st.label}</span>` : nothing}
      </div>
      ${r.error
        ? html`<div class="error errtxt">Nie można policzyć terminu</div>`
        : main
          ? html`<div class="big"><b class=${main.late ? "late" : ""}>${main.rel}</b><span class="abs">${main.abs}</span></div>`
          : nothing}
      ${!r.error && time && km
        ? html`<div class="two">
            <div><div class="lbl">Czas</div><div class="v ${time.late ? "late" : ""}">${time.rel} · ${time.abs}</div></div>
            <div><div class="lbl">Przebieg</div><div class="v ${km.late ? "late" : ""}">${km.rel} · ${km.abs}</div></div>
          </div>`
        : nothing}
      ${r.progress === null || r.progress === undefined
        ? nothing
        : html`<div class="bar" role="progressbar" aria-valuenow=${Math.round(r.progress)} aria-valuemin="0" aria-valuemax="100">
            <i class=${st.key} style="width: ${Math.max(0, Math.min(100, r.progress))}%"></i>
          </div>`}
    </button>`;
  }

  _detail(r) {
    const close = () => (this._openId = null);
    const { time, km } = mainLimit(r);
    const lines = [time, km].filter(Boolean);
    return html`<div class="overlay" @click=${close}>
      <div class="sheet" role="dialog" aria-label=${r.text} @click=${(e) => e.stopPropagation()}>
        <header>
          <button class="ib" aria-label="Zamknij" @click=${close}><ha-icon icon="mdi:close"></ha-icon></button>
          <h2>${r.text}</h2>
        </header>
        <div class="body">
          ${r.extra_text ? html`<div class="sub">${r.extra_text}</div>` : nothing}
          ${r.error ? html`<div class="error">Nie można policzyć terminu</div>` : nothing}
          <div class="stats">
            <div><b>${pct(r.progress_time)}</b><span>czas</span></div>
            <div><b>${pct(r.progress_km)}</b><span>przebieg</span></div>
            <div><b>${pct(r.progress_forecast)}</b><span>prognoza</span></div>
          </div>
          <div class="lines">
            ${lines.map((l) => html`<div class="${l.late ? "late" : ""}">${l.rel} · ${l.abs}</div>`)}
          </div>
        </div>
        <footer>
          ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}
          ${this._confirmDelete
            ? html`<div class="conf">Na pewno usunąć to przypomnienie?</div>
                <div class="foot-btns">
                  <button class="btn text" @click=${() => (this._confirmDelete = false)}>Anuluj</button>
                  <button class="btn fill danger" ?disabled=${this._busy} @click=${() => this._call({ type: "vehicle_log/reminder/delete", reminder_id: r.id })}>Usuń</button>
                </div>`
            : html`<button class="btn fill wide" ?disabled=${this._busy} @click=${() => this._done(r)}>Wykonane</button>
                <div class="foot-btns">
                  <button class="btn text" @click=${() => { close(); this._emit("edit-reminder", r); }}>Edytuj</button>
                  <button class="btn text danger" @click=${() => (this._confirmDelete = true)}>Usuń</button>
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
    return html`<div class="col">
        ${od?.is_due
          ? html`<div class="alert" role="status">
              <ha-icon icon="mdi:alert-outline"></ha-icon>
              <span class="t">Brak odczytu przebiegu od ${od.days_since} ${daysUnit(od.days_since)}</span>
              <button class="btn text" @click=${() => this._emit("add-odometer")}>Aktualizuj</button>
            </div>`
          : nothing}
        ${v.reminders.length
          ? v.reminders.map((r) => this._card(r))
          : html`<div class="empty">Brak przypomnień. Użyj przycisku Przypomnienie, aby dodać pierwsze.</div>`}
      </div>
      ${open ? this._detail(open) : nothing}`;
  }
}
customElements.define("vl-reminders", VlReminders);
