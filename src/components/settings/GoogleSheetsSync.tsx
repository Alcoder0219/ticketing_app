import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/api/client";
import { toast } from "sonner";
import {
  Loader2,
  FileSpreadsheet,
  ExternalLink,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { formatDate } from "@/utils/dateFormat";


const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1LbKfDv6peha2SXlCKHxKg146TaFEDpssenWNnz0gKAk/edit";
const STORAGE_KEY = "sheets:lastSyncedAt";
const AUTO_KEY = "sheets:autoSync";
const INTERVAL_KEY = "sheets:autoSyncInterval";

const INTERVALS = [
  { value: "60", label: "Every 1 minute" },
  { value: "300", label: "Every 5 minutes" },
  { value: "900", label: "Every 15 minutes" },
  { value: "1800", label: "Every 30 minutes" },
  { value: "3600", label: "Every 1 hour" },
];

export function GoogleSheetsSync() {
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<"success" | "error" | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [intervalSec, setIntervalSec] = useState("300");
  const [nextRunAt, setNextRunAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<number | null>(null);
  const runSyncRef = useRef<(silent?: boolean) => void>(() => {});

  useEffect(() => {
    setLastSynced(localStorage.getItem(STORAGE_KEY));
    setAutoSync(localStorage.getItem(AUTO_KEY) === "true");
    const stored = localStorage.getItem(INTERVAL_KEY);
    if (stored) setIntervalSec(stored);
  }, []);

  // Tick every second for countdown UI
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const runSync = useCallback(
    async (attempt = 1, silent = false): Promise<void> => {
      setSyncing(true);
      try {
        const { data, error } = await supabase.functions.invoke(
          "sync-tickets-to-sheets",
          { body: {} },
        );
        if (error) throw error;
        if (data && data.success === false)
          throw new Error(data.error || "Sync failed");

        const ts = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, ts);
        setLastSynced(ts);
        setLastStatus("success");
        if (!silent) toast.success(`Synced successfully — ${formatTs(ts)}`);
      } catch (err: any) {
        const msg = String(err?.message || err);
        if (/timeout|timed out|network/i.test(msg) && attempt < 3) {
          return runSync(attempt + 1, silent);
        }
        setLastStatus("error");
        let friendly = "Sync failed — please try again";
        if (/401|403|auth/i.test(msg))
          friendly = "Authentication failed — check service account credentials";
        else if (/404|not found/i.test(msg))
          friendly = "Google Sheet not found — check the Sheet ID";
        toast.error(friendly, {
          action: { label: "Retry", onClick: () => runSync(1) },
        });
        console.error("Sheets sync error:", err);
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  // Keep latest runSync in a ref so the interval always calls the latest version
  useEffect(() => {
    runSyncRef.current = (silent = true) => runSync(1, silent);
  }, [runSync]);

  // Auto-sync timer
  useEffect(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!autoSync) {
      setNextRunAt(null);
      return;
    }
    const ms = parseInt(intervalSec, 10) * 1000;
    setNextRunAt(Date.now() + ms);
    timerRef.current = window.setInterval(() => {
      console.log("[auto-sync] tick — running silent sync");
      runSyncRef.current(true);
      setNextRunAt(Date.now() + ms);
    }, ms);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [autoSync, intervalSec]);

  function toggleAuto(on: boolean) {
    setAutoSync(on);
    localStorage.setItem(AUTO_KEY, String(on));
    if (on) {
      toast.success(
        `Auto-sync enabled — ${INTERVALS.find((i) => i.value === intervalSec)?.label.toLowerCase()}`,
      );
      runSync(1, true);
    } else {
      toast("Auto-sync disabled");
    }
  }

  function changeInterval(v: string) {
    setIntervalSec(v);
    localStorage.setItem(INTERVAL_KEY, v);
    if (autoSync) {
      toast.success(
        `Auto-sync interval updated — ${INTERVALS.find((i) => i.value === v)?.label.toLowerCase()}`,
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Google Sheets Sync
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Tickets sync automatically to Google Sheets on every create, update,
          and resolve. You can also trigger a manual full sync or enable
          periodic auto-sync below.
        </p>

        {/* Manual sync */}
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => runSync(1)} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync to Google Sheets
          </Button>

          <Button variant="outline" asChild>
            <a href={SHEET_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              View Sheet
            </a>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          {lastStatus === "success" && (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          )}
          {lastStatus === "error" && (
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
          )}
          {lastSynced
            ? `Last synced: ${formatTs(lastSynced)}`
            : "Not synced yet from this browser."}
        </p>

        <Separator />

        {/* Auto-sync */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label
                htmlFor="auto-sync-switch"
                className="text-base font-semibold flex items-center gap-2"
              >
                <Zap className="h-4 w-4 text-primary" />
                Auto-Sync
              </Label>
              <p className="text-xs text-muted-foreground max-w-md">
                Automatically push the latest ticket data to Google Sheets at a
                fixed interval while this tab is open. Server-side sync on
                ticket changes runs independently.
              </p>
            </div>
            <Switch
              id="auto-sync-switch"
              checked={autoSync}
              onCheckedChange={toggleAuto}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="interval" className="text-sm w-24">
              Interval
            </Label>
            <Select
              value={intervalSec}
              onValueChange={changeInterval}
              disabled={!autoSync}
            >
              <SelectTrigger id="interval" className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            className={`text-xs flex items-center gap-1.5 ${
              autoSync ? "text-green-600" : "text-muted-foreground"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                autoSync ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"
              }`}
            />
            {autoSync
              ? `Auto-sync active — next run in ${formatCountdown(nextRunAt, now)}`
              : "Auto-sync is off"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTs(iso: string) {
  return formatDate(iso, true);
}

function formatCountdown(target: number | null, now: number) {
  if (!target) return "—";
  const sec = Math.max(0, Math.floor((target - now) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
