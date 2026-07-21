import Sidebar from "@/components/Sidebar";
import RouteGuard from "@/components/RouteGuard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper flex">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto">
          <RouteGuard>{children}</RouteGuard>
        </div>
      </main>
    </div>
  );
}
