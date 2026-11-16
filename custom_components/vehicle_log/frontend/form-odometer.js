import { VlForm, html, parseNum, badNum, intError, toField, todayIso, fmtInt } from "./ui.js";

export class VlOdometerForm extends VlForm {
  static properties = {
    ...VlForm.properties,
    _odometer: { state: true },
    _date: { state: true },
  };

  willUpdate(changed) {
    if (changed.has("entry") || this._odometer === undefined) {
      const e = this.entry || {};
      this._odometer = toField(e.odometer);
      this._date = e.date || todayIso();
    }
  }

  get heading() {
    return this.editing ? "Przebieg" : "Aktualizuj przebieg";
  }

  buildEntry() {
    const odo = parseNum(this._odometer);
    const odoErr = intError(this._odometer);
    if (odoErr) throw new Error(odoErr);
    if (badNum(this._odometer) || odo === null || odo < 0) throw new Error("Podaj poprawny przebieg.");
    if (!this._date) throw new Error("Podaj datę.");
    return {
      ...(this.entry || {}),
      kind: "odometer",
      vehicle_id: this.vehicle.id,
      odometer: this._odometer,
      date: this._date,
    };
  }

  renderBody() {
    return html`<div class="body">
      ${this.field("Przebieg", this._odometer, (v) => (this._odometer = v), {
        inputmode: "numeric",
        suffix: "km",
        placeholder: !this.editing && this.vehicle?.odometer != null ? `ostatnio ${fmtInt(this.vehicle.odometer)}` : "",
      })}
      ${this.field("Data", this._date, (v) => (this._date = v), { type: "date" })}
    </div>`;
  }
}
customElements.define("vl-odometer-form", VlOdometerForm);
