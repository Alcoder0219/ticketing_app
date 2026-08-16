import {
  LayoutDashboard,
  LineChart,
  PlusCircle,
  Ticket,
  Clock,
  ClipboardList,
  Building2,
  BarChart3,
  ShieldCheck,
  Settings,
  Users,
  LogOut,
  UserCircle,
  Bot,
  PlayCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "@/components/NavLink";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions, Permissions } from "@/contexts/PermissionsContext";
import { supabase } from "@/integrations/api/client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

type AppRole = "super_admin" | "admin" | "hod" | "user" | "assigned_person";

interface NavItem {
  /** i18n key under `nav.*`; resolved at render time so it follows the active language. */
  titleKey: string;
  url: string;
  icon: typeof LayoutDashboard;
  roles?: AppRole[];
  permissionKey?: keyof Permissions["sidebar"];
}

const allNav: NavItem[] = [
  { titleKey: "nav.aiAssistant", url: "/ai-assistant", icon: Bot, permissionKey: "aiAssistant" },
  { titleKey: "nav.overview", url: "/", icon: LayoutDashboard, permissionKey: "overview" },

  { titleKey: "nav.myProfile", url: "/profile", icon: UserCircle },
  { titleKey: "nav.analytics", url: "/analytics", icon: LineChart, permissionKey: "analytics" },
  { titleKey: "nav.summary", url: "/reports", icon: BarChart3, permissionKey: "summary" },
  { titleKey: "nav.createTicket", url: "/create-ticket", icon: PlusCircle, permissionKey: "createTicket" },
  { titleKey: "nav.myTickets", url: "/my-tickets", icon: Ticket, permissionKey: "myTickets" },
  { titleKey: "nav.pendingTickets", url: "/pending-tickets", icon: Clock, permissionKey: "pendingTickets" },
  { titleKey: "nav.assignedTickets", url: "/assigned-tickets", icon: ClipboardList, permissionKey: "assignedTickets" },
  { titleKey: "nav.departmentTickets", url: "/department-tickets", icon: Building2, permissionKey: "departmentTickets" },
  { titleKey: "nav.pcReview", url: "/pc-review", icon: ShieldCheck, permissionKey: "pcReview" },
  { titleKey: "nav.tutorialVideos", url: "/tutorials", icon: PlayCircle, permissionKey: "tutorialVideos" },
];

const adminNav: NavItem[] = [
  { titleKey: "nav.manageUsers", url: "/manage-users", icon: Users, permissionKey: "manageUsers" },
  { titleKey: "nav.settings", url: "/settings", icon: Settings, permissionKey: "settings" },
];

function hasAccess(item: NavItem, userRole: AppRole | null, permissions: Permissions, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true;
  // Hard role gate first (preserves existing behavior)
  if (item.roles && (!userRole || !item.roles.includes(userRole))) return false;
  // Then dynamic permission gate (from roles table)
  if (item.permissionKey && !permissions?.sidebar?.[item.permissionKey]) return false;
  return true;
}

export function AppSidebar() {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, role, signOut } = useAuth();
  const { permissions, isSuperAdmin } = usePermissions();
  const isActive = (path: string) => location.pathname === path;
  const initials = profile?.name?.split(" ").map(n => n[0]).join("") || "?";

  const [hasNewTutorials, setHasNewTutorials] = useState(false);
  useEffect(() => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from("tutorial_videos" as any)
      .select("id", { count: "exact", head: true })
      .eq("is_published", true)
      .gte("created_at", since)
      .then(({ count }) => setHasNewTutorials((count ?? 0) > 0));
  }, []);

  const visibleMain = allNav.filter(item => hasAccess(item, role, permissions, isSuperAdmin));
  const visibleAdmin = adminNav.filter(item => hasAccess(item, role, permissions, isSuperAdmin));


  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1">
              <img src="/amsons-logo.png" alt="Amsons Group" className="h-full w-full object-contain" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-sidebar-foreground tracking-tight leading-tight">Amsons Group</h2>
              <p className="text-[10px] text-sidebar-muted-foreground tracking-wide uppercase">{t("nav.supportPortal")}</p>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white p-0.5">
              <img src="/amsons-logo.png" alt="Amsons Group" className="h-full w-full object-contain" />
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 mt-3 mb-1 text-sidebar-muted-foreground text-[10px] uppercase tracking-[0.18em] font-semibold">
            {!collapsed && t("nav.main")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMain.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={t(item.titleKey)}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="rounded-lg transition-all duration-200 hover:bg-sidebar-accent hover:translate-x-0.5 group relative"
                      activeClassName="bg-primary/15 text-white font-medium shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{t(item.titleKey)}</span>}
                      {!collapsed && item.url === "/tutorials" && hasNewTutorials && (
                        <Badge className="ml-auto h-4 px-1.5 text-[9px] bg-emerald-500 text-white border-0">{t("nav.new")}</Badge>
                      )}

                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleAdmin.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 mt-3 mb-1 text-sidebar-muted-foreground text-[10px] uppercase tracking-[0.18em] font-semibold">
              {!collapsed && t("nav.administration")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleAdmin.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={t(item.titleKey)}>
                      <NavLink
                        to={item.url}
                        className="hover:bg-sidebar-accent transition-all duration-200 group relative"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium border-l-2 border-l-sidebar-primary"
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{t(item.titleKey)}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2 rounded-xl bg-sidebar-accent/40 p-1.5 ring-1 ring-sidebar-border/60">
          <Link
            to="/profile"
            title={t("nav.editProfile")}
            className="flex items-center gap-3 flex-1 min-w-0 rounded-md p-1.5 -m-1.5 hover:bg-sidebar-accent transition-colors cursor-pointer"
          >
            <Avatar className="h-9 w-9 shrink-0 ring-2 ring-sidebar-primary/30">
              {(profile as any)?.profile_picture && <AvatarImage src={(profile as any).profile_picture} alt={profile?.name || ""} />}
              <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate flex items-center gap-1.5">
                  {profile?.name || t("common.loading")}
                  <UserCircle className="h-3 w-3 text-sidebar-muted-foreground" />
                </p>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-sidebar-primary/40 text-sidebar-primary font-medium">
                  {role ? t(`roles.${role}`, { defaultValue: role }) : ""}
                </Badge>

              </div>
            )}
          </Link>
          {!collapsed && (
            <button onClick={handleLogout} title={t("nav.logout")} className="text-sidebar-muted-foreground hover:text-sidebar-foreground transition-colors p-1.5 rounded-md hover:bg-sidebar-accent shrink-0">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
