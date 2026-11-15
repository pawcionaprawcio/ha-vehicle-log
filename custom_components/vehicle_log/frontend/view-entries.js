import { LitElement, html, css, nothing, fmtDate, fmtKm, fmtMoney, fmtDec } from "./ui.js";

export class VlEntries extends LitElement {
  static properties = {
    vehicle: { attribute: false },
    serviceTypes: { attribute: false },
  };
  static styles = css`
    :host { display: block; color: var(--primary-text-color); }
    .card {
      background: var(--card-background-color, #fff); border-radius: 12px; padding: 12px 16px; margin: 12px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px;
      box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0, 0, 0, 0.2));
    }
    .stat small { display: block; color: var(--secondary-text-color); font-size: 12px; }
    .stat b { font-size: 18px; font-weight: 500; }
    .stat .sub { color: var(--secondary-text-color); font-size: 12px; }
    h3 { margin: 16px 16px 4px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); }
    .row {
      display: flex; align-items: center; gap: 16px; width: 100%; min-height: 56px; padding: 6px 16px;
      background: var(--card-background-color, #fff); border: none; border-bottom: 1px solid var(--divider-color);
      color: inherit; font: inherit; text-align: left; cursor: pointer;
    }
    .row ha-icon { color: var(--secondary-text-color); flex: none; }
    .main { flex: 1; min-width: 0; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-size: 12px; color: var(--secondary-text-color); }
    .end { text-align: right; flex: none; }
    .empty { padding: 32px 16px; text-align: center; color: var(--secondary-text-color); }
    .warn { color: var(--warning-color, #f4a100); }
  `;

  _open(entry) {
    this.dispatchEvent(new CustomEvent("edit-entry", { detail: entry, bubbles: true, composed: true }));
  }

  _l100(n) {
    return `${fmtDec(n, 1, 1)} l/100 km`;
  }

  _summary(v) {
    const c = v.consumption;
    const showForecast = v.forecast_odometer !== null && v.forecast_odometer !== v.odometer;
    const stale = v.odometer_update?.is_due;
    return html`<div class="card">
      <div class="stat">
        <small>Przebieg</small><b>${v.odometer === null ? "—" : fmtKm(v.odometer)}</b>
        ${stale ? html`<div class="sub warn">Brak odczytu od ${v.odometer_update.days_since} dni</div>` : nothing}
      </div>
      <div class="stat">
        <small>Szacowany przebieg</small><b>${v.forecast_odometer === null ? "—" : fmtKm(v.forecast_odometer)}</b>
        ${showForecast ? nothing : html`<div class="sub">zgodny z odczytem</div>`}
      </div>
      <div class="stat">
        <small>Ostatnie spalanie</small><b>${c ? this._l100(c.last_l_per_100km) : "—"}</b>
        ${c ? nothing : html`<div class="sub">od drugiego tankowania do pełna</div>`}
      </div>
      <div class="stat">
        <small>Średnie spalanie</small><b>${c ? this._l100(c.avg_l_per_100km) : "—"}</b>
        ${c ? html`<div class="sub">${fmtMoney(c.avg_cost_per_100km)} / 100 km</div>` : nothing}
      </div>
    </div>`;
  }

  _row(e) {
    const type = this.serviceTypes?.[e.service_type];
    const isRefuel = e.kind === "refuel";
    const name = isRefuel
      ? ["Tankowanie", e.fuel_type, e.full_tank ? null : "(częściowe)"].filter(Boolean).join(" ")
      : e.name || type?.label || "";
    const sub = isRefuel
      ? `${fmtDec(e.litres, 0, 2)} l · ${fmtDec(e.price_per_litre, 2, 3)} zł/l`
      : e.kind === "odometer"
        ? "Odczyt przebiegu"
        : "";
    return html`<button class="row" @click=${() => this._open(e)}>
      <ha-icon icon=${type?.icon || "mdi:wrench"}></ha-icon>
      <div class="main">
        <div class="name">${name}</div>
        ${sub ? html`<div class="sub">${sub}</div>` : nothing}
      </div>
      <div class="end">
        <div>${e.kind === "odometer" ? "" : fmtMoney(e.total)}</div>
        <div class="sub">${fmtKm(e.odometer)}</div>
      </div>
    </button>`;
  }

  render() {
    const v = this.vehicle;
    if (!v) return nothing;
    const groups = [];
    for (const e of v.entries) {
      const last = groups[groups.length - 1];
      if (last && last.date === e.date) last.items.push(e);
      else groups.push({ date: e.date, items: [e] });
    }
    return html`${this._summary(v)}
    ${groups.length
      ? groups.map((g) => html`<h3>${fmtDate(g.date)}</h3>${g.items.map((e) => this._row(e))}`)
      : html`<div class="empty">Brak wpisów. Użyj przycisku +, aby dodać pierwszy.</div>`}
    <div style="height: 88px"></div>`;
  }
}
customElements.define("vl-entries", VlEntries);
