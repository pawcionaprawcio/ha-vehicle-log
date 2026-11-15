import { LitElement, html, css, nothing } from "./ui.js";

const HIDDEN_TYPES = ["refuel", "odometer_update"];

/** Searchable service-type list. Fires `pick` with {id, label}. */
export class VlTypePicker extends LitElement {
  static properties = {
    serviceTypes: { attribute: false },
    _search: { state: true },
  };
  static styles = css`
    :host { display: flex; flex-direction: column; gap: 12px; flex: 1; overflow-y: auto; padding: 12px 16px; color: var(--primary-text-color); }
    * { box-sizing: border-box; }
    input {
      font: inherit; font-size: 16px; min-height: 48px; padding: 8px 12px; width: 100%;
      color: var(--primary-text-color); background: var(--card-background-color, #fff);
      border: 1px solid var(--divider-color); border-radius: 8px;
    }
    .types { display: flex; flex-direction: column; }
    .type {
      display: flex; align-items: center; gap: 16px; min-height: 52px; padding: 0 8px; border: none;
      border-bottom: 1px solid var(--divider-color); background: none; color: inherit; font: inherit;
      font-size: 16px; text-align: left; cursor: pointer;
    }
    .type ha-icon { color: var(--secondary-text-color); }
    .hint { font-size: 12px; color: var(--secondary-text-color); }
  `;

  constructor() {
    super();
    this._search = "";
  }

  _pick(id, label) {
    this.dispatchEvent(new CustomEvent("pick", { detail: { id, label }, bubbles: true, composed: true }));
  }

  render() {
    const q = this._search.trim().toLocaleLowerCase("pl");
    const types = Object.entries(this.serviceTypes || {}).filter(
      ([id, t]) => !HIDDEN_TYPES.includes(id) && t.label.toLocaleLowerCase("pl").includes(q),
    );
    return html`<input
        type="search"
        placeholder="Szukaj rodzaju serwisu"
        aria-label="Szukaj"
        .value=${this._search}
        @input=${(e) => (this._search = e.target.value)}
      />
      <div class="types">
        ${types.map(
          ([id, t]) => html`<button class="type" @click=${() => this._pick(id, t.label)}>
            <ha-icon icon=${t.icon}></ha-icon>${t.label}
          </button>`,
        )}
        ${types.length ? nothing : html`<div class="hint">Brak wyników.</div>`}
      </div>`;
  }
}
if (!customElements.get("vl-type-picker")) customElements.define("vl-type-picker", VlTypePicker);
