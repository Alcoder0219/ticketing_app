import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, PlusCircle, Save, X, Shield, Bot, PlayCircle } from "lucide-react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/api/client";
import { useToast } from "@/hooks/use-toast";
import { Permissions } from "@/contexts/PermissionsContext";

type AppRole = "super_admin" | "admin" | "hod" | "user" | "assigned_person";

interface RoleRow {
  id: string;
  name: AppRole;
  description: string | null;
  permissions: Permissions;
  created_at: string;
  updated_at: string;
}

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "hod", label: "HOD" },
  { value: "assigned_person", label: "Team Member" },
  { value: "user", label: "User" },
];

const DEFAULT_PERMS: Permissions = {
  tickets: { create: false, viewAll: false, viewOwn: true, assign: false, updateStatus: false, close: false, delete: false },
  dashboard: { view: false, scope: "own" },
  sidebar: {
    overview: true, analytics: false, summary: false, createTicket: false, myTickets: true,
    pendingTickets: false, assignedTickets: false, departmentTickets: false, pcReview: false, manageUsers: false, settings: false, aiAssistant: false, tutorialVideos: true,
  },

  department: "own",
};

// Labels are i18n keys, resolved at render time so they follow the active language.
const SIDEBAR_LABELS: { key: keyof Permissions["sidebar"]; labelKey: string; icon?: string }[] = [
  { key: "overview", labelKey: "nav.overview" },
  { key: "analytics", labelKey: "nav.analytics" },
  { key: "summary", labelKey: "nav.summary" },
  { key: "createTicket", labelKey: "nav.createTicket" },
  { key: "myTickets", labelKey: "nav.myTickets" },
  { key: "pendingTickets", labelKey: "nav.pendingTickets" },
  { key: "assignedTickets", labelKey: "nav.assignedTickets" },
  { key: "departmentTickets", labelKey: "nav.departmentTickets" },
  { key: "pcReview", labelKey: "nav.pcReview" },
  { key: "aiAssistant", labelKey: "nav.aiAssistant", icon: "bot" },
  { key: "tutorialVideos", labelKey: "nav.tutorialVideos", icon: "play" },

  { key: "manageUsers", labelKey: "nav.manageUsers" },
  { key: "settings", labelKey: "nav.settings" },
];

const TICKET_LABELS: { key: keyof Permissions["tickets"]; labelKey: string; noteKey?: string }[] = [
  { key: "create", labelKey: "rolesPerms.perm.create" },
  { key: "viewAll", labelKey: "rolesPerms.perm.viewAll" },
  { key: "viewOwn", labelKey: "rolesPerms.perm.viewOwn" },
  { key: "assign", labelKey: "rolesPerms.perm.assign" },
  { key: "updateStatus", labelKey: "rolesPerms.perm.updateStatus" },
  { key: "close", labelKey: "rolesPerms.perm.close" },
  { key: "delete", labelKey: "rolesPerms.perm.delete", noteKey: "rolesPerms.perm.deleteNote" },
];

interface FormState {
  name: AppRole;
  description: string;
  permissions: Permissions;
}

export function RolesPermissionsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleRow | null>(null);
  const [form, setForm] = useState<FormState>({ name: "user", description: "", permissions: DEFAULT_PERMS });
  // Plant access toggles: { unitName: isEnabled }
  const [plantAccess, setPlantAccess] = useState<Record<string, boolean>>({});
  const [ownPlantOnly, setOwnPlantOnly] = useState<boolean>(false);

  const { data: units } = useQuery({
    queryKey: ["roles-units"],
    queryFn: async () => {
      const { data } = await supabase.from("units").select("id,name").order("name");
      return data || [];
    },
  });

  // Load plant access for the role being edited (or default all ON for new role)
  useEffect(() => {
    if (!formOpen || !units) return;
    const init: Record<string, boolean> = {};
    units.forEach((u: any) => { init[u.name] = true; });
    if (editing) {
      supabase.from("role_plant_access" as any)
        .select("unit_name,is_enabled,own_plant_only")
        .eq("role_name", editing.name)
        .then(({ data }) => {
          const map = { ...init };
          let ownOnly = false;
          (data || []).forEach((r: any) => {
            map[r.unit_name] = !!r.is_enabled;
            if (r.own_plant_only) ownOnly = true;
          });
          setPlantAccess(map);
          setOwnPlantOnly(ownOnly);
        });
    } else {
      setPlantAccess(init);
      setOwnPlantOnly(false);
    }
  }, [formOpen, editing, units]);

  const { data: roles, isLoading } = useQuery<RoleRow[]>({
    queryKey: ["roles-permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("roles" as any).select("*").order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as RoleRow[];
    },
    refetchOnWindowFocus: false,
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: FormState & { id?: string }) => {
      if (payload.id) {
        const { data, error } = await supabase
          .from("roles" as any)
          .update({
            name: payload.name,
            description: payload.description || null,
            permissions: payload.permissions as any,
          })
          .eq("id", payload.id)
          .select()
          .single();
        if (error) throw error;
        return data as unknown as RoleRow;
      }
      const { data, error } = await supabase
        .from("roles" as any)
        .insert({
          name: payload.name,
          description: payload.description || null,
          permissions: payload.permissions as any,
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as RoleRow;
    },
    onSuccess: (saved, vars) => {
      queryClient.setQueryData<RoleRow[]>(["roles-permissions"], (old) => {
        if (!old) return [saved];
        return vars.id ? old.map((r) => (r.id === saved.id ? saved : r)) : [...old, saved];
      });
      toast({ title: vars.id ? t("messages.roleUpdated") : t("messages.roleCreated") });
      setFormOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast({ title: t("messages.saveFailed"), description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("roles" as any).delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["roles-permissions"] });
      const prev = queryClient.getQueryData<RoleRow[]>(["roles-permissions"]);
      queryClient.setQueryData<RoleRow[]>(["roles-permissions"], (old) => old?.filter((r) => r.id !== id) ?? []);
      return { prev };
    },
    onSuccess: () => { toast({ title: t("messages.roleDeleted") }); setDeletingRole(null); },
    onError: (e: Error, _id, ctx) => {
      queryClient.setQueryData(["roles-permissions"], ctx?.prev);
      toast({ title: t("messages.deleteFailed"), description: e.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "user", description: "", permissions: DEFAULT_PERMS });
    setFormOpen(true);
  };

  const openEdit = (r: RoleRow) => {
    setEditing(r);
    setForm({ name: r.name, description: r.description ?? "", permissions: r.permissions });
    setFormOpen(true);
  };

  const savePlantAccess = async (roleName: string) => {
    const rows = Object.entries(plantAccess).map(([unit_name, is_enabled]) => ({
      role_name: roleName, unit_name, is_enabled, own_plant_only: ownPlantOnly,
    }));
    if (!rows.length) return;
    await supabase.from("role_plant_access" as any).upsert(rows, { onConflict: "role_name,unit_name" });
  };

  const handleSave = async () => {
    const result = await upsertMutation.mutateAsync({ ...form, id: editing?.id });
    await savePlantAccess(result.name);
  };

  const updateTicket = (key: keyof Permissions["tickets"], value: boolean) =>
    setForm((f) => ({ ...f, permissions: { ...f.permissions, tickets: { ...f.permissions.tickets, [key]: value } } }));

  const updateSidebar = (key: keyof Permissions["sidebar"], value: boolean) =>
    setForm((f) => ({ ...f, permissions: { ...f.permissions, sidebar: { ...f.permissions.sidebar, [key]: value } } }));

  const summaryChip = (label: string, on: boolean) => (
    <Badge variant="outline" className={on ? "border-success text-success bg-success/10" : "border-muted-foreground/30 text-muted-foreground bg-muted/30"}>
      {label} {on ? "✓" : "✗"}
    </Badge>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> {t("rolesPerms.title")}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{t("rolesPerms.subtitle")}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusCircle className="h-4 w-4 mr-2" /> {t("rolesPerms.createNewRole")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("rolesPerms.roleName")}</TableHead>
              <TableHead>{t("rolesPerms.description")}</TableHead>
              <TableHead>{t("rolesPerms.permissionsSummary")}</TableHead>
              <TableHead className="text-right">{t("rolesPerms.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <>
                {[1, 2, 3].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}><div className="h-8 bg-muted animate-pulse rounded" /></TableCell>
                  </TableRow>
                ))}
              </>
            )}
            {!isLoading && roles?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  {t("rolesPerms.noRoles")}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && roles?.map((r) => {
              const isSuper = r.name === "super_admin";
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {ROLE_OPTIONS.find((o) => o.value === r.name)?.label ?? r.name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{r.description ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {summaryChip(t("rolesPerms.perm.chipCreate"), r.permissions?.tickets?.create)}
                      {summaryChip(t("rolesPerms.perm.chipAssign"), r.permissions?.tickets?.assign)}
                      {summaryChip(t("rolesPerms.perm.chipViewAll"), r.permissions?.tickets?.viewAll)}
                      {summaryChip(t("rolesPerms.perm.chipDelete"), r.permissions?.tickets?.delete)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive disabled:opacity-30"
                      onClick={() => setDeletingRole(r)}
                      disabled={isSuper}
                      title={isSuper ? t("rolesPerms.superAdminNoDelete") : t("rolesPerms.deleteRoleTooltip")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {formOpen && (
          <Card className="border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{editing ? t("rolesPerms.editRole") : t("rolesPerms.createNewRole")}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => { setFormOpen(false); setEditing(null); }}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("rolesPerms.roleName")} *</Label>
                  <Input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value as AppRole })}
                    disabled={!!editing}
                    placeholder={t("rolesPerms.roleNamePlaceholder")}
                  />
                  {editing && <p className="text-xs text-muted-foreground">{t("rolesPerms.roleNameLocked")}</p>}
                </div>
                <div className="space-y-2">
                  <Label>{t("rolesPerms.description")}</Label>
                  <Textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder={t("rolesPerms.descriptionPlaceholder")}
                  />
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* A. Ticket Permissions */}
                <div className="border rounded-lg p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider border-b pb-2">{t("rolesPerms.ticketPermissions")}</h4>
                  {TICKET_LABELS.map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <Label className="font-normal text-sm">
                        {t(item.labelKey)}
                        {item.noteKey && <span className="ml-2 text-xs text-muted-foreground">({t(item.noteKey)})</span>}
                      </Label>
                      <Switch
                        checked={form.permissions.tickets[item.key]}
                        onCheckedChange={(v) => updateTicket(item.key, v)}
                      />
                    </div>
                  ))}
                </div>

                {/* B. Dashboard */}
                <div className="border rounded-lg p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider border-b pb-2">{t("rolesPerms.dashboardAccess")}</h4>
                  <div className="flex items-center justify-between">
                    <Label className="font-normal text-sm">{t("rolesPerms.viewDashboard")}</Label>
                    <Switch
                      checked={form.permissions.dashboard.view}
                      onCheckedChange={(v) => setForm((f) => ({ ...f, permissions: { ...f.permissions, dashboard: { ...f.permissions.dashboard, view: v } } }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">{t("rolesPerms.dataScope")}</Label>
                    <RadioGroup
                      value={form.permissions.dashboard.scope}
                      onValueChange={(v) => setForm((f) => ({ ...f, permissions: { ...f.permissions, dashboard: { ...f.permissions.dashboard, scope: v as any } } }))}
                    >
                      <div className="flex items-center gap-2"><RadioGroupItem value="all" id="ds-all" /><Label htmlFor="ds-all" className="font-normal">{t("rolesPerms.scopeAll")}</Label></div>
                      <div className="flex items-center gap-2"><RadioGroupItem value="department" id="ds-dept" /><Label htmlFor="ds-dept" className="font-normal">{t("rolesPerms.scopeDepartment")}</Label></div>
                      <div className="flex items-center gap-2"><RadioGroupItem value="own" id="ds-own" /><Label htmlFor="ds-own" className="font-normal">{t("rolesPerms.scopeOwn")}</Label></div>
                    </RadioGroup>
                  </div>
                </div>

                {/* C. Sidebar */}
                <div className="border rounded-lg p-4 space-y-3 md:col-span-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider border-b pb-2">{t("rolesPerms.sidebarAccess")}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {SIDEBAR_LABELS.map((s) => (
                      <div key={s.key} className="flex items-center gap-2">
                        <Checkbox
                          id={`sb-${s.key}`}
                          checked={form.permissions.sidebar[s.key]}
                          onCheckedChange={(v) => updateSidebar(s.key, !!v)}
                        />
                        <Label htmlFor={`sb-${s.key}`} className="font-normal text-sm cursor-pointer flex items-center gap-1.5">
                          {s.icon === "bot" && <Bot className="h-3.5 w-3.5 text-primary" />}
                          {s.icon === "play" && <PlayCircle className="h-3.5 w-3.5 text-primary" />}

                          {t(s.labelKey)}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* D. Department restriction */}
                <div className="border rounded-lg p-4 space-y-3 md:col-span-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider border-b pb-2">{t("rolesPerms.departmentRestriction")}</h4>
                  <RadioGroup
                    value={form.permissions.department}
                    onValueChange={(v) => setForm((f) => ({ ...f, permissions: { ...f.permissions, department: v as any } }))}
                  >
                    <div className="flex items-center gap-2"><RadioGroupItem value="all" id="dep-all" /><Label htmlFor="dep-all" className="font-normal">{t("rolesPerms.accessAllDepartments")}</Label></div>
                    <div className="flex items-center gap-2"><RadioGroupItem value="own" id="dep-own" /><Label htmlFor="dep-own" className="font-normal">{t("rolesPerms.accessOwnDepartment")}</Label></div>
                  </RadioGroup>
                </div>

                {/* E. Plant / Unit Access Control */}
                <div className="border rounded-lg p-4 space-y-3 md:col-span-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider border-b pb-2">{t("rolesPerms.plantAccessControl")}</h4>

                  {/* Own Plant Only toggle */}
                  <div className="flex items-start justify-between gap-4 py-2 px-2 rounded border bg-muted/20">
                    <div className="space-y-1">
                      <Label className="font-normal text-sm">{t("rolesPerms.ownPlantOnly")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("rolesPerms.ownPlantOnlyHelp")}
                      </p>
                    </div>
                    <Switch
                      checked={ownPlantOnly}
                      onCheckedChange={(v) => setOwnPlantOnly(!!v)}
                    />
                  </div>

                  {ownPlantOnly && (
                    <div className="rounded border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                      ⚠️ {t("rolesPerms.ownPlantOnlyWarning")}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {t("rolesPerms.plantToggleHelp")}
                  </p>
                  <div
                    className="space-y-2 pt-1"
                    style={ownPlantOnly ? { opacity: 0.4, pointerEvents: "none" } : undefined}
                  >
                    {(units || []).length === 0 && (
                      <p className="text-sm text-muted-foreground">{t("rolesPerms.noUnits")}</p>
                    )}
                    {(units || []).map((u: any) => {
                      const on = !!plantAccess[u.name];
                      return (
                        <div key={u.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/40">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={on}
                              onCheckedChange={(v) => setPlantAccess((p) => ({ ...p, [u.name]: v }))}
                            />
                            <span className="text-sm font-medium">{u.name}</span>
                          </div>
                          <Badge
                            variant="outline"
                            className={on
                              ? "border-success text-success bg-success/10"
                              : "border-destructive/40 text-destructive bg-destructive/10"}
                          >
                            {on ? t("rolesPerms.active") : t("rolesPerms.noAccess")}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setFormOpen(false); setEditing(null); }}>{t("common.cancel")}</Button>
                <Button onClick={handleSave} disabled={upsertMutation.isPending}>
                  <Save className="h-4 w-4 mr-2" /> {editing ? t("rolesPerms.updateRole") : t("rolesPerms.saveRole")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>

      <AlertDialog open={!!deletingRole} onOpenChange={(o) => !o && setDeletingRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rolesPerms.deleteRoleTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rolesPerms.deleteRoleDesc", { role: deletingRole?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingRole && deleteMutation.mutate(deletingRole.id)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
