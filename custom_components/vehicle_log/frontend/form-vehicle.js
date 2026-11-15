import { VlForm, html, LIMITS } from "./ui.js";

export class VlVehicleForm extends VlForm {
  static properties = {
    ...VlForm.properties,
    _name: { state: true },
    _purchase: { state: true },
  };

  willUpdate(changed) {
    if (changed.has("entry") || this._name === undefined) {
      const v = this.entry || {};
      this._name = v.name || "";
      this._purchase = v.purchase_date || "";
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
    const vehicle = { ...(this.entry || {}), id: this.entry?.id || this._newId, name, purchase_date: this._purchase || null };
    await this._call({ type: "vehicle_log/vehicle/save", vehicle });
  }

  async _delete() {
    await this._call({ type: "vehicle_log/vehicle/delete", vehicle_id: this.entry.id });
  }

  renderBody() {
    return html`<div class="body">
      ${this.field("Nazwa", this._name, (v) => (this._name = v), { maxlength: LIMITS.name, placeholder: "np. Auto rodzinne" })}
      ${this.field("Data zakupu", this._purchase, (v) => (this._purchase = v), { type: "date" })}
    </div>`;
  }
}
customElements.define("vl-vehicle-form", VlVehicleForm);
