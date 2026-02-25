"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useI18n } from "@/components/i18n-context";

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  className?: string;
  pageSizeOptions?: number[];
};

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
  pageSizeOptions = [20, 50, 100],
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const { t } = useI18n();

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 text-sm", className)}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
          {t("common.prev")}
        </Button>
        <div className="text-xs text-[hsl(var(--fg))]/70">
          {t("common.pageOf").replace("{page}", String(safePage)).replace("{total}", String(totalPages))}
        </div>
        <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>
          {t("common.next")}
        </Button>
      </div>

      {onPageSizeChange ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[hsl(var(--fg))]/70">{t("common.pageSize")}</span>
          <select
            className="rounded-xl border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-xs"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
