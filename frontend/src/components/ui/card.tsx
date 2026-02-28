import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(165deg,hsl(var(--card))_0%,hsl(var(--card))_56%,hsl(var(--muted))_100%)] shadow-[0_10px_30px_-18px_hsl(var(--fg)/0.35)] transition-all duration-200",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "p-4 border-b border-[hsl(var(--border))] bg-[linear-gradient(120deg,hsl(var(--accent)/0.08)_0%,hsl(var(--card))_65%)]",
        className
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
