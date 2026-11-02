/*
 * share.js - the page behind a shared Routine Calendar routine link.
 *
 * A shared link looks like https://routine-calendar.github.io/routines/create?shared=<payload>. When Routine Calendar is installed and the
 * Android App Link is verified (see /.well-known/assetlinks.json), Android opens the app directly and this page never loads.
 * When it does load, there is NO choice to make: on an Android phone the page opens the app AUTOMATICALLY right away, and the app adds
 * the routine by itself, exactly as it was shared. Step by step:
 *   1. read the payload from the query string (base64url of the UTF-8 JSON of a RoutineTemplate, version 1) and decode it,
 *   2. show a read-only preview (text only, never HTML from the payload),
 *   3. open the app with a Chrome intent:// URL (custom scheme routinecalendar://, package com.routinecalendar.app). Its
 *      S.browser_fallback_url brings the browser back to this page with &fallback=1 when the app is not installed, and a timer covers
 *      browsers that ignore intents or block the automatic open,
 *   4. only when the app cannot be opened show the FALLBACK: why, "Copy link" (for the app's Import shared routine card) with
 *      step-by-step instructions, and "Try opening the app again" (a tap counts as a user gesture, which some browsers require).
 * The app is not opened automatically when the payload is too large for a direct open (AUTO_OPEN_MAX_LENGTH), on non-Android devices,
 * or when the link is damaged; those cases go straight to the fallback (a damaged link gets no Copy link, it would not work either).
 *
 * The decoding mirrors src/features/routineTemplate/shareCodec.ts in the app (same size limit, same alphabet handling). The app
 * remains the validator: this page only previews and never stores anything.
 *
 * Docs: https://developer.chrome.com/docs/android/intents ,
 *       https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder ,
 *       https://developer.mozilla.org/en-US/docs/Web/API/Window/atob ,
 *       https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event ,
 *       https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat ,
 *       https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
 */
"use strict";

/** App URL scheme (expo.scheme in the app's app.json). */
const APP_SCHEME = "routinecalendar";
/** Android package of the app (expo.android.package in the app's app.json); Chrome opens only this app from the intent. */
const APP_PACKAGE = "com.routinecalendar.app";
/** App route that receives a shared routine (src/app/routines/create.tsx). */
const SHARE_PATH = "routines/create";
/** Query parameter that carries the payload. */
const SHARE_PARAM = "shared";
/** Query parameter this page adds to its own URL as the intent's browser fallback (the app is not installed). */
const FALLBACK_PARAM = "fallback";
/** Largest accepted payload in characters (ROUTINE_SHARE_MAX_PAYLOAD_LENGTH in the app); larger ones the app refuses too. */
const MAX_PAYLOAD_LENGTH = 256 * 1024;
/**
 * Largest payload opened automatically. An Android intent travels through a binder transaction of at most about 1 MB, and the URL is
 * sent as UTF-16 (2 bytes per character), so a very long link can fail to open the app. Above this length the page shows the fallback
 * directly and the app's paste import (which accepts up to MAX_PAYLOAD_LENGTH) is used instead.
 */
const AUTO_OPEN_MAX_LENGTH = 100 * 1000;
/** How long to wait for the app to take over before the fallback is shown. */
const APP_OPEN_TIMEOUT_MS = 2500;

/** Page texts in English and Polish (the two app languages). */
const TEXTS = {
  en: {
    pageTitle: "Shared routine - Routine Calendar",
    appName: "Routine Calendar",
    heading: "A routine was shared with you",
    opening: "Opening Routine Calendar. The routine is added automatically.",
    opened: "The routine was sent to Routine Calendar. You can close this page.",
    copyLink: "Copy link",
    openAgain: "Try opening the app again",
    copied: "Link copied. Now paste it in the app (step 3 below).",
    copyFailed: "Copying is not available here. Select the address in the address bar and copy it.",
    reasonDidNotOpen: "Routine Calendar did not open, so the routine could not be added automatically. You can still add it by hand:",
    reasonNotInstalled: "Routine Calendar is not installed on this phone, so the routine could not be added automatically. You can still add it by hand:",
    reasonNotAndroid: "Routine Calendar is an Android app, so the routine can't be added on this device automatically. You can still add it on your phone:",
    reasonTooLong: "This routine is too large to open the app directly. You can still add it by hand:",
    howToTitle: "How to add it",
    howTo1: "Install Routine Calendar on your Android phone.",
    howTo2: "Tap Copy link above (on a computer, send the link to your phone first).",
    howTo3: "In the app, open Create routine, expand Import shared routine, paste the link and tap Import.",
    howTo4: "Check the routine and tap Save.",
    schedule: "Schedule",
    prerequisites: "You will need",
    steps: "Steps",
    unnamed: "Untitled routine",
    starts: "Starts {date}",
    once: "Once",
    daily: "Every day",
    weekly: "Every week",
    monthly: "Every month",
    everyDays: "Every {n} days",
    everyWeeks: "Every {n} weeks",
    everyMonths: "Every {n} months",
    onWeekdays: "on {days}",
    endsAfter: "{n} times",
    endsOn: "Until {date}",
    reminderAt: "Reminder at {time}",
    alarm: "Alarm",
    seconds: "{n} s",
    minutes: "{n} min",
    hours: "{n} h",
    times: "× {n}",
    errorMissing: "This link does not contain a routine. Ask the sender to share it again.",
    errorTooLarge: "This shared routine is too large to open.",
    errorMalformed: "This link is damaged or incomplete. Ask the sender to share it again.",
    errorVersion: "This routine was shared from a newer version of Routine Calendar. Update the app, then try again:",
  },
  pl: {
    pageTitle: "Udostępniona rutyna - Kalendarz Rutyn",
    appName: "Kalendarz Rutyn",
    heading: "Ktoś udostępnił Ci rutynę",
    opening: "Otwieranie Kalendarza Rutyn. Rutyna zostanie dodana automatycznie.",
    opened: "Rutyna została przekazana do Kalendarza Rutyn. Możesz zamknąć tę stronę.",
    copyLink: "Kopiuj link",
    openAgain: "Spróbuj ponownie otworzyć aplikację",
    copied: "Link skopiowany. Teraz wklej go w aplikacji (krok 3 poniżej).",
    copyFailed: "Kopiowanie nie jest tu dostępne. Zaznacz adres na pasku adresu i skopiuj go.",
    reasonDidNotOpen: "Kalendarz Rutyn się nie otworzył, więc rutyny nie udało się dodać automatycznie. Nadal możesz dodać ją ręcznie:",
    reasonNotInstalled: "Kalendarz Rutyn nie jest zainstalowany na tym telefonie, więc rutyny nie udało się dodać automatycznie. Nadal możesz dodać ją ręcznie:",
    reasonNotAndroid: "Kalendarz Rutyn to aplikacja na Androida, więc na tym urządzeniu rutyny nie da się dodać automatycznie. Nadal możesz dodać ją na telefonie:",
    reasonTooLong: "Ta rutyna jest zbyt duża, aby otworzyć ją bezpośrednio w aplikacji. Nadal możesz dodać ją ręcznie:",
    howToTitle: "Jak ją dodać",
    howTo1: "Zainstaluj Kalendarz Rutyn na telefonie z Androidem.",
    howTo2: "Dotknij Kopiuj link powyżej (na komputerze najpierw wyślij link na telefon).",
    howTo3: "W aplikacji otwórz Stwórz rutynę, rozwiń Importuj udostępnioną rutynę, wklej link i dotknij Importuj.",
    howTo4: "Sprawdź rutynę i dotknij Zapisz.",
    schedule: "Harmonogram",
    prerequisites: "Będzie potrzebne",
    steps: "Kroki",
    unnamed: "Rutyna bez nazwy",
    starts: "Od {date}",
    once: "Jednorazowo",
    daily: "Codziennie",
    weekly: "Co tydzień",
    monthly: "Co miesiąc",
    everyDays: "Co {n} dni",
    everyWeeks: "Co {n} tyg.",
    everyMonths: "Co {n} mies.",
    onWeekdays: "w dni: {days}",
    endsAfter: "{n} razy",
    endsOn: "Do {date}",
    reminderAt: "Przypomnienie o {time}",
    alarm: "Alarm",
    seconds: "{n} s",
    minutes: "{n} min",
    hours: "{n} godz.",
    times: "× {n}",
    errorMissing: "Ten link nie zawiera rutyny. Poproś nadawcę o ponowne udostępnienie.",
    errorTooLarge: "Ta udostępniona rutyna jest zbyt duża, aby ją otworzyć.",
    errorMalformed: "Ten link jest uszkodzony lub niepełny. Poproś nadawcę o ponowne udostępnienie.",
    errorVersion: "Ta rutyna pochodzi z nowszej wersji Kalendarza Rutyn. Zaktualizuj aplikację i spróbuj ponownie:",
  },
};

/** Page language: Polish when the browser prefers it, English otherwise. */
const LANG = (navigator.languages || [navigator.language || "en"]).some((l) => String(l).toLowerCase().startsWith("pl")) ? "pl" : "en";
/** Texts of the page language. */
const T = TEXTS[LANG];

/**
 * Fills {placeholders} of a text.
 * @param {string} text text with {key} tokens
 * @param {Record<string, string|number>} values replacement values
 * @returns {string} the filled text
 */
function fill(text, values) {
  // Unknown keys keep their token.
  return text.replace(/\{(\w+)\}/g, (token, key) => (key in values ? String(values[key]) : token));
}

/**
 * Reads the raw payload from the query string WITHOUT URLSearchParams, because URLSearchParams turns "+" into a space.
 * @returns {string|null} the percent-decoded value of ?shared=, or null when the parameter is missing
 */
function readRawPayload() {
  // First "shared=" parameter of the query string, up to the next "&" or "#".
  const match = new RegExp(`[?&]${SHARE_PARAM}=([^&#]*)`).exec(window.location.search);
  if (match === null) return null;
  // A malformed percent escape keeps the raw text (it fails decoding later and is reported as damaged).
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Turns a code into canonical base64url: whitespace removed, "+" -> "-", "/" -> "_", trailing "=" removed.
 * @param {string} code the raw code
 * @returns {string} the canonical code
 */
function normalizeCode(code) {
  return code.replace(/\s+/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes a payload into the template object, mirroring decodeRoutineSharePayload in the app.
 * @param {string|null} raw the raw payload
 * @returns {{ok: true, template: object} | {ok: false, reason: "missing"|"too-large"|"malformed"|"version"}}
 */
function decodePayload(raw) {
  // No parameter or an empty one.
  if (raw === null || raw.trim() === "") return { ok: false, reason: "missing" };
  // Size check before any work (whitespace may add a little to a valid code).
  if (raw.length > MAX_PAYLOAD_LENGTH * 2) return { ok: false, reason: "too-large" };
  const code = normalizeCode(raw);
  if (code.length > MAX_PAYLOAD_LENGTH) return { ok: false, reason: "too-large" };
  // Only the base64url alphabet, and no length that an encoder cannot produce.
  if (!/^[A-Za-z0-9_-]+$/.test(code) || code.length % 4 === 1) return { ok: false, reason: "malformed" };
  let text;
  try {
    // base64url -> standard base64 with padding -> binary string -> bytes.
    const standard = code.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((code.length + 3) % 4);
    const binary = atob(standard);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    // Strict UTF-8: invalid bytes throw instead of becoming U+FFFD.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // A template is a JSON object with a numeric version.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || typeof parsed.version !== "number") {
    return { ok: false, reason: "malformed" };
  }
  // Only version 1 is known; a newer app made anything else.
  if (parsed.version !== 1) return { ok: false, reason: "version" };
  return { ok: true, template: parsed };
}

/**
 * Formats a "YYYY-MM-DD" calendar date in the page language (as a local date, so no timezone shift).
 * @param {unknown} key the date key
 * @returns {string|null} the formatted date, or null for anything that is not a valid key
 */
function formatDate(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  // Reject dates such as 2026-02-31 that roll over into another month.
  if (date.getMonth() !== m - 1) return null;
  return new Intl.DateTimeFormat(LANG, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/**
 * Short weekday name of an ISO weekday (1 = Monday ... 7 = Sunday).
 * @param {number} iso the ISO weekday
 * @returns {string} the localized short name
 */
function weekdayName(iso) {
  // 2024-01-01 was a Monday, so day (iso) of that week has the wanted weekday.
  return new Intl.DateTimeFormat(LANG, { weekday: "short" }).format(new Date(2024, 0, iso));
}

/**
 * Tells whether a value is a positive whole number (used for counts and intervals from the untrusted payload).
 * @param {unknown} n the value
 * @returns {boolean}
 */
function isCount(n) {
  return Number.isInteger(n) && n > 0;
}

/**
 * Builds the schedule and reminder chip texts of a template.
 * @param {object} template the decoded template
 * @returns {string[]} chip texts in display order
 */
function scheduleChips(template) {
  const chips = [];
  const schedule = typeof template.schedule === "object" && template.schedule !== null ? template.schedule : {};
  // Repeat rule.
  const repeat = schedule.repeat;
  if (repeat && typeof repeat === "object") {
    if (repeat.kind === "once") chips.push(T.once);
    else if (repeat.kind === "daily") chips.push(T.daily);
    else if (repeat.kind === "weekly") chips.push(T.weekly);
    else if (repeat.kind === "monthly") chips.push(T.monthly);
    else if (repeat.kind === "custom" && isCount(repeat.every)) {
      const key = { day: "everyDays", week: "everyWeeks", month: "everyMonths" }[repeat.unit];
      if (key) {
        // "Every week" reads better than "Every 1 weeks".
        const single = { day: T.daily, week: T.weekly, month: T.monthly }[repeat.unit];
        let text = repeat.every === 1 ? single : fill(T[key], { n: repeat.every });
        // Picked weekdays of a weekly custom repeat.
        if (repeat.unit === "week" && Array.isArray(repeat.weekdays) && repeat.weekdays.length > 0) {
          const days = repeat.weekdays.filter((d) => isCount(d) && d <= 7).map(weekdayName).join(", ");
          if (days) text += " " + fill(T.onWeekdays, { days });
        }
        chips.push(text);
      }
    }
  }
  // Start date.
  const start = formatDate(schedule.startDate);
  if (start) chips.push(fill(T.starts, { date: start }));
  // End rule.
  const end = schedule.end;
  if (end && typeof end === "object") {
    if (end.kind === "after-occurrences" && isCount(end.count)) chips.push(fill(T.endsAfter, { n: end.count }));
    const until = end.kind === "on-date" ? formatDate(end.date) : null;
    if (until) chips.push(fill(T.endsOn, { date: until }));
  }
  // Reminder and alarm.
  const reminder = template.reminder;
  if (reminder && typeof reminder === "object" && reminder.enabled === true) {
    if (typeof reminder.time === "string" && /^\d{2}:\d{2}$/.test(reminder.time)) chips.push(fill(T.reminderAt, { time: reminder.time }));
    if (reminder.alarmEnabled === true) chips.push(T.alarm);
  }
  return chips;
}

/**
 * Detail text of one step (duration or quantity).
 * @param {object} step a template step
 * @returns {string} the detail, or "" for a check step
 */
function stepDetail(step) {
  if (step.mode === "timed" && typeof step.duration === "number" && step.duration > 0) {
    const key = { seconds: "seconds", minutes: "minutes", hours: "hours" }[step.durationUnit];
    return key ? fill(T[key], { n: step.duration }) : "";
  }
  if (step.mode === "quantity" && typeof step.quantity === "number" && step.quantity > 0) {
    const unit = typeof step.quantityUnit === "string" ? " " + step.quantityUnit : "";
    return fill(T.times, { n: step.quantity }) + unit;
  }
  return "";
}

/**
 * Detail text of one prerequisite (quantity and unit).
 * @param {object} item a template prerequisite
 * @returns {string} the detail, or ""
 */
function prerequisiteDetail(item) {
  if (typeof item.quantity !== "number" || item.quantity <= 0) return "";
  return String(item.quantity) + (typeof item.unit === "string" ? " " + item.unit : "");
}

/**
 * Creates an element with plain text (never innerHTML: the payload is untrusted).
 * @param {string} tag element name
 * @param {string} text its text
 * @param {string} [className] optional class
 * @returns {HTMLElement}
 */
function el(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

/**
 * Renders a titled list of items (steps or prerequisites) into the preview.
 * @param {HTMLElement} root container
 * @param {string} title section title
 * @param {"ol"|"ul"} tag ordered (steps) or unordered (prerequisites)
 * @param {unknown} items untrusted array
 * @param {string} titleKey the field holding the item name ("title" or "name")
 * @param {(item: object) => string} detail detail text builder
 */
function renderList(root, title, tag, items, titleKey, detail) {
  if (!Array.isArray(items)) return;
  // Only objects with a non-empty name are shown (the app validator drops the rest too).
  const valid = items.filter((item) => item && typeof item === "object" && typeof item[titleKey] === "string" && item[titleKey].trim());
  if (valid.length === 0) return;
  root.appendChild(el("h2", title));
  const list = document.createElement(tag);
  for (const item of valid) {
    const li = el("li", item[titleKey].trim());
    const extra = detail(item);
    if (extra) {
      // Separator, then the muted detail.
      li.appendChild(document.createTextNode(" "));
      li.appendChild(el("span", "· " + extra, "detail"));
    }
    list.appendChild(li);
  }
  root.appendChild(list);
}

/**
 * Renders the decoded routine into #routine.
 * @param {object} template the decoded template
 */
function renderRoutine(template) {
  const root = document.getElementById("routine");
  const name = typeof template.name === "string" && template.name.trim() ? template.name.trim() : T.unnamed;
  root.appendChild(el("h1", name));
  // Use the routine name in the browser tab too.
  document.title = `${name} - ${T.appName}`;
  const chips = scheduleChips(template);
  if (chips.length > 0) {
    root.appendChild(el("h2", T.schedule));
    const list = document.createElement("ul");
    list.className = "chips";
    for (const chip of chips) list.appendChild(el("li", chip));
    root.appendChild(list);
  }
  renderList(root, T.prerequisites, "ul", template.prerequisites, "name", prerequisiteDetail);
  renderList(root, T.steps, "ol", template.steps, "title", stepDetail);
  root.hidden = false;
}

/**
 * Shows a message in the fallback's status line (copy result).
 * @param {string} text the message
 */
function setStatus(text) {
  document.getElementById("status").textContent = text;
}

/**
 * Tells whether the page runs on an Android device (the only platform of the app).
 * @returns {boolean}
 */
function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

/**
 * Tells whether this load is the intent's browser fallback (Chrome came back because the app is not installed).
 * @returns {boolean}
 */
function isIntentFallback() {
  return new RegExp(`[?&]${FALLBACK_PARAM}=1(?:&|#|$)`).test(window.location.search);
}

/**
 * This page's URL without the fallback marker: the link that is copied and that the intent falls back to.
 * @returns {string}
 */
function shareUrl() {
  // Drop "&fallback=1" (or "?fallback=1&") so a copied link is the original one.
  const search = window.location.search.replace(new RegExp(`([?&])${FALLBACK_PARAM}=1(&|$)`), (match, lead, tail) => (tail ? lead : "")).replace(/[?&]$/, "");
  return `${window.location.origin}${window.location.pathname}${search}`;
}

/**
 * Builds the Chrome intent URL that opens the app's Create route with the payload, or comes back here with &fallback=1.
 * @param {string} code the canonical payload
 * @returns {string}
 */
function intentUrl(code) {
  // Where Chrome goes when no installed app handles the intent: this page, marked so it does not try again.
  const base = shareUrl();
  const fallback = `${base}${base.includes("?") ? "&" : "?"}${FALLBACK_PARAM}=1`;
  return (
    `intent://${SHARE_PATH}?${SHARE_PARAM}=${encodeURIComponent(code)}` +
    `#Intent;scheme=${APP_SCHEME};package=${APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  );
}

/**
 * Shows the fallback card with its reason; Copy link, the instructions and "Try opening the app again" are optional.
 * @param {string} reason the localized reason text
 * @param {{copy: boolean, retryCode: string|null}} options `copy`: show Copy link and the instructions; `retryCode`: payload for a retry button, or null
 */
function showFallback(reason, options) {
  document.getElementById("opening").hidden = true;
  const card = document.getElementById("fallback");
  document.getElementById("reason").textContent = reason;
  // Copy link copies the original share URL (without the fallback marker).
  if (options.copy) {
    document.getElementById("copy-link").onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl());
        setStatus(T.copied);
      } catch {
        setStatus(T.copyFailed);
      }
    };
  }
  document.getElementById("copy-link").hidden = !options.copy;
  document.getElementById("howto").hidden = !options.copy;
  // A tap on the retry button is a user gesture, which browsers that blocked the automatic open accept.
  const retry = document.getElementById("open-app");
  if (options.retryCode !== null) retry.href = intentUrl(options.retryCode);
  retry.hidden = options.retryCode === null;
  document.getElementById("actions").hidden = !options.copy && options.retryCode === null;
  card.hidden = false;
}

/**
 * Opens the app automatically and shows the fallback when it does not take over in time.
 * @param {string} code the canonical payload
 */
function openAppAutomatically(code) {
  document.getElementById("opening").hidden = false;
  // Set once the page is hidden: the app (or the system chooser) came to the front.
  let left = false;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") left = true;
    // Back in the browser after the app opened: say so instead of offering anything.
    else if (left && document.getElementById("fallback").hidden) document.getElementById("opening-text").textContent = T.opened;
  });
  // Still visible after the timeout: the browser ignored or blocked the intent.
  window.setTimeout(() => {
    if (!left && document.visibilityState === "visible") showFallback(T.reasonDidNotOpen, { copy: true, retryCode: code });
  }, APP_OPEN_TIMEOUT_MS);
  // Hand over to the app now (replace: Back from the app does not land on a page that would open it again).
  window.location.replace(intentUrl(code));
}

/** Fills the static texts (elements with data-text="key"). */
function applyTexts() {
  document.documentElement.lang = LANG;
  document.title = T.pageTitle;
  for (const node of document.querySelectorAll("[data-text]")) {
    const value = T[node.getAttribute("data-text")];
    if (value) node.textContent = value;
  }
}

/** Entry point: translate, decode, show the preview, then open the app or show the fallback. */
function main() {
  applyTexts();
  const raw = readRawPayload();
  const result = decodePayload(raw);
  if (!result.ok) {
    const key = { missing: "errorMissing", "too-large": "errorTooLarge", malformed: "errorMalformed", version: "errorVersion" }[result.reason];
    // A newer-version routine still works in an updated app: offer the copy path and a retry; anything else is unusable.
    const usable = result.reason === "version" && raw !== null;
    showFallback(T[key], { copy: usable, retryCode: usable && isAndroid() ? normalizeCode(raw) : null });
    return;
  }
  renderRoutine(result.template);
  const code = normalizeCode(raw);
  // Not a phone the app runs on: explain and offer the copy path.
  if (!isAndroid()) return showFallback(T.reasonNotAndroid, { copy: true, retryCode: null });
  // Chrome came back through the intent's fallback URL: the app is not installed.
  if (isIntentFallback()) return showFallback(T.reasonNotInstalled, { copy: true, retryCode: code });
  // Too long for a reliable direct open: the paste import still accepts it.
  if (code.length > AUTO_OPEN_MAX_LENGTH) return showFallback(T.reasonTooLong, { copy: true, retryCode: null });
  // The normal case: open the app right away.
  openAppAutomatically(code);
}

main();
