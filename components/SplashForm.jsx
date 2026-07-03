"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidBirthday(value) {
  if (!value) return true; // optional field
  const m = value.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

export default function SplashForm() {
  const params = useSearchParams();

  // UniFi appends these to the redirect URL
  const mac = params.get("id") || "";
  const ap = params.get("ap") || "";
  const ssid = params.get("ssid") || "";
  const t = params.get("t") || "";
  const originalUrl = params.get("url") || "";

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

  const canSubmit = useMemo(
    () => emailValid && nameValid && birthdayValid && status !== "submitting",
    [emailValid, nameValid, birthdayValid, status]
  );

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
      const res = await fetch("/api/connect", {
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
          t,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      setStatus("success");

      // Give the network a moment to apply authorization, then send the
      // guest on to their original destination (or a fallback).
      const dest = originalUrl || process.env.NEXT_PUBLIC_REDIRECT_URL || "https://hyperglow.co.uk";
      setTimeout(() => {
        window.location.href = dest;
      }, 4000);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message || "Connection failed. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="w-full max-w-md mx-auto text-center px-6 py-12">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-glow-gradient shadow-glow">
          <svg className="h-10 w-10 text-night" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold mb-3">
          You&apos;re <span className="glow-text">connected!</span>
        </h1>
        <p className="text-slate-400">
          Enjoy your free WiFi. You&apos;ll be redirected in a few seconds&hellip;
        </p>
      </div>
    );
  }

  const inputBase =
    "w-full rounded-xl border bg-panel/80 px-4 py-3 text-white placeholder-slate-500 outline-none transition " +
    "focus:border-glowviolet focus:shadow-glowsm";

  return (
    <div className="w-full max-w-md mx-auto px-6 py-10">
      {/* Brand */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Hyper<span className="glow-text">Glow</span>
        </h1>
        <p className="mt-2 text-slate-400">
          Free Guest WiFi{ssid ? ` · ${ssid}` : ""}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-panel/60 p-6 shadow-glow backdrop-blur">
        <h2 className="text-lg font-semibold mb-1">Get connected</h2>
        <p className="text-sm text-slate-400 mb-6">
          Fill in your details below to enjoy free WiFi.
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-300">
              Email <span className="text-glowpink">*</span>
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
              className={`${inputBase} ${
                touched.email && !emailValid ? "border-red-500/70" : "border-white/10"
              }`}
              required
            />
            {touched.email && !emailValid && (
              <p className="mt-1 text-xs text-red-400">Please enter a valid email address.</p>
            )}
          </div>

          {/* First Name */}
          <div>
            <label htmlFor="firstName" className="mb-1.5 block text-sm font-medium text-slate-300">
              First Name <span className="text-glowpink">*</span>
            </label>
            <input
              id="firstName"
              type="text"
              autoComplete="given-name"
              placeholder="Alex"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onBlur={() => setTouched((s) => ({ ...s, firstName: true }))}
              className={`${inputBase} ${
                touched.firstName && !nameValid ? "border-red-500/70" : "border-white/10"
              }`}
              required
            />
            {touched.firstName && !nameValid && (
              <p className="mt-1 text-xs text-red-400">First name is required.</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-300">
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
              className={`${inputBase} border-white/10`}
            />
          </div>

          {/* Birthday */}
          <div>
            <label htmlFor="birthday" className="mb-1.5 block text-sm font-medium text-slate-300">
              Birthday <span className="text-slate-500">(DD/MM)</span>
            </label>
            <input
              id="birthday"
              type="text"
              inputMode="numeric"
              placeholder="24/06"
              value={birthday}
              onChange={handleBirthdayChange}
              onBlur={() => setTouched((s) => ({ ...s, birthday: true }))}
              className={`${inputBase} ${
                touched.birthday && !birthdayValid ? "border-red-500/70" : "border-white/10"
              }`}
              maxLength={5}
            />
            {touched.birthday && !birthdayValid && (
              <p className="mt-1 text-xs text-red-400">Use DD/MM format, e.g. 24/06.</p>
            )}
          </div>

          {status === "error" && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-2 w-full rounded-xl bg-glow-gradient px-4 py-3.5 font-semibold text-night transition
                       enabled:hover:opacity-90 enabled:shadow-glow
                       disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {status === "submitting" ? "Connecting…" : "Connect to WiFi"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        By connecting you agree to receive occasional updates from HyperGlow.
      </p>
    </div>
  );
}
