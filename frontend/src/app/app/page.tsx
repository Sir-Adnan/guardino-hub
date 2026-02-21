import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-sm text-[hsl(var(--fg))]/70">Dashboard</div>
          <div className="text-xl font-semibold">خوش آمدید</div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-[hsl(var(--fg))]/70">
            اینجا به مرور آمار فروش، وضعیت نودها، و گزارش‌ها اضافه می‌شود.
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card><CardContent><div className="text-sm">Users</div><div className="text-2xl font-semibold">—</div></CardContent></Card>
        <Card><CardContent><div className="text-sm">Balance</div><div className="text-2xl font-semibold">—</div></CardContent></Card>
        <Card><CardContent><div className="text-sm">Nodes</div><div className="text-2xl font-semibold">—</div></CardContent></Card>
      </div>
    </div>
  );
}
