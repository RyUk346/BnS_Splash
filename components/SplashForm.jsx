"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

function isValidBirthday(value) {
  if (!value) return true; // optional field
  const m = value.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

function BrandLogo() {
  const [imgError, setImgError] = useState(false);
  if (imgError) {
    return (
      <span className="bns-heading text-3xl text-bnsblack">Burger &amp; Sauce</span>
    );
  }
  return (
    // Official Burger & Sauce black logo — served from /public.
    // next/image resizes + converts to WebP/AVIF on the fly and caches the
    // result, so guests download a small optimized file instead of the raw PNG.
    // Note: with basePath, next/image src must be prefixed manually.
    <Image
      src={`${BASE}/bns-logo.png`}
      alt="Burger & Sauce"
      width={320}
      height={72}
      priority
      sizes="(max-width: 480px) 240px, 320px"
      className="h-16 w-auto"
      onError={() => setImgError(true)}
    />
  );
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
          t,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      setStatus("success");

      // Give the network a moment to apply authorization, then send the
      // guest on to their original destination (or the brand site).
      const dest =
        originalUrl ||
        process.env.NEXT_PUBLIC_REDIRECT_URL ||
        "https://burgerandsauce.com";
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
      <div className="w-full max-w-md mx-auto px-4 py-10">
        <div className="overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="flex justify-center bg-white px-6 py-8">
            <BrandLogo />
          </div>
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-bnsblack">
              <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="bns-heading mb-3 text-3xl">You&apos;re connected!</h1>
            <p className="text-bnsgrey">
              Enjoy your free WiFi. You&apos;ll be redirected in a few seconds&hellip;
            </p>
          </div>
        </div>
      </div>
    );
  }

  const inputBase =
    "w-full rounded-lg border bg-white px-4 py-3 text-bnsblack placeholder-gray-400 outline-none transition " +
    "focus:border-bnsblack focus:ring-2 focus:ring-bnsblack/20";

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8">
      <div className="overflow-hidden rounded-2xl bg-white shadow-card">
        {/* Brand header — black logo on white, black pill like the site's CTAs */}
        <div className="flex flex-col items-center gap-4 bg-white px-6 pb-2 pt-9">
          <BrandLogo />
          <span className="bns-heading rounded-full bg-bnsblack px-5 py-2 text-xs tracking-[0.3em] text-white">
            Free Guest WiFi
          </span>
        </div>

        <div className="px-6 py-6">
          {/* <h1 className="bns-heading text-xl">Get connected</h1>
          <p className="mb-6 mt-1 text-sm text-bnsgrey">
            Fresh everyday. Never frozen. Fill in your details to hop online.
          </p> */}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="bns-heading mb-1.5 block text-sm">
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
                className={`${inputBase} ${
                  touched.email && !emailValid ? "border-red-500" : "border-gray-300"
                }`}
                required
              />
              {touched.email && !emailValid && (
                <p className="mt-1 text-xs text-red-600">Please enter a valid email address.</p>
              )}
            </div>

            {/* First Name */}
            <div>
              <label htmlFor="firstName" className="bns-heading mb-1.5 block text-sm">
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
                className={`${inputBase} ${
                  touched.firstName && !nameValid ? "border-red-500" : "border-gray-300"
                }`}
                required
              />
              {touched.firstName && !nameValid && (
                <p className="mt-1 text-xs text-red-600">First name is required.</p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="bns-heading mb-1.5 block text-sm">
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
                className={`${inputBase} border-gray-300`}
              />
            </div>

            {/* Birthday */}
            <div>
              <label htmlFor="birthday" className="bns-heading mb-1.5 block text-sm">
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
                className={`${inputBase} ${
                  touched.birthday && !birthdayValid ? "border-red-500" : "border-gray-300"
                }`}
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
              className="bns-heading mt-2 w-full rounded-lg bg-bnsblack px-4 py-4 text-lg tracking-widest text-white transition
                         enabled:hover:bg-black enabled:active:scale-[0.99]
                         disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
            >
              {status === "submitting" ? "Connecting…" : "Connect to WiFi"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-bnsgrey">
            By connecting you agree to receive occasional updates from Burger &amp; Sauce.{" "}
            <a
              href="https://burgerandsauce.com/privacy-policy/"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy Policy
            </a>
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 mt-4">
        <p className="mt-4 text-center text-xs text-gray-400">
        WiFi powered by 
      </p>
      {/* <img
      src={`${BASE}/hyperglow-logo.png.webp`}
      alt="Burger & Sauce"
      className="h-10 w-auto"
      onError={() => setImgError(true)}
    /> */}
     <a href="https://hyperglow.co.uk/">
      <Image
      src={`${BASE}/hyperglow-logo.png.webp`}
      alt="Hyper Glow"
      width={220}
      height={52}
      priority
      sizes="(max-width: 480px) 240px, 320px"
      className="h-12 w-auto"
      onError={() => setImgError(true)}
    />
     </a>
      </div>
    </div>
  );
}
