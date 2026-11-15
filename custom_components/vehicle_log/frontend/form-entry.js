import "./type-picker.js";
import { VlForm, html, nothing, parseNum, badNum, intError, toField, fmtDec, todayIso, entryTotal, LIMITS } from "./ui.js";

const NUMERIC = ["odometer", "parts", "labour", "total", "tax_pct", "discount_pct", "discount_amount"];

export class VlEntryForm extends VlForm {
  static properties = {
    ...VlForm.properties,
    _step: { state: true },
    _f: { state: true },
    _totalTouched: { state: true },
    _showTax: { state: true },
  };
  willUpdate(changed) {
    if (changed.has("entry") || !this._f) this._init();
  }

  _init() {
    const e = this.entry || {};
    this._step = this.editing ? 2 : 1;
    this._f = {
      service_type: e.service_type || "other",
      name: e.name || "",
      date: e.date || todayIso(),
      odometer: toField(e.odometer),
      parts: toField(e.parts),
      labour: toField(e.labour),
      total: toField(e.total),
      tax_pct: toField(e.tax_pct),
      discount_pct: toField(e.discount_pct),
      discount_amount: toField(e.discount_amount),
      part_numbers: e.part_numbers || "",
      comment: e.comment || "",
      accessory: Boolean(e.accessory),
    };
    const auto = entryTotal(e.parts, e.labour, e.tax_pct, e.discount_pct, e.discount_amount);
    this._totalTouched = this.editing && e.total !== null && e.total !== undefined && e.total !== auto;
    this._showTax = Boolean(e.tax_pct || e.discount_pct || e.discount_amount);
  }

  get heading() {
    return this._step === 1 ? "Wybierz rodzaj" : this.editing ? "Edytuj serwis" : "Dodaj serwis";
  }

  _set(key, value) {
    this._f = { ...this._f, [key]: value };
  }

  _autoTotal() {
    const f = this._f;
    const [p, l] = [parseNum(f.parts), parseNum(f.labour)];
    if (p === null && l === null) return "";
    return fmtDec(entryTotal(p, l, parseNum(f.tax_pct), parseNum(f.discount_pct), parseNum(f.discount_amount)), 0, 2);
  }

  _pickType(id, label) {
    this._f = { ...this._f, service_type: id, name: label };
    this._step = 2;
  }

  showFooter() {
    return this._step === 2;
  }

  buildEntry() {
    const f = this._f;
    const total = this._totalTouched ? f.total : this._autoTotal();
    const odoErr = intError(f.odometer);
    if (odoErr) throw new Error(odoErr);
    for (const k of NUMERIC) if (badNum(f[k])) throw new Error("Popraw nieprawidłową liczbę.");
    if (badNum(total)) throw new Error("Popraw nieprawidłową liczbę.");
    if (!f.name.trim()) throw new Error("Podaj nazwę.");
    if (!f.date) throw new Error("Podaj datę.");
    return {
      ...(this.entry || {}),
      kind: "service",
      vehicle_id: this.vehicle.id,
      service_type: f.service_type,
      name: f.name.trim(),
      date: f.date,
      odometer: f.odometer,
      parts: f.parts,
      labour: f.labour,
      total,
      tax_pct: f.tax_pct,
      discount_pct: f.discount_pct,
      discount_amount: f.discount_amount,
      part_numbers: f.part_numbers,
      comment: f.comment,
      accessory: f.accessory,
    };
  }

  _renderPicker() {
    return html`<vl-type-picker
      .serviceTypes=${this.view?.service_types}
      @pick=${(e) => this._pickType(e.detail.id, e.detail.label)}
    ></vl-type-picker>`;
  }

  renderBody() {
    if (this._step === 1) return this._renderPicker();
    const f = this._f;
    const type = this.view?.service_types?.[f.service_type];
    return html`<div class="body">
      ${this.editing
        ? nothing
        : html`<button class="link" @click=${() => (this._step = 1)}>
            ${type ? `Rodzaj: ${type.label} (zmień)` : "Zmień rodzaj"}
          </button>`}
      ${this.field("Nazwa", f.name, (v) => this._set("name", v), { maxlength: LIMITS.name })}
      ${this.field("Data", f.date, (v) => this._set("date", v), { type: "date" })}
      ${this.field("Przebieg (km)", f.odometer, (v) => this._set("odometer", v), { inputmode: "numeric" })}
      <div class="row">
        ${this.num("Części (zł)", f.parts, (v) => this._set("parts", v))}
        ${this.num("Robocizna (zł)", f.labour, (v) => this._set("labour", v))}
      </div>
      ${this._showTax
        ? html`${this.num("Podatek (%)", f.tax_pct, (v) => this._set("tax_pct", v))}
            <div class="row">
              ${this.num("Rabat (%)", f.discount_pct, (v) => this._set("discount_pct", v))}
              ${this.num("Rabat (zł)", f.discount_amount, (v) => this._set("discount_amount", v))}
            </div>`
        : html`<button class="link" @click=${() => (this._showTax = true)}>Dodaj podatek lub rabat</button>`}
      ${this.field(
        "Razem (zł)",
        this._totalTouched ? f.total : this._autoTotal(),
        (v) => {
          this._totalTouched = true;
          this._set("total", v);
        },
        { inputmode: "decimal" },
      )}
      ${this._totalTouched
        ? html`<button class="link" @click=${() => (this._totalTouched = false)}>Wylicz automatycznie</button>`
        : nothing}
      ${this.field("Numery części", f.part_numbers, (v) => this._set("part_numbers", v), { maxlength: LIMITS.part_numbers })}
      ${this.textArea("Komentarz", f.comment, LIMITS.comment, (v) => this._set("comment", v))}
      <label class="check">
        <input type="checkbox" .checked=${f.accessory} @change=${(e) => this._set("accessory", e.target.checked)} />
        Licz jako koszt akcesoriów
      </label>
    </div>`;
  }
}
customElements.define("vl-entry-form", VlEntryForm);
