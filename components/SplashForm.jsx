"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { EMAIL_RE, normalizeEmail, suggestEmail } from "@/lib/email";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Shared input classes (classic theme, semi-transparent on the card)
const INPUT =
  "w-full rounded-lg border bg-white/80 px-4 py-3 text-bnsblack placeholder-gray-400 outline-none transition focus:border-bnsblack focus:ring-2 focus:ring-bnsblack/20";

// Birthday is DD/MM/YYYY and optional. Validates a real calendar date and a
// sane year range (no future dates, nobody older than ~120).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Give the gateway the briefest chance to confirm the device is authorized,
 * then redirect regardless.
 *
 * This used to wait up to 8.4 seconds. That was the single biggest remaining
 * delay in the flow, and it was almost entirely wasted: by the time this runs,
 * /api/connect has already had UniFi accept AUTHORIZE_GUEST_ACCESS. The poll
 * only watched for that decision to show up in UniFi's client record, which
 * is a reporting lag, not the network actually opening.
 *
 * So the check is now an optimisation, not a gate: one immediate look, one
 * quick retry, then go. A guest whose WiFi happens to open a beat after the
 * redirect gets a page that loads a fraction later — far better than everyone
 * staring at a button for several seconds.
 */
const ONLINE_CHECK_BUDGET_MS = 1200;
const ONLINE_CHECK_INTERVAL_MS = 300;

async function waitUntilOnline(mac, consoleId = "") {
  if (!mac) return; // no MAC (direct page open) — nothing to check, just go

  const deadline = Date.now() + ONLINE_CHECK_BUDGET_MS;
  const params = new URLSearchParams({ mac });
  if (consoleId) params.set("console", consoleId);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/connection-status?${params}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.authorized === true) return; // confirmed open — go now
      if (data.authorized === null) return; // can't tell; don't wait around
    } catch {
      return; // network/API problem — never hold the guest for this
    }
    if (Date.now() + ONLINE_CHECK_INTERVAL_MS >= deadline) break;
    await sleep(ONLINE_CHECK_INTERVAL_MS);
  }
  // Budget spent. The authorization was already accepted by UniFi, so go.
}

// Pause before the one automatic retry. Long enough for UniFi to have listed
// a just-joined device, short enough not to feel like a hang.
const RETRY_PAUSE_MS = 700;

// How long to say nothing before reassuring the guest.
//
// Deliberately NOT a countdown: connect times range from under a second to
// well over ten, so any number we displayed would be a promise we couldn't
// keep, and a counter that hits zero while still spinning is worse than no
// counter at all. Most connects finish inside this window and the guest sees
// nothing extra; past it, they get a message that explains without promising.
const SLOW_NOTICE_MS = 3000;

/**
 * Reduce anything a guest types or pastes to plain UK digits.
 * Spaces, brackets and dashes go; a pasted "+44 7123 456789" or
 * "0044 7123 456789" becomes "07123456789" rather than being rejected —
 * phones hand out the +44 form, and refusing it would just lose the number.
 */
function toUkPhoneDigits(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0044")) d = "0" + d.slice(4);
  else if (d.startsWith("44")) d = "0" + d.slice(2);
  return d.slice(0, 11);
}

/**
 * UK mobile: 11 digits beginning 07 — e.g. 07123456789.
 * Optional field, so blank passes; anything typed has to be a real number.
 * Guests were entering short or mistyped numbers that could never be called.
 */
function isValidUkPhone(value) {
  if (!value) return true; // optional field
  return /^07\d{9}$/.test(value);
}

function isValidBirthday(value) {
  if (!value) return true; // optional field
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);

  const thisYear = new Date().getFullYear();
  if (year < thisYear - 120 || year > thisYear) return false;
  if (month < 1 || month > 12) return false;

  // Days in the given month (handles leap years).
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

export default function SplashForm() {
  const params = useSearchParams();

  // UniFi appends these to the redirect URL
  const mac = params.get("id") || "";
  const ap = params.get("ap") || "";
  const ssid = params.get("ssid") || "";

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [promo, setPromo] = useState(""); // "Yes" | "No" — no preselection (consent must be a choice)
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  // Shown only once a connect has run long enough to be worth explaining.
  const [slowNotice, setSlowNotice] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [emailSuggestion, setEmailSuggestion] = useState(""); // "did you mean …"
  const [emailError, setEmailError] = useState(""); // server-side reject message

  // Captive-portal browsers (iOS Captive Network Assistant, Android's login
  // WebView) run their own autofocus heuristic on load, which typically picks
  // the first plain type="text" input. Name is now that field AND the first
  // field on the form, so their choice and ours agree — no fighting over it.
  // We still claim focus explicitly (and re-assert after first paint) so the
  // behaviour is the same everywhere.
  // Arm the "still connecting" message while a submit is in flight, and make
  // sure it never outlives the attempt that started it.
  useEffect(() => {
    if (status !== "submitting") {
      setSlowNotice(false);
      return;
    }
    const t = setTimeout(() => setSlowNotice(true), SLOW_NOTICE_MS);
    return () => clearTimeout(t);
  }, [status]);

  const nameRef = useRef(null);
  // { email, promise } — the in-flight/settled server email check
  const emailCheckRef = useRef({ email: "", promise: null });
  useEffect(() => {
    const focusName = () => nameRef.current?.focus({ preventScroll: true });
    focusName();
    const t = setTimeout(focusName, 350);
    return () => clearTimeout(t);
  }, []);

  const emailValid = EMAIL_RE.test(normalizeEmail(email));
  const nameValid = firstName.trim().length > 0;
  const birthdayValid = isValidBirthday(birthday.trim());
  const phoneValid = isValidUkPhone(phone.trim());
  const canSubmit =
    emailValid &&
    !emailSuggestion && // an unresolved typo suggestion blocks submit
    !emailError &&
    nameValid &&
    birthdayValid &&
    phoneValid &&
    promo !== "" &&
    status !== "submitting";

  function handleEmailChange(e) {
    const v = e.target.value;
    setEmail(v);
    setEmailError("");
    // Live typo hint (client-side, instant — never auto-applied).
    setEmailSuggestion(EMAIL_RE.test(normalizeEmail(v)) ? suggestEmail(v) || "" : "");
  }

  /**
   * Start the server-side email check (MX lookup + disposable domains) as soon
   * as the address looks complete, rather than on submit.
   *
   * The guest then spends several seconds on phone, birthday and the consent
   * choice, by which time the answer is already back — so the check costs
   * nothing at the moment they tap Connect. Keyed by address so an edited
   * email re-checks.
   */
  function prefetchEmailCheck(raw) {
    const clean = normalizeEmail(raw);
    if (!EMAIL_RE.test(clean)) return;
    if (emailCheckRef.current.email === clean) return; // already in flight/done
    emailCheckRef.current = { email: clean, promise: postEmailCheck(clean) };
  }

  function postEmailCheck(clean) {
    return fetch(`${BASE}/api/validate-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: clean }),
    })
      .then((r) => r.json())
      // Unreachable endpoint must never strand a guest — fail open.
      .catch(() => ({ valid: true }));
  }

  function applySuggestion() {
    setEmail(emailSuggestion);
    setEmailSuggestion("");
    setEmailError("");
  }

  // Digits only, capped at 11 — the field simply won't accept a letter, a
  // space or a 12th digit, so most mistakes are impossible rather than
  // reported after the fact.
  function handlePhoneChange(e) {
    setPhone(toUkPhoneDigits(e.target.value));
  }

  // Auto-format as the guest types: DDMMYYYY -> DD/MM/YYYY
  function handleBirthdayChange(e) {
    const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
    let v = digits;
    if (digits.length > 4) {
      v = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    } else if (digits.length > 2) {
      v = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    setBirthday(v);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("submitting");
    setErrorMsg("");
    setEmailError("");
    setSlowNotice(false);

    const cleanEmail = normalizeEmail(email);

    // Step 1: deeper email validation (MX + disposable) on the server.
    // Usually already answered — it was started when they left the field.
    try {
      const cached =
        emailCheckRef.current.email === cleanEmail ? emailCheckRef.current.promise : null;
      const vd = await (cached || postEmailCheck(cleanEmail));
      if (!vd.valid) {
        setStatus("idle");
        setEmailError(vd.message || "Please enter a valid email address.");
        if (vd.suggestion) setEmailSuggestion(vd.suggestion);
        return; // block connect until the email passes
      }
    } catch {
      // Validation endpoint unreachable → fail open, don't strand the guest.
    }

    // Step 2: authorize, with one silent retry.
    //
    // Around one connect in six was failing outright, and the commonest cause
    // is UniFi not having listed the just-joined device yet — which a second
    // attempt a moment later usually clears. Retrying here turns most of those
    // error screens into a slightly slow success, which is a far better guest
    // experience than asking them to tap Connect again themselves.
    const payload = {
      email: cleanEmail,
      firstName: firstName.trim(),
      phone: phone.trim(),
      birthday: birthday.trim(),
      promo,
      mac,
      ap,
      ssid,
    };

    const attempt = async (retryOf) => {
      const res = await fetch(`${BASE}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryOf ? { ...payload, retryOf } : payload),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.success, data };
    };

    try {
      let { ok, data } = await attempt();

      if (!ok) {
        // `retryOf` reuses the row key from the first attempt, so the guest
        // gets one Sheet row rather than two. Their details were already
        // saved server-side before the failure, so nothing is riding on this.
        await sleep(RETRY_PAUSE_MS);
        ({ ok, data } = await attempt(data.timestamp));
      }

      if (!ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      // No success screen. Wait until the network is genuinely open for this
      // device, then send the guest to the brand site. We ask our server
      // (which asks UniFi) rather than guessing with a fixed delay, so the
      // redirect never lands on a "no internet" error page.
      // (We ignore the "original URL" UniFi passes — on iOS/Android it's just
      // the OS connectivity probe, e.g. captive.apple.com.)
      const dest = process.env.NEXT_PUBLIC_REDIRECT_URL || "https://burgerandsauce.com";
      // data.consoleId scopes the status check to the one console that just
      // authorized this device, instead of searching all of them per poll.
      await waitUntilOnline(mac, data.consoleId || "");
      window.location.href = dest;
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message || "Connection failed. Please try again.");
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black">
      {/* Photo background + dark tint */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${BASE}/bg.png)` }}
      />
      {/* <div aria-hidden className="absolute inset-0 bg-black/30" /> */}

      <div className="relative z-10 w-full max-w-md px-4 py-8">
        {/* Semi-transparent white card */}
        <div className="overflow-hidden rounded-2xl border border-white/40 bg-white/65 shadow-card backdrop-blur-md">
          <>
              {/* Brand header */}
              <div className="flex flex-col items-center gap-2 px-6 pb-2 pt-6">
                <Image
                  src={`${BASE}/bns-logo.png`}
                  alt="Burger & Sauce"
                  width={320}
                  height={72}
                  priority
                  className="h-10 w-auto"
                />
                <p className="text-xl font-semibold text-bnsblack">Free Guest WiFi</p>
                <p className="text-bnsgrey">Please Enter Your Details Below</p>
              </div>

              <div className="-mt-2 px-6 py-4">
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  {/* Name — first field, so the captive browser's autofocus
                      heuristic and ours agree on the same input */}
                  <div>
                    <label htmlFor="name" className="bns-heading mb-1.5 block text-sm text-bnsblack">
                      Name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="name"
                      ref={nameRef}
                      type="text"
                      autoComplete="name"
                      placeholder="Alex Smith"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      onBlur={() => setTouched((s) => ({ ...s, firstName: true }))}
                      className={`${INPUT} ${touched.firstName && !nameValid ? "border-red-500" : "border-gray-300"}`}
                      required
                    />
                    {touched.firstName && !nameValid && (
                      <p className="mt-1 text-xs text-red-600">Name is required.</p>
                    )}
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="email" className="bns-heading mb-1.5 block text-sm text-bnsblack">
                      Email <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={handleEmailChange}
                      onBlur={(e) => {
                        setTouched((s) => ({ ...s, email: true }));
                        // Get the MX check moving while they fill the rest in.
                        prefetchEmailCheck(e.target.value);
                      }}
                      className={`${INPUT} ${
                        (touched.email && !emailValid) || emailError ? "border-red-500" : "border-gray-300"
                      }`}
                      required
                    />
                    {touched.email && !emailValid && (
                      <p className="mt-1 text-xs text-red-600">Please enter a valid email address.</p>
                    )}
                    {emailError && (
                      <p className="mt-1 text-xs text-red-600">{emailError}</p>
                    )}
                    {emailSuggestion && (
                      <p className="mt-1 text-xs text-bnsblack">
                        Did you mean{" "}
                        <button
                          type="button"
                          onClick={applySuggestion}
                          className="font-semibold underline"
                        >
                          {emailSuggestion}
                        </button>
                        ?
                      </p>
                    )}
                  </div>

                  {/* Phone */}
                  <div>
                    <label htmlFor="phone" className="bns-heading mb-1.5 block text-sm text-bnsblack">
                      Phone No.
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="07123456789"
                      value={phone}
                      onChange={handlePhoneChange}
                      onBlur={() => setTouched((s) => ({ ...s, phone: true }))}
                      className={`${INPUT} ${
                        touched.phone && !phoneValid ? "border-red-500" : "border-gray-300"
                      }`}
                      maxLength={11}
                    />
                    {touched.phone && !phoneValid && (
                      <p className="mt-1 text-xs text-red-600">
                        Enter a UK mobile number — 11 digits starting 07.
                      </p>
                    )}
                  </div>

                  {/* Birthday */}
                  <div>
                    <label htmlFor="birthday" className="bns-heading mb-1.5 block text-sm text-bnsblack">
                      Birthday <span className="font-normal normal-case text-bnsgrey">(DD/MM/YYYY)</span>
                    </label>
                    <input
                      id="birthday"
                      type="text"
                      inputMode="numeric"
                      placeholder="24/06/1995"
                      value={birthday}
                      onChange={handleBirthdayChange}
                      onBlur={() => setTouched((s) => ({ ...s, birthday: true }))}
                      className={`${INPUT} ${touched.birthday && !birthdayValid ? "border-red-500" : "border-gray-300"}`}
                      maxLength={10}
                    />
                    {touched.birthday && !birthdayValid && (
                      <p className="mt-1 text-xs text-red-600">
                        Use DD/MM/YYYY format, e.g. 24/06/1995.
                      </p>
                    )}
                  </div>

                  {/* Promotional offers consent — compact segmented control */}
                  <fieldset>
                    <legend className="bns-heading mb-1.5 block text-sm text-bnsblack">
                      Promotional Offers <span aria-hidden="true">*</span>
                    </legend>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: "Yes", label: "Yes, send me offers" },
                        { value: "No", label: "No, pay full price" },
                      ].map((opt) => {
                        const selected = promo === opt.value;
                        return (
                          <label
                            key={opt.value}
                            className={`flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-2.5 text-[11px] font-semibold leading-tight transition xs:text-xs sm:gap-2 sm:px-3 sm:text-sm ${
                              selected
                                ? "border-bnsblack bg-bnsblack/5 text-bnsblack shadow-sm"
                                : "border-gray-300 bg-white/80 text-bnsgrey hover:border-bnsblack/50"
                            }`}
                          >
                            <input
                              type="radio"
                              name="promo"
                              value={opt.value}
                              checked={selected}
                              onChange={(e) => setPromo(e.target.value)}
                              className="sr-only"
                              required
                            />
                            {/* Visible radio indicator */}
                            <span
                              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 sm:h-4 sm:w-4 ${
                                selected ? "border-bnsblack" : "border-gray-400"
                              }`}
                            >
                              {selected && (
                                <span className="h-1.5 w-1.5 rounded-full bg-bnsblack sm:h-2 sm:w-2" />
                              )}
                            </span>
                            {opt.label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  {status === "error" && (
                    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {errorMsg}
                    </div>
                  )}

                  {/* The asterisks on Name, Email and Promotional Offers were
                      unexplained — fine for anyone who knows the convention,
                      not for everyone. Sits above the button, where someone
                      who can't press it will look. */}
                  <p className="text-xs text-bnsgrey">
                    <span aria-hidden="true">*</span> Required
                  </p>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="bns-heading mt-2 w-full rounded-lg bg-bnsblack px-4 py-2 text-lg tracking-widest text-white transition enabled:hover:bg-black enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-400/60 disabled:text-white/70"
                  >
                    {status === "submitting" ? "Connecting…" : "Connect to WiFi"}
                  </button>

                  {/* Only after SLOW_NOTICE_MS, so the guests who connect in a
                      second or two never see it. No number and no progress
                      bar on purpose — we can't predict how long this takes,
                      and a promise we break is worse than no promise. */}
                  {status === "submitting" && slowNotice && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="flex items-center justify-center gap-2 text-center text-xs text-bnsgrey"
                    >
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-bnsgrey border-t-transparent"
                      />
                      Still connecting — this can take a few seconds the first
                      time on this network.
                    </p>
                  )}
                </form>

                <p className="mt-5 text-center text-xs text-gray-700">
                  By connecting you agree to our{" "}
                  <a
                    href="https://burgerandsauce.com/privacy-policy/"
                    className="underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Terms &amp; Privacy Policy
                  </a>
                </p>
              </div>
          </>
        </div>
      </div>
    </div>
  );
}
