"use client";

import { useRouter } from "next/navigation";
import { ArrowRightLeft, FileText, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-context";

export default function ReportsHome() {
  const router = useRouter();
  const { lang } = useI18n();
  const copy = lang === "en"
    ? {
        eyebrow: "Financial Insights",
        title: "Financial reports",
        subtitle: "Quick access to ledger transactions and order history",
        live: "Ready for live monitoring",
        ledger: "Ledger",
        ledgerSubtitle: "Full record of credit, debit and refund transactions",
        ledgerBody: "Track cash flow and reseller balance changes with quick filters.",
        ledgerButton: "Open ledger",
        orders: "Orders",
        ordersSubtitle: "User order status, operation type and final result",
        ordersBody: "Review completed, failed and rolled-back orders from one place.",
        ordersButton: "Open orders",
      }
    : {
        eyebrow: "بینش مالی",
        title: "گزارش‌های مالی",
        subtitle: "دسترسی سریع به دفتر کل تراکنش‌ها و تاریخچه سفارشات",
        live: "آماده پایش لحظه‌ای",
        ledger: "دفتر کل",
        ledgerSubtitle: "ثبت کامل تراکنش‌های شارژ، کسر و بازگشت موجودی",
        ledgerBody: "رصد جریان نقدی و بررسی تغییرات موجودی رسیلرها با فیلترهای سریع.",
        ledgerButton: "ورود به دفتر کل",
        orders: "سفارشات",
        ordersSubtitle: "وضعیت سفارشات کاربران، نوع عملیات و نتیجه نهایی",
        ordersBody: "مشاهده‌ی سفارشات تکمیل‌شده، ناموفق و برگشت‌خورده به‌صورت یکپارچه.",
        ordersButton: "ورود به سفارشات",
      };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(112deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-4 shadow-[0_15px_28px_-20px_hsl(var(--fg)/0.35)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-card-1))] px-3 py-1 text-xs text-[hsl(var(--fg))]/75">
              <FileText size={13} />
              {copy.eyebrow}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{copy.title}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--fg))]/70">{copy.subtitle}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(130deg,hsl(var(--accent)/0.16),hsl(var(--surface-card-1)))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))]/80">
            <ArrowRightLeft size={14} />
            {copy.live}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <ArrowRightLeft size={18} />
              {copy.ledger}
            </div>
            <div className="text-sm text-[hsl(var(--fg))]/70">{copy.ledgerSubtitle}</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 text-sm text-[hsl(var(--fg))]/80">
              {copy.ledgerBody}
            </div>
            <Button onClick={() => router.push("/app/admin/reports/ledger")}>{copy.ledgerButton}</Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <ShoppingCart size={18} />
              {copy.orders}
            </div>
            <div className="text-sm text-[hsl(var(--fg))]/70">{copy.ordersSubtitle}</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[linear-gradient(145deg,hsl(var(--surface-card-1))_0%,hsl(var(--surface-card-3))_100%)] p-3 text-sm text-[hsl(var(--fg))]/80">
              {copy.ordersBody}
            </div>
            <Button onClick={() => router.push("/app/admin/reports/orders")}>{copy.ordersButton}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
