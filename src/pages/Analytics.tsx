import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/api/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Inbox, TrendingUp, TrendingDown } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

const COLORS = {
  primary: "hsl(217, 80%, 45%)",
  gold: "hsl(43, 56%, 54%)",
  success: "hsl(153, 80%, 34%)",
  danger: "hsl(0, 76%, 52%)",
};

function getMonthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ChartSkeleton() { return <Skeleton className="w-full h-[280px]" />; }
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Inbox className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export default function Analytics() {
  const { user, role, profile, allowedUnitNames } = useAuth();
  const [unitFilter, setUnitFilter] = useState<string>("all");

  const { data: units } = useQuery({
    queryKey: ["filter-units", allowedUnitNames?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").order("name");
      if (allowedUnitNames) q = q.in("name", allowedUnitNames.length ? allowedUnitNames : ["__none__"]);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["analytics-tickets", role, profile?.department_id],
    queryFn: async () => {
      let query = supabase
        .from("tickets")
        .select("id, status, created_at, closed_at, target_date, assigned_to, unit_id, issue_department_id, issue_dept:departments!tickets_issue_department_id_fkey(name), unit:units(name), assignee:profiles!tickets_assigned_to_fkey(name)")
        .order("created_at", { ascending: false });
      if (role === "user") query = query.eq("raised_by", user!.id);
      else if (role === "hod" && profile?.department_id) query = query.eq("issue_department_id", profile.department_id);
      const { data } = await query;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: ratings } = useQuery({
    queryKey: ["analytics-ratings"],
    queryFn: async () => {
      const { data } = await supabase.from("ticket_ratings").select("rating, ticket_id");
      return data || [];
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    if (!tickets) return [];
    if (unitFilter === "all") return tickets;
    return tickets.filter(t => t.unit_id === unitFilter);
  }, [tickets, unitFilter]);

  // Volume trends by department (monthly stacked-ish, line per dept)
  const deptTrendData = useMemo(() => {
    const monthDeptMap: Record<string, Record<string, number>> = {};
    const deptNames = new Set<string>();
    filtered.forEach(t => {
      const m = getMonthKey(new Date(t.created_at));
      const dept = (t as any).issue_dept?.name || "Unknown";
      deptNames.add(dept);
      if (!monthDeptMap[m]) monthDeptMap[m] = {};
      monthDeptMap[m][dept] = (monthDeptMap[m][dept] || 0) + 1;
    });
    const months = Object.keys(monthDeptMap).sort().slice(-12);
    const data = months.map(m => {
      const row: any = { month: m };
      deptNames.forEach(d => { row[d] = monthDeptMap[m][d] || 0; });
      return row;
    });
    return { data, depts: Array.from(deptNames) };
  }, [filtered]);

  // SLA breach rate over time (monthly)
  const slaData = useMemo(() => {
    const map: Record<string, { total: number; breached: number }> = {};
    filtered.forEach(t => {
      const m = getMonthKey(new Date(t.created_at));
      if (!map[m]) map[m] = { total: 0, breached: 0 };
      map[m].total++;
      if (t.target_date && t.status !== "closed") {
        if (new Date(t.target_date) < new Date()) map[m].breached++;
      } else if (t.target_date && t.closed_at && new Date(t.closed_at) > new Date(t.target_date)) {
        map[m].breached++;
      }
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, v]) => ({
      month,
      breachRate: v.total > 0 ? +((v.breached / v.total) * 100).toFixed(1) : 0,
    }));
  }, [filtered]);

  // Technician performance
  const technicianData = useMemo(() => {
    if (!ratings) return [];
    const ratingMap: Record<string, number[]> = {};
    ratings.forEach(r => {
      const t = filtered.find(x => x.id === r.ticket_id);
      if (t?.assigned_to) {
        if (!ratingMap[t.assigned_to]) ratingMap[t.assigned_to] = [];
        ratingMap[t.assigned_to].push(r.rating);
      }
    });
    const map: Record<string, { name: string; closed: number; agings: number[]; ratings: number[] }> = {};
    filtered.filter(t => t.assigned_to).forEach(t => {
      const id = t.assigned_to!;
      const name = (t as any).assignee?.name || "Unknown";
      if (!map[id]) map[id] = { name, closed: 0, agings: [], ratings: ratingMap[id] || [] };
      if (t.status === "closed" && t.closed_at) {
        map[id].closed++;
        map[id].agings.push((new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()) / 86400000);
      }
    });
    return Object.values(map)
      .map(t => ({
        name: t.name,
        closed: t.closed,
        avgAging: t.agings.length > 0 ? +(t.agings.reduce((a, b) => a + b, 0) / t.agings.length).toFixed(1) : 0,
        avgScore: t.ratings.length > 0 ? +(t.ratings.reduce((a, b) => a + b, 0) / t.ratings.length).toFixed(2) : 0,
      }))
      .sort((a, b) => b.closed - a.closed);
  }, [filtered, ratings]);

  // Top/bottom units
  const unitData = useMemo(() => {
    const map: Record<string, { name: string; total: number; resolved: number; agings: number[] }> = {};
    filtered.forEach(t => {
      const id = t.unit_id || "none";
      const name = (t as any).unit?.name || "Unassigned";
      if (!map[id]) map[id] = { name, total: 0, resolved: 0, agings: [] };
      map[id].total++;
      if (["resolved", "closed"].includes(t.status)) map[id].resolved++;
      if (t.status === "closed" && t.closed_at) {
        map[id].agings.push((new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()) / 86400000);
      }
    });
    const arr = Object.values(map).map(u => ({
      name: u.name,
      total: u.total,
      resolutionRate: u.total > 0 ? Math.round((u.resolved / u.total) * 100) : 0,
      avgAging: u.agings.length > 0 ? +(u.agings.reduce((a, b) => a + b, 0) / u.agings.length).toFixed(1) : 0,
    })).sort((a, b) => b.resolutionRate - a.resolutionRate);
    return arr;
  }, [filtered]);

  const topUnits = unitData.slice(0, 5);
  const bottomUnits = [...unitData].reverse().slice(0, 5);

  return (
    <AppLayout title="Detailed Analytics">
      <div className="space-y-6">
        <Card className="border shadow-sm">
          <CardContent className="p-4 flex justify-end">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground">Unit:</span>
              <Select value={unitFilter} onValueChange={setUnitFilter}>
                <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  {units?.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border shadow-sm">
            <CardHeader><CardTitle className="text-sm font-semibold">Ticket Volume by Department</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <ChartSkeleton /> : deptTrendData.data.length === 0 ? <EmptyChart label="No data" /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={deptTrendData.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: "Tickets", angle: -90, position: "insideLeft", fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {deptTrendData.depts.map((d, i) => (
                      <Line key={d} type="monotone" dataKey={d} stroke={`hsl(${(i * 67) % 360}, 70%, 45%)`} strokeWidth={2} dot={{ r: 2 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader><CardTitle className="text-sm font-semibold">SLA Breach Rate Over Time (%)</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <ChartSkeleton /> : slaData.length === 0 ? <EmptyChart label="No SLA data" /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={slaData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: "% Breached", angle: -90, position: "insideLeft", fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="breachRate" name="Breach Rate %" fill={COLORS.danger} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border shadow-sm">
          <CardHeader><CardTitle className="text-sm font-semibold">Technician Performance</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <ChartSkeleton /> : technicianData.length === 0 ? <EmptyChart label="No assigned tickets" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Technician</TableHead>
                    <TableHead className="text-right">Tickets Closed</TableHead>
                    <TableHead className="text-right">Avg Aging (days)</TableHead>
                    <TableHead className="text-right">Avg Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {technicianData.map(t => (
                    <TableRow key={t.name}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right">{t.closed}</TableCell>
                      <TableCell className="text-right">{t.avgAging || "—"}</TableCell>
                      <TableCell className="text-right">
                        {t.avgScore > 0 ? (
                          <Badge variant={t.avgScore >= 4 ? "default" : t.avgScore >= 3 ? "secondary" : "destructive"}>
                            {t.avgScore} ★
                          </Badge>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-600" /> Top Performing Units
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <ChartSkeleton /> : topUnits.length === 0 ? <EmptyChart label="No units" /> : (
                <div className="space-y-3">
                  {topUnits.map(u => (
                    <div key={u.name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.total} tickets • avg {u.avgAging}d</p>
                      </div>
                      <Badge className="bg-green-600">{u.resolutionRate}%</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-600" /> Bottom Performing Units
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <ChartSkeleton /> : bottomUnits.length === 0 ? <EmptyChart label="No units" /> : (
                <div className="space-y-3">
                  {bottomUnits.map(u => (
                    <div key={u.name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.total} tickets • avg {u.avgAging}d</p>
                      </div>
                      <Badge variant="destructive">{u.resolutionRate}%</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
