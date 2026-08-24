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
 * Poll until the gateway confirms this device is authorized (i.e. the WiFi
 * really is connected), then resolve. Gives up after ~12s and resolves
 * anyway — a guest must never be trapped on the form by a slow API.
 */
async function waitUntilOnline(mac) {
  if (!mac) {
    await sleep(800); // no MAC (direct page open) — brief pause, then go
    return;
  }
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${BASE}/api/connection-status?mac=${encodeURIComponent(mac)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.authorized === true) return; // network is open — go now
      if (data.authorized === null) break; // can't tell; stop polling
    } catch {
      break; // network/API problem — don't keep the guest waiting
    }
    await sleep(1200);
  }
  // Fallback: give the gateway a moment, then proceed regardless.
  await sleep(800);
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
  const [errorMsg, setErrorMsg] = useState("");
  const [emailSuggestion, setEmailSuggestion] = useState(""); // "did you mean …"
  const [emailError, setEmailError] = useState(""); // server-side reject message

  // Captive-portal browsers (iOS Captive Network Assistant, Android's login
  // WebView) run their own autofocus heuristic on load, which typically picks
  // the first plain type="text" input. Name is now that field AND the first
  // field on the form, so their choice and ours agree — no fighting over it.
  // We still claim focus explicitly (and re-assert after first paint) so the
  // behaviour is the same everywhere.
  const nameRef = useRef(null);
  useEffect(() => {
    const focusName = () => nameRef.current?.focus({ preventScroll: true });
    focusName();
    const t = setTimeout(focusName, 350);
    return () => clearTimeout(t);
  }, []);

  const emailValid = EMAIL_RE.test(normalizeEmail(email));
  const nameValid = firstName.trim().length > 0;
  const birthdayValid = isValidBirthday(birthday.trim());
  const canSubmit =
    emailValid &&
    !emailSuggestion && // an unresolved typo suggestion blocks submit
    !emailError &&
    nameValid &&
    birthdayValid &&
    promo !== "" &&
    status !== "submitting";

  function handleEmailChange(e) {
    const v = e.target.value;
    setEmail(v);
    setEmailError("");
    // Live typo hint (client-side, instant — never auto-applied).
    setEmailSuggestion(EMAIL_RE.test(normalizeEmail(v)) ? suggestEmail(v) || "" : "");
  }

  function applySuggestion() {
    setEmail(emailSuggestion);
    setEmailSuggestion("");
    setEmailError("");
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

    const cleanEmail = normalizeEmail(email);

    // Step 1: deeper email validation (MX + disposable) on the server.
    try {
      const vr = await fetch(`${BASE}/api/validate-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const vd = await vr.json();
      if (!vd.valid) {
        setStatus("idle");
        setEmailError(vd.message || "Please enter a valid email address.");
        if (vd.suggestion) setEmailSuggestion(vd.suggestion);
        return; // block connect until the email passes
      }
    } catch {
      // Validation endpoint unreachable → fail open, don't strand the guest.
    }

    // Step 2: existing connect + Sheets flow.
    try {
      const res = await fetch(`${BASE}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          firstName: firstName.trim(),
          phone: phone.trim(),
          birthday: birthday.trim(),
          promo,
          mac,
          ap,
          ssid,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      // No success screen. Wait until the network is genuinely open for this
      // device, then send the guest to the brand site. We ask our server
      // (which asks UniFi) rather than guessing with a fixed delay, so the
      // redirect never lands on a "no internet" error page.
      // (We ignore the "original URL" UniFi passes — on iOS/Android it's just
      // the OS connectivity probe, e.g. captive.apple.com.)
      const dest = process.env.NEXT_PUBLIC_REDIRECT_URL || "https://burgerandsauce.com";
      await waitUntilOnline(mac);
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
                      onBlur={() => setTouched((s) => ({ ...s, email: true }))}
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
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="07123 456789"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={`${INPUT} border-gray-300`}
                    />
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

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="bns-heading mt-2 w-full rounded-lg bg-bnsblack px-4 py-2 text-lg tracking-widest text-white transition enabled:hover:bg-black enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-400/60 disabled:text-white/70"
                  >
                    {status === "submitting" ? "Connecting…" : "Connect to WiFi"}
                  </button>
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
