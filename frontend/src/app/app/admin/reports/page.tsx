import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function ReportsHome() {
  return (
    <Card>
      <CardHeader>
        <div className="text-xl font-semibold">Admin: Reports</div>
        <div className="text-sm text-[hsl(var(--fg))]/70">Ledger و Orders</div>
      </CardHeader>
      <CardContent className="text-sm text-[hsl(var(--fg))]/70">
        از منو: Ledger / Orders
      </CardContent>
    </Card>
  );
}
