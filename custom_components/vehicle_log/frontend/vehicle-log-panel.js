import { LitElement, html, css, nothing, storage, errorText, haStyles } from "./ui.js";
import "./view-entries.js";
import "./form-entry.js";
import "./form-refuel.js";
import "./form-odometer.js";
import "./form-reminder.js";
import "./form-vehicle.js";
import "./view-reminders.js";
import "./view-garage.js";

const KEY_VEHICLE = "vehicle_log.vehicle";
const KEY_TAB = "vehicle_log.tab";
const TABS = [
  ["entries", "Wpisy", "mdi:format-list-bulleted"],
  ["reminders", "Przypomnienia", "mdi:bell-outline"],
  ["garage", "Garaż", "mdi:garage-variant"],
];
const MAX_BACKOFF_MS = 30000;

class VehicleLogPanel extends LitElement {
  static properties = {
    // Re-render only when the connection changes, not on every state update.
    hass: { attribute: false, hasChanged: (value, old) => value?.connection !== old?.connection },
    narrow: { type: Boolean, reflect: true },
    panel: { attribute: false },
    _view: { state: true },
    _vehicleId: { state: true },
    _tab: { state: true },
    _sheet: { state: true },
    _connError: { state: true },
    _pop: { state: true },
    _openId: { state: true },
  };

  static styles = [
    haStyles,
    css`
    :host {
      display: flex; flex-direction: column; height: 100vh; height: 100dvh; position: relative;
      background: var(--primary-background-color); color: var(--primary-text-color);
      font-family: var(--paper-font-body1_-_font-family, inherit);
    }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; cursor: pointer; }
    .bar {
      display: flex; align-items: center; gap: 4px; height: 56px; padding: 0 8px 0 4px; flex: none;
      background: var(--app-header-background-color, var(--primary-background-color));
      color: var(--app-header-text-color, var(--primary-text-color));
      border-bottom: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .bar h1 {
      margin: 0; font-size: 20px; font-weight: 400; padding-left: 12px; flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    :host(:not([narrow])) .bar h1 { flex: none; padding-left: 16px; }
    .icon-btn {
      background: none; border: none; width: 48px; height: 48px; border-radius: 50%; flex: none;
      display: flex; align-items: center; justify-content: center;
    }
    .picker {
      display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 8px 0 12px; border-radius: 18px;
      background: none; border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); font-size: 14px;
      max-width: 55%; flex: none; --mdc-icon-size: 20px; margin-left: auto; position: relative;
    }
    /* 48px touch target around the 36px pill */
    .picker::before { content: ""; position: absolute; inset: -6px -4px; }
    .picker span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .picker ha-icon:first-child { color: var(--secondary-text-color, #727272); }
    .tabs { display: flex; height: 56px; flex: 1; justify-content: center; min-width: 0; }
    .tabs button {
      display: flex; align-items: center; gap: 8px; padding: 0 20px; background: none; border: 0;
      border-bottom: 2px solid transparent; font-size: 14px; color: var(--secondary-text-color, #727272);
      --mdc-icon-size: 20px;
    }
    .tabs button[aria-current="page"] { color: var(--primary-color, #03a9f4); border-bottom-color: var(--primary-color, #03a9f4); }
    main { flex: 1; min-height: 0; overflow-y: auto; }
    .content { padding: 16px 12px 96px; }
    :host(:not([narrow])) .content { max-width: 1000px; margin: 0 auto; padding: 24px 24px 96px; }
    nav {
      display: flex; flex: none; height: 60px; border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      background: var(--app-header-background-color, var(--primary-background-color)); box-sizing: content-box;
      padding-bottom: env(safe-area-inset-bottom);
    }
    nav button {
      flex: 1; background: none; border: none; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 2px; font-size: 12px; color: var(--secondary-text-color, #727272);
    }
    nav button ha-icon { padding: 2px 18px; border-radius: 14px; }
    nav button[aria-current="page"] { color: var(--primary-color, #03a9f4); }
    nav button[aria-current="page"] ha-icon { background: color-mix(in srgb, var(--primary-color, #03a9f4) 18%, transparent); }
    .fab {
      position: absolute; right: 24px; bottom: 24px; height: 56px; padding: 0 20px 0 16px; border-radius: 16px; border: none;
      display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 15px; z-index: 5;
      background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff);
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
    }
    :host([narrow]) .fab { right: 16px; bottom: calc(76px + env(safe-area-inset-bottom)); }
    .overlay { position: fixed; inset: 0; z-index: 30; }
    .overlay.dim { background: rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end; justify-content: center; }
    .menu {
      background: var(--card-background-color, #fff); padding: 8px 0 16px; width: 100%;
      border-radius: 16px 16px 0 0;
    }
    .menu button, .pop button {
      display: flex; align-items: center; gap: 16px; width: 100%; min-height: 56px; padding: 0 20px; font-size: 16px;
      background: none; border: none; text-align: left;
    }
    .menu ha-icon, .pop ha-icon { color: var(--secondary-text-color, #727272); flex: none; }
    .pop {
      position: absolute; z-index: 31; background: var(--card-background-color, #fff); border-radius: 12px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }
    .pop.add { width: 240px; right: 24px; bottom: 88px; }
    .pop.veh { top: 52px; right: 8px; width: 280px; max-width: calc(100% - 16px); max-height: 60vh; overflow-y: auto; }
    .pop.veh button { min-height: 48px; padding: 0 16px; font-size: 15px; }
    .pop.veh button span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .pop.veh button ha-icon { color: var(--primary-color, #03a9f4); }
    .pop button + button { border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); }
    .center { padding: 32px 16px; }
    .center .btn { margin-top: 16px; }
  `,
  ];

  constructor() {
    super();
    this._view = null;
    this._sheet = null;
    this._connError = "";
    this._pop = null;
    this._openId = null;
    this._onKey = (e) => {
      if (e.key !== "Escape") return;
      if (this._pop) this._pop = null;
      else if (this._sheet?.type === "menu") this._sheet = null;
    };
    this._vehicleId = storage.get(KEY_VEHICLE);
    this._tab = TABS.some((t) => t[0] === storage.get(KEY_TAB)) ? storage.get(KEY_TAB) : "entries";
    this._token = 0;
    this._retries = 0;
    this._conn = null;
    this._unsub = null;
    this._timer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this._onKey);
    this._connect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._onKey);
    this._teardown();
  }

  updated(changed) {
    // A new hass.connection (HA reconnected) needs a fresh subscription.
    if (changed.has("hass") && this.hass?.connection && this.hass.connection !== this._conn) {
      this._connect();
    }
  }

  _teardown() {
    this._token++;
    clearTimeout(this._timer);
    this._timer = null;
    const unsub = this._unsub;
    this._unsub = null;
    this._conn = null;
    if (unsub) {
      try {
        Promise.resolve(unsub()).catch(() => {});
      } catch (_) {
        /* connection already closed */
      }
    }
  }

  _connect() {
    const conn = this.hass?.connection;
    if (!conn || !this.isConnected) return;
    this._teardown();
    this._conn = conn;
    const token = this._token;
    conn
      .subscribeMessage((event) => {
        if (token === this._token) this._setView(event.view);
      }, { type: "vehicle_log/subscribe" })
      .then((unsub) => {
        if (token !== this._token) {
          unsub();
          return;
        }
        this._unsub = unsub;
        this._retries = 0;
        this._connError = "";
      })
      .catch((err) => {
        if (token !== this._token) return;
        this._connError = errorText(err);
        // Keep _conn so hass updates do not bypass the backoff below.
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this._retries++);
        this._timer = setTimeout(() => {
          this._conn = null;
          this._connect();
        }, delay);
      });
  }

  _setView(view) {
    const known = new Set(this._view?.vehicles.map((v) => v.id));
    const fresh = this._view ? view.vehicles.find((v) => !known.has(v.id)) : null;
    this._view = view;
    if (fresh) this._selectVehicle(fresh.id);
    const ids = view.vehicles.map((v) => v.id);
    if (!ids.includes(this._vehicleId)) this._vehicleId = ids[0] ?? null;
  }

  get _vehicle() {
    return this._view?.vehicles.find((v) => v.id === this._vehicleId) ?? null;
  }

  _selectVehicle(id) {
    this._vehicleId = id;
    this._pop = null;
    storage.set(KEY_VEHICLE, id);
  }

  get _showPicker() {
    return (this._view?.vehicles.length ?? 0) > 1 && this._tab !== "garage";
  }

  _selectTab(tab) {
    this._tab = tab;
    if (this._pop === "vehicle") this._pop = null;
    storage.set(KEY_TAB, tab);
  }

  _toggleMenu() {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  _openEdit(entry) {
    this._sheet = { type: entry.kind, entry };
  }

  _onFab() {
    if (this._tab === "reminders") this._sheet = { type: "reminder" };
    else if (this.narrow) this._sheet = { type: "menu" };
    else this._pop = "add";
  }

  _onOpenReminder(e) {
    // detail: reminder id, or null to only switch to the reminders tab.
    this._selectTab("reminders");
    this._openId = e.detail ?? null;
  }

  _onSaved(e) {
    this._setView(e.detail);
  }

  _addItems() {
    const choices = [
      ["refuel", "Tankowanie", "mdi:gas-station"],
      ["service", "Serwis", "mdi:wrench"],
      ["odometer", "Odczyt przebiegu", "mdi:counter"],
    ];
    return choices.map(
      ([type, label, icon]) => html`<button @click=${() => {
        this._pop = null;
        this._sheet = { type };
      }}>
        <ha-icon icon=${icon}></ha-icon>${label}
      </button>`,
    );
  }

  _renderPop() {
    if (this._pop === "add") {
      return html`<div class="overlay" @click=${() => (this._pop = null)}></div>
        <div class="pop add">${this._addItems()}</div>`;
    }
    if (this._pop === "vehicle" && this._showPicker) {
      const vehicles = this._view?.vehicles ?? [];
      return html`<div class="overlay" @click=${() => (this._pop = null)}></div>
        <div class="pop veh" role="listbox" aria-label="Pojazd">
          ${vehicles.map(
            (v) => html`<button role="option" aria-selected=${v.id === this._vehicleId} @click=${() => this._selectVehicle(v.id)}>
              <span>${v.name}</span>${v.id === this._vehicleId ? html`<ha-icon icon="mdi:check"></ha-icon>` : nothing}
            </button>`,
          )}
        </div>`;
    }
    return nothing;
  }

  _renderSheet() {
    const s = this._sheet;
    if (!s) return nothing;
    const close = () => (this._sheet = null);
    if (s.type === "menu") {
      return html`<div class="overlay dim" @click=${close}>
        <div class="menu" @click=${(e) => e.stopPropagation()}>${this._addItems()}</div>
      </div>`;
    }
    const p = { hass: this.hass, view: this._view, vehicle: this._vehicle, entry: s.entry };
    const on = { close, saved: (e) => this._onSaved(e) };
    switch (s.type) {
      case "refuel":
        return html`<vl-refuel-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-refuel-form>`;
      case "odometer":
        return html`<vl-odometer-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-odometer-form>`;
      case "reminder":
        return html`<vl-reminder-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-reminder-form>`;
      case "vehicle":
        return html`<vl-vehicle-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-vehicle-form>`;
      default:
        return html`<vl-entry-form .hass=${p.hass} .view=${p.view} .vehicle=${p.vehicle} .entry=${p.entry}
          ?narrow=${this.narrow} @close=${on.close} @saved=${on.saved}></vl-entry-form>`;
    }
  }

  _renderContent() {
    if (!this._view) {
      return html`<div class="empty center">
        ${this._connError
          ? html`<div class="error" role="alert">Nie można połączyć z integracją: ${this._connError}</div>
              <div>Ponawiam próbę…</div>`
          : "Ładowanie…"}
      </div>`;
    }
    if (this._tab === "garage") {
      return html`<vl-garage
        .hass=${this.hass}
        .view=${this._view}
        ?wide=${!this.narrow}
        @saved=${(e) => this._onSaved(e)}
        @add-vehicle=${() => (this._sheet = { type: "vehicle" })}
        @edit-vehicle=${(e) => (this._sheet = { type: "vehicle", entry: e.detail })}
      ></vl-garage>`;
    }
    const v = this._vehicle;
    if (!v) {
      return html`<div class="empty center">
        Brak pojazdów.<br />
        <button class="btn fill" @click=${() => (this._sheet = { type: "vehicle" })}>Dodaj pojazd</button>
      </div>`;
    }
    if (this._tab === "reminders") {
      return html`<vl-reminders
        .hass=${this.hass}
        .vehicle=${v}
        .serviceTypes=${this._view.service_types}
        ?narrow=${this.narrow}
        ?wide=${!this.narrow}
        .openId=${this._openId}
        @reminder-opened=${() => (this._openId = null)}
        @saved=${(e) => this._onSaved(e)}
        @add-odometer=${() => (this._sheet = { type: "odometer" })}
        @edit-reminder=${(e) => (this._sheet = { type: "reminder", entry: e.detail })}
      ></vl-reminders>`;
    }
    return html`<vl-entries
      .vehicle=${v}
      .serviceTypes=${this._view.service_types}
      ?wide=${!this.narrow}
      @edit-entry=${(e) => this._openEdit(e.detail)}
    ></vl-entries>`;
  }

  render() {
    const vehicles = this._view?.vehicles ?? [];
    const showFab = this._view && this._vehicle && this._tab !== "garage";
    const showPicker = this._showPicker;
    const tabBtn = ([id, label, icon]) => html`<button aria-current=${this._tab === id ? "page" : "false"} @click=${() => this._selectTab(id)}>
      <ha-icon icon=${icon}></ha-icon>${label}
    </button>`;
    return html`
      <div class="bar">
        ${this.narrow
          ? html`<button class="icon-btn" aria-label="Menu" @click=${() => this._toggleMenu()}>
              <ha-icon icon="mdi:menu"></ha-icon>
            </button>`
          : nothing}
        <h1>Dziennik pojazdu</h1>
        ${this.narrow ? nothing : html`<div class="tabs">${TABS.map(tabBtn)}</div>`}
        ${showPicker
          ? html`<button class="picker" aria-haspopup="listbox" aria-label="Pojazd" @click=${() => (this._pop = this._pop === "vehicle" ? null : "vehicle")}>
              <ha-icon icon="mdi:car"></ha-icon><span>${this._vehicle?.name ?? ""}</span><ha-icon icon="mdi:menu-down"></ha-icon>
            </button>`
          : nothing}
      </div>
      <main><div class="content" @open-reminder=${(e) => this._onOpenReminder(e)}>${this._renderContent()}</div></main>
      ${showFab
        ? html`<button class="fab" aria-label=${this._tab === "reminders" ? "Dodaj przypomnienie" : "Dodaj"} @click=${() => this._onFab()}>
            <ha-icon icon="mdi:plus"></ha-icon>${this._tab === "reminders" ? "Przypomnienie" : "Dodaj"}
          </button>`
        : nothing}
      ${this.narrow ? html`<nav>${TABS.map(tabBtn)}</nav>` : nothing}
      ${this._renderPop()}
      ${this._renderSheet()}
    `;
  }
}

if (!customElements.get("vehicle-log-panel")) {
  customElements.define("vehicle-log-panel", VehicleLogPanel);
}
