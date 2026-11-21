// Panel strings in Polish and English. The panel calls setLanguage(hass.language);
// "pl" (any region) gets Polish, every other language gets English.

let LANG = "en";

export function setLanguage(code) {
  LANG = String(code || "").toLowerCase().split("-")[0] === "pl" ? "pl" : "en";
  return LANG;
}

export function lang() {
  return LANG;
}

/** Plural form: Polish one/few/many, English one/other (pass the same word twice). */
export function plural(n, one, few, many) {
  if (LANG !== "pl") return n === 1 ? one : many;
  const m10 = n % 10;
  const m100 = n % 100;
  if (n === 1) return one;
  return m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? few : many;
}

const days = (n) => (LANG === "pl" ? plural(n, "dzień", "dni", "dni") : plural(n, "day", "days", "days"));

// key: [Polish, English]; a function gets the params object.
const S = {
  // panel
  title: ["Dziennik pojazdu", "Vehicle Log"],
  tab_entries: ["Wpisy", "Entries"],
  tab_reminders: ["Przypomnienia", "Reminders"],
  tab_garage: ["Garaż", "Garage"],
  add: ["Dodaj", "Add"],
  add_reminder: ["Dodaj przypomnienie", "Add reminder"],
  reminder: ["Przypomnienie", "Reminder"],
  refuel: ["Tankowanie", "Refuel"],
  service: ["Serwis", "Service"],
  odometer_reading: ["Odczyt przebiegu", "Odometer reading"],
  vehicle: ["Pojazd", "Vehicle"],
  menu: ["Menu", "Menu"],
  conn_error: [(p) => `Nie można połączyć z integracją: ${p.error}`, (p) => `Cannot connect to the integration: ${p.error}`],
  retrying: ["Ponawiam próbę…", "Retrying…"],
  loading: ["Ładowanie…", "Loading…"],
  no_vehicles: ["Brak pojazdów.", "No vehicles."],
  add_vehicle: ["Dodaj pojazd", "Add vehicle"],

  // shared
  odometer: ["Przebieg", "Odometer"],
  date: ["Data", "Date"],
  time: ["Godzina", "Time"],
  name: ["Nazwa", "Name"],
  comment: ["Komentarz", "Comment"],
  close: ["Zamknij", "Close"],
  delete: ["Usuń", "Delete"],
  cancel: ["Anuluj", "Cancel"],
  save: ["Zapisz", "Save"],
  saving: ["Zapisywanie…", "Saving…"],
  edit: ["Edytuj", "Edit"],
  unknown_error: ["Nieznany błąd", "Unknown error"],
  int_only_digits: [(p) => `${p.label}: tylko cyfry, bez przecinka i znaków.`, (p) => `${p.label}: digits only, no commas or other characters.`],
  int_too_big: [(p) => `${p.label}: wartość jest zbyt duża.`, (p) => `${p.label}: the value is too large.`],
  bad_number: ["Popraw nieprawidłową liczbę.", "Fix the invalid number."],
  need_name: ["Podaj nazwę.", "Enter a name."],
  need_date: ["Podaj datę.", "Enter a date."],
  delete_entry: ["Na pewno usunąć ten wpis?", "Delete this entry?"],
  delete_reminder: ["Na pewno usunąć to przypomnienie?", "Delete this reminder?"],
  last_value: [(p) => `ostatnio ${p.value}`, (p) => `last ${p.value}`],
  tax_or_discount: ["Podatek lub rabat", "Tax or discount"],
  tax: ["Podatek", "Tax"],
  discount: ["Rabat", "Discount"],
  discount_pct: ["Rabat (%)", "Discount (%)"],
  discount_amount: ["Rabat (zł)", "Discount (zł)"],

  // reminder status and limits
  st_overdue: ["Po terminie", "Overdue"],
  st_soon: ["Wkrótce", "Soon"],
  st_ok: ["OK", "OK"],
  today: ["dziś", "today"],
  days_left: [(p) => `za ${p.n} ${days(p.n)}`, (p) => `in ${p.n} ${days(p.n)}`],
  days_late: [(p) => `${p.n} ${days(p.n)} po terminie`, (p) => `${p.n} ${days(p.n)} overdue`],
  km_left: [(p) => `za ${p.km}`, (p) => `in ${p.km}`],
  km_late: [(p) => `${p.km} po terminie`, (p) => `${p.km} overdue`],
  or: [" lub ", " or "],

  // type picker
  type: ["Rodzaj", "Type"],
  choose_type: ["Wybierz rodzaj", "Choose type"],
  change: ["Zmień", "Change"],
  search_type: ["Szukaj rodzaju serwisu", "Search service types"],
  search: ["Szukaj", "Search"],
  no_results: ["Brak wyników.", "No results."],

  // entries
  since: [(p) => `od ${p.date}`, (p) => `since ${p.date}`],
  vehicle_load_error: ["Nie udało się wczytać danych pojazdu", "Could not load this vehicle's data"],
  forecast_today: [(p) => `szac. dziś ${p.km}`, (p) => `est. today ${p.km}`],
  no_reading_for: [(p) => `Brak odczytu od ${p.n} ${days(p.n)}`, (p) => `No reading for ${p.n} ${days(p.n)}`],
  avg_consumption: ["Średnie spalanie", "Average consumption"],
  last_consumption: ["Ostatnie spalanie", "Last consumption"],
  last_consumption_pb: ["Ostatnie spalanie Pb", "Last petrol consumption"],
  last_consumption_lpg: ["Ostatnie spalanie LPG", "Last LPG consumption"],
  last_lpg_hint: ["od drugiego tankowania LPG do pełna", "after the second full LPG refuel"],
  consumption_hint: ["od drugiego tankowania do pełna", "after the second full-tank refuel"],
  refuel_on: [(p) => `tankowanie ${p.date}`, (p) => `refuel ${p.date}`],
  all: ["Wszystkie", "All"],
  entry: ["Wpis", "Entry"],
  bad_entry: ["Błędny wpis", "Invalid entry"],
  partial: ["(częściowe)", "(partial)"],
  no_date: ["Bez daty", "No date"],
  no_entries: ["Brak wpisów. Użyj przycisku Dodaj, aby dodać pierwszy.", "No entries yet. Use the Add button to add the first one."],

  // reminders
  error: ["Błąd", "Error"],
  cannot_compute: ["Nie można policzyć terminu", "Cannot work out the due date"],
  time_limit: ["Czas", "Time"],
  stat_time: ["czas", "time"],
  stat_km: ["przebieg", "distance"],
  stat_forecast: ["prognoza", "forecast"],
  done: ["Wykonane", "Done"],
  no_odometer_for: [(p) => `Brak odczytu przebiegu od ${p.n} ${days(p.n)}`, (p) => `No odometer reading for ${p.n} ${days(p.n)}`],
  update: ["Aktualizuj", "Update"],
  no_reminders: ["Brak przypomnień. Użyj przycisku Przypomnienie, aby dodać pierwsze.", "No reminders yet. Use the Reminder button to add the first one."],

  // garage
  vehicles: ["Pojazdy", "Vehicles"],
  data_error: ["Błąd danych", "Data error"],
  no_fuel: ["Paliwo nie wybrane", "No fuel selected"],
  bought: [(p) => `zakup ${p.date}`, (p) => `bought ${p.date}`],
  settings: ["Ustawienia", "Settings"],
  forecast_setting: ["Szacuj przebieg", "Estimate odometer"],
  forecast_hint: ["Na podstawie dotychczasowej jazdy", "Based on your driving so far"],
  odo_reminder_setting: ["Przypominaj o przebiegu", "Odometer reminder"],
  odo_reminder_hint: ["Gdy brak odczytu przez podaną liczbę dni", "When there is no reading for the given number of days"],
  days_without: ["Dni bez odczytu", "Days without a reading"],
  days_without_aria: ["Dni bez odczytu przebiegu", "Days without an odometer reading"],
  days_range: ["Liczba dni musi być od 1 do 3650.", "The number of days must be 1 to 3650."],
  import: ["Import", "Import"],
  import_hint: ["Wczytaj eksport .xlsx z aplikacji Car Notes. Istniejące wpisy nie zostaną zdublowane.", "Load an .xlsx export from the Car Notes app. Existing entries are not duplicated."],
  choose_file: ["Wybierz plik", "Choose file"],
  file_too_big: ["Plik jest za duży (limit 2 MB).", "The file is too large (2 MB limit)."],
  file_read_error: [(p) => `Nie można odczytać pliku: ${p.error}`, (p) => `Cannot read the file: ${p.error}`],
  import_done: [
    (p) => `Dodano ${p.added} ${plural(p.added, "wpis", "wpisy", "wpisów")}, pominięto ${p.skipped}.`,
    (p) => `Added ${p.added} ${plural(p.added, "entry", "entries", "entries")}, skipped ${p.skipped}.`,
  ],
  import_vehicles: [
    (p) => ` Dodano ${p.n} ${plural(p.n, "nowy pojazd", "nowe pojazdy", "nowych pojazdów")}.`,
    (p) => ` Added ${p.n} new ${plural(p.n, "vehicle", "vehicles", "vehicles")}.`,
  ],

  // service form
  edit_service: ["Edytuj serwis", "Edit service"],
  add_service: ["Dodaj serwis", "Add service"],
  parts: ["Części", "Parts"],
  labour: ["Robocizna", "Labour"],
  total: ["Razem", "Total"],
  auto_total: ["Wylicz automatycznie", "Calculate automatically"],
  parts_and_comment: ["Numery części i komentarz", "Part numbers and comment"],
  part_numbers: ["Numery części", "Part numbers"],
  accessory: ["Koszt akcesoriów", "Accessory cost"],

  // refuel form
  two_of_three: ["Podaj dwie z trzech wartości: kwota, cena za litr, litry.", "Enter two of the three values: amount, price per litre, litres."],
  fuel_type: ["Rodzaj paliwa", "Fuel type"],
  other_fuel_option: ["inny…", "other…"],
  other_fuel: ["Inne paliwo", "Other fuel"],
  amount: ["Kwota", "Amount"],
  price_per_litre: ["Cena za litr", "Price per litre"],
  litres: ["Litry", "Litres"],
  two_values_hint: ["Wpisz dwie wartości, trzecia zostanie wyliczona.", "Enter two values; the third is calculated."],
  full_tank: ["Do pełna", "Full tank"],
  partial_tank: ["Tankowanie częściowe", "Partial refuel"],
  full_tank_hint: ["Potrzebne do liczenia spalania", "Needed to calculate consumption"],

  // reminder form
  edit_reminder: ["Edytuj przypomnienie", "Edit reminder"],
  interval_km_label: ["Interwał (km)", "Interval (km)"],
  interval_months_label: ["Interwał (miesiące)", "Interval (months)"],
  baseline_odometer: ["Przebieg bazowy", "Starting odometer"],
  need_text: ["Podaj tekst przypomnienia.", "Enter the reminder text."],
  km_range: ["Interwał w km musi być od 1 do 1 000 000.", "The km interval must be 1 to 1,000,000."],
  months_range: ["Interwał w miesiącach musi być od 1 do 1200.", "The month interval must be 1 to 1200."],
  need_interval: ["Podaj interwał w km lub miesiącach.", "Enter an interval in km or months."],
  need_baseline_odo: ["Podaj przebieg bazowy, aby liczyć interwał w km.", "Enter the starting odometer to use a km interval."],
  need_baseline_date: ["Podaj datę bazową.", "Enter the starting date."],
  due: [(p) => `Termin: ${p.text}`, (p) => `Due: ${p.text}`],
  text: ["Tekst", "Text"],
  extra_text: ["Dodatkowy tekst", "Extra text"],
  every_km: ["Co ile km", "Every (km)"],
  every_months: ["Co ile miesięcy", "Every (months)"],
  months_short: ["mies.", "mo."],
  baseline_date: ["Data bazowa", "Starting date"],

  // vehicle form
  edit_vehicle: ["Edytuj pojazd", "Edit vehicle"],
  delete_vehicle: [
    "Na pewno usunąć ten pojazd? Zostaną usunięte także wszystkie jego wpisy i przypomnienia.",
    "Delete this vehicle? All its entries and reminders are deleted too.",
  ],
  need_vehicle_name: ["Podaj nazwę pojazdu.", "Enter the vehicle name."],
  need_fuel: ["Wybierz rodzaj paliwa (jeden lub dwa).", "Choose the fuel type (one or two)."],
  vehicle_name_placeholder: ["np. Auto rodzinne", "e.g. Family car"],
  purchase_date: ["Data zakupu", "Purchase date"],
  fuel_hint: ["Jeden lub dwa, np. Pb95 + LPG", "One or two, e.g. Petrol 95 + LPG"],

  // LPG
  petrol_consumption: ["Spalanie Pb", "Petrol consumption"],
  petrol_consumption_hint: ["Używane do czasu zmierzenia z tankowań", "Used until it is measured from refuels"],
  petrol_price: ["Cena Pb", "Petrol price"],
  petrol_price_hint: ["Do wyliczenia oszczędności; puste = ostatnia znana cena", "For the savings; empty = last known price"],
  petrol_only: ["Od ostatniego tankowania Pb jeździłem tylko na benzynie", "Only petrol since the last petrol refuel"],
  petrol_only_hint: ["Do pomiaru spalania Pb", "Used to measure petrol consumption"],
  lpg_install_hint: ["Od tego przebiegu liczona jest oszczędność na LPG", "LPG savings are counted from this odometer reading"],
  lpg_two_fuels_hint: [
    "Auto ma już dwa paliwa — zmień paliwa w Garażu, żeby tankować LPG",
    "This vehicle already has two fuels — change them in the Garage to refuel LPG",
  ],
  entered: ["wpisane", "entered"],
  measured_km: [(p) => `zmierzone, ${p.km}`, (p) => `measured, ${p.km}`],
  approximate: ["orientacyjnie", "approximate"],
  lpg_mode: ["Jazda na LPG", "Driving on LPG"],
  lpg_mode_petrol: [(p) => `+ ${p.l} l Pb · orientacyjnie`, (p) => `+ ${p.l} l petrol · approximate`],
  lpg_mode_pending: ["po kilku tankowaniach LPG do pełna", "after a few full LPG refuels"],
  lpg_mode_line: [
    (p) => `Na LPG: ~${p.lpg} l LPG + ${p.pb} l Pb / 100 km (orientacyjnie)`,
    (p) => `On LPG: ~${p.lpg} l LPG + ${p.pb} l petrol / 100 km (approximate)`,
  ],
  lpg_since: [(p) => `LPG · od ${p.date}`, (p) => `LPG · since ${p.date}`],
  lpg_saved: [(p) => `Dzięki jeździe na LPG zaoszczędziłeś ${p.amount}`, (p) => `Driving on LPG has saved you ${p.amount}`],
  lpg_progress: [(p) => `${p.pct}% z ${p.cost} kosztów LPG`, (p) => `${p.pct}% of ${p.cost} LPG costs`],
  lpg_remaining: [(p) => `Do zwrotu ${p.amount}`, (p) => `${p.amount} to go`],
  lpg_at_km: [(p) => `ok. ${p.km}`, (p) => `approx. ${p.km}`],
  lpg_paid_back: [
    (p) => `Instalacja się zwróciła — na czysto zaoszczędziłeś ${p.amount}`,
    (p) => `The installation has paid for itself — net savings ${p.amount}`,
  ],
  lpg_no_baseline: ["Podaj spalanie Pb w ustawieniach auta, żeby liczyć oszczędność", "Set petrol consumption in the vehicle settings to see the savings"],
  lpg_no_install_odometer: ["Podaj przebieg we wpisie montażu instalacji LPG", "Add the odometer reading to the LPG installation entry"],
  lpg_unpriced: [
    (p) => `${p.n} ${plural(p.n, "tankowanie", "tankowania", "tankowań")} bez ceny Pb — pominięte w oszczędności`,
    (p) => `${p.n} ${plural(p.n, "refuel", "refuels", "refuels")} without a petrol price left out of the savings`,
  ],

  // odometer form
  update_odometer: ["Aktualizuj przebieg", "Update odometer"],
  need_odometer: ["Podaj poprawny przebieg.", "Enter a valid odometer value."],
};

export function t(key, params = {}) {
  const pair = S[key];
  if (!pair) return key;
  const value = pair[LANG === "pl" ? 0 : 1];
  return typeof value === "function" ? value(params) : value;
}

const MONTHS = {
  pl: {
    short: ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
    long: ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"],
  },
  en: {
    short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    long: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  },
};

export function monthName(index, form = "short") {
  return MONTHS[LANG][form][index];
}

// Service type labels by id; Polish comes from the backend (const.SERVICE_TYPES).
const TYPES_EN = {
  periodic_service: "Periodic service",
  oil_filter: "Oil and filter",
  air_filter: "Air filter",
  cabin_filter: "Cabin filter",
  brake_pads: "Brake pads",
  brake_discs_pads: "Brake discs and pads",
  brake_fluid: "Brake fluid",
  spark_plugs: "Spark plugs",
  wipers: "Wipers",
  tyre_change: "Tyre change",
  wheels: "Wheels",
  engine: "Engine",
  suspension: "Suspension",
  gearbox: "Gearbox",
  fluids: "Fluids",
  fuel_filter: "Fuel filter",
  timing_belt: "Timing belt",
  accessory_belt: "Accessory belt",
  coolant: "Coolant",
  car_wash: "Car wash",
  tyre_repair: "Tyre repair",
  electrical: "Electrical",
  bodywork: "Bodywork repair",
  towing: "Towing",
  odometer_update: "Odometer update",
  other: "Other service",
  lpg_install: "LPG installation",
  lpg_service: "LPG service",
  refuel: "Refuel",
};

/** service_types from the view with labels in the current language. */
export function localizeTypes(types) {
  if (LANG === "pl" || !types) return types;
  return Object.fromEntries(
    Object.entries(types).map(([id, type]) => [id, { ...type, label: TYPES_EN[id] || type.label }]),
  );
}

// Stored fuel codes stay as they are; only the label changes.
const FUELS_EN = { Pb95: "Petrol 95", Pb98: "Petrol 98", ON: "Diesel" };

export function fuelLabel(code) {
  return LANG === "pl" ? code : FUELS_EN[code] || code;
}
