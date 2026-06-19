import { cn } from "@/lib/cn";

const BRAND_ASSET_VERSION = "2026-06-19-1";
const brandAsset = (path: string) => `${path}?v=${BRAND_ASSET_VERSION}`;

export function BrandMark({
  showText = false,
  subtitle,
  className,
  markClassName,
  textClassName,
}: {
  showText?: boolean;
  subtitle?: string;
  className?: string;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl border border-red-900/10 bg-white shadow-[0_12px_28px_-18px_rgba(153,0,0,0.8)]",
          markClassName
        )}
      >
        <img src={brandAsset("/brand/guardino-mark.png")} alt="Guardino" className="h-full w-full object-contain" />
      </span>
      {showText ? (
        <span className={cn("min-w-0", textClassName)}>
          <span className="block truncate text-sm font-extrabold tracking-tight text-[hsl(var(--fg))]">Guardino Hub</span>
          {subtitle ? <span className="block truncate text-[11px] text-[hsl(var(--fg))]/60">{subtitle}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
