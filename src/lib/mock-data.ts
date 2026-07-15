export type TicketStatus = "Open" | "In Progress" | "Resolved" | "Closed" | "Reopened";
export type TicketPriority = "low" | "medium" | "high" | "critical";
export type UserRole = "super_admin" | "admin" | "hod" | "user" | "assigned_person";

export interface User {
  id: string;
  name: string;
  username: string;
  employeeId: string;
  role: UserRole;
  department: string;
  contact: string;
  email: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  unit: string;
  department: string;
  issueDepartment: string;
  status: TicketStatus;
  priority: TicketPriority;
  raisedBy: User;
  assignedTo?: User;
  targetDate?: string;
  nextTargetDate?: string;
  remarks?: string;
  raisedAt: string;
  closedAt?: string;
  closedBy?: string;
  closingRemarks?: string;
  reopenedAt?: string;
  reopenRemarks?: string;
  rating?: number;
  feedback?: string;
  photoUrl?: string;
  reopenPhotoUrl?: string;
}

export interface TicketHistory {
  id: string;
  ticketId: string;
  action: string;
  performedBy: string;
  timestamp: string;
  remarks?: string;
  oldStatus?: TicketStatus;
  newStatus?: TicketStatus;
}

export const statusMap: Record<string, TicketStatus> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
};

export const priorityMap: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const statusColor: Record<TicketStatus, string> = {
  "Open": "status-badge-open",
  "In Progress": "status-badge-in-progress",
  "Resolved": "status-badge-resolved",
  "Closed": "status-badge-closed",
  "Reopened": "status-badge-reopened",
};

export const priorityColor: Record<string, string> = {
  low: "bg-green-100 text-green-700 border-green-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  critical: "bg-red-100 text-red-700 border-red-200",
};

export const currentUser: User = {
  id: "u1",
  name: "Rahul Sharma",
  username: "rahul.sharma",
  employeeId: "EMP-1024",
  role: "hod",
  department: "IT Department",
  contact: "+91 98765 43210",
  email: "rahul@company.com",
};

export const departments = [
  "IT Department",
  "HR Department",
  "Finance Department",
  "Operations",
  "Maintenance",
  "Administration",
  "Security",
];

export const units = ["Unit A", "Unit B", "Unit C", "Head Office"];

export const dashboardStats = {
  total: 6,
  open: 1,
  inProgress: 2,
  resolved: 1,
  closed: 1,
  reopened: 1,
};
