"use client";

import { useRouter } from "next/navigation";
import { ArrowRightLeft, FileText, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ReportsHome() {
  const router = useRouter();
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(112deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <FileText size={13} />
              Financial Insights
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">گزارش‌های مالی</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">دسترسی سریع به دفتر کل تراکنش‌ها و تاریخچه سفارشات</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <ArrowRightLeft size={14} />
            آماده پایش لحظه‌ای
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <ArrowRightLeft size={18} />
              دفتر کل
            </div>
            <div className="text-sm text-[hsl(var(--fg))]/70">ثبت کامل تراکنش‌های شارژ، کسر و بازگشت موجودی</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 text-sm text-[hsl(var(--fg))]/80">
              رصد جریان نقدی و بررسی تغییرات موجودی رسیلرها با فیلترهای سریع.
            </div>
            <Button onClick={() => router.push("/app/admin/reports/ledger")}>ورود به دفتر کل</Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <ShoppingCart size={18} />
              سفارشات
            </div>
            <div className="text-sm text-[hsl(var(--fg))]/70">وضعیت سفارشات کاربران، نوع عملیات و نتیجه نهایی</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 text-sm text-[hsl(var(--fg))]/80">
              مشاهده‌ی سفارشات تکمیل‌شده، ناموفق و برگشت‌خورده به‌صورت یکپارچه.
            </div>
            <Button onClick={() => router.push("/app/admin/reports/orders")}>ورود به سفارشات</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
