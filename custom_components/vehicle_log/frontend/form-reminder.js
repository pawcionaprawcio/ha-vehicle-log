import { typeRow } from "./type-picker.js";
import { t, localizeTypes } from "./i18n.js";
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
    return this._step === 1 ? t("choose_type") : this.editing ? t("edit_reminder") : t("add_reminder");
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
    return t("delete_reminder");
  }

  async save() {
    const f = this._f;
    const [km, months, odo] = [parseNum(f.interval_km), parseNum(f.interval_months), parseNum(f.baseline_odometer)];
    const intErr =
      intError(f.interval_km, t("interval_km_label")) ||
      intError(f.interval_months, t("interval_months_label")) ||
      intError(f.baseline_odometer, t("baseline_odometer"));
    let err = intErr;
    if (!err && !f.text.trim()) err = t("need_text");
    else if (!err && f.interval_km.trim() !== "" && !(km >= 1 && km <= 1000000)) err = t("km_range");
    else if (!err && f.interval_months.trim() !== "" && !(months >= 1 && months <= 1200)) err = t("months_range");
    else if (!err && !km && !months) err = t("need_interval");
    else if (!err && km && odo === null) err = t("need_baseline_odo");
    else if (!err && !f.baseline_date) err = t("need_baseline_date");
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
      <span class="t" style="padding: 4px 0">${t("due", { text: [dueKm !== null ? fmtKm(dueKm) : null, date ? fmtDate(date) : null].filter(Boolean).join(t("or")) })}</span>
    </div>`;
  }

  renderBody() {
    if (this._step === 1) {
      return html`<vl-type-picker
        .serviceTypes=${localizeTypes(this.view?.service_types)}
        @pick=${(e) => this._pickType(e.detail.id, e.detail.label)}
      ></vl-type-picker>`;
    }
    const f = this._f;
    const type = localizeTypes(this.view?.service_types)?.[f.service_type];
    return html`<div class="body">
      ${this.editing ? nothing : typeRow(type, () => (this._step = 1))}
      ${this.field(t("text"), f.text, (v) => this._set("text", v), { maxlength: LIMITS.name })}
      ${this.textArea(t("extra_text"), f.extra_text, EXTRA_MAX, (v) => this._set("extra_text", v))}
      <div class="row">
        ${this.field(t("every_km"), f.interval_km, (v) => this._set("interval_km", v), { inputmode: "numeric", suffix: "km" })}
        ${this.field(t("every_months"), f.interval_months, (v) => this._set("interval_months", v), { inputmode: "numeric", suffix: t("months_short") })}
      </div>
      <div class="row">
        ${this.field(t("baseline_odometer"), f.baseline_odometer, (v) => this._set("baseline_odometer", v), { inputmode: "numeric", suffix: "km" })}
        ${this.field(t("baseline_date"), f.baseline_date, (v) => this._set("baseline_date", v), { type: "date" })}
      </div>
      ${this._due()}
    </div>`;
  }
}
customElements.define("vl-reminder-form", VlReminderForm);
