import { VlForm, html, css, nothing, refuelDerivedKey, parseNum, badNum, intError, toField, fmtDec, fmtInt, todayIso, nowTime, storage } from "./ui.js";
import { LIMITS } from "./ui.js";
import { t as tr, fuelLabel } from "./i18n.js";

const OTHER = "__other";
const LPG = "LPG";
const AMOUNTS = ["total", "price_per_litre", "litres"];

export class VlRefuelForm extends VlForm {
  static properties = {
    ...VlForm.properties,
    _f: { state: true },
    _showTax: { state: true },
    _showComment: { state: true },
  };
  static styles = [
    VlForm.styles,
    css`
      .seg { display: flex; border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.5)); border-radius: 24px; overflow: hidden; }
      .seg button {
        flex: 1; min-width: 0; height: 48px; min-height: 48px; padding: 0 8px; border: 0; border-radius: 0;
        display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 14px; background: transparent;
        --mdc-icon-size: 18px;
      }
      .seg button:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -2px; }
      .seg button + button { border-left: 1px solid var(--divider-color, rgba(127, 127, 127, 0.5)); }
      .seg button[aria-checked="true"] {
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 22%, transparent);
        color: var(--primary-color, #03a9f4);
      }
    `,
  ];

  willUpdate(changed) {
    if (changed.has("entry") || !this._f) this._init();
  }

  /** Fuels to offer: the vehicle's own, or the whole catalog for a vehicle without any set. */
  get _ownFuels() {
    return this.vehicle?.fuel_types || [];
  }

  _fuelOptions() {
    const own = this._ownFuels;
    if (!own.length) return this.view?.fuel_types || [];
    // an older refuel may hold a fuel the vehicle no longer has; keep it selectable when editing it
    const current = this.entry?.fuel_type;
    return current && !own.includes(current) ? [...own, current] : own;
  }

  _init() {
    const e = this.entry || {};
    const types = this._fuelOptions();
    let fuel = e.fuel_type;
    if (!this.editing) {
      const last = (this.vehicle?.entries || []).find((x) => x.kind === "refuel" && x.fuel_type);
      fuel = [storage.get(`vehicle_log.fuel.${this.vehicle?.id}`), last?.fuel_type].find((x) => x && types.includes(x))
        || types[0] || "";
    }
    const known = !fuel || types.includes(fuel);
    this._order = [];
    this._f = {
      total: toField(e.total),
      price_per_litre: toField(e.price_per_litre),
      litres: toField(e.litres),
      fuel: known ? fuel || "" : OTHER,
      fuel_other: known ? "" : fuel,
      full_tank: this.editing ? Boolean(e.full_tank) : true,
      odometer: toField(e.odometer),
      date: e.date || todayIso(),
      time: e.time || nowTime(),
      tax_pct: toField(e.tax_pct),
      comment: e.comment || "",
      petrol_price: toField(e.petrol_price),
      petrol_only: Boolean(e.petrol_only),
    };
    this._showTax = Boolean(e.tax_pct);
    this._showComment = Boolean(e.comment);
  }

  get heading() {
    return tr("refuel");
  }

  _set(key, value) {
    const next = { ...this._f, [key]: value };
    if (AMOUNTS.includes(key)) {
      this._order = [key, ...this._order.filter((k) => k !== key)];
      // A complete triple would be saved as-is and could disagree: empty the
      // derived field so it shows as a greyed computed value instead.
      if (AMOUNTS.every((k) => parseNum(next[k]) !== null)) next[refuelDerivedKey(key)] = "";
    }
    this._f = next;
  }

  /** The amount field to leave empty so the backend derives it, or null. */
  _derivedKey() {
    const filled = AMOUNTS.filter((k) => parseNum(this._f[k]) !== null);
    if (filled.length === 2) return AMOUNTS.find((k) => !filled.includes(k));
    return null; // untouched complete triple (stored values) is sent unchanged
  }

  _computed(key) {
    const { total, price_per_litre: price, litres } = Object.fromEntries(
      AMOUNTS.map((k) => [k, parseNum(this._f[k])]),
    );
    if (key === "total" && price !== null && litres !== null) return fmtDec(price * litres, 2, 2);
    if (key === "litres" && total !== null && price) return fmtDec(total / price, 0, 3);
    if (key === "price_per_litre" && total !== null && litres) return fmtDec(total / litres, 2, 3);
    return "";
  }

  buildEntry() {
    const f = this._f;
    const odoErr = intError(f.odometer);
    if (odoErr) throw new Error(odoErr);
    for (const k of [...AMOUNTS, "odometer", "tax_pct", "petrol_price"]) {
      if (badNum(f[k])) throw new Error(tr("bad_number"));
    }
    const drop = this._derivedKey();
    if (AMOUNTS.filter((k) => parseNum(f[k]) !== null).length < 2 && !drop) {
      throw new Error(tr("two_of_three"));
    }
    if (!f.date) throw new Error(tr("need_date"));
    const fuel = f.fuel === OTHER ? f.fuel_other.trim() : f.fuel;
    const amounts = Object.fromEntries(AMOUNTS.map((k) => [k, k === drop ? "" : f[k]]));
    const entry = {
      ...(this.entry || {}),
      kind: "refuel",
      vehicle_id: this.vehicle.id,
      ...amounts,
      fuel_type: fuel || null,
      full_tank: f.full_tank,
      odometer: f.odometer,
      date: f.date,
      time: f.time || null,
      tax_pct: f.tax_pct,
      // no discount fields here: a discount stored on an older refuel is kept via ...this.entry
      comment: f.comment,
      // the store keeps petrol_price only on LPG refuels and petrol_only only on the others
      petrol_price: fuel === LPG ? f.petrol_price : "",
      petrol_only: fuel !== LPG && this._hasInstall ? f.petrol_only : false,
    };
    if (fuel) storage.set(`vehicle_log.fuel.${this.vehicle.id}`, fuel);
    return entry;
  }

  get _hasInstall() {
    const odo = this.vehicle?.lpg?.install_odometer;
    return odo !== null && odo !== undefined;
  }

  get _isLpg() {
    return (this._f.fuel === OTHER ? this._f.fuel_other.trim() : this._f.fuel) === LPG;
  }

  _renderPetrolPrice() {
    const f = this._f;
    if (!this._isLpg) return nothing;
    return html`${this.num(tr("petrol_price"), f.petrol_price, (v) => this._set("petrol_price", v), "", "zł/l")}
      <div class="hint">${tr("petrol_price_hint")}</div>`;
  }

  _renderPetrolOnly() {
    const f = this._f;
    if (this._isLpg || !this._hasInstall) return nothing;
    return this.switchRow(tr("petrol_only"), f.petrol_only, (v) => this._set("petrol_only", v), tr("petrol_only_hint"));
  }

  _amount(label, key, suffix) {
    const computed = this._f[key] === "" ? this._computed(key) : "";
    return this.num(label, this._f[key], (v) => this._set(key, v), computed, suffix);
  }

  _segKey(e, types) {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = Math.max(0, types.indexOf(this._f.fuel));
    const next = types[(i + d + types.length) % types.length];
    this._set("fuel", next);
    this.updateComplete.then(() => this.renderRoot.querySelector('.seg button[aria-checked="true"]')?.focus());
  }

  _renderFuel() {
    const f = this._f;
    const types = this._fuelOptions();
    if (this._ownFuels.length) {
      return html`<div class="seg" role="radiogroup" aria-label=${tr("fuel_type")} @keydown=${(e) => this._segKey(e, types)}>
        ${types.map((t, i) => {
          const on = f.fuel === t;
          const tab = on || (!types.includes(f.fuel) && i === 0);
          return html`<button role="radio" tabindex=${tab ? 0 : -1} aria-checked=${on ? "true" : "false"} @click=${() => this._set("fuel", t)}>
            ${on ? html`<ha-icon icon="mdi:check"></ha-icon>` : nothing}${fuelLabel(t)}
          </button>`;
        })}
      </div>`;
    }
    return html`<label
        >${tr("fuel_type")}
        <select @change=${(e) => this._set("fuel", e.target.value)}>
          ${types.map((t) => html`<option value=${t} ?selected=${f.fuel === t}>${fuelLabel(t)}</option>`)}
          <option value=${OTHER} ?selected=${f.fuel === OTHER}>${tr("other_fuel_option")}</option>
        </select>
      </label>
      ${f.fuel === OTHER
        ? this.field(tr("other_fuel"), f.fuel_other, (v) => this._set("fuel_other", v), { maxlength: 30 })
        : nothing}`;
  }

  renderBody() {
    const f = this._f;
    return html`<div class="body">
      ${this._renderFuel()} ${this._amount(tr("amount"), "total", "zł")}
      <div class="row">
        ${this._amount(tr("price_per_litre"), "price_per_litre", "zł/l")} ${this._amount(tr("litres"), "litres", "l")}
      </div>
      <div class="hint">${tr("two_values_hint")}</div>
      ${this._renderPetrolPrice()}
      ${this.field(tr("odometer"), f.odometer, (v) => this._set("odometer", v), {
        inputmode: "numeric",
        suffix: "km",
        placeholder: !this.editing && this.vehicle?.odometer != null ? tr("last_value", { value: fmtInt(this.vehicle.odometer) }) : "",
      })}
      ${this.switchRow(tr("full_tank"), f.full_tank, (v) => this._set("full_tank", v), tr("full_tank_hint"))}
      ${this._renderPetrolOnly()}
      <div class="row">
        ${this.field(tr("date"), f.date, (v) => this._set("date", v), { type: "date" })}
        ${this.field(tr("time"), f.time, (v) => this._set("time", v), { type: "time" })}
      </div>
      ${this.expander(
        this._showTax,
        tr("tax"),
        () => (this._showTax = true),
        this.num(tr("tax"), f.tax_pct, (v) => this._set("tax_pct", v), "", "%"),
      )}
      ${this.expander(
        this._showComment,
        tr("comment"),
        () => (this._showComment = true),
        this.textArea(tr("comment"), f.comment, LIMITS.comment, (v) => this._set("comment", v)),
      )}
    </div>`;
  }
}
customElements.define("vl-refuel-form", VlRefuelForm);
