import { lazy, Suspense } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { PermissionsProvider } from "@/contexts/PermissionsContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import { TicketDetailPanel } from "@/components/TicketDetailPanel";

// Route pages are code-split so each loads on demand — keeps the initial
// bundle small and the first paint fast. Login stays eager (entry point).
const Index = lazy(() => import("./pages/Index"));
const Analytics = lazy(() => import("./pages/Analytics"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CreateTicket = lazy(() => import("./pages/CreateTicket"));
const MyTickets = lazy(() => import("./pages/MyTickets"));
const TicketDetail = lazy(() => import("./pages/TicketDetail"));
const PendingTickets = lazy(() => import("./pages/PendingTickets"));
const AssignedTickets = lazy(() => import("./pages/AssignedTickets"));
const DepartmentTickets = lazy(() => import("./pages/DepartmentTickets"));
const Reports = lazy(() => import("./pages/Reports"));
const ManageUsers = lazy(() => import("./pages/ManageUsers"));
const Settings = lazy(() => import("./pages/Settings"));
const PCReview = lazy(() => import("./pages/PCReview"));
const MyProfile = lazy(() => import("./pages/MyProfile"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const Tutorials = lazy(() => import("./pages/Tutorials"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="flex h-screen w-full items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="theme">
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <PermissionsProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
                <Route path="/analytics" element={<ProtectedRoute permissionKey="analytics"><Analytics /></ProtectedRoute>} />
                <Route path="/ai-assistant" element={<ProtectedRoute><AIAssistant /></ProtectedRoute>} />
                <Route path="/ai-assistant/:conversationId" element={<ProtectedRoute><AIAssistant /></ProtectedRoute>} />
                <Route path="/tutorials" element={<ProtectedRoute permissionKey="tutorialVideos"><Tutorials /></ProtectedRoute>} />

                <Route path="/create-ticket" element={<ProtectedRoute permissionKey="createTicket"><CreateTicket /></ProtectedRoute>} />
                <Route path="/my-tickets" element={<ProtectedRoute permissionKey="myTickets"><MyTickets /></ProtectedRoute>} />
                <Route path="/ticket/:id" element={<ProtectedRoute><TicketDetail /></ProtectedRoute>} />
                <Route path="/pending-tickets" element={<ProtectedRoute permissionKey="pendingTickets"><PendingTickets /></ProtectedRoute>} />
                <Route path="/assigned-tickets" element={<ProtectedRoute permissionKey="assignedTickets"><AssignedTickets /></ProtectedRoute>} />
                <Route path="/department-tickets" element={<ProtectedRoute permissionKey="departmentTickets"><DepartmentTickets /></ProtectedRoute>} />
                <Route path="/pc-review" element={<ProtectedRoute permissionKey="pcReview"><PCReview /></ProtectedRoute>} />
                <Route path="/reports" element={<ProtectedRoute permissionKey="summary"><Reports /></ProtectedRoute>} />
                <Route path="/manage-users" element={<ProtectedRoute permissionKey="manageUsers"><ManageUsers /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute permissionKey="settings"><Settings /></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><MyProfile /></ProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            <TicketDetailPanel />
          </BrowserRouter>
        </TooltipProvider>
      </PermissionsProvider>
    </AuthProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
