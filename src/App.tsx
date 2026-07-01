import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { Employee } from "./types";
import { seedDatabaseIfEmpty } from "./utils/seed";
import {
  DashboardView,
  StockInView,
  StockOutView,
  ProductsView,
  EmployeesView,
  AdjustView,
  DepositWithdrawView,
  ReportsView,
  SettingsView,
  AttendanceView,
} from "./components";
import {
  LayoutDashboard,
  ArrowDownLeft,
  ArrowUpRight,
  Package,
  Users,
  Sliders,
  Database,
  Printer,
  CalendarCheck2,
  Settings as SettingsIcon,
  LogOut,
  Lock,
  UserPlus2,
  Key,
} from "lucide-react";

export default function App() {
  // Session State
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  // Active Screen Navigation
  const [activeTab, setActiveTab] = useState<string>("dashboard");

  // Login inputs
  const [loginId, setLoginId] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [loginError, setLoginError] = useState("");

  // Quick Register Modal inside login
  const [showRegister, setShowRegister] = useState(false);
  const [regId, setRegId] = useState("");
  const [regPin, setRegPin] = useState("");
  const [regName, setRegName] = useState("");
  const [regLastName, setRegLastName] = useState("");
  const [regDept, setRegDept] = useState("ฝ่ายผลิต");
  const [regRole, setRegRole] = useState("user_production");

  // Run Seeder and resolve user sessions
  useEffect(() => {
    const initApp = async () => {
      // 1. Seed database if empty
      await seedDatabaseIfEmpty();

      // 2. Check localStorage session
      const savedSession = localStorage.getItem("wsm_user_session");
      if (savedSession) {
        try {
          const parsed = JSON.parse(savedSession) as Employee;
          // Verify with DB to make sure user still active
          const docRef = doc(db, "employees", parsed.id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const liveData = docSnap.data() as Employee;
            if (liveData.status === "Active") {
              setCurrentUser(liveData);
            } else {
              localStorage.removeItem("wsm_user_session");
            }
          }
        } catch (err) {
          console.error(err);
        }
      }
      setLoading(false);
    };

    initApp();
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");

    if (!loginId || loginId.length !== 8) {
      setLoginError("รหัสพนักงานต้องเป็นตัวเลข 8 หลัก");
      return;
    }
    if (!loginPin || loginPin.length !== 6) {
      setLoginError("รหัส PIN ส่วนตัวต้องมี 6 หลัก");
      return;
    }

    try {
      const docRef = doc(db, "employees", loginId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const empData = docSnap.data() as Employee;
        if (empData.status !== "Active") {
          setLoginError("สถานะบัญชีนี้ถูกระงับ กรุณาติดต่อหัวหน้างาน");
          return;
        }

        if (empData.pin === loginPin) {
          setCurrentUser(empData);
          localStorage.setItem("wsm_user_session", JSON.stringify(empData));
        } else {
          setLoginError("รหัส PIN ความปลอดภัยไม่ถูกต้อง");
        }
      } else {
        setLoginError("ไม่พบรายชื่อพนักงานรหัสนี้ในฐานข้อมูลระบบ");
      }
    } catch (err) {
      console.error(err);
      setLoginError("เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล");
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("wsm_user_session");
    setActiveTab("dashboard");
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regId.length !== 8 || regPin.length !== 6 || !regName || !regLastName) {
      alert("กรุณากรอกข้อมูลให้ตรงเงื่อนไขและถูกต้อง");
      return;
    }

    const newEmp: Employee = {
      id: regId,
      pin: regPin,
      name: regName,
      lastName: regLastName,
      position: "Operator",
      jobPosition: "พนักงานลงทะเบียนใหม่",
      department: regDept,
      status: "Active",
      role: regRole,
      shiftWork: "DAY",
    };

    try {
      await setDoc(doc(db, "employees", regId), newEmp);
      alert("ลงทะเบียนพนักงานใหม่สำเร็จ! คุณสามารถลงชื่อเข้างานได้ทันที");
      setShowRegister(false);
      setLoginId(regId);
      setLoginPin(regPin);
    } catch (err) {
      console.error(err);
      alert("ไม่สามารถสร้างบัญชีได้");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-semibold text-gray-500 tracking-wider">กำลังเชื่อมโยงฐานข้อมูลคลาวด์ WSM-DUNAN...</p>
      </div>
    );
  }

  // LOGIN SCREEN
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden font-sans">
        {/* Brand Background decorations */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-red-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-red-800/15 rounded-full blur-3xl pointer-events-none"></div>

        <div className="w-full max-w-md bg-white border border-gray-100 shadow-2xl rounded-3xl overflow-hidden relative z-10 flex flex-col">
          {/* Header Banner */}
          <div className="bg-gradient-to-br from-red-600 to-red-700 p-8 text-white text-center relative">
            <div className="absolute top-3 left-3 bg-white/10 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-widest uppercase">
              WSM-DUNAN
            </div>
            <h1 className="text-2xl font-bold tracking-tight uppercase mt-4">STOCK CENTER</h1>
            <p className="text-xs text-red-100 font-medium mt-1">ระบบจัดการสต๊อกและตารางทำงานพนักงานเรียลไทม์</p>
          </div>

          {/* Form */}
          <form onSubmit={handleLoginSubmit} className="p-8 space-y-5">
            {loginError && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block">รหัสพนักงาน (8 หลัก)</label>
              <input
                type="text"
                maxLength={8}
                required
                placeholder="ป้อนรหัสพนักงาน เช่น 00000001"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value.replace(/\D/g, ""))}
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block">ความปลอดภัย PIN (6 หลัก)</label>
              <input
                type="password"
                maxLength={6}
                required
                placeholder="ป้อนรหัส PIN ส่วนตัว เช่น 123456"
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ""))}
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition font-mono font-bold"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-black hover:bg-gray-800 text-white font-bold py-3.5 rounded-2xl transition cursor-pointer shadow-lg shadow-black/10 text-sm mt-2"
            >
              เข้าสู่ระบบแบบปลอดภัย
            </button>

            <div className="border-t border-gray-100 my-4" />

            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowRegister(true)}
                className="text-xs font-bold text-red-600 hover:underline flex items-center justify-center gap-1.5 mx-auto"
              >
                <UserPlus2 className="w-4 h-4" />
                <span>ขึ้นทะเบียนพนักงานใหม่ (สมัครพนักงานสำหรับการทดสอบ)</span>
              </button>
            </div>
          </form>
        </div>

        {/* QUICK REGISTER OVERLAY MODAL */}
        {showRegister && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs">
            <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col">
              <div className="bg-gradient-to-r from-red-600 to-red-700 p-6 text-white flex justify-between items-center">
                <span className="font-bold flex items-center gap-2">
                  <UserPlus2 className="w-5 h-5" /> ขึ้นทะเบียนพนักงานใหม่
                </span>
                <button
                  type="button"
                  onClick={() => setShowRegister(false)}
                  className="hover:bg-red-800 p-1 rounded-full text-white/80"
                >
                  <X />
                </button>
              </div>

              <form onSubmit={handleRegisterSubmit} className="p-6 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">รหัสพนักงาน (8 หลัก) *</label>
                    <input
                      type="text"
                      maxLength={8}
                      required
                      placeholder="เช่น 00000009"
                      value={regId}
                      onChange={(e) => setRegId(e.target.value.replace(/\D/g, ""))}
                      className="w-full mt-1 px-3 py-2 border rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">PIN (6 หลัก) *</label>
                    <input
                      type="password"
                      maxLength={6}
                      required
                      placeholder="เช่น 654321"
                      value={regPin}
                      onChange={(e) => setRegPin(e.target.value.replace(/\D/g, ""))}
                      className="w-full mt-1 px-3 py-2 border rounded-xl font-mono text-center tracking-widest font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">ชื่อจริง *</label>
                    <input
                      type="text"
                      required
                      placeholder="ภาษาไทย"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="w-full mt-1 px-3 py-2 border rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">นามสกุล *</label>
                    <input
                      type="text"
                      required
                      placeholder="ภาษาไทย"
                      value={regLastName}
                      onChange={(e) => setRegLastName(e.target.value)}
                      className="w-full mt-1 px-3 py-2 border rounded-xl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">แผนกงาน (Dept)</label>
                    <select
                      value={regDept}
                      onChange={(e) => setRegDept(e.target.value)}
                      className="w-full mt-1 px-3 py-2 border rounded-xl"
                    >
                      <option value="ฝ่ายผลิต">ฝ่ายผลิต</option>
                      <option value="สโตร์กลาง">สโตร์กลาง</option>
                      <option value="สโตร์ FG">สโตร์ FG</option>
                      <option value="Planning">Planning</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">สิทธิ์พนักงาน (Role)</label>
                    <select
                      value={regRole}
                      onChange={(e) => setRegRole(e.target.value)}
                      className="w-full mt-1 px-3 py-2 border rounded-xl"
                    >
                      <option value="admin">Admin (ผู้ดูแลระบบ)</option>
                      <option value="leader">Leader (หัวหน้างาน)</option>
                      <option value="user_store">Store Keeper (เจ้าหน้าที่สโตร์)</option>
                      <option value="user_production">Production Operator</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2.5 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowRegister(false)}
                    className="flex-1 border py-2.5 rounded-xl font-semibold"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-bold hover:bg-red-700 transition"
                  >
                    ขึ้นทะเบียนสำเร็จ
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // RENDER MAIN FULL-STACK SPA INTERFACE
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row font-sans text-slate-900 overflow-hidden">
      {/* Mobile top navbar */}
      <header className="md:hidden bg-[#111] text-white h-16 shrink-0 flex justify-between items-center px-4 border-b border-white/10 print:hidden sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-red-600 flex items-center justify-center rounded">
            <div className="w-3.5 h-3.5 bg-white rounded-sm"></div>
          </div>
          <span className="font-bold text-sm tracking-tight text-white">WSM-DUNAN</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] font-bold text-white">{currentUser.name}</p>
            <p className="text-[8px] text-slate-400 uppercase tracking-wider">{currentUser.role}</p>
          </div>
          <button onClick={handleLogout} className="text-slate-400 hover:text-white transition p-1">
            <LogOut className="w-4 h-4 text-red-500" />
          </button>
        </div>
      </header>

      {/* Left Sidebar on Desktop */}
      <aside className="w-66 bg-[#111] shrink-0 border-r border-white/5 flex flex-col justify-between p-5 text-slate-400 print:hidden overflow-y-auto hidden md:flex">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-8 h-8 bg-red-600 flex items-center justify-center rounded-lg shadow-md shadow-red-600/20">
              <div className="w-4 h-4 bg-white rounded-sm"></div>
            </div>
            <h1 className="text-white font-bold text-lg tracking-tight">WSM-DUNAN</h1>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase px-3 block mb-2">เมนูการทำรายการ</span>

            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "dashboard" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>แดชบอร์ด</span>
            </button>

            <button
              onClick={() => setActiveTab("stock_in")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "stock_in" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <ArrowDownLeft className="w-4 h-4 shrink-0" />
              <span>บันทึกรับเข้าสินค้า (In)</span>
            </button>

            <button
              onClick={() => setActiveTab("stock_out")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "stock_out" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <ArrowUpRight className="w-4 h-4 shrink-0" />
              <span>โอนออกสินค้า (Out)</span>
            </button>

            <button
              onClick={() => setActiveTab("products_master")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "products_master" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Package className="w-4 h-4 shrink-0" />
              <span>ทะเบียนสินค้า (Master)</span>
            </button>

            <button
              onClick={() => setActiveTab("stock_adjust")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "stock_adjust" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Sliders className="w-4 h-4 shrink-0" />
              <span>ตรวจนับปรับสต๊อก (Adjust)</span>
            </button>

            <button
              onClick={() => setActiveTab("deposit_withdraw")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "deposit_withdraw" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>ฝากและเบิกอะไหล่แยก</span>
            </button>

            <button
              onClick={() => setActiveTab("reports_print")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "reports_print" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>รายงานและพิมพ์ใบโอนย้าย</span>
            </button>

            <div className="pt-3 pb-1 border-t border-white/5 my-2" />

            <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase px-3 block mb-2">พนักงาน & ระบบ</span>

            <button
              onClick={() => setActiveTab("time_attendance")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "time_attendance" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <CalendarCheck2 className="w-4 h-4 shrink-0" />
              <span>เช็คอิน & จัดกะพนักงาน</span>
            </button>

            <button
              onClick={() => setActiveTab("employees_permissions")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "employees_permissions" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>จัดการรายชื่อและสิทธิ์</span>
            </button>

            <button
              onClick={() => setActiveTab("settings")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "settings" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <SettingsIcon className="w-4 h-4 shrink-0" />
              <span>ตั้งค่าระบบ</span>
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="p-4 border border-white/5 bg-black/20 rounded-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-white uppercase shadow-inner shrink-0">
                {currentUser.name.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white font-semibold truncate">{currentUser.name} {currentUser.lastName}</p>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest truncate font-semibold">{currentUser.jobPosition || currentUser.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white/5 hover:bg-red-950/20 hover:text-red-400 text-slate-400 font-semibold text-[11px] transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-red-500" />
              <span>ออกจากระบบ</span>
            </button>
          </div>

          <div className="text-[10px] text-slate-600 border-t border-white/5 pt-3 leading-normal px-1">
            <p className="font-bold text-slate-500">WSM-DUNAN CENTER</p>
            <p>เวอร์ชัน: v2.5.0 Stable Release</p>
          </div>
        </div>
      </aside>

      {/* Dynamic Content Panel */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col h-full">
        {/* Mobile Bottom Navigation Toggle helper */}
        <div className="md:hidden flex flex-wrap gap-1 bg-black p-2 rounded-2xl mb-4 text-[11px] font-bold text-slate-300 print:hidden shadow-lg">
          <button onClick={() => setActiveTab("dashboard")} className={`px-2.5 py-1.5 rounded-lg transition-colors ${activeTab === "dashboard" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>บอร์ด</button>
          <button onClick={() => setActiveTab("stock_in")} className={`px-2.5 py-1.5 rounded-lg transition-colors ${activeTab === "stock_in" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>รับเข้า</button>
          <button onClick={() => setActiveTab("stock_out")} className={`px-2.5 py-1.5 rounded-lg transition-colors ${activeTab === "stock_out" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>โอนออก</button>
          <button onClick={() => setActiveTab("products_master")} className={`px-2.5 py-1.5 rounded-lg transition-colors ${activeTab === "products_master" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>พาร์ท</button>
          <button onClick={() => setActiveTab("reports_print")} className={`px-2.5 py-1.5 rounded-lg transition-colors ${activeTab === "reports_print" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>รายงาน</button>
          <button onClick={() => setActiveTab("time_attendance")} className={`px-2.5 py-1.5 rounded-lg transition-colors ${activeTab === "time_attendance" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>กะ/เช็คอิน</button>
          <button onClick={() => setActiveTab("settings")} className={`px-2.5 py-1.5 rounded-lg transition-colors ${activeTab === "settings" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>ตั้งค่า</button>
        </div>

        <div className="flex-1">
          {activeTab === "dashboard" && <DashboardView />}
          {activeTab === "stock_in" && <StockInView currentUser={currentUser} />}
          {activeTab === "stock_out" && <StockOutView currentUser={currentUser} />}
          {activeTab === "products_master" && <ProductsView />}
          {activeTab === "employees_permissions" && <EmployeesView currentUser={currentUser} />}
          {activeTab === "stock_adjust" && <AdjustView currentUser={currentUser} />}
          {activeTab === "deposit_withdraw" && <DepositWithdrawView currentUser={currentUser} />}
          {activeTab === "reports_print" && <ReportsView currentUser={currentUser} />}
          {activeTab === "settings" && <SettingsView currentUser={currentUser} />}
          {activeTab === "time_attendance" && <AttendanceView currentUser={currentUser} />}
        </div>
      </main>
    </div>
  );
}

function X(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );
}
