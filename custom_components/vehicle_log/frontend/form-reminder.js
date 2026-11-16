import { typeRow } from "./type-picker.js";
import { VlForm, html, nothing, parseNum, badNum, intError, toField, todayIso, addMonths, fmtDate, fmtKm, LIMITS } from "./ui.js";

const EXTRA_MAX = 300;

export class VlReminderForm extends VlForm {
  static properties = {
    ...VlForm.properties,
    _step: { state: true },
    _f: { state: true },
  };

  willUpdate(changed) {
    if (changed.has("entry") || !this._f) this._init();
  }

  _init() {
    const r = this.entry || {};
    this._step = this.editing ? 2 : 1;
    this._f = {
      service_type: r.service_type || "other",
      text: r.text || "",
      extra_text: r.extra_text || "",
      interval_km: toField(r.interval_km),
      interval_months: toField(r.interval_months),
      baseline_odometer: toField(r.baseline_odometer ?? this.vehicle?.odometer),
      baseline_date: r.baseline_date || todayIso(),
    };
  }

  get heading() {
    return this._step === 1 ? "Wybierz rodzaj" : this.editing ? "Edytuj przypomnienie" : "Dodaj przypomnienie";
  }

  _set(key, value) {
    this._f = { ...this._f, [key]: value };
  }

  _pickType(id, label) {
    const tpl = this.view?.reminder_templates?.[id];
    this._f = {
      ...this._f,
      service_type: id,
      text: label,
      interval_km: toField(tpl?.interval_km),
      interval_months: toField(tpl?.interval_months),
    };
    this._step = 2;
  }

  showFooter() {
    return this._step === 2;
  }

  get deleteWarning() {
    return "Na pewno usunąć to przypomnienie?";
  }

  async save() {
    const f = this._f;
    const [km, months, odo] = [parseNum(f.interval_km), parseNum(f.interval_months), parseNum(f.baseline_odometer)];
    const intErr =
      intError(f.interval_km, "Interwał (km)") ||
      intError(f.interval_months, "Interwał (miesiące)") ||
      intError(f.baseline_odometer, "Przebieg bazowy");
    let err = intErr;
    if (!err && !f.text.trim()) err = "Podaj tekst przypomnienia.";
    else if (!err && f.interval_km.trim() !== "" && !(km >= 1 && km <= 1000000)) err = "Interwał w km musi być od 1 do 1 000 000.";
    else if (!err && f.interval_months.trim() !== "" && !(months >= 1 && months <= 1200)) err = "Interwał w miesiącach musi być od 1 do 1200.";
    else if (!err && !km && !months) err = "Podaj interwał w km lub miesiącach.";
    else if (!err && km && odo === null) err = "Podaj przebieg bazowy, aby liczyć interwał w km.";
    else if (!err && !f.baseline_date) err = "Podaj datę bazową.";
    if (err) {
      this._error = err;
      return;
    }
    await this._call({
      type: "vehicle_log/reminder/save",
      reminder: {
        ...(this.entry || {}),
        id: this.entry?.id || this._newId,
        vehicle_id: this.vehicle.id,
        service_type: f.service_type,
        text: f.text.trim(),
        extra_text: f.extra_text,
        interval_km: km || null,
        interval_months: months || null,
        baseline_odometer: odo,
        baseline_date: f.baseline_date,
      },
    });
  }

  async _delete() {
    await this._call({ type: "vehicle_log/reminder/delete", reminder_id: this.entry.id });
  }

  _due() {
    const f = this._f;
    const [km, months, odo] = [parseNum(f.interval_km), parseNum(f.interval_months), parseNum(f.baseline_odometer)];
    const date = months >= 1 && months <= 1200 ? addMonths(f.baseline_date, Math.round(months)) : null;
    const dueKm = km > 0 && odo !== null ? odo + Math.round(km) : null;
    if (!date && dueKm === null) return nothing;
    return html`<div class="alert" style="background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent); border-color: color-mix(in srgb, var(--primary-color, #03a9f4) 35%, transparent)" aria-live="polite">
      <ha-icon icon="mdi:calendar-clock" style="color: var(--primary-color, #03a9f4)"></ha-icon>
      <span class="t" style="padding: 4px 0">Termin: ${[dueKm !== null ? fmtKm(dueKm) : null, date ? fmtDate(date) : null].filter(Boolean).join(" lub ")}</span>
    </div>`;
  }

  renderBody() {
    if (this._step === 1) {
      return html`<vl-type-picker
        .serviceTypes=${this.view?.service_types}
        @pick=${(e) => this._pickType(e.detail.id, e.detail.label)}
      ></vl-type-picker>`;
    }
    const f = this._f;
    const type = this.view?.service_types?.[f.service_type];
    return html`<div class="body">
      ${this.editing ? nothing : typeRow(type, () => (this._step = 1))}
      ${this.field("Tekst", f.text, (v) => this._set("text", v), { maxlength: LIMITS.name })}
      ${this.textArea("Dodatkowy tekst", f.extra_text, EXTRA_MAX, (v) => this._set("extra_text", v))}
      <div class="row">
        ${this.field("Co ile km", f.interval_km, (v) => this._set("interval_km", v), { inputmode: "numeric", suffix: "km" })}
        ${this.field("Co ile miesięcy", f.interval_months, (v) => this._set("interval_months", v), { inputmode: "numeric", suffix: "mies." })}
      </div>
      <div class="row">
        ${this.field("Przebieg bazowy", f.baseline_odometer, (v) => this._set("baseline_odometer", v), { inputmode: "numeric", suffix: "km" })}
        ${this.field("Data bazowa", f.baseline_date, (v) => this._set("baseline_date", v), { type: "date" })}
      </div>
      ${this._due()}
    </div>`;
  }
}
customElements.define("vl-reminder-form", VlReminderForm);
