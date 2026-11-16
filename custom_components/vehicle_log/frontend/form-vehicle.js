import { VlForm, html, LIMITS } from "./ui.js";

const MAX_FUELS = 2;

export class VlVehicleForm extends VlForm {
  static properties = {
    ...VlForm.properties,
    _name: { state: true },
    _purchase: { state: true },
    _fuels: { state: true },
  };

  willUpdate(changed) {
    if (changed.has("entry") || this._name === undefined) {
      const v = this.entry || {};
      this._name = v.name || "";
      this._purchase = v.purchase_date || "";
      this._fuels = [...(v.fuel_types || [])];
    }
  }

  get heading() {
    return this.editing ? "Edytuj pojazd" : "Dodaj pojazd";
  }

  get deleteWarning() {
    return "Na pewno usunąć ten pojazd? Zostaną usunięte także wszystkie jego wpisy i przypomnienia.";
  }

  async save() {
    const name = this._name.trim();
    if (!name) {
      this._error = "Podaj nazwę pojazdu.";
      return;
    }
    if (!this._fuels.length) {
      this._error = "Wybierz rodzaj paliwa (jeden lub dwa).";
      return;
    }
    const vehicle = {
      ...(this.entry || {}),
      id: this.entry?.id || this._newId,
      name,
      purchase_date: this._purchase || null,
      fuel_types: this._fuels,
    };
    await this._call({ type: "vehicle_log/vehicle/save", vehicle });
  }

  async _delete() {
    await this._call({ type: "vehicle_log/vehicle/delete", vehicle_id: this.entry.id });
  }

  renderBody() {
    return html`<div class="body">
      ${this.field("Nazwa", this._name, (v) => (this._name = v), { maxlength: LIMITS.name, placeholder: "np. Auto rodzinne" })}
      ${this.field("Data zakupu", this._purchase, (v) => (this._purchase = v), { type: "date" })}
      <div class="fuels">
        <div class="hint">Jeden lub dwa rodzaje, np. Pb95 + LPG</div>
        ${(this.view?.fuel_types || []).map((t) => {
          const on = this._fuels.includes(t);
          return this.switchRow(t, on, (checked) => this._toggleFuel(t, checked), "", !on && this._fuels.length >= MAX_FUELS);
        })}
      </div>
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
