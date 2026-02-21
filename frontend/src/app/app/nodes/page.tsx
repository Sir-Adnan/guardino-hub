import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function NodesPage() {
  return (
    <Card>
      <CardHeader>
        <div className="text-xl font-semibold">Nodes</div>
        <div className="text-sm text-[hsl(var(--fg))]/70">در مراحل بعد، مدیریت نودها اضافه می‌شود</div>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-[hsl(var(--fg))]/70">Placeholder</div>
      </CardContent>
    </Card>
  );
}
