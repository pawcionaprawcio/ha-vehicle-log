import {
  LitElement, html, css, nothing, haStyles,
  fmtDate, fmtKm, fmtMoney, fmtDec, fmtShortDate, monthLabel, reminderStatus, reminderLimitText,
} from "./ui.js";

export class VlEntries extends LitElement {
  static properties = {
    vehicle: { attribute: false },
    serviceTypes: { attribute: false },
    wide: { type: Boolean, reflect: true },
  };
  static styles = [
    haStyles,
    css`
      :host { display: block; color: var(--primary-text-color); }
      * { box-sizing: border-box; }
      .layout { display: flex; flex-direction: column; gap: 12px; }
      :host([wide]) .layout {
        display: grid; grid-template-columns: 380px minmax(0, 560px); gap: 16px;
        justify-content: center; align-items: start;
      }
      .col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
      .vhead { display: flex; align-items: center; gap: 12px; padding: 16px 16px 0; }
      .vhead .m { flex: 1; min-width: 0; }
      .vname { font-size: 18px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vmeta { font-size: 13px; color: var(--secondary-text-color, #727272); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .odo { padding: 12px 16px 0; }
      .odo .k { font-size: 12px; color: var(--secondary-text-color, #727272); }
      .odo .big { font-size: 32px; font-weight: 400; line-height: 1.2; }
      .odo .est { font-size: 13px; color: var(--secondary-text-color, #727272); }
      .stale { padding: 4px 16px 0; font-size: 13px; color: var(--warning-color, #ffa600); }
      .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px 16px 16px; }
      .tile {
        border-radius: 10px; padding: 10px 12px; min-width: 0;
        background: color-mix(in srgb, var(--secondary-text-color, #727272) 10%, transparent);
      }
      .tile .k { font-size: 12px; color: var(--secondary-text-color, #727272); }
      .tile .v { font-size: 18px; margin-top: 2px; }
      .tile .s { font-size: 12px; color: var(--secondary-text-color, #727272); }
      .verr { padding: 16px; }
      .nextrem { border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); }
      .li .chev { color: var(--secondary-text-color, #727272); flex: none; }
      .groups { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .groups .card { margin-bottom: 8px; }
    `,
  ];

  _open(entry) {
    this.dispatchEvent(new CustomEvent("edit-entry", { detail: entry, bubbles: true, composed: true }));
  }

  _openReminder(id) {
    this.dispatchEvent(new CustomEvent("open-reminder", { detail: id, bubbles: true, composed: true }));
  }

  _l100(n) {
    return `${fmtDec(n, 1, 1)} l/100 km`;
  }

  _vehicleCard(v, withNext) {
    const c = v.consumption;
    const lastSeg = v.segments?.length ? v.segments[v.segments.length - 1] : null;
    const showForecast = v.forecast_odometer !== null && v.forecast_odometer !== undefined && v.forecast_odometer !== v.odometer;
    const stale = v.odometer_update?.is_due;
    const meta = [(v.fuel_types || []).join(" + "), v.purchase_date ? `od ${fmtDate(v.purchase_date)}` : ""]
      .filter(Boolean)
      .join(" · ");
    const next = withNext && v.reminders?.length ? v.reminders[0] : null;
    return html`<div class="card">
      <div class="vhead">
        <div class="badge b-primary"><ha-icon icon=${v.icon || "mdi:car"}></ha-icon></div>
        <div class="m">
          <div class="vname">${v.name}</div>
          ${meta ? html`<div class="vmeta">${meta}</div>` : nothing}
        </div>
      </div>
      ${v.error
        ? html`<div class="verr error">Nie udało się wczytać danych pojazdu</div>`
        : html`<div class="odo">
              <div class="k">Przebieg</div>
              <div class="big">${v.odometer === null || v.odometer === undefined ? "—" : fmtKm(v.odometer)}</div>
              ${showForecast ? html`<div class="est">szac. dziś ${fmtKm(v.forecast_odometer)}</div>` : nothing}
            </div>
            ${stale ? html`<div class="stale">Brak odczytu od ${v.odometer_update.days_since} dni</div>` : nothing}
            <div class="tiles">
              <div class="tile">
                <div class="k">Średnie spalanie</div>
                <div class="v">${c ? this._l100(c.avg_l_per_100km) : "—"}</div>
                <div class="s">${c ? `${fmtMoney(c.avg_cost_per_100km)} / 100 km` : "od drugiego tankowania do pełna"}</div>
              </div>
              <div class="tile">
                <div class="k">Ostatnie spalanie</div>
                <div class="v">${c ? this._l100(c.last_l_per_100km) : "—"}</div>
                ${c && lastSeg ? html`<div class="s">tankowanie ${fmtShortDate(lastSeg.to_date)}</div>` : nothing}
              </div>
            </div>`}
      ${next ? this._nextRow(next) : nothing}
    </div>`;
  }

  _nextRow(r) {
    const st = reminderStatus(r.progress);
    const sub = reminderLimitText(r);
    return html`<button class="li nextrem" @click=${() => this._openReminder(r.id)}>
      <div class="badge ${st.key ? `b-${st.key}` : ""}"><ha-icon icon="mdi:bell-outline"></ha-icon></div>
      <div class="m">
        <div class="t1">${r.text}</div>
        ${sub ? html`<div class="t2">${sub}</div>` : nothing}
      </div>
      <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
    </button>`;
  }

  _remindersCard(v) {
    const items = (v.reminders || []).slice(0, 3);
    if (!items.length) return nothing;
    return html`<div class="card">
      <div class="card-h"><span>Przypomnienia</span><button @click=${() => this._openReminder(null)}>Wszystkie</button></div>
      ${items.map((r) => {
        const st = reminderStatus(r.progress);
        const sub = reminderLimitText(r);
        return html`<button class="li" @click=${() => this._openReminder(r.id)}>
          <div class="m">
            <div class="t1">${r.text}</div>
            ${sub ? html`<div class="t2">${sub}</div>` : nothing}
          </div>
          ${st.key ? html`<span class="chip c-${st.key}">${st.label}</span>` : nothing}
        </button>`;
      })}
    </div>`;
  }

  _row(v, e) {
    const type = this.serviceTypes?.[e.service_type];
    const date = fmtShortDate(e.date);
    const km = e.odometer === null || e.odometer === undefined ? "" : fmtKm(e.odometer);
    if (e.error) {
      return html`<button class="li" @click=${() => this._open(e)}>
        <div class="badge b-err"><ha-icon icon="mdi:alert-circle-outline"></ha-icon></div>
        <div class="m"><div class="t1">${e.name || type?.label || "Wpis"}</div><div class="t2">Błędny wpis</div></div>
      </button>`;
    }
    if (e.kind === "refuel") {
      const title = ["Tankowanie", e.fuel_type, e.full_tank ? null : "(częściowe)"].filter(Boolean).join(" ");
      const sub = [
        date,
        e.litres === null || e.litres === undefined ? "" : `${fmtDec(e.litres, 0, 2)} l`,
        e.price_per_litre === null || e.price_per_litre === undefined ? "" : `${fmtDec(e.price_per_litre, 2, 3)} zł/l`,
      ].filter(Boolean).join(" · ");
      const seg = (v.segments || []).find((s) => s.to_odometer === e.odometer && s.to_date === e.date);
      return html`<button class="li" @click=${() => this._open(e)}>
        <div class="badge b-refuel"><ha-icon icon="mdi:gas-station"></ha-icon></div>
        <div class="m"><div class="t1">${title}</div><div class="t2">${sub}</div></div>
        <div class="e">
          <div class="t1">${fmtMoney(e.total)}</div>
          ${seg ? html`<div class="t2">${fmtDec(seg.l_per_100km, 1, 1)} l/100</div>` : nothing}
        </div>
      </button>`;
    }
    if (e.kind === "odometer") {
      return html`<button class="li dim compact" @click=${() => this._open(e)}>
        <div class="badge b-odo"><ha-icon icon="mdi:counter"></ha-icon></div>
        <div class="m"><div class="t1">Odczyt przebiegu</div><div class="t2">${date}</div></div>
        <div class="e"><div class="t1">${km}</div></div>
      </button>`;
    }
    return html`<button class="li" @click=${() => this._open(e)}>
      <div class="badge b-service"><ha-icon icon=${type?.icon || "mdi:wrench"}></ha-icon></div>
      <div class="m">
        <div class="t1">${e.name || type?.label || ""}</div>
        <div class="t2">${[date, km].filter(Boolean).join(" · ")}</div>
      </div>
      <div class="e"><div class="t1">${fmtMoney(e.total)}</div></div>
    </button>`;
  }

  _history(v) {
    const groups = [];
    for (const e of v.entries || []) {
      const label = e.date ? monthLabel(e.date) : "Bez daty";
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(e);
      else groups.push({ label, items: [e] });
    }
    if (!groups.length) {
      return html`<div class="card"><div class="empty">Brak wpisów. Użyj przycisku Dodaj, aby dodać pierwszy.</div></div>`;
    }
    return html`<div class="groups">
      ${groups.map(
        (g) => html`<div class="sec-h">${g.label}</div>
          <div class="card">${g.items.map((e) => this._row(v, e))}</div>`,
      )}
    </div>`;
  }

  render() {
    const v = this.vehicle;
    if (!v) return nothing;
    if (this.wide) {
      return html`<div class="layout">
        <div class="col">${this._vehicleCard(v, false)}${this._remindersCard(v)}</div>
        <div class="col">${this._history(v)}</div>
      </div>`;
    }
    return html`<div class="layout">${this._vehicleCard(v, true)}${this._history(v)}</div>`;
  }
}
customElements.define("vl-entries", VlEntries);
