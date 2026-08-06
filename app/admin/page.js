import AdminDashboard from "@/components/AdminDashboard";

export const metadata = {
  title: "HyperGlow Admin | Guest WiFi",
  robots: { index: false, follow: false }, // keep it out of search engines
};

export default function AdminPage() {
  return <AdminDashboard />;
}
