import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { Employee, NotificationItem } from "./types";
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
  ShieldAlert,
  Monitor,
  Bell,
  X as XIcon,
} from "lucide-react";

export default function App() {
  // Windows 7 / Old Browser Compatibility Mode State
  const [win7Mode, setWin7Mode] = useState<boolean>(() => {
    const stored = localStorage.getItem("win7_compatibility_mode");
    if (stored !== null) return stored === "true";
    // Proactive auto-detection of Windows 7 (NT 6.1), Vista (NT 6.0), or older Windows NT versions
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      const ua = navigator.userAgent;
      const isOldWin = ua.includes("Windows NT 6.1") || ua.includes("Windows NT 6.0") || ua.includes("Windows NT 5.");
      return isOldWin;
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem("win7_compatibility_mode", win7Mode ? "true" : "false");
    if (win7Mode) {
      document.documentElement.classList.add("win7-mode");
      document.body.classList.add("win7-mode");
    } else {
      document.documentElement.classList.remove("win7-mode");
      document.body.classList.remove("win7-mode");
    }
  }, [win7Mode]);

  // Session State
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  // Active Screen Navigation
  const [activeTab, setActiveTab] = useState<string>("dashboard");

  // Notifications State
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);

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

  // Force change PIN states
  const [newPin, setNewPin] = useState("");
  const [confirmNewPin, setConfirmNewPin] = useState("");
  const [changePinError, setChangePinError] = useState("");

  const handleForceChangePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePinError("");

    if (!currentUser) return;

    if (newPin.length !== 6 || confirmNewPin.length !== 6) {
      setChangePinError("รหัส PIN จะต้องมีตัวเลขความยาว 6 หลัก");
      return;
    }
    if (newPin === "123456") {
      setChangePinError("คุณไม่สามารถใช้รหัสเริ่มต้น '123456' เป็นรหัสผ่านใหม่ได้");
      return;
    }
    if (newPin !== confirmNewPin) {
      setChangePinError("รหัสผ่านใหม่และรหัสยืนยันไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง");
      return;
    }

    try {
      const docRef = doc(db, "employees", currentUser.id);
      await updateDoc(docRef, { pin: newPin });

      const updatedUser = { ...currentUser, pin: newPin };
      setCurrentUser(updatedUser);
      localStorage.setItem("wsm_user_session", JSON.stringify(updatedUser));

      alert("🎉 ยินดีด้วย! เปลี่ยนรหัส PIN ความปลอดภัยส่วนบุคคลเรียบร้อยแล้ว ระบบกำลังนำทางท่านเข้าสู่ระบบ");
      setNewPin("");
      setConfirmNewPin("");
    } catch (err) {
      console.error(err);
      setChangePinError("เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ในการแก้ไขรหัส PIN");
    }
  };

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

  // Real-time synchronization for the logged-in user's profile
  useEffect(() => {
    if (!currentUser?.id) return;
    const unsubscribe = onSnapshot(doc(db, "employees", currentUser.id), (snapshot) => {
      if (snapshot.exists()) {
        const liveData = snapshot.data() as Employee;
        setCurrentUser(liveData);
        localStorage.setItem("wsm_user_session", JSON.stringify(liveData));
      }
    });
    return () => unsubscribe();
  }, [currentUser?.id]);

  // Toast trigger and synthesizer beep helper
  const triggerToast = (notif: NotificationItem) => {
    setToasts((prev) => [...prev, notif]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== notif.id));
    }, 6000);

    try {
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);
      
      osc.frequency.setValueAtTime(587.33, context.currentTime); // D5
      osc.frequency.setValueAtTime(880, context.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.04, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
      osc.start();
      osc.stop(context.currentTime + 0.4);
    } catch (e) {
      console.warn("Audio Context sound blocked or failed", e);
    }
  };

  const formatNotifTime = (timestamp: any) => {
    if (!timestamp) return "เมื่อสักครู่";
    let date: Date;
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else {
      date = new Date(timestamp);
    }
    return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) + " น.";
  };

  // 1. Real-time Listener: Adjust Requests Collection
  useEffect(() => {
    if (!currentUser?.id) return;

    let isInitialAdjust = true;

    const unsubAdjust = onSnapshot(collection(db, "adjust_requests"), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const req = change.doc.data() as any;
        const reqId = change.doc.id;
        
        if (req.status === "approved" && req.requesterId === "00000000") return;

        if (change.type === "added") {
          if (isInitialAdjust) {
            const isApprover = ["admin", "leader"].includes(currentUser.role);
            if (req.status === "pending" && isApprover) {
              setNotifications((prev) => {
                if (prev.some((n) => n.id === `adj_req_${reqId}`)) return prev;
                return [
                  {
                    id: `adj_req_${reqId}`,
                    title: "คำขอปรับยอดคงค้าง",
                    message: `พนักงาน ${req.requesterName} ยื่นขอปรับสต๊อกพาร์ท ${req.partNo} (ผลต่าง ${req.difference} ชิ้น)`,
                    timestamp: req.timestamp?.toDate ? req.timestamp.toDate() : new Date(),
                    read: true,
                    type: "request",
                    linkTab: "stock_adjust",
                  },
                  ...prev,
                ];
              });
            }
          } else {
            const isApprover = ["admin", "leader"].includes(currentUser.role);
            if (req.status === "pending") {
              if (isApprover) {
                const newNotif: NotificationItem = {
                  id: `adj_req_${reqId}`,
                  title: "⚠️ มีคำขอปรับยอดใหม่",
                  message: `พนักงาน ${req.requesterName} ยื่นขอปรับสต๊อกพาร์ท ${req.partNo} (ผลต่าง ${req.difference} ชิ้น)`,
                  timestamp: new Date(),
                  read: false,
                  type: "request",
                  linkTab: "stock_adjust",
                };
                setNotifications((prev) => [newNotif, ...prev]);
                triggerToast(newNotif);
              }
            }
          }
        } else if (change.type === "modified") {
          if (req.requesterId === currentUser.id) {
            const statusText = req.status === "approved" ? "อนุมัติเรียบร้อย" : "ปฏิเสธคำขอ";
            const colorSymbol = req.status === "approved" ? "✅" : "❌";
            const newNotif: NotificationItem = {
              id: `adj_mod_${reqId}_${req.status}`,
              title: `${colorSymbol} คำขอปรับยอดของคุณได้รับการตรวจสอบ`,
              message: `คำขอปรับสต๊อกสำหรับพาร์ท ${req.partNo} ของคุณได้รับการ${statusText}โดยผู้ดูแล`,
              timestamp: new Date(),
              read: false,
              type: "approval",
              linkTab: "stock_adjust",
            };
            setNotifications((prev) => [newNotif, ...prev]);
            triggerToast(newNotif);
          }
          
          if (req.status !== "pending") {
            setNotifications((prev) =>
              prev.map((n) => (n.id === `adj_req_${reqId}` ? { ...n, read: true } : n))
            );
          }
        }
      });
      isInitialAdjust = false;
    });

    return () => {
      unsubAdjust();
    };
  }, [currentUser?.id, currentUser?.role]);

  // 2. Real-time Listener: Deposits & Withdrawals Collection
  useEffect(() => {
    if (!currentUser?.id) return;

    let isInitialDep = true;

    const unsubDep = onSnapshot(collection(db, "deposits_withdrawals"), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const rec = change.doc.data() as any;
        const recId = change.doc.id;

        if (change.type === "added") {
          if (isInitialDep) {
            const isStoreKeeper = ["admin", "user_store"].includes(currentUser.role);
            if (rec.status === "pending" && isStoreKeeper) {
              setNotifications((prev) => {
                if (prev.some((n) => n.id === `dep_req_${recId}`)) return prev;
                return [
                  {
                    id: `dep_req_${recId}`,
                    title: `คำขอฝาก/เบิกค้างตรวจสอบ`,
                    message: `พนักงาน ${rec.operatorName} ขอ${rec.type === "deposit" ? "ฝากชิ้นงาน" : "เบิกงาน"}พาร์ท ${rec.partNo} (${rec.qty} ชิ้น)`,
                    timestamp: rec.timestamp?.toDate ? rec.timestamp.toDate() : new Date(),
                    read: true,
                    type: "request",
                    linkTab: "deposit_withdraw",
                  },
                  ...prev,
                ];
              });
            }
          } else {
            const isStoreKeeper = ["admin", "user_store"].includes(currentUser.role);
            if (rec.status === "pending") {
              if (isStoreKeeper) {
                const typeText = rec.type === "deposit" ? "ฝากชิ้นงาน" : "เบิกคืนชิ้นงาน";
                const newNotif: NotificationItem = {
                  id: `dep_req_${recId}`,
                  title: `📦 มีคำขอ${rec.type === "deposit" ? "ฝาก" : "เบิก"}งานใหม่`,
                  message: `พนักงาน ${rec.operatorName} ยื่นขอ${typeText}พาร์ท ${rec.partNo} จำนวน ${rec.qty} ชิ้น`,
                  timestamp: new Date(),
                  read: false,
                  type: "request",
                  linkTab: "deposit_withdraw",
                };
                setNotifications((prev) => [newNotif, ...prev]);
                triggerToast(newNotif);
              }
            }
          }
        } else if (change.type === "modified") {
          if (rec.operatorId === currentUser.id) {
            const typeText = rec.type === "deposit" ? "ฝากงาน" : "เบิกงาน";
            const newNotif: NotificationItem = {
              id: `dep_mod_${recId}_${rec.status}`,
              title: `✅ คำขอ${typeText}ได้รับการตรวจสอบแล้ว`,
              message: `คำขอ${typeText}พาร์ท ${rec.partNo} (${rec.qty} ชิ้น) ได้รับการตรวจสอบและอนุมัติเข้าสโตร์แล้ว`,
              timestamp: new Date(),
              read: false,
              type: "approval",
              linkTab: "deposit_withdraw",
            };
            setNotifications((prev) => [newNotif, ...prev]);
            triggerToast(newNotif);
          }

          if (rec.status === "verified") {
            setNotifications((prev) =>
              prev.map((n) => (n.id === `dep_req_${recId}` ? { ...n, read: true } : n))
            );
          }
        }
      });
      isInitialDep = false;
    });

    return () => {
      unsubDep();
    };
  }, [currentUser?.id, currentUser?.role]);

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
      jobPosition: "พนักงานลงทะเบียนใหม่ (รออนุมัติ)",
      department: regDept,
      status: "Active",
      role: regRole,
      shiftWork: "DAY",
      approved: false,
    };

    try {
      await setDoc(doc(db, "employees", regId), newEmp);
      alert("ส่งคำขอลงทะเบียนสำเร็จ! บัญชีของคุณเริ่มต้นให้เข้าดูระบบได้เท่านั้น จนกว่าแอดมินจะยืนยันสิทธิ์เข้าถึงเต็มรูปแบบ");
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
                className="text-xs font-bold text-red-600 hover:underline flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
              >
                <UserPlus2 className="w-4 h-4" />
                <span>ส่งคำขอลงทะเบียน สมัครงานระบบใหม่</span>
              </button>
              <p className="text-[10px] text-gray-400 mt-1 max-w-xs mx-auto">
                * เริ่มต้นลงทะเบียนจะเข้าดูระบบได้เท่านั้น จนกว่าแอดมินจะยืนยันอนุมัติสิทธิ์เข้าถึง
              </p>
            </div>
          </form>
        </div>

        {/* QUICK REGISTER OVERLAY MODAL */}
        {showRegister && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs">
            <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col">
              <div className="bg-gradient-to-r from-red-600 to-red-700 p-6 text-white flex justify-between items-center">
                <span className="font-bold flex items-center gap-2">
                  <UserPlus2 className="w-5 h-5" /> ส่งคำขอลงทะเบียนสมัครพนักงาน
                </span>
                <button
                  type="button"
                  onClick={() => setShowRegister(false)}
                  className="hover:bg-red-800 p-1 rounded-full text-white/80 cursor-pointer"
                >
                  <X />
                </button>
              </div>

              <div className="bg-amber-50 text-amber-800 p-4 border-b border-amber-100 text-xs">
                ⚠️ <strong>เงื่อนไขสิทธิ์ระบบ:</strong> บัญชีลงทะเบียนใหม่จะเริ่มต้นด้วยสิทธิ์ <strong>เข้าดูระบบ (View Only)</strong> เท่านั้น จนกว่าแอดมินหรือหัวหน้างานจะตรวจเช็คและกดอนุมัติสิทธิ์เต็มรูปแบบในเมนูจัดการพนักงาน
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

  // FORCE CHANGE DEFAULT PIN SCREEN
  if (currentUser && currentUser.pin === "123456") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden font-sans">
        {/* Decorative background */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-red-800/15 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md bg-white border border-gray-100 shadow-2xl rounded-3xl overflow-hidden relative z-10 flex flex-col">
          {/* Header Banner */}
          <div className="bg-gradient-to-br from-amber-500 to-amber-600 p-8 text-white text-center relative">
            <div className="absolute top-3 left-3 bg-white/20 px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase">
              SECURITY FIRST
            </div>
            <ShieldAlert className="w-12 h-12 text-white mx-auto animate-bounce mt-3" />
            <h1 className="text-xl font-black tracking-tight uppercase mt-3">กรุณาเปลี่ยนรหัส PIN เริ่มต้น</h1>
            <p className="text-xs text-amber-50 font-semibold mt-1">เพื่อความปลอดภัยส่วนบุคคลในการปกป้องข้อมูลของระบบ</p>
          </div>

          {/* Form */}
          <form onSubmit={handleForceChangePinSubmit} className="p-8 space-y-5">
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-xs space-y-1">
              <p className="font-extrabold flex items-center gap-1.5 text-[13px]">
                <span>⚠️ ตรวจพบการเข้าใช้งานครั้งแรก</span>
              </p>
              <p className="text-amber-700 leading-relaxed font-semibold">
                เนื่องจากคุณใช้รหัส PIN ทั่วไปคือกุญแจ <strong>123456</strong> ซึ่งเป็นรหัสเริ่มต้นระบบ เพื่อความปลอดภัย กรุณาตั้งค่ารหัส PIN ใหม่ 6 หลักของคุณเองก่อนเริ่มใช้งาน
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block">รหัส PIN ใหม่ 6 หลัก (เฉพาะตัวเลข)</label>
              <input
                type="password"
                maxLength={6}
                required
                placeholder="ป้อนรหัส PIN ใหม่ 6 หลัก"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition font-mono font-bold"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block">ยืนยันรหัส PIN ใหม่</label>
              <input
                type="password"
                maxLength={6}
                required
                placeholder="ป้อนยืนยันรหัส PIN อีกครั้ง"
                value={confirmNewPin}
                onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, ""))}
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition font-mono font-bold"
              />
            </div>

            {changePinError && (
              <p className="text-xs font-bold text-red-600 text-center bg-red-50 border border-red-100 p-2.5 rounded-xl">
                {changePinError}
              </p>
            )}

            <button
              type="submit"
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-extrabold py-3.5 rounded-2xl transition cursor-pointer shadow-lg shadow-amber-600/20 text-sm"
            >
              ยืนยันเปลี่ยนรหัสผ่านใหม่
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full bg-slate-100 hover:bg-slate-200 text-gray-600 font-semibold py-2.5 rounded-2xl transition cursor-pointer text-xs flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5 text-red-500" />
              <span>ย้อนกลับไปหน้าเข้าสู่ระบบ</span>
            </button>
          </form>
        </div>
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
        <div className="flex items-center gap-2.5">
          {/* Mobile Bell Button */}
          <button
            onClick={() => setShowNotifications(true)}
            className="relative p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition cursor-pointer"
            title="แจ้งเตือน"
          >
            <Bell className="w-4 h-4" />
            {notifications.filter((n) => !n.read).length > 0 && (
              <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-red-600 text-[8px] font-bold text-white rounded-full flex items-center justify-center animate-pulse">
                {notifications.filter((n) => !n.read).length}
              </span>
            )}
          </button>

          <button
            onClick={() => setWin7Mode(!win7Mode)}
            className={`p-1.5 rounded-lg border transition cursor-pointer flex items-center justify-center ${
              win7Mode ? "bg-amber-600 border-amber-500 text-white" : "border-white/10 text-slate-400 hover:text-white hover:bg-white/5"
            }`}
            title="โหมด Windows 7"
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleLogout} className="text-slate-400 hover:text-white transition p-1">
            <LogOut className="w-4 h-4 text-red-500" />
          </button>
        </div>
      </header>

      {/* Left Sidebar on Desktop */}
      <aside className="w-66 bg-[#111] shrink-0 border-r border-white/5 flex flex-col justify-between p-5 text-slate-400 print:hidden overflow-y-auto hidden md:flex">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-red-600 flex items-center justify-center rounded-lg shadow-md shadow-red-600/20">
                <div className="w-4 h-4 bg-white rounded-sm"></div>
              </div>
              <h1 className="text-white font-bold text-lg tracking-tight">WSM-DUNAN</h1>
            </div>

            {/* Desktop Bell Notification */}
            <button
              onClick={() => setShowNotifications(true)}
              className="relative p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition cursor-pointer"
              title="การแจ้งเตือน"
            >
              <Bell className="w-4.5 h-4.5" />
              {notifications.filter((n) => !n.read).length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-[9px] font-bold text-white rounded-full flex items-center justify-center animate-pulse">
                  {notifications.filter((n) => !n.read).length}
                </span>
              )}
            </button>
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
              <span>รับเข้า</span>
            </button>

            <button
              onClick={() => setActiveTab("stock_out")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "stock_out" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <ArrowUpRight className="w-4 h-4 shrink-0" />
              <span>โอนออก</span>
            </button>

            <button
              onClick={() => setActiveTab("reports_print")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "reports_print" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>พิมพ์ใบโอน</span>
            </button>

            <button
              onClick={() => setActiveTab("deposit_withdraw")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "deposit_withdraw" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>ฝาก/เบิก</span>
            </button>

            <button
              onClick={() => setActiveTab("stock_adjust")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "stock_adjust" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Sliders className="w-4 h-4 shrink-0" />
              <span>ปรับยอด (ปรับสต๊อก)</span>
            </button>

            <button
              onClick={() => setActiveTab("products_master")}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition ${
                activeTab === "products_master" ? "bg-red-600 text-white shadow-lg shadow-red-600/15" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              <Package className="w-4 h-4 shrink-0" />
              <span>สินค้า</span>
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
              onClick={() => setWin7Mode(!win7Mode)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl mb-2.5 text-xs font-bold transition cursor-pointer border ${
                win7Mode
                  ? "bg-amber-600/20 text-amber-400 border-amber-500/40 hover:bg-amber-600/30"
                  : "bg-white/5 border-white/10 hover:bg-white/10 text-slate-300"
              }`}
              title="โหมด Windows 7: เพิ่มความเข้ากันได้กับเบราว์เซอร์และ Windows รุ่นเก่า"
            >
              <div className="flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5" />
                <span>โหมด Windows 7</span>
              </div>
              <span className={`text-[8px] px-1.5 py-0.5 rounded font-black ${win7Mode ? "bg-amber-500 text-black" : "bg-slate-800 text-slate-500"}`}>
                {win7Mode ? "เปิด" : "ปิด"}
              </span>
            </button>
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
        {/* Mobile Scrollable Tabs Navigation */}
        <div className="md:hidden flex gap-1 bg-black p-2 rounded-2xl mb-4 text-[11px] font-bold text-slate-300 print:hidden shadow-lg overflow-x-auto whitespace-nowrap scrollbar-none">
          <button onClick={() => setActiveTab("dashboard")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "dashboard" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>แดชบอร์ด</button>
          <button onClick={() => setActiveTab("stock_in")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "stock_in" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>รับเข้า</button>
          <button onClick={() => setActiveTab("stock_out")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "stock_out" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>โอนออก</button>
          <button onClick={() => setActiveTab("reports_print")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "reports_print" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>พิมพ์ใบโอน</button>
          <button onClick={() => setActiveTab("deposit_withdraw")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "deposit_withdraw" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>ฝาก/เบิก</button>
          <button onClick={() => setActiveTab("stock_adjust")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "stock_adjust" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>ปรับยอด</button>
          <button onClick={() => setActiveTab("products_master")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "products_master" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>สินค้า/พาร์ท</button>
          <button onClick={() => setActiveTab("time_attendance")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "time_attendance" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>กะ/เช็คอิน</button>
          <button onClick={() => setActiveTab("employees_permissions")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "employees_permissions" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>จัดการรายชื่อ</button>
          <button onClick={() => setActiveTab("settings")} className={`px-2.5 py-1.5 rounded-lg shrink-0 transition-colors ${activeTab === "settings" ? "bg-red-600 text-white" : "hover:bg-white/5"}`}>ตั้งค่า</button>
        </div>

        {currentUser?.approved === false && (
          <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white px-5 py-4 rounded-2xl mb-6 shadow-md border border-amber-400/20">
            <p className="font-extrabold text-sm flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-ping" />
              <span>⚠️ บัญชีอยู่ระหว่างรออนุมัติ (โหมดเข้าดูระบบได้เท่านั้น)</span>
            </p>
            <p className="text-xs text-amber-50 mt-1">
              บัญชีพนักงานของคุณได้ส่งคำขอลงทะเบียนเรียบร้อยแล้ว ในช่วงเริ่มต้นนี้คุณจะสามารถ <strong>เข้าดูระบบได้เท่านั้น (View-Only Mode)</strong> จะไม่สามารถทำรายการ สแกน หรือยืนยันส่งข้อมูลใดๆ ลงฐานข้อมูลได้ จนกว่าแอดมินหรือหัวหน้างานจะยืนยันอนุมัติสิทธิ์เข้าใช้งานของคุณในระบบพนักงาน
            </p>
          </div>
        )}

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

      {/* Real-time Notifications Sliding Panel */}
      {showNotifications && (
        <div className="fixed inset-0 z-50 flex justify-end print:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setShowNotifications(false)}
          />
          
          {/* Panel */}
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col z-10 animate-slide-in">
            <div className="p-6 bg-[#111] text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-red-500" />
                <h2 className="text-base font-bold tracking-tight">ศูนย์แจ้งเตือนคำขอทำรายการ</h2>
              </div>
              <button
                onClick={() => setShowNotifications(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            
            {/* Notifications List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              <div className="flex justify-between items-center px-1 mb-2">
                <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">รายการเคลื่อนไหวทั้งหมด</span>
                {notifications.length > 0 && (
                  <button
                    onClick={() => {
                      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                    }}
                    className="text-xs text-red-600 hover:text-red-700 font-bold cursor-pointer"
                  >
                    ทำเครื่องหมายอ่านแล้วทั้งหมด
                  </button>
                )}
              </div>
              
              {notifications.length === 0 ? (
                <div className="text-center py-12 text-gray-400 space-y-2">
                  <Bell className="w-8 h-8 mx-auto text-gray-300 stroke-1" />
                  <p className="text-xs font-semibold">ยังไม่มีรายการแจ้งเตือนใหม่ในระบบ</p>
                  <p className="text-[10px] text-gray-400">เมื่อพนักงานยื่นคำขอหรือเมื่อคำขอได้รับการตรวจสอบ ระบบจะแจ้งเตือนคุณแบบเรียลไทม์</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => {
                      // Mark as read
                      setNotifications((prev) =>
                        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
                      );
                      if (notif.linkTab) {
                        setActiveTab(notif.linkTab);
                      }
                      setShowNotifications(false);
                    }}
                    className={`p-4 border rounded-2xl cursor-pointer transition text-xs relative flex gap-3 items-start ${
                      notif.read ? "bg-white border-gray-100 text-gray-700 hover:bg-gray-50" : "bg-red-50/70 border-red-100 text-gray-800 hover:bg-red-50 font-medium shadow-xs"
                    }`}
                  >
                    {!notif.read && (
                      <span className="absolute top-4 left-3.5 w-1.5 h-1.5 bg-red-600 rounded-full animate-ping" />
                    )}
                    <div className={`${!notif.read ? "pl-2" : ""} flex-1 space-y-1`}>
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-bold text-gray-900 leading-tight">{notif.title}</span>
                        <span className="text-[10px] text-gray-400 shrink-0 font-mono">{formatNotifTime(notif.timestamp)}</span>
                      </div>
                      <p className="text-gray-500 leading-normal text-[11px]">{notif.message}</p>
                      {notif.linkTab && (
                        <span className="inline-block text-[10px] text-red-600 font-bold underline mt-1">
                          ไปที่เมนูเพื่อตรวจสอบข้อมูล &rarr;
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="p-4 border-t bg-gray-50 text-center text-[10px] text-gray-400 font-semibold uppercase tracking-wider shrink-0">
              WSM-DUNAN Real-time Push Notification Channel
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification Container */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => {
              if (toast.linkTab) {
                setActiveTab(toast.linkTab);
              }
              setToasts((prev) => prev.filter((t) => t.id !== toast.id));
            }}
            className="pointer-events-auto bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-800 flex gap-3 items-start cursor-pointer hover:bg-slate-800 transition duration-150 transform hover:-translate-y-0.5 animate-slide-in"
          >
            <Bell className="w-5 h-5 text-red-500 shrink-0 mt-0.5 animate-bounce" />
            <div className="text-xs space-y-0.5">
              <p className="font-bold text-white tracking-tight">{toast.title}</p>
              <p className="text-slate-400 text-[11px] leading-snug">{toast.message}</p>
              <p className="text-[9px] text-slate-500 pt-1">แตะที่นี่เพื่อตรวจสอบ &bull; กดเพื่อปิด</p>
            </div>
          </div>
        ))}
      </div>
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
