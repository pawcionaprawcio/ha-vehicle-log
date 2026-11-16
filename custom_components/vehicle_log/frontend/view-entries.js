import {
  LitElement, html, css, nothing, haStyles,
  fmtDate, fmtKm, fmtMoney, fmtDec, fmtShortDate, monthLabel, reminderStatus, reminderLimitText,
} from "./ui.js";
import { t, fuelLabel } from "./i18n.js";

export class VlEntries extends LitElement {
  static properties = {
    vehicle: { attribute: false },
    serviceTypes: { attribute: false },
    lang: { attribute: false },
    wide: { type: Boolean, reflect: true },
  };
  static styles = [
    haStyles,
    css`
      :host { display: block; color: var(--primary-text-color); container-type: inline-size; }
      * { box-sizing: border-box; }
      .layout { display: flex; flex-direction: column; gap: 12px; }
      /* Two columns only when the panel itself is wide enough (sidebar open eats ~256px). */
      @container (min-width: 760px) {
        :host([wide]) .layout {
          display: grid; grid-template-columns: 380px minmax(0, 560px); gap: 16px;
          justify-content: center; align-items: start;
        }
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
      .lpg { border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 6px; }
      .lpg .k { font-size: 12px; color: var(--secondary-text-color, #727272); }
      .lpg .saved { font-size: 16px; }
      .lpg .bar { margin-top: 2px; }
      .lpg .s { font-size: 13px; color: var(--secondary-text-color, #727272); }
      .lpg .warn { font-size: 13px; color: var(--warning-color, #ffa600); }
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

  /** Petrol tile/line text: measured, else the manually entered value, else null. */
  _petrolL100(v) {
    if (v.consumption) return { value: v.consumption.avg_l_per_100km, manual: false };
    if (v.petrol_l_per_100km !== null && v.petrol_l_per_100km !== undefined) return { value: v.petrol_l_per_100km, manual: true };
    return null;
  }

  _lpgSection(v) {
    const l = v.lpg;
    if (!l) return nothing;
    const head = t("lpg_since", { date: l.install_date ? fmtDate(l.install_date) : "—" })
      + (l.install_odometer !== null && l.install_odometer !== undefined ? ` (${fmtKm(l.install_odometer)})` : "");
    let body;
    if (l.status === "no_install_odometer") {
      body = html`<div class="warn">${t("lpg_no_install_odometer")}</div>`;
    } else if (l.status === "no_baseline") {
      body = html`<div class="warn">${t("lpg_no_baseline")}</div>`;
    } else if (l.lpg_cost > 0 && l.paid_back) {
      body = html`<div class="saved">${t("lpg_paid_back", { amount: fmtMoney(l.net_savings) })}</div>`;
    } else if (l.lpg_cost > 0) {
      const pct = Math.floor(l.progress_pct ?? 0);
      const when = l.payback_month ? `~${l.payback_month.slice(5, 7)}.${l.payback_month.slice(0, 4)}` : null;
      const rest = [
        t("lpg_remaining", { amount: fmtMoney(l.remaining) }),
        l.payback_odometer !== null && l.payback_odometer !== undefined && v.odometer !== null && v.odometer !== undefined
          ? t("lpg_at_km", { km: fmtKm(Math.max(0, l.payback_odometer - v.odometer)) }) : null,
        when,
      ].filter(Boolean).join(" · ");
      body = html`<div class="saved">${t("lpg_saved", { amount: fmtMoney(l.fuel_savings) })}</div>
        <div class="bar" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><i style="width: ${pct}%"></i></div>
        <div class="s">${t("lpg_progress", { pct, cost: fmtMoney(l.lpg_cost) })}</div>
        <div class="s">${rest}</div>`;
    } else {
      body = html`<div class="saved">${t("lpg_saved", { amount: fmtMoney(l.fuel_savings) })}</div>`;
    }
    const pb = l.baseline_l_per_100km;
    const pbNote = l.baseline_source === "measured" ? t("measured_km", { km: fmtKm(l.measured_km) }) : t("entered");
    const lc = v.lpg_consumption;
    return html`<div class="lpg">
      <div class="k">${head}</div>
      ${body}
      ${l.unpriced_count ? html`<div class="s">${t("lpg_unpriced", { n: l.unpriced_count })}</div>` : nothing}
      ${pb !== null && pb !== undefined ? html`<div class="s">${t("petrol_consumption")}: ${this._l100(pb)} (${pbNote})</div>` : nothing}
      ${lc ? html`<div class="s">LPG: ~${this._l100(lc.avg_l_per_100km)} (${t("approximate")})</div>` : nothing}
    </div>`;
  }

  _vehicleCard(v, withNext) {
    const c = v.consumption;
    const pb = this._petrolL100(v);
    const lc = v.lpg_consumption;
    const petrolSegs = (v.segments || []).filter((s) => s.fuel !== "lpg");
    const lastSeg = petrolSegs.length ? petrolSegs[petrolSegs.length - 1] : null;
    const showForecast = v.forecast_odometer !== null && v.forecast_odometer !== undefined && v.forecast_odometer !== v.odometer;
    const stale = v.odometer_update?.is_due;
    const meta = [(v.fuel_types || []).map(fuelLabel).join(" + "), v.purchase_date ? t("since", { date: fmtDate(v.purchase_date) }) : ""]
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
        ? html`<div class="verr error">${t("vehicle_load_error")}</div>`
        : html`<div class="odo">
              <div class="k">${t("odometer")}</div>
              <div class="big">${v.odometer === null || v.odometer === undefined ? "—" : fmtKm(v.odometer)}</div>
              ${showForecast ? html`<div class="est">${t("forecast_today", { km: fmtKm(v.forecast_odometer) })}</div>` : nothing}
            </div>
            ${stale ? html`<div class="stale">${t("no_reading_for", { n: v.odometer_update.days_since })}</div>` : nothing}
            <div class="tiles">
              <div class="tile">
                <div class="k">${v.lpg || lc ? t("petrol_consumption") : t("avg_consumption")}</div>
                <div class="v">${pb ? this._l100(pb.value) : "—"}</div>
                <div class="s">${c ? `${fmtMoney(c.avg_cost_per_100km)} / 100 km` : pb ? `(${t("entered")})` : t("consumption_hint")}</div>
              </div>
              <div class="tile">
                <div class="k">${t("last_consumption")}</div>
                <div class="v">${c ? this._l100(c.last_l_per_100km) : "—"}</div>
                ${c && lastSeg ? html`<div class="s">${t("refuel_on", { date: fmtShortDate(lastSeg.to_date) })}</div>` : nothing}
              </div>
              ${lc
                ? html`<div class="tile">
                    <div class="k">${t("lpg_consumption")}</div>
                    <div class="v">~${this._l100(lc.avg_l_per_100km)}</div>
                    <div class="s">${t("approximate")}</div>
                  </div>`
                : nothing}
            </div>
            ${this._lpgSection(v)}`}
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
      <div class="card-h"><span>${t("tab_reminders")}</span><button @click=${() => this._openReminder(null)}>${t("all")}</button></div>
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
        <div class="m"><div class="t1">${e.name || type?.label || t("entry")}</div><div class="t2">${[t("bad_entry"), date].filter(Boolean).join(" · ")}</div></div>
      </button>`;
    }
    if (e.kind === "refuel") {
      const title = [t("refuel"), e.fuel_type ? fuelLabel(e.fuel_type) : null, e.full_tank ? null : t("partial")].filter(Boolean).join(" ");
      const sub = [
        date,
        e.litres === null || e.litres === undefined ? "" : `${fmtDec(e.litres, 0, 2)} l`,
        e.price_per_litre === null || e.price_per_litre === undefined ? "" : `${fmtDec(e.price_per_litre, 2, 3)} zł/l`,
      ].filter(Boolean).join(" · ");
      const fuel = e.fuel_type === "LPG" ? "lpg" : "petrol";
      const seg = (v.segments || []).find((s) => s.fuel === fuel && s.to_odometer === e.odometer && s.to_date === e.date);
      return html`<button class="li" @click=${() => this._open(e)}>
        <div class="badge b-refuel"><ha-icon icon="mdi:gas-station"></ha-icon></div>
        <div class="m"><div class="t1">${title}</div><div class="t2">${sub}</div></div>
        <div class="e">
          <div class="t1">${fmtMoney(e.total)}</div>
          ${seg ? html`<div class="t2">${fuel === "lpg" ? "~" : ""}${fmtDec(seg.l_per_100km, 1, 1)} l/100</div>` : nothing}
        </div>
      </button>`;
    }
    if (e.kind === "odometer") {
      return html`<button class="li dim compact" @click=${() => this._open(e)}>
        <div class="badge b-odo"><ha-icon icon="mdi:counter"></ha-icon></div>
        <div class="m"><div class="t1">${t("odometer_reading")}</div><div class="t2">${date}</div></div>
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
      const label = e.date ? monthLabel(e.date) : t("no_date");
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(e);
      else groups.push({ label, items: [e] });
    }
    if (!groups.length) {
      return html`<div class="card"><div class="empty">${t("no_entries")}</div></div>`;
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
