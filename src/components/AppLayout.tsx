import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Bell, CheckCheck, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { formatDate } from "@/utils/dateFormat";

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function AppLayout({ children, title }: AppLayoutProps) {
  const { user, allowedUnitNames } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notifOpen, setNotifOpen] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      return data || [];
    },
    enabled: !!user,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!user) return;
      await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Realtime updates for notifications
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, queryClient]);

  const unreadCount = notifications?.filter(n => !n.is_read).length || 0;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-20 h-16 flex items-center justify-between border-b border-border/70 bg-card/80 backdrop-blur-md px-6 shrink-0">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground rounded-lg" />
              {title && <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{title}</h1>}
            </div>
            <div className="flex items-center gap-2">
              {allowedUnitNames && allowedUnitNames.length > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="gap-1 border-primary/40 text-primary bg-primary/5 cursor-default">
                        <MapPin className="h-3 w-3" />
                        <span className="text-xs">{allowedUnitNames.join(", ")}</span>
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Your data access is restricted to: {allowedUnitNames.join(", ")}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <ThemeToggle />
              <Popover open={notifOpen} onOpenChange={setNotifOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative rounded-full hover:bg-muted transition-colors">
                    <Bell className="h-[18px] w-[18px]" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-3 border-b flex items-center justify-between">
                    <span className="font-semibold text-sm">Notifications</span>
                    {unreadCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => markAllRead.mutate()}
                      >
                        <CheckCheck className="h-3.5 w-3.5 mr-1" />
                        Mark all read
                      </Button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-auto">
                    {(notifications || []).length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground text-center">No notifications</p>
                    ) : (
                      notifications!.map(n => (
                        <div
                          key={n.id}
                          className={`relative p-3 pl-4 border-b last:border-0 cursor-pointer transition-colors ${
                            !n.is_read
                              ? "bg-primary/10 hover:bg-primary/15 border-l-2 border-l-primary"
                              : "hover:bg-muted/50"
                          }`}
                          onClick={() => {
                            if (!n.is_read) markRead.mutate(n.id);
                            if (n.ticket_id) navigate(`/ticket/${n.ticket_id}`);
                            setNotifOpen(false);
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className={`text-sm truncate ${!n.is_read ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
                                  {n.title}
                                </p>
                                {!n.is_read && (
                                  <span className="h-2 w-2 rounded-full bg-primary shrink-0 animate-pulse" aria-label="Unread" />
                                )}
                              </div>
                              <p className={`text-xs mt-0.5 ${!n.is_read ? "text-foreground/70" : "text-muted-foreground"}`}>
                                {n.message}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-1">{formatDate(n.created_at, true)}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 bg-background bg-grid-pattern animate-fade-in">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
