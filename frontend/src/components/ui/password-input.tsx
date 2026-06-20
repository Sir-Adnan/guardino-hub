"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/cn";

/**
 * Password field with a show/hide toggle. Drop-in replacement for <Input type="password">.
 * Positioning uses logical (inline-end) utilities so it stays correct in the RTL layout.
 */
export function PasswordInput({
  className,
  showLabel = "نمایش رمز",
  hideLabel = "مخفی کردن رمز",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { showLabel?: string; hideLabel?: string }) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? "text" : "password"}
        className={cn("pe-10", className)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? hideLabel : showLabel}
        title={show ? hideLabel : showLabel}
        className="absolute inset-y-0 end-0 flex items-center px-3 text-[hsl(var(--fg))]/50 transition-colors hover:text-[hsl(var(--fg))]"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
