"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { accentOptions, setAccent } from "@/components/theme-provider";
import { storage } from "@/lib/storage";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [accent, setAccentState] = React.useState(storage.get("accent") || "blue");
  const r = useRouter();

  function onLogout() {
    storage.del("token");
    r.push("/login");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="text-xl font-semibold">Settings</div>
          <div className="text-sm text-[hsl(var(--fg))]/70">تنظیمات ظاهری و حساب</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="text-sm font-medium">Theme</div>
            <div className="flex flex-wrap gap-2">
              <Button variant={theme === "light" ? "primary" : "outline"} onClick={() => setTheme("light")}>Light</Button>
              <Button variant={theme === "dark" ? "primary" : "outline"} onClick={() => setTheme("dark")}>Dark</Button>
              <Button variant={theme === "system" ? "primary" : "outline"} onClick={() => setTheme("system")}>System</Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Accent</div>
            <div className="flex flex-wrap gap-2">
              {accentOptions.map((a) => (
                <Button
                  key={a}
                  variant={accent === a ? "primary" : "outline"}
                  onClick={() => {
                    setAccentState(a);
                    setAccent(a);
                  }}
                >
                  {a}
                </Button>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <Button variant="outline" onClick={onLogout}>Logout</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
