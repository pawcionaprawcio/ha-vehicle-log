import { typeRow } from "./type-picker.js";
import { t, localizeTypes } from "./i18n.js";
import { VlForm, html, nothing, parseNum, badNum, intError, toField, fmtDec, todayIso, entryTotal, LIMITS } from "./ui.js";

const NUMERIC = ["odometer", "parts", "labour", "total", "tax_pct", "discount_pct", "discount_amount"];

export class VlEntryForm extends VlForm {
  static properties = {
    ...VlForm.properties,
    _step: { state: true },
    _f: { state: true },
    _totalTouched: { state: true },
    _showTax: { state: true },
    _showNotes: { state: true },
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
    this._showNotes = Boolean(e.part_numbers || e.comment);
  }

  get heading() {
    return this._step === 1 ? t("choose_type") : this.editing ? t("edit_service") : t("add_service");
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
    for (const k of NUMERIC) if (badNum(f[k])) throw new Error(t("bad_number"));
    if (badNum(total)) throw new Error(t("bad_number"));
    if (!f.name.trim()) throw new Error(t("need_name"));
    if (!f.date) throw new Error(t("need_date"));
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

  /** LPG install is offered until the vehicle has one; LPG service only for an LPG vehicle. */
  _hiddenTypes() {
    const v = this.vehicle || {};
    const hidden = [];
    if ((v.entries || []).some((e) => e.service_type === "lpg_install")) hidden.push("lpg_install");
    if (!(v.fuel_types || []).includes("LPG")) hidden.push("lpg_service");
    return hidden;
  }

  _lpgHints() {
    if (this._f.service_type !== "lpg_install") return nothing;
    const fuels = this.vehicle?.fuel_types || [];
    return html`<div class="hint">${t("lpg_install_hint")}</div>
      ${fuels.length >= 2 && !fuels.includes("LPG") ? html`<div class="hint warn">${t("lpg_two_fuels_hint")}</div>` : nothing}`;
  }

  _renderPicker() {
    return html`<vl-type-picker
      .serviceTypes=${localizeTypes(this.view?.service_types)}
      .hidden=${this._hiddenTypes()}
      @pick=${(e) => this._pickType(e.detail.id, e.detail.label)}
    ></vl-type-picker>`;
  }

  renderBody() {
    if (this._step === 1) return this._renderPicker();
    const f = this._f;
    const type = localizeTypes(this.view?.service_types)?.[f.service_type];
    return html`<div class="body">
      ${this.editing ? nothing : typeRow(type, () => (this._step = 1))}
      ${this.field(t("name"), f.name, (v) => this._set("name", v), { maxlength: LIMITS.name })}
      <div class="row">
        ${this.field(t("date"), f.date, (v) => this._set("date", v), { type: "date" })}
        ${this.field(t("odometer"), f.odometer, (v) => this._set("odometer", v), { inputmode: "numeric", suffix: "km" })}
      </div>
      ${this._lpgHints()}
      <div class="row">
        ${this.num(t("parts"), f.parts, (v) => this._set("parts", v), "", "zł")}
        ${this.num(t("labour"), f.labour, (v) => this._set("labour", v), "", "zł")}
      </div>
      ${this.expander(
        this._showTax,
        t("tax_or_discount"),
        () => (this._showTax = true),
        html`${this.num(t("tax"), f.tax_pct, (v) => this._set("tax_pct", v), "", "%")}
          <div class="row">
            ${this.num(t("discount"), f.discount_pct, (v) => this._set("discount_pct", v), "", "%", t("discount_pct"))}
            ${this.num(t("discount"), f.discount_amount, (v) => this._set("discount_amount", v), "", "zł", t("discount_amount"))}
          </div>`,
      )}
      ${this.field(
        t("total"),
        this._totalTouched ? f.total : this._autoTotal(),
        (v) => {
          this._totalTouched = true;
          this._set("total", v);
        },
        { inputmode: "decimal", suffix: "zł" },
      )}
      ${this._totalTouched
        ? html`<button class="btn text" style="align-self:flex-start" @click=${() => (this._totalTouched = false)}>
            ${t("auto_total")}
          </button>`
        : nothing}
      ${this.expander(
        this._showNotes,
        t("parts_and_comment"),
        () => (this._showNotes = true),
        html`${this.field(t("part_numbers"), f.part_numbers, (v) => this._set("part_numbers", v), { maxlength: LIMITS.part_numbers })}
          ${this.textArea(t("comment"), f.comment, LIMITS.comment, (v) => this._set("comment", v))}`,
      )}
      ${this.switchRow(t("accessory"), f.accessory, (v) => this._set("accessory", v))}
    </div>`;
  }
}
customElements.define("vl-entry-form", VlEntryForm);
