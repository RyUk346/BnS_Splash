import { Suspense } from "react";
import SplashForm from "@/components/SplashForm";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Suspense fallback={null}>
        <SplashForm />
      </Suspense>
    </main>
  );
}
