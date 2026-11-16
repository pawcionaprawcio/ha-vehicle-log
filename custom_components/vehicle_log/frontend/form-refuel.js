import { VlForm, html, css, nothing, refuelDerivedKey, parseNum, badNum, intError, toField, fmtDec, fmtInt, todayIso, nowTime, storage } from "./ui.js";
import { LIMITS } from "./ui.js";

const OTHER = "__other";
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
      discount_pct: toField(e.discount_pct),
      discount_amount: toField(e.discount_amount),
      comment: e.comment || "",
    };
    this._showTax = Boolean(e.tax_pct || e.discount_pct || e.discount_amount);
    this._showComment = Boolean(e.comment);
  }

  get heading() {
    return "Tankowanie";
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
    for (const k of [...AMOUNTS, "odometer", "tax_pct", "discount_pct", "discount_amount"]) {
      if (badNum(f[k])) throw new Error("Popraw nieprawidłową liczbę.");
    }
    const drop = this._derivedKey();
    if (AMOUNTS.filter((k) => parseNum(f[k]) !== null).length < 2 && !drop) {
      throw new Error("Podaj dwie z trzech wartości: koszt, cena za litr, litry.");
    }
    if (!f.date) throw new Error("Podaj datę.");
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
      discount_pct: f.discount_pct,
      discount_amount: f.discount_amount,
      comment: f.comment,
    };
    if (fuel) storage.set(`vehicle_log.fuel.${this.vehicle.id}`, fuel);
    return entry;
  }

  _amount(label, key, suffix) {
    const computed = this._f[key] === "" ? this._computed(key) : "";
    return this.num(label, this._f[key], (v) => this._set(key, v), computed, suffix);
  }

  _renderFuel() {
    const f = this._f;
    const types = this._fuelOptions();
    if (this._ownFuels.length) {
      return html`<div class="seg" role="radiogroup" aria-label="Rodzaj paliwa">
        ${types.map((t) => {
          const on = f.fuel === t;
          return html`<button role="radio" aria-checked=${on ? "true" : "false"} @click=${() => this._set("fuel", t)}>
            ${on ? html`<ha-icon icon="mdi:check"></ha-icon>` : nothing}${t}
          </button>`;
        })}
      </div>`;
    }
    return html`<label
        >Rodzaj paliwa
        <select @change=${(e) => this._set("fuel", e.target.value)}>
          ${types.map((t) => html`<option value=${t} ?selected=${f.fuel === t}>${t}</option>`)}
          <option value=${OTHER} ?selected=${f.fuel === OTHER}>inny…</option>
        </select>
      </label>
      ${f.fuel === OTHER
        ? this.field("Inne paliwo", f.fuel_other, (v) => this._set("fuel_other", v), { maxlength: 30 })
        : nothing}`;
  }

  renderBody() {
    const f = this._f;
    return html`<div class="body">
      ${this._renderFuel()} ${this._amount("Kwota", "total", "zł")}
      <div class="row">
        ${this._amount("Cena za litr", "price_per_litre", "zł/l")} ${this._amount("Litry", "litres", "l")}
      </div>
      <div class="hint">Wpisz dwie wartości, trzecia zostanie wyliczona.</div>
      ${this.field("Przebieg", f.odometer, (v) => this._set("odometer", v), {
        inputmode: "numeric",
        suffix: "km",
        placeholder: !this.editing && this.vehicle?.odometer != null ? `ostatnio ${fmtInt(this.vehicle.odometer)}` : "",
      })}
      ${this.switchRow("Do pełna", f.full_tank, (v) => this._set("full_tank", v), "Potrzebne do liczenia spalania")}
      <div class="row">
        ${this.field("Data", f.date, (v) => this._set("date", v), { type: "date" })}
        ${this.field("Godzina", f.time, (v) => this._set("time", v), { type: "time" })}
      </div>
      ${this.expander(
        this._showTax,
        "Podatek lub rabat",
        () => (this._showTax = true),
        html`${this.num("Podatek", f.tax_pct, (v) => this._set("tax_pct", v), "", "%")}
          <div class="row">
            ${this.num("Rabat", f.discount_pct, (v) => this._set("discount_pct", v), "", "%")}
            ${this.num("Rabat", f.discount_amount, (v) => this._set("discount_amount", v), "", "zł")}
          </div>`,
      )}
      ${this.expander(
        this._showComment,
        "Komentarz",
        () => (this._showComment = true),
        this.textArea("Komentarz", f.comment, LIMITS.comment, (v) => this._set("comment", v)),
      )}
    </div>`;
  }
}
customElements.define("vl-refuel-form", VlRefuelForm);
