import { useState, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/api/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Inbox, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { formatDate } from "@/utils/dateFormat";
import { DateRange } from "react-day-picker";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ComposedChart, Line, LabelList,
} from "recharts";

const COLOR_BAR = "hsl(220, 60%, 75%)";
const COLOR_BAR_DARK = "hsl(220, 50%, 55%)";
const COLOR_LINE = "hsl(0, 0%, 20%)";
const COLOR_PENDING = "hsl(220, 60%, 75%)";
const COLOR_INPROGRESS = "hsl(220, 50%, 55%)";

function startOfWeek(d: Date) {
  const date = new Date(d);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}
function getWeekNumber(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
function weekLabel(d: Date) {
  return `Week ${getWeekNumber(d)}`;
}
function weekRangeLabel(d: Date) {
  const start = startOfWeek(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${format(start, "MMM d")} to ${format(end, "MMM d, yyyy")} (Week ${getWeekNumber(d)})`;
}
function monthLabel(d: Date) {
  return format(d, "MMM yyyy");
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border shadow-sm overflow-hidden">
      <div className="bg-muted/40 border-b px-3 py-2 text-center">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </Card>
  );
}
function EmptyChart() {
  return (
    <div className="flex flex-col items-center justify-center h-[220px] text-muted-foreground">
      <Inbox className="h-8 w-8 mb-2 opacity-40" />
      <p className="text-xs">No data</p>
    </div>
  );
}
function ChartSkeleton() { return <Skeleton className="w-full h-[220px]" />; }

export default function Dashboard() {
  const { user, role, profile, allowedUnitNames } = useAuth();
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const { data: units } = useQuery({
    queryKey: ["filter-units", allowedUnitNames?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").order("name");
      if (allowedUnitNames) q = q.in("name", allowedUnitNames.length ? allowedUnitNames : ["__none__"]);
      return (await q).data || [];
    },
  });
  const { data: departments } = useQuery({
    queryKey: ["filter-departments"],
    queryFn: async () => (await supabase.from("departments").select("id, name").eq("is_active", true).order("name")).data || [],
  });

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["overview-tickets", role, profile?.department_id],
    queryFn: async () => {
      let query = supabase
        .from("tickets")
        .select("id, status, created_at, closed_at, issue_department_id, unit_id")
        .order("created_at", { ascending: false });
      if (role === "user") query = query.eq("raised_by", user!.id);
      else if (role === "hod" && profile?.department_id) query = query.eq("issue_department_id", profile.department_id);
      else if (role === "assigned_person") query = query.eq("assigned_to", user!.id);
      const { data } = await query;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: ratings, isLoading: ratingsLoading } = useQuery({
    queryKey: ["overview-ratings"],
    queryFn: async () => (await supabase.from("ticket_ratings").select("rating, created_at, ticket_id")).data || [],
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    if (!tickets) return [];
    return tickets.filter(t => {
      if (unitFilter !== "all" && t.unit_id !== unitFilter) return false;
      if (deptFilter !== "all" && t.issue_department_id !== deptFilter) return false;
      const created = new Date(t.created_at);
      if (dateRange?.from && created < dateRange.from) return false;
      if (dateRange?.to && created > dateRange.to) return false;
      return true;
    });
  }, [tickets, unitFilter, deptFilter, dateRange]);

  // Build period buckets
  function buildBuckets<T>(items: T[], getDate: (i: T) => Date | null, granularity: "week" | "month", count: number) {
    const buckets: Array<{ key: string; label: string; rangeLabel: string; date: Date; items: T[] }> = [];
    const now = new Date();
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now);
      if (granularity === "week") d.setDate(d.getDate() - i * 7);
      else d.setMonth(d.getMonth() - i);
      const anchor = granularity === "week" ? startOfWeek(d) : new Date(d.getFullYear(), d.getMonth(), 1);
      const key = anchor.toISOString();
      buckets.push({
        key,
        label: granularity === "week" ? weekLabel(anchor) : monthLabel(anchor),
        rangeLabel: granularity === "week" ? weekRangeLabel(anchor) : monthLabel(anchor),
        date: anchor,
        items: [],
      });
    }
    items.forEach(it => {
      const dt = getDate(it);
      if (!dt) return;
      const anchor = granularity === "week" ? startOfWeek(dt) : new Date(dt.getFullYear(), dt.getMonth(), 1);
      const b = buckets.find(b => b.key === anchor.toISOString());
      if (b) b.items.push(it);
    });
    return buckets;
  }

  // Weekly Total Tickets (last 9 weeks like image)
  const weeklyTotals = useMemo(() => {
    return buildBuckets(filtered, t => new Date(t.created_at), "week", 9)
      .map(b => ({ label: b.label, total: b.items.length }));
  }, [filtered]);

  // Monthly Total Tickets (last 10 months)
  const monthlyTotals = useMemo(() => {
    return buildBuckets(filtered, t => new Date(t.created_at), "month", 10)
      .map(b => ({ label: b.label, total: b.items.length }));
  }, [filtered]);

  // Weekly Avg Close Time + closed count
  const weeklyClose = useMemo(() => {
    return buildBuckets(filtered.filter(t => t.closed_at), t => new Date(t.closed_at!), "week", 9)
      .map(b => {
        const days = b.items.map(t => (new Date(t.closed_at!).getTime() - new Date(t.created_at).getTime()) / 86400000);
        return {
          label: b.label,
          aging: days.length ? +(days.reduce((a, c) => a + c, 0) / days.length).toFixed(1) : 0,
          closed: b.items.length,
        };
      });
  }, [filtered]);

  const monthlyClose = useMemo(() => {
    return buildBuckets(filtered.filter(t => t.closed_at), t => new Date(t.closed_at!), "month", 10)
      .map(b => {
        const days = b.items.map(t => (new Date(t.closed_at!).getTime() - new Date(t.created_at).getTime()) / 86400000);
        return {
          label: b.label,
          aging: days.length ? +(days.reduce((a, c) => a + c, 0) / days.length).toFixed(1) : 0,
          closed: b.items.length,
        };
      });
  }, [filtered]);

  // Weekly / Monthly Avg Rating
  const ticketIds = useMemo(() => new Set(filtered.map(t => t.id)), [filtered]);
  const filteredRatings = useMemo(() => (ratings || []).filter(r => ticketIds.has(r.ticket_id)), [ratings, ticketIds]);

  const weeklyRating = useMemo(() => {
    return buildBuckets(filteredRatings, r => new Date(r.created_at), "week", 9)
      .map(b => ({
        label: b.label,
        score: b.items.length ? +(b.items.reduce((a, c) => a + c.rating, 0) / b.items.length).toFixed(2) : 0,
        count: b.items.length,
      }));
  }, [filteredRatings]);

  const monthlyRating = useMemo(() => {
    return buildBuckets(filteredRatings, r => new Date(r.created_at), "month", 10)
      .map(b => ({
        label: b.label,
        score: b.items.length ? +(b.items.reduce((a, c) => a + c.rating, 0) / b.items.length).toFixed(2) : 0,
        count: b.items.length,
      }));
  }, [filteredRatings]);

  // Weekly / Monthly Status (Pending vs In Progress)
  const weeklyStatus = useMemo(() => {
    return buildBuckets(filtered, t => new Date(t.created_at), "week", 6).map(b => ({
      label: b.rangeLabel,
      pending: b.items.filter(t => t.status === "open" || t.status === "reopened").length,
      inProgress: b.items.filter(t => t.status === "in_progress").length,
    }));
  }, [filtered]);

  const monthlyStatus = useMemo(() => {
    return buildBuckets(filtered, t => new Date(t.created_at), "month", 4).map(b => ({
      label: b.label,
      pending: b.items.filter(t => t.status === "open" || t.status === "reopened").length,
      inProgress: b.items.filter(t => t.status === "in_progress").length,
    }));
  }, [filtered]);

  const dateLabel = dateRange?.from
    ? dateRange.to
      ? `${format(dateRange.from, "dd-MM-yyyy")} – ${format(dateRange.to, "dd-MM-yyyy")}`
      : format(dateRange.from, "dd-MM-yyyy")
    : "Select date range";

  const axisProps = {
    tick: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
    stroke: "hsl(var(--border))",
  };

  return (
    <AppLayout title="Ticketing Dashboard">
      <div className="space-y-3">
        {/* Title bar */}
        <div className="bg-[hsl(220,40%,90%)] border rounded-md py-2">
          <h2 className="text-center text-base font-bold italic text-foreground">Ticketing Dashboard</h2>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="bg-background">
              <span className="text-xs text-muted-foreground mr-2">Unit:</span>
              <SelectValue placeholder="All Units" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Units ({units?.length || 0})</SelectItem>
              {units?.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="bg-background"><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="justify-between font-normal bg-background">
                <span className={dateRange?.from ? "" : "text-muted-foreground"}>{dateLabel}</span>
                <CalendarIcon className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
              <div className="flex justify-end p-2 border-t">
                <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>Clear</Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Row 1: Weekly */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <ChartCard title="Weekly Total Tickets">
            {isLoading ? <ChartSkeleton /> : weeklyTotals.every(d => d.total === 0) ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weeklyTotals} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={10} />
                  <Bar dataKey="total" name="Total Tickets" fill={COLOR_BAR}>
                    <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Weekly Average Ticket Close Time">
            {isLoading ? <ChartSkeleton /> : weeklyClose.every(d => d.closed === 0) ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={weeklyClose} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis yAxisId="left" {...axisProps} />
                  <YAxis yAxisId="right" orientation="right" {...axisProps} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={10} />
                  <Bar yAxisId="right" dataKey="closed" name="Total Tickets Closed" fill={COLOR_BAR}>
                    <LabelList dataKey="closed" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                  <Line yAxisId="left" type="monotone" dataKey="aging" name="Aging (for closed tickets)" stroke={COLOR_LINE} strokeWidth={1.5} dot={{ r: 3, fill: COLOR_LINE }}>
                    <LabelList dataKey="aging" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Weekly Average Rating">
            {ratingsLoading ? <ChartSkeleton /> : weeklyRating.every(d => d.count === 0) ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={weeklyRating} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis yAxisId="left" domain={[0, 5]} {...axisProps} />
                  <YAxis yAxisId="right" orientation="right" {...axisProps} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={10} />
                  <Bar yAxisId="right" dataKey="count" name="Rate Count" fill={COLOR_BAR}>
                    <LabelList dataKey="count" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                  <Line yAxisId="left" type="monotone" dataKey="score" name="Rate Score (Target 5)" stroke={COLOR_LINE} strokeWidth={1.5} dot={{ r: 3, fill: COLOR_LINE }}>
                    <LabelList dataKey="score" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Row 2: Monthly */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <ChartCard title="Monthly Total Tickets">
            {isLoading ? <ChartSkeleton /> : monthlyTotals.every(d => d.total === 0) ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyTotals} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={10} />
                  <Bar dataKey="total" name="Total Tickets" fill={COLOR_BAR}>
                    <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Monthly Average Ticket Close Time">
            {isLoading ? <ChartSkeleton /> : monthlyClose.every(d => d.closed === 0) ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={monthlyClose} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis yAxisId="left" {...axisProps} />
                  <YAxis yAxisId="right" orientation="right" {...axisProps} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={10} />
                  <Bar yAxisId="right" dataKey="closed" name="Total Tickets Closed" fill={COLOR_BAR}>
                    <LabelList dataKey="closed" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                  <Line yAxisId="left" type="monotone" dataKey="aging" name="Aging" stroke={COLOR_LINE} strokeWidth={1.5} dot={{ r: 3, fill: COLOR_LINE }}>
                    <LabelList dataKey="aging" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Monthly Average Rating">
            {ratingsLoading ? <ChartSkeleton /> : monthlyRating.every(d => d.count === 0) ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={monthlyRating} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis yAxisId="left" domain={[0, 5]} {...axisProps} />
                  <YAxis yAxisId="right" orientation="right" {...axisProps} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={10} />
                  <Bar yAxisId="right" dataKey="count" name="Rating Count" fill={COLOR_BAR}>
                    <LabelList dataKey="count" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                  <Line yAxisId="left" type="monotone" dataKey="score" name="Rate Score" stroke={COLOR_LINE} strokeWidth={1.5} dot={{ r: 3, fill: COLOR_LINE }}>
                    <LabelList dataKey="score" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Row 3: Status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ChartCard title="Weekly Status">
            {isLoading ? <ChartSkeleton /> : weeklyStatus.every(d => d.pending === 0 && d.inProgress === 0) ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weeklyStatus} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--border))" />
                  <YAxis {...axisProps} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={10} />
                  <Bar dataKey="pending" name="Pending" fill={COLOR_PENDING}>
                    <LabelList dataKey="pending" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                  <Bar dataKey="inProgress" name="In Progress" fill={COLOR_INPROGRESS}>
                    <LabelList dataKey="inProgress" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Monthly Status">
            {isLoading ? <ChartSkeleton /> : monthlyStatus.every(d => d.pending === 0 && d.inProgress === 0) ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyStatus} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={10} />
                  <Bar dataKey="pending" name="Pending" fill={COLOR_PENDING}>
                    <LabelList dataKey="pending" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                  <Bar dataKey="inProgress" name="In Progress" fill={COLOR_INPROGRESS}>
                    <LabelList dataKey="inProgress" position="top" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    </AppLayout>
  );
}
