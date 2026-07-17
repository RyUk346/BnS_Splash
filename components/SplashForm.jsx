"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Shared input classes (classic theme, semi-transparent on the card)
const INPUT =
  "w-full rounded-lg border bg-white/80 px-4 py-3 text-bnsblack placeholder-gray-400 outline-none transition focus:border-bnsblack focus:ring-2 focus:ring-bnsblack/20";

function isValidBirthday(value) {
  if (!value) return true; // optional field
  const m = value.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return false;
  return Number(m[1]) >= 1 && Number(m[1]) <= 31 && Number(m[2]) >= 1 && Number(m[2]) <= 12;
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
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState("");

  const emailValid = EMAIL_RE.test(email.trim());
  const nameValid = firstName.trim().length > 0;
  const birthdayValid = isValidBirthday(birthday.trim());
  const canSubmit = emailValid && nameValid && birthdayValid && status !== "submitting";

  function handleBirthdayChange(e) {
    let v = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    setBirthday(v);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch(`${BASE}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim(),
          phone: phone.trim(),
          birthday: birthday.trim(),
          mac,
          ap,
          ssid,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      setStatus("success");
      // Give the network a moment to apply authorization, then send the
      // guest to the brand site. (We deliberately ignore the "original URL"
      // UniFi passes — on iOS/Android it's just the OS connectivity probe,
      // e.g. captive.apple.com, not a page the guest actually wanted.)
      const dest = process.env.NEXT_PUBLIC_REDIRECT_URL || "https://burgerandsauce.com";
      setTimeout(() => (window.location.href = dest), 4000);
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
          {status === "success" ? (
            <>
              <div className="flex justify-center px-6 pt-9">
                <Image
                  src={`${BASE}/bns-logo.png`}
                  alt="Burger & Sauce"
                  width={320}
                  height={72}
                  priority
                  className="h-10 w-auto"
                />
              </div>
              <div className="px-6 py-10 text-center">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-bnsblack">
                  <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h1 className="bns-heading mb-3 text-3xl text-bnsblack">You&apos;re connected!</h1>
                <p className="text-bnsgrey">
                  Enjoy your free WiFi. You&apos;ll be redirected in a few seconds&hellip;
                </p>
              </div>
            </>
          ) : (
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
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => setTouched((s) => ({ ...s, email: true }))}
                      className={`${INPUT} ${touched.email && !emailValid ? "border-red-500" : "border-gray-300"}`}
                      required
                    />
                    {touched.email && !emailValid && (
                      <p className="mt-1 text-xs text-red-600">Please enter a valid email address.</p>
                    )}
                  </div>

                  {/* First Name */}
                  <div>
                    <label htmlFor="firstName" className="bns-heading mb-1.5 block text-sm text-bnsblack">
                      First Name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      autoComplete="given-name"
                      placeholder="Alex"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      onBlur={() => setTouched((s) => ({ ...s, firstName: true }))}
                      className={`${INPUT} ${touched.firstName && !nameValid ? "border-red-500" : "border-gray-300"}`}
                      required
                    />
                    {touched.firstName && !nameValid && (
                      <p className="mt-1 text-xs text-red-600">First name is required.</p>
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
                      Birthday <span className="font-normal normal-case text-bnsgrey">(DD/MM)</span>
                    </label>
                    <input
                      id="birthday"
                      type="text"
                      inputMode="numeric"
                      placeholder="24/06"
                      value={birthday}
                      onChange={handleBirthdayChange}
                      onBlur={() => setTouched((s) => ({ ...s, birthday: true }))}
                      className={`${INPUT} ${touched.birthday && !birthdayValid ? "border-red-500" : "border-gray-300"}`}
                      maxLength={5}
                    />
                    {touched.birthday && !birthdayValid && (
                      <p className="mt-1 text-xs text-red-600">Use DD/MM format, e.g. 24/06.</p>
                    )}
                  </div>

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
          )}
        </div>
      </div>
    </div>
  );
}
