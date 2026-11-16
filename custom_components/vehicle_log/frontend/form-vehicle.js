import { VlForm, html, LIMITS, toField, badNum } from "./ui.js";
import { t as tr, fuelLabel } from "./i18n.js";

const MAX_FUELS = 2;

export class VlVehicleForm extends VlForm {
  static properties = {
    ...VlForm.properties,
    _name: { state: true },
    _purchase: { state: true },
    _fuels: { state: true },
    _petrolL100: { state: true },
  };

  willUpdate(changed) {
    if (changed.has("entry") || this._name === undefined) {
      const v = this.entry || {};
      this._name = v.name || "";
      this._purchase = v.purchase_date || "";
      this._fuels = [...(v.fuel_types || [])];
      this._petrolL100 = toField(v.petrol_l_per_100km);
    }
  }

  get heading() {
    return this.editing ? tr("edit_vehicle") : tr("add_vehicle");
  }

  get deleteWarning() {
    return tr("delete_vehicle");
  }

  async save() {
    const name = this._name.trim();
    if (!name) {
      this._error = tr("need_vehicle_name");
      return;
    }
    if (!this._fuels.length) {
      this._error = tr("need_fuel");
      return;
    }
    if (badNum(this._petrolL100)) {
      this._error = tr("bad_number");
      return;
    }
    const vehicle = {
      ...(this.entry || {}),
      id: this.entry?.id || this._newId,
      name,
      purchase_date: this._purchase || null,
      fuel_types: this._fuels,
      petrol_l_per_100km: this._petrolL100,
    };
    await this._call({ type: "vehicle_log/vehicle/save", vehicle });
  }

  async _delete() {
    await this._call({ type: "vehicle_log/vehicle/delete", vehicle_id: this.entry.id });
  }

  renderBody() {
    return html`<div class="body">
      ${this.field(tr("name"), this._name, (v) => (this._name = v), { maxlength: LIMITS.name, placeholder: tr("vehicle_name_placeholder") })}
      ${this.field(tr("purchase_date"), this._purchase, (v) => (this._purchase = v), { type: "date" })}
      <div class="fuels">
        <div class="fuels-title">${tr("fuel_type")}</div>
        <div class="hint">${tr("fuel_hint")}</div>
        ${(this.view?.fuel_types || []).map((t) => {
          const on = this._fuels.includes(t);
          return this.switchRow(fuelLabel(t), on, (checked) => this._toggleFuel(t, checked), "", !on && this._fuels.length >= MAX_FUELS);
        })}
      </div>
      ${this.num(tr("petrol_consumption"), this._petrolL100, (v) => (this._petrolL100 = v), "", "l/100 km")}
      <div class="hint">${tr("petrol_consumption_hint")}</div>
    </div>`;
  }

  _toggleFuel(fuel, on) {
    const types = this.view?.fuel_types || [];
    const next = on ? [...this._fuels, fuel] : this._fuels.filter((f) => f !== fuel);
    // keep the catalog order so "Pb95 + LPG" reads the same everywhere
    this._fuels = types.filter((t) => next.includes(t));
    this._error = undefined;
  }
}
customElements.define("vl-vehicle-form", VlVehicleForm);
