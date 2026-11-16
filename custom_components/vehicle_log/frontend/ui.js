// Shared helpers, styles and the form base class for the Vehicle Log panel.
import { LitElement, html, css, nothing } from "./lit-core.min.js";

export const LIMITS = { name: 70, part_numbers: 300, comment: 1000 };

const NBSP = " ";

/** Parse "5,79" / "1 000.5" / 12 -> number; empty or invalid -> null. */
export function parseNum(str) {
  if (str === null || str === undefined) return null;
  if (typeof str === "number") return Number.isFinite(str) ? str : null;
  const text = String(str).trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** True when the field has text that is not a valid number. */
export function badNum(str) {
  return String(str ?? "").trim() !== "" && parseNum(str) === null;
}

export const ODOMETER_MAX = 10_000_000;

/**
 * Polish message when an odometer/interval field is not a whole non-negative
 * number (digits and whitespace only), else "". Empty is fine.
 */
export function intError(str, label = "Przebieg") {
  const text = String(str ?? "").trim();
  if (!text) return "";
  if (!/^[\d\s]+$/.test(text)) return `${label}: tylko cyfry, bez przecinka i znaków.`;
  if (parseNum(text) > ODOMETER_MAX) return `${label}: wartość jest zbyt duża.`;
  return "";
}

/** Random 32-char hex id; crypto.randomUUID is missing on plain http. */
export function newId() {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && c.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Polish plural: 1 -> one, 2-4 (not 12-14) -> few, otherwise many. */
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (n === 1) return one;
  return m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? few : many;
}

export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])}.${m[2]}.${m[1]}` : iso || "";
}

function group(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Number with NBSP-grouped thousands, no unit ("" when unset). */
export function fmtInt(n) {
  return n === null || n === undefined ? "" : group(n);
}

export function fmtKm(n) {
  return n === null || n === undefined ? "" : `${group(n)}${NBSP}km`;
}

export function fmtMoney(n) {
  if (n === null || n === undefined) return "";
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const text = whole
    ? group(n)
    : n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  return `${text}${NBSP}zł`;
}

/** Decimal with comma, between min and max fraction digits, no grouping. */
export function fmtDec(n, min = 0, max = 2) {
  if (n === null || n === undefined) return "";
  return n.toLocaleString("pl-PL", {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: false,
  });
}

/** Number -> text for an input field ("" when unset). */
export function toField(n) {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

/** Mirror of calc.entry_total. */
export function entryTotal(parts, labour, taxPct, discountPct, discountAmount) {
  let base = (parts || 0) + (labour || 0);
  base = base * (1 - (discountPct || 0) / 100) - (discountAmount || 0);
  return Math.round(base * (1 + (taxPct || 0) / 100) * 100) / 100;
}

/**
 * Which refuel amount to recompute when total, price and litres are all filled
 * and `edited` was just changed: keep the edited field and the total
 * (edited litres -> recompute price; edited total or price -> recompute litres).
 */
export function refuelDerivedKey(edited) {
  return edited === "litres" ? "price_per_litre" : "litres";
}

/** Mirror of calc.add_months (day clamped to the end of the target month). */
export function addMonths(iso, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  const day = Math.min(Number(m[3]), new Date(year, month, 0).getDate());
  const p = (n) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}`;
}

export function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function nowTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const storage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_) {
      /* storage unavailable: ignore */
    }
  },
};

export function errorText(err) {
  if (err && typeof err === "object" && err.message) return String(err.message);
  return String(err || "Nieznany błąd");
}

const MONTHS_SHORT = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
const MONTHS_LONG = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];

/** "2026-11-14" -> "14 lis" ("" when not a date). */
export function fmtShortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m && MONTHS_SHORT[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}` : iso || "";
}

/** "2026-11-14" -> "Listopad 2026". */
export function monthLabel(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(iso || "");
  return m && MONTHS_LONG[Number(m[2]) - 1] ? `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}` : iso || "";
}

/** Reminder progress (percent or null) -> chip/bar status. */
export function reminderStatus(progress) {
  if (progress === null || progress === undefined) return { key: null, label: "" };
  if (progress >= 100) return { key: "err", label: "Po terminie" };
  if (progress >= 80) return { key: "warn", label: "Wkrótce" };
  return { key: "ok", label: "OK" };
}

/** Nearest-limit text of a reminder: "za 9 dni lub za 9 800 km", "" when no limit. */
export function reminderLimitText(r) {
  const parts = [];
  if (r.days_left !== null && r.days_left !== undefined) {
    const n = Math.abs(r.days_left);
    const unit = n === 1 ? "dzień" : "dni";
    parts.push(r.days_left < 0 ? `${n} ${unit} po terminie` : `za ${n} ${unit}`);
  }
  if (r.km_left !== null && r.km_left !== undefined) {
    parts.push(r.km_left < 0 ? `${fmtKm(-r.km_left)} po terminie` : `za ${fmtKm(r.km_left)}`);
  }
  return parts.join(" lub ");
}

/** Shared HA-Settings-like building blocks (cards, list rows, badges, chips, buttons). */
export const haStyles = css`
  .card {
    background: var(--ha-card-background, var(--card-background-color, #fff));
    border: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(127, 127, 127, 0.3)));
    border-radius: var(--ha-card-border-radius, 12px);
    overflow: hidden;
  }
  .card-h {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 12px 16px 0; font-size: 16px; font-weight: 500;
  }
  .card-h a, .card-h button {
    color: var(--primary-color, #03a9f4); font-size: 14px; font-weight: 500; text-decoration: none;
    background: none; border: 0; cursor: pointer; font-family: inherit;
  }
  .sec-h { font-size: 14px; font-weight: 500; color: var(--secondary-text-color, #727272); margin: 4px 4px 0; }
  .li {
    display: flex; align-items: center; gap: 16px; padding: 10px 16px; min-height: 64px;
    box-sizing: border-box;
  }
  .li.compact { min-height: 48px; }
  .li + .li { border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); }
  button.li {
    width: 100%; text-align: left; font: inherit; color: inherit; background: transparent;
    border: 0; border-radius: 0; cursor: pointer; padding: 10px 16px;
  }
  .li .m { flex: 1; min-width: 0; }
  .li .t1 { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .li .t2 { font-size: 13px; color: var(--secondary-text-color, #727272); }
  .li .e { text-align: right; flex: none; }
  .li .e .t1 { font-size: 15px; }
  .li.dim .t1 { color: var(--secondary-text-color, #727272); font-size: 15px; }
  .badge {
    width: 40px; height: 40px; border-radius: 50%; flex: none;
    display: flex; align-items: center; justify-content: center;
    --mdc-icon-size: 22px;
    background: color-mix(in srgb, var(--secondary-text-color, #727272) 18%, transparent);
    color: var(--secondary-text-color, #727272);
  }
  .badge.b-service, .badge.b-primary {
    background: color-mix(in srgb, var(--primary-color, #03a9f4) 18%, transparent);
    color: var(--primary-color, #03a9f4);
  }
  .badge.b-refuel, .badge.b-ok {
    background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent);
    color: var(--success-color, #43a047);
  }
  .badge.b-odo {
    background: color-mix(in srgb, var(--secondary-text-color, #727272) 18%, transparent);
    color: var(--secondary-text-color, #727272);
  }
  .badge.b-warn {
    background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent);
    color: var(--warning-color, #ffa600);
  }
  .badge.b-err {
    background: color-mix(in srgb, var(--error-color, #db4437) 18%, transparent);
    color: var(--error-color, #db4437);
  }
  .chip {
    font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: 12px; white-space: nowrap;
    background: color-mix(in srgb, var(--secondary-text-color, #727272) 18%, transparent);
    color: var(--primary-text-color);
  }
  .chip.c-ok { background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent); color: color-mix(in srgb, var(--success-color, #43a047) 55%, var(--primary-text-color, #212121)); }
  .chip.c-warn { background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent); color: color-mix(in srgb, var(--warning-color, #ffa600) 55%, var(--primary-text-color, #212121)); }
  .chip.c-err { background: color-mix(in srgb, var(--error-color, #db4437) 18%, transparent); color: color-mix(in srgb, var(--error-color, #db4437) 55%, var(--primary-text-color, #212121)); }
  input.switch {
    appearance: none; -webkit-appearance: none; position: relative; flex: none; margin: 0;
    width: 36px; height: 20px; min-height: 0; padding: 0; border: 0; border-radius: 10px; cursor: pointer;
    background: color-mix(in srgb, var(--secondary-text-color, #727272) 55%, transparent);
    transition: background 0.15s;
  }
  input.switch::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: #fff; transition: transform 0.15s;
  }
  input.switch:checked { background: var(--primary-color, #03a9f4); }
  input.switch:checked::after { transform: translateX(16px); }
  input.switch:disabled { opacity: 0.4; cursor: default; }
  input.switch:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;
    height: 40px; min-height: 40px; padding: 0 20px; border: 0; border-radius: 20px; cursor: pointer;
    font: inherit; font-size: 14px; font-weight: 500; text-decoration: none; background: transparent;
    color: var(--primary-color, #03a9f4); --mdc-icon-size: 18px;
  }
  .btn.fill { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
  .btn.text { padding: 0 12px; }
  .btn.text.danger { color: var(--error-color, #db4437); }
  .btn.fill.danger { background: var(--error-color, #db4437); color: #fff; }
  .btn.wide { width: 100%; height: 48px; min-height: 48px; border-radius: 24px; font-size: 15px; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .alert {
    display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; border-radius: 12px; font-size: 14px;
    background: color-mix(in srgb, var(--warning-color, #ffa600) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning-color, #ffa600) 35%, transparent);
  }
  .alert > ha-icon { color: var(--warning-color, #ffa600); flex: none; }
  .alert .t { flex: 1; min-width: 0; }
  .bar {
    height: 6px; border-radius: 3px; overflow: hidden;
    background: color-mix(in srgb, var(--secondary-text-color, #727272) 20%, transparent);
  }
  .bar i { display: block; height: 100%; border-radius: 3px; background: var(--primary-color, #03a9f4); }
  .bar i.ok { background: var(--success-color, #43a047); }
  .bar i.warn { background: var(--warning-color, #ffa600); }
  .bar i.err { background: var(--error-color, #db4437); }
  .empty { padding: 24px 16px; text-align: center; color: var(--secondary-text-color, #727272); }
  .error { color: var(--error-color, #db4437); font-size: 14px; word-break: break-word; }
  .hint { font-size: 12px; color: var(--secondary-text-color, #727272); }
`;

/** Dialog shell, outlined fields and legacy form controls used by the entry forms. */
export const sheetStyles = css`
  ${haStyles}
  :host {
    color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, inherit);
  }
  * { box-sizing: border-box; }
  .overlay {
    position: fixed; inset: 0; z-index: 30; background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .sheet {
    background: var(--card-background-color, #fff); width: 100%; max-width: 560px;
    max-height: 90vh; display: flex; flex-direction: column; border-radius: 24px; overflow: hidden;
  }
  :host([narrow]) .sheet { max-width: none; height: 100%; max-height: none; border-radius: 0; }
  header {
    display: flex; align-items: center; gap: 4px; padding: 0 8px 0 4px; min-height: 56px; flex: none;
    border-bottom: 1px solid var(--divider-color);
  }
  header h2 { flex: 1; margin: 0; font-size: 20px; font-weight: 400; min-width: 0; }
  button.ib {
    width: 48px; height: 48px; min-height: 48px; padding: 0; border: 0; border-radius: 50%; flex: none;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    background: transparent; color: var(--primary-text-color); --mdc-icon-size: 24px;
  }
  .body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
  .body > * { flex: none; }
  footer {
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--divider-color);
    display: flex; flex-direction: column; gap: 8px; flex: none;
  }
  /* DOM order is primary action first: wide = row-reverse (delete left, save right), narrow = column-reverse */
  .foot-row { display: flex; flex-direction: row-reverse; align-items: center; gap: 8px; }
  .foot-row .spacer { flex: 1; }
  :host([narrow]) .foot-row { flex-direction: column-reverse; align-items: stretch; }
  :host([narrow]) .foot-row .spacer { display: none; }
  :host([narrow]) .foot-row .btn { width: 100%; height: 48px; min-height: 48px; }
  :host([narrow]) .expander-btn { height: 48px; min-height: 48px; }
  :host([narrow]) .foot-row .btn.fill { height: 48px; border-radius: 24px; font-size: 15px; }
  .row { display: flex; gap: 12px; }
  .row > * { flex: 1; min-width: 0; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
  input, select, textarea {
    font: inherit; font-size: 16px; min-height: 48px; padding: 8px 12px; width: 100%;
    color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px;
  }
  textarea { min-height: 80px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--primary-color); border-color: transparent; }
  input[type="checkbox"] { width: 24px; min-height: 24px; height: 24px; accent-color: var(--primary-color); }
  input.switch { width: 36px; height: 20px; min-height: 0; }
  input::placeholder { color: var(--disabled-text-color, #999); font-style: italic; }
  .check { flex-direction: row; align-items: center; gap: 12px; min-height: 48px; font-size: 16px; color: var(--primary-text-color); }
  button {
    font: inherit; min-height: 48px; min-width: 48px; padding: 0 16px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color);
  }
  button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; font-weight: 500; }
  button.danger { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
  button.danger.solid { background: var(--error-color, #db4437); color: #fff; }
  button.link { border: none; color: var(--primary-color); justify-content: flex-start; text-align: left; padding: 0; }
  button:disabled { opacity: 0.5; cursor: default; }
  .count { text-align: right; font-size: 12px; color: var(--secondary-text-color); }
  /* outlined field with the label floating on the border */
  label.f {
    position: relative; display: flex; flex-direction: row; align-items: center; height: 56px; gap: 8px;
    padding: 0 14px; border: 1px solid color-mix(in srgb, var(--secondary-text-color, #727272) 60%, transparent);
    border-radius: 8px; font-size: 16px; color: var(--primary-text-color);
    background: var(--card-background-color, #fff);
  }
  label.f:focus-within { border-color: var(--primary-color, #03a9f4); box-shadow: 0 0 0 1px var(--primary-color, #03a9f4); }
  label.f.disabled { opacity: 0.6; }
  label.f .fl {
    position: absolute; top: -9px; left: 10px; padding: 0 4px; font-size: 12px; line-height: 16px; pointer-events: none;
    background: var(--card-background-color, #fff); color: var(--secondary-text-color, #727272);
    max-width: calc(100% - 28px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  label.f:focus-within .fl { color: var(--primary-color, #03a9f4); }
  label.f input, label.f textarea {
    flex: 1; min-width: 0; height: 100%; min-height: 0; padding: 0; border: 0; border-radius: 0; outline: none;
    background: transparent; box-shadow: none; font-size: 16px;
  }
  label.f.ta { height: auto; align-items: stretch; padding: 0; }
  label.f.ta textarea { height: auto; min-height: 96px; padding: 16px 14px; }
  label.f .suf { color: var(--secondary-text-color, #727272); flex: none; }
  .ta-wrap { display: flex; flex-direction: column; gap: 4px; }
  /* switch row */
  label.swrow {
    flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px;
    font-size: 16px; color: var(--primary-text-color); cursor: pointer;
  }
  label.swrow .hint { display: block; }
`;

/**
 * Base class for the entry forms. Subclasses implement `heading`, `renderBody()`
 * and `buildEntry()`, which returns the entry payload or throws an Error with
 * a Polish validation message.
 */
export class VlForm extends LitElement {
  static properties = {
    hass: { attribute: false },
    view: { attribute: false },
    vehicle: { attribute: false },
    entry: { attribute: false },
    narrow: { type: Boolean, reflect: true },
    _error: { state: true },
    _busy: { state: true },
    _confirmDelete: { state: true },
  };
  static styles = sheetStyles;

  constructor() {
    super();
    this._error = "";
    this._busy = false;
    this._confirmDelete = false;
    // One id per opened form: a retry after a lost response upserts, not duplicates.
    this._newId = newId();
  }

  get editing() {
    return Boolean(this.entry && this.entry.id);
  }

  get heading() {
    return "";
  }

  renderBody() {
    return nothing;
  }

  get deleteWarning() {
    return "Na pewno usunąć ten wpis?";
  }

  renderExtraHeader() {
    return nothing;
  }

  showFooter() {
    return true;
  }

  close() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  _saved(view) {
    this.dispatchEvent(new CustomEvent("saved", { detail: view, bubbles: true, composed: true }));
  }

  async _call(msg) {
    this._busy = true;
    this._error = "";
    try {
      const view = await this.hass.callWS(msg);
      this._saved(view);
      this.close();
    } catch (err) {
      this._error = errorText(err);
    } finally {
      this._busy = false;
    }
  }

  async save() {
    let entry;
    try {
      entry = this.buildEntry();
    } catch (err) {
      this._error = err.message;
      return;
    }
    await this._call({ type: "vehicle_log/entry/save", entry: { ...entry, id: entry.id || this._newId } });
  }

  async _delete() {
    await this._call({ type: "vehicle_log/entry/delete", entry_id: this.entry.id });
  }

  field(label, value, onInput, opts = {}) {
    const { type = "text", maxlength, inputmode, placeholder = "", disabled = false, suffix = "" } = opts;
    return html`<label class="f ${disabled ? "disabled" : ""}"
      ><span class="fl">${label}</span>
      <input
        type=${type}
        .value=${value}
        maxlength=${maxlength ?? nothing}
        inputmode=${inputmode ?? nothing}
        placeholder=${placeholder}
        ?disabled=${disabled}
        @input=${(e) => onInput(e.target.value)}
      />${suffix ? html`<span class="suf">${suffix}</span>` : nothing}</label
    >`;
  }

  num(label, value, onInput, placeholder = "", suffix = "") {
    return this.field(label, value, onInput, { inputmode: "decimal", placeholder, suffix });
  }

  textArea(label, value, max, onInput) {
    return html`<div class="ta-wrap">
      <label class="f ta"
        ><span class="fl">${label}</span>
        <textarea .value=${value} maxlength=${max} @input=${(e) => onInput(e.target.value)}></textarea
      ></label>
      <span class="count">${value.length}/${max}</span>
    </div>`;
  }

  switchRow(label, checked, onChange, hint = "", disabled = false) {
    return html`<label class="swrow"
      ><span>${label}${hint ? html`<span class="hint">${hint}</span>` : nothing}</span>
      <input
        type="checkbox"
        class="switch"
        role="switch"
        .checked=${checked}
        ?disabled=${disabled}
        @change=${(e) => onChange(e.target.checked)}
    /></label>`;
  }

  expander(open, label, onOpen, content) {
    return open
      ? content
      : html`<button class="btn text expander-btn" style="align-self:flex-start" @click=${onOpen}>
          <ha-icon icon="mdi:plus"></ha-icon>${label}
        </button>`;
  }

  render() {
    return html`<div class="overlay">
      <div class="sheet" role="dialog" aria-label=${this.heading}>
        <header>
          <button class="ib" aria-label="Zamknij" @click=${() => this.close()}>
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
          <h2>${this.heading}</h2>
          ${this.renderExtraHeader()}
        </header>
        ${this.renderBody()}
        ${this.showFooter() ? this._renderFooter() : nothing}
      </div>
    </div>`;
  }

  _renderFooter() {
    return html`<footer>
      ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}
      ${this._confirmDelete
        ? html`<div>${this.deleteWarning}</div>
            <div class="foot-row">
              <button class="btn fill danger" ?disabled=${this._busy} @click=${() => this._delete()}>Usuń</button>
              <span class="spacer"></span>
              <button class="btn text" @click=${() => (this._confirmDelete = false)}>Anuluj</button>
            </div>`
        : html`<div class="foot-row">
            <button class="btn fill" ?disabled=${this._busy} @click=${() => this.save()}>
              ${this._busy ? "Zapisywanie…" : "Zapisz"}
            </button>
            <span class="spacer"></span>
            ${this.editing
              ? html`<button class="btn text danger" @click=${() => (this._confirmDelete = true)}>Usuń</button>`
              : nothing}
          </div>`}
    </footer>`;
  }
}

export { LitElement, html, css, nothing };
