import { Suspense } from "react";
import SplashForm from "@/components/SplashForm";

// UniFi redirects guests to /guest/s/<site>/?ap=..&id=..&t=..&url=..&ssid=..
// so this route renders the same splash form as the home page.
export default function GuestPortal() {
  return (
    <Suspense fallback={null}>
      <SplashForm />
    </Suspense>
  );
}
