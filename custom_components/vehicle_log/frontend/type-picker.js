import { LitElement, html, css, nothing, haStyles } from "./ui.js";

const HIDDEN_TYPES = ["refuel", "odometer_update"];

/** "Rodzaj" row shown on the service and reminder forms; clicking it reopens the picker. */
export function typeRow(type, onClick) {
  return html`<button class="li type-row" style="border:1px solid var(--divider-color); border-radius: 12px" @click=${onClick}>
    <div class="badge b-service"><ha-icon icon=${type?.icon || "mdi:wrench"}></ha-icon></div>
    <div class="m">
      <div class="t2">Rodzaj</div>
      <div class="t1">${type?.label || "Wybierz rodzaj"}</div>
    </div>
    <span style="color: var(--primary-color, #03a9f4); font-size: 14px; font-weight: 500">Zmień</span>
  </button>`;
}

/** Searchable service-type list. Fires `pick` with {id, label}. */
export class VlTypePicker extends LitElement {
  static properties = {
    serviceTypes: { attribute: false },
    _search: { state: true },
  };
  static styles = [
    haStyles,
    css`
      :host { display: flex; flex-direction: column; gap: 12px; flex: 1; overflow-y: auto; padding: 12px 16px; color: var(--primary-text-color); }
      * { box-sizing: border-box; }
      label.f {
        position: relative; display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 14px; flex: none;
        border: 1px solid color-mix(in srgb, var(--secondary-text-color, #727272) 60%, transparent); border-radius: 8px;
        background: var(--card-background-color, #fff); color: var(--secondary-text-color, #727272); --mdc-icon-size: 22px;
      }
      label.f:focus-within { border-color: var(--primary-color, #03a9f4); box-shadow: 0 0 0 1px var(--primary-color, #03a9f4); }
      label.f input {
        flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: none; background: transparent;
        font: inherit; font-size: 16px; color: var(--primary-text-color);
      }
      .types { display: flex; flex-direction: column; }
      .types .li { border-top: 0; border-bottom: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); }
      .types .li .t1 { white-space: normal; }
      .hint { padding: 8px 0; }
    `,
  ];

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
    return html`<label class="f"
        ><ha-icon icon="mdi:magnify"></ha-icon
        ><input
          type="search"
          placeholder="Szukaj rodzaju serwisu"
          aria-label="Szukaj"
          .value=${this._search}
          @input=${(e) => (this._search = e.target.value)}
      /></label>
      <div class="types">
        ${types.map(
          ([id, t]) => html`<button class="li compact" @click=${() => this._pick(id, t.label)}>
            <div class="badge b-service"><ha-icon icon=${t.icon}></ha-icon></div>
            <div class="m"><div class="t1">${t.label}</div></div>
          </button>`,
        )}
        ${types.length ? nothing : html`<div class="hint">Brak wyników.</div>`}
      </div>`;
  }
}
if (!customElements.get("vl-type-picker")) customElements.define("vl-type-picker", VlTypePicker);
