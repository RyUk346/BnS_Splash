import { Suspense } from "react";
import SplashForm from "@/components/SplashForm";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <SplashForm />
    </Suspense>
  );
}
