export interface Employee {
  id: string; // 8-digit Employee ID
  pin: string; // 6-digit PIN
  name: string;
  lastName: string;
  position: string;
  jobPosition: string;
  department: string;
  status: "Active" | "Inactive";
  role: string; // admin, leader, user_production, user_store, user_planning, sales, or custom
  shiftWork: "DAY" | "NIGHT";
  fixedDayShift?: boolean;
  approved?: boolean;
  avatarUrl?: string;
  phone?: string;
}

export interface Product {
  id: string; // Composite "Customer-PartNo"
  sapNo: string;
  zone: string;
  customer: string;
  partNo: string;
  partName: string;
  fullBox: number;
  packageType: string;
  openingStock: number; // ยอดยกมา
  receivedTotal: number; // รับรวม
  shippedTotal: number; // โอนรวม
  stock: number; // คงเหลือ (opening + received - shipped)
  boxSize?: string; // ขนาดกล่อง (S, M, L, XL etc.)
}

export interface InventoryTransaction {
  id: string;
  labelId: string;
  partNo: string;
  partName: string;
  customer: string;
  subCustomer?: string | null; // สำหรับกลุ่ม BOI (SAMBO, AMAKASAKI, etc.)
  type: "in" | "out" | "adj_in" | "adj_out";
  subType: string; // "รับเข้าจากฝ่ายผลิต" etc. / "ส่งสโตร์ FG", "เบิกงาน Rework", "เบิกงานจาก TN" etc.
  qty: number;
  location: string;
  shift: string;
  operatorId: string;
  operatorName: string;
  timestamp: any; // Timestamp or Date
  printed?: boolean; // "Printed" status for transfer documents
}

export interface AdjustRequest {
  id: string;
  partNo: string;
  partName: string;
  subCustomer?: string | null; // สำหรับกลุ่ม BOI
  currentStock: number;
  actualStock: number;
  difference: number;
  requesterId: string;
  requesterName: string;
  timestamp: any;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  approvedTimestamp?: any;
}

export interface DepositWithdrawal {
  id: string;
  partNo: string;
  partName: string;
  customer: string;
  qty: number;
  type: "deposit" | "withdraw";
  status: "pending" | "verified"; // deposit/withdraw pending verification by store
  operatorId: string;
  operatorName: string;
  timestamp: any;
  verifiedBy?: string;
  verifiedTimestamp?: any;
}

export interface TimeAttendance {
  id: string; // "empId_YYYY-MM-DD"
  empId: string;
  empName: string;
  date: string; // "YYYY-MM-DD"
  checkIn?: string; // "08:15"
  checkOut?: string; // "20:30"
  shift: "DAY" | "NIGHT";
  workHours: number;
  otHours: number;
  requests?: AttendanceRequest[];
}

export interface AttendanceRequest {
  id: string;
  type: "forgot_time" | "leave";
  requestType: string; // "ลืมสแกนนิ้ว", "ลากิจ", "ลาป่วย", "ลาพักร้อน"
  detail: string;
  proposedCheckIn?: string;
  proposedCheckOut?: string;
  status: "pending" | "approved" | "rejected";
  timestamp: any;
}

export interface LocationItem {
  id: string;
  name: string;
  created: any;
}
