import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, setDoc, updateDoc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Employee, TimeAttendance, AttendanceRequest } from "../types";
import { calculateAttendance } from "../utils/timeTracker";
import { Clock, Calendar, CheckCircle2, UserCheck, AlertTriangle, Moon, Sun, ArrowRight, ClipboardList, ShieldAlert, HelpCircle, Info, Lightbulb, X, Camera } from "lucide-react";

interface AttendanceViewProps {
  currentUser: Employee | null;
}

export default function AttendanceView({ currentUser }: AttendanceViewProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendances, setAttendances] = useState<TimeAttendance[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showQRGuide, setShowQRGuide] = useState(false);

  // Employee form state
  const [reqType, setReqType] = useState<"forgot_time" | "leave">("forgot_time");
  const [requestDetail, setRequestDetail] = useState("");
  const [proposedIn, setProposedIn] = useState("08:30");
  const [proposedOut, setProposedOut] = useState("17:30");
  const [requestDate, setRequestDate] = useState(new Date().toISOString().split("T")[0]);
  const [leaveType, setLeaveType] = useState("ลากิจ"); // ลากิจ, ลาป่วย, ลาพักร้อน

  // Manager filter state
  const [selectedShiftFilter, setSelectedShiftFilter] = useState<"DAY" | "NIGHT">("DAY");

  // Shift Rotation planner state
  const [rotationSettings, setRotationSettings] = useState({
    nextRotationDate: "",
    rotationInterval: 7, // 7 or 14
  });

  const isManager = currentUser?.role === "admin" || currentUser?.role === "leader";
  const todayStr = new Date().toISOString().split("T")[0];

  // Load rotation settings
  useEffect(() => {
    const loadRotation = async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "attendance_rotation"));
        if (snap.exists()) {
          const d = snap.data();
          setRotationSettings({
            nextRotationDate: d.nextRotationDate || "",
            rotationInterval: Number(d.rotationInterval) || 7,
          });
        }
      } catch (err) {
        console.error("Error loading rotation settings:", err);
      }
    };
    loadRotation();
  }, []);

  // Update current time clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // 1. Fetch employees
    const unsubEmps = onSnapshot(collection(db, "employees"), (snap) => {
      const list: Employee[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Employee));
      setEmployees(list);
    });

    // 2. Fetch all attendance logs
    const unsubAtt = onSnapshot(collection(db, "time_attendance"), (snap) => {
      const list: TimeAttendance[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({ id: d.id, ...data } as TimeAttendance);
      });
      setAttendances(list);
    });

    return () => {
      unsubEmps();
      unsubAtt();
    };
  }, []);

  // Filter attendance record for active user today
  const myRecordToday = attendances.find((a) => a.empId === currentUser?.id && a.date === todayStr);

  const handleClockIn = async () => {
    if (!currentUser) return;
    const timeStr = currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const id = `${currentUser.id}_${todayStr}`;

    const record: TimeAttendance = {
      id,
      empId: currentUser.id,
      empName: `${currentUser.name} ${currentUser.lastName}`,
      date: todayStr,
      checkIn: timeStr,
      shift: currentUser.shiftWork || "DAY",
      workHours: 0,
      otHours: 0,
    };

    try {
      await setDoc(doc(db, "time_attendance", id), record, { merge: true });
      alert(`บันทึกเวลาเข้างานเรียบร้อย ณ เวลา ${timeStr} น.`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleClockOut = async () => {
    if (!currentUser || !myRecordToday) return;
    const timeStr = currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

    // Calculate hours and OT hours using our custom formulas
    const checkInTime = myRecordToday.checkIn || "08:30";
    const { workHours, otHours } = calculateAttendance(checkInTime, timeStr, myRecordToday.shift);

    try {
      await updateDoc(doc(db, "time_attendance", myRecordToday.id), {
        checkOut: timeStr,
        workHours,
        otHours,
      });
      alert(`บันทึกเลิกงานและคำนวณชั่วโมงทำงานสำเร็จ:\nเวลาทำงาน: ${workHours} ชม.\nเวลา OT: ${otHours} ชม.`);
    } catch (err) {
      console.error(err);
    }
  };

  // Employee: submit adjustment or leave request
  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const reqId = `REQ-${Date.now().toString().slice(-6)}`;
    const id = `${currentUser.id}_${requestDate}`;

    const newReq: AttendanceRequest = {
      id: reqId,
      type: reqType,
      requestType: reqType === "leave" ? leaveType : "ลืมสแกนเวลา",
      detail: requestDetail,
      proposedCheckIn: reqType === "forgot_time" ? proposedIn : undefined,
      proposedCheckOut: reqType === "forgot_time" ? proposedOut : undefined,
      status: "pending",
      timestamp: new Date(),
    };

    try {
      // Pull current attendance record or create empty
      const attDocRef = doc(db, "time_attendance", id);
      const attSnap = await getDoc(attDocRef);

      let existingReqs: AttendanceRequest[] = [];
      if (attSnap.exists()) {
        existingReqs = attSnap.data().requests || [];
      }

      await setDoc(
        attDocRef,
        {
          empId: currentUser.id,
          empName: `${currentUser.name} ${currentUser.lastName}`,
          date: requestDate,
          shift: currentUser.shiftWork || "DAY",
          requests: [...existingReqs, newReq],
        },
        { merge: true }
      );

      alert("ส่งคำร้องขอเสร็จสมบูรณ์ เพื่อรอหัวหน้างานอนุมัติพิจารณา");
      setRequestDetail("");
    } catch (err) {
      console.error(err);
    }
  };

  // Manager: approve or reject attendance requests
  const handleManagerDecision = async (
    attId: string,
    reqId: string,
    decision: "approved" | "rejected"
  ) => {
    try {
      const docRef = doc(db, "time_attendance", attId);
      const snap = await getDoc(docRef);

      if (!snap.exists()) return;

      const data = snap.data() as TimeAttendance;
      const list = data.requests || [];

      // Find and update status of request
      const updatedList = list.map((r) => {
        if (r.id === reqId) {
          return { ...r, status: decision };
        }
        return r;
      });

      const matchedReq = list.find((r) => r.id === reqId);

      // If approved, update active checkIn and checkOut hours immediately
      const updates: any = { requests: updatedList };

      if (decision === "approved" && matchedReq) {
        if (matchedReq.type === "forgot_time") {
          const inTime = matchedReq.proposedCheckIn || "08:30";
          const outTime = matchedReq.proposedCheckOut || "17:30";
          const { workHours, otHours } = calculateAttendance(inTime, outTime, data.shift);

          updates.checkIn = inTime;
          updates.checkOut = outTime;
          updates.workHours = workHours;
          updates.otHours = otHours;
        } else {
          // If leave: set workHours = 8 and otHours = 0 (paid leave)
          updates.checkIn = "LEAVE";
          updates.checkOut = "LEAVE";
          updates.workHours = 8;
          updates.otHours = 0;
        }
      }

      await updateDoc(docRef, updates);
      alert(`ดำเนินการคำร้องขอเป็น [${decision === "approved" ? "อนุมัติ" : "ปฏิเสธ"}] เรียบร้อยแล้ว`);
    } catch (err) {
      console.error(err);
    }
  };

  // Manager: Schedule Shift work
  const handleScheduleShift = async (empId: string, selectedShift: "DAY" | "NIGHT") => {
    try {
      await updateDoc(doc(db, "employees", empId), { shiftWork: selectedShift });
      alert("จัดกะพนักงานเสร็จสมบูรณ์");
    } catch (err) {
      console.error(err);
    }
  };

  // Save Shift Rotation settings to Firestore
  const handleSaveRotationSettings = async (nextDate: string, interval: number) => {
    try {
      await setDoc(doc(db, "settings", "attendance_rotation"), {
        nextRotationDate: nextDate,
        rotationInterval: interval,
      });
      setRotationSettings({ nextRotationDate: nextDate, rotationInterval: interval });
      alert("บันทึกการตั้งค่ากำหนดการเปลี่ยนกะพนักงานเสร็จเรียบร้อยแล้ว");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาด ไม่สามารถบันทึกการตั้งค่าได้");
    }
  };

  const handleToggleFixedDayShift = async (empId: string, currentVal: boolean) => {
    try {
      const isNowFixed = !currentVal;
      await updateDoc(doc(db, "employees", empId), { 
        fixedDayShift: isNowFixed,
        ...(isNowFixed ? { shiftWork: "DAY" } : {})
      });
      alert(`อัปเดตสถานะ "ทำกะเช้าตลอด" สำเร็จแล้ว`);
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    }
  };

  // Perform immediate swap of shifts and roll nextDate forward
  const handleTriggerRotation = async () => {
    if (!confirm("คุณต้องการสลับกะพนักงานทุกคนในระบบทันทีใช่หรือไม่? (พนักงานที่เปิดกะเช้าตลอดจะถูกล็อกไว้ที่กะกลางวัน)")) return;
    try {
      // 1. Swap shifts for all employees (skipping fixedDayShift ones)
      const promises = employees.map((emp) => {
        if (emp.fixedDayShift) {
          return updateDoc(doc(db, "employees", emp.id), { shiftWork: "DAY" });
        }
        const newShift = emp.shiftWork === "NIGHT" ? "DAY" : "NIGHT";
        return updateDoc(doc(db, "employees", emp.id), { shiftWork: newShift });
      });
      await Promise.all(promises);

      // 2. Calculate next date
      let baseDate = new Date();
      if (rotationSettings.nextRotationDate) {
        baseDate = new Date(rotationSettings.nextRotationDate);
      }
      baseDate.setDate(baseDate.getDate() + Number(rotationSettings.rotationInterval));
      const nextDateStr = baseDate.toISOString().split("T")[0];

      // 3. Save new settings
      await setDoc(doc(db, "settings", "attendance_rotation"), {
        nextRotationDate: nextDateStr,
        rotationInterval: rotationSettings.rotationInterval,
      });
      
      setRotationSettings(prev => ({ ...prev, nextRotationDate: nextDateStr }));
      alert(`สลับกะพนักงานทั้งหมดเรียบร้อยแล้ว! (ยกเว้นผู้ที่ถูกล็อก "กะเช้าตลอด")\nระบบเลื่อนวันเปลี่ยนกะรอบถัดไปเป็น: ${nextDateStr}`);
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการสลับกะพนักงาน");
    }
  };

  const getDaysRemaining = () => {
    if (!rotationSettings.nextRotationDate) return null;
    const target = new Date(rotationSettings.nextRotationDate);
    const today = new Date();
    target.setHours(0,0,0,0);
    today.setHours(0,0,0,0);
    const diffTime = target.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // List of pending requests for managers to review
  const pendingRequests = attendances.flatMap((att) => {
    const list = att.requests || [];
    return list
      .filter((r) => r.status === "pending")
      .map((r) => ({
        attendanceId: att.id,
        empId: att.empId,
        empName: att.empName,
        date: att.date,
        shift: att.shift,
        ...r,
      }));
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">บันทึกเวลาทำงานและจัดกะพนักงาน</h2>
          <p className="text-sm text-gray-500 mt-1">บันทึกเวลาเข้างาน-เลิกงาน ตรวจเช็คเวลาทำงานและยื่นคำร้องขอลากิจ/ลืมลงเวลา</p>
        </div>
        <button
          onClick={() => setShowQRGuide(true)}
          className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 transition shrink-0"
        >
          <HelpCircle className="w-4.5 h-4.5 text-red-600 animate-pulse" />
          <span>คู่มือสแกน QR บันทึกเวลา</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Check In Panel for Employees */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-5 lg:col-span-5">
          <div className="text-center p-6 bg-red-50/50 rounded-2xl border border-red-100 relative overflow-hidden">
            <button
              type="button"
              onClick={() => setShowQRGuide(true)}
              className="absolute top-3 right-3 text-slate-400 hover:text-red-600 transition p-1 z-10"
              title="คู่มือการใช้ QR Scanner"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            <div className="absolute right-0 top-0 opacity-10 translate-x-5 -translate-y-5">
              <Clock className="w-40 h-40 text-red-600" />
            </div>

            <span className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1 rounded-full uppercase tracking-wider">
              {currentUser?.shiftWork === "NIGHT" ? "กะกลางคืน (NIGHT)" : "กะกลางวัน (DAY)"}
            </span>

            <h1 className="text-4xl font-mono font-bold tracking-widest text-gray-900 mt-4">
              {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </h1>
            <p className="text-xs text-gray-400 font-medium mt-1.5 flex items-center justify-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>{currentTime.toLocaleDateString("th-TH", { dateStyle: "long" })}</span>
            </p>

            <div className="grid grid-cols-2 gap-3 pt-6">
              <button
                onClick={handleClockIn}
                disabled={!!myRecordToday?.checkIn}
                className="bg-black hover:bg-gray-800 text-white font-bold py-3.5 rounded-xl text-xs transition cursor-pointer disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                บันทึกเข้างาน (Clock In)
              </button>
              <button
                onClick={handleClockOut}
                disabled={!myRecordToday?.checkIn || !!myRecordToday?.checkOut}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 rounded-xl text-xs transition cursor-pointer disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                บันทึกเลิกงาน (Clock Out)
              </button>
            </div>

            {myRecordToday && (
              <div className="mt-4 p-3 bg-white border border-gray-100 rounded-xl flex justify-around text-xs text-left">
                <div>
                  <p className="text-gray-400">เวลาเข้างาน:</p>
                  <p className="font-bold text-gray-800 mt-0.5">{myRecordToday.checkIn || "-"}</p>
                </div>
                <div className="w-px bg-gray-100" />
                <div>
                  <p className="text-gray-400">เวลาเลิกงาน:</p>
                  <p className="font-bold text-gray-800 mt-0.5">{myRecordToday.checkOut || "-"}</p>
                </div>
                <div className="w-px bg-gray-100" />
                <div>
                  <p className="text-gray-400">ชั่วโมงรวม:</p>
                  <p className="font-bold text-red-600 mt-0.5">{(myRecordToday.workHours || 0) + (myRecordToday.otHours || 0)} ชม.</p>
                </div>
              </div>
            )}
          </div>

          {/* Merge Forgot Time / Leave requests */}
          <div className="border-t border-gray-100 my-4" />

          <form onSubmit={handleSubmitRequest} className="space-y-4">
            <h3 className="font-bold text-gray-800 text-sm">ยื่นคำร้องย้อนหลัง ( Forgot Time / Leave )</h3>

            <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
              <button
                type="button"
                onClick={() => setReqType("forgot_time")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  reqType === "forgot_time" ? "bg-white text-gray-800 shadow-xs" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                ลืมลงเวลาทำงาน
              </button>
              <button
                type="button"
                onClick={() => setReqType("leave")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  reqType === "leave" ? "bg-white text-gray-800 shadow-xs" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                คำขอลางาน (Leave)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-gray-500 font-medium">วันที่ขอทำรายการ</label>
                <input
                  type="date"
                  required
                  value={requestDate}
                  onChange={(e) => setRequestDate(e.target.value)}
                  className="w-full mt-1 p-2 border rounded-lg font-semibold bg-white"
                />
              </div>

              {reqType === "leave" ? (
                <div>
                  <label className="text-gray-500 font-medium">เลือกประเภทลางาน</label>
                  <select
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value)}
                    className="w-full mt-1 p-2 border rounded-lg font-semibold bg-white text-xs"
                  >
                    <option value="ลากิจ">ลากิจ (Personal Leave)</option>
                    <option value="ลาป่วย">ลาป่วย (Sick Leave)</option>
                    <option value="ลาพักร้อน">ลาพักร้อน (Annual Leave)</option>
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-gray-500 font-medium">เวลาเข้างาน</label>
                    <input
                      type="text"
                      value={proposedIn}
                      onChange={(e) => setProposedIn(e.target.value)}
                      className="w-full mt-1 p-1.5 border rounded-lg text-center font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 font-medium">เวลาออกงาน</label>
                    <input
                      type="text"
                      value={proposedOut}
                      onChange={(e) => setProposedOut(e.target.value)}
                      className="w-full mt-1 p-1.5 border rounded-lg text-center font-mono font-bold"
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">คำอธิบายเหตุผลประกอบคำร้อง *</label>
              <textarea
                required
                placeholder="เช่น ลืมนำการ์ดมาพกพา หรือ ลากิจพาคุณแม่ไปพบแพทย์ที่โรงพยาบาล"
                value={requestDetail}
                onChange={(e) => setRequestDetail(e.target.value)}
                className="w-full mt-1 p-3 border rounded-xl text-xs outline-none focus:ring-1 focus:ring-red-500 h-20"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-black text-white text-xs py-2.5 rounded-xl font-bold hover:bg-gray-800 transition"
            >
              ส่งคำขอรับพิจารณา
            </button>
          </form>
        </div>

        {/* Manager Console Panel */}
        <div className="lg:col-span-7 space-y-6">
          {isManager ? (
            <>
              {/* Reviews and Decisions */}
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-base">
                  <ClipboardList className="w-5 h-5 text-red-600" /> ตรวจสอบพิจารณาคำขอพนักงาน ({pendingRequests.length})
                </h3>

                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {pendingRequests.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 italic text-xs bg-gray-50 rounded-xl border border-gray-100">
                      ไม่มีคำขอรออนุมัติค้างในระบบเวลานี้
                    </div>
                  ) : (
                    pendingRequests.map((req) => (
                      <div key={req.id} className="p-4 border border-amber-100 bg-amber-50/20 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-gray-800">{req.empName}</span>
                            <span className="text-gray-400 font-mono">({req.empId})</span>
                          </div>
                          <p className="text-gray-500">
                            วันที่เสนอ: <span className="font-semibold text-gray-700">{req.date}</span> (กะ {req.shift})
                          </p>
                          <p className="text-red-700 font-bold">
                            คำขอ: [{req.requestType}] {req.type === "forgot_time" ? `(เสนอเข้า: ${req.proposedCheckIn} / เลิก: ${req.proposedCheckOut})` : ""}
                          </p>
                          <p className="text-gray-400 italic">" {req.detail} "</p>
                        </div>

                        <div className="flex gap-2 w-full sm:w-auto self-stretch sm:self-auto">
                          <button
                            onClick={() => handleManagerDecision(req.attendanceId, req.id, "approved")}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-3 rounded-lg text-[10px]"
                          >
                            อนุมัติ
                          </button>
                          <button
                            onClick={() => handleManagerDecision(req.attendanceId, req.id, "rejected")}
                            className="flex-1 border border-red-200 text-red-600 hover:bg-red-50 font-bold py-2 px-3 rounded-lg text-[10px]"
                          >
                            ปฏิเสธ
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Shift Scheduling tool */}
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-50 pb-4">
                  <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-base">
                    <UserCheck className="w-5 h-5 text-red-600" /> จัดตารางกะพนักงานหลัก (Shift Work Schedule)
                  </h3>
                  
                  {/* Quick Auto-Rotation Notification */}
                  {rotationSettings.nextRotationDate && (
                    <div className="flex items-center gap-2">
                      {getDaysRemaining() !== null && (
                        getDaysRemaining()! < 0 ? (
                          <span className="bg-red-100 text-red-700 font-bold px-3 py-1 rounded-full text-[10px] animate-pulse">
                            🚨 เลยกำหนดเปลี่ยนกะพนักงานมาแล้ว {Math.abs(getDaysRemaining()!)} วัน!
                          </span>
                        ) : getDaysRemaining() === 0 ? (
                          <span className="bg-amber-100 text-amber-800 font-bold px-3 py-1 rounded-full text-[10px] animate-bounce">
                            🔔 ถึงกำหนดเปลี่ยนกะพนักงานวันนี้แล้ว!
                          </span>
                        ) : (
                          <span className="bg-green-50 text-green-700 border border-green-200 font-bold px-3 py-1 rounded-full text-[10px]">
                            📅 อีก {getDaysRemaining()} วันจะถึงรอบเปลี่ยนกะถัดไป
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>

                {/* Shift Rotation Configuration Panel */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 sm:p-5 space-y-4">
                  <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1">
                    <Calendar className="w-4 h-4 text-red-600" />
                    <span>ตั้งค่ารอบหมุนเวียนกะอัตโนมัติ (Shift Rotation Scheduler)</span>
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end text-xs">
                    <div className="sm:col-span-5">
                      <label className="text-gray-500 font-semibold">วันที่เปลี่ยนกะรอบถัดไป (Next Rotation Date)</label>
                      <input
                        type="date"
                        value={rotationSettings.nextRotationDate}
                        onChange={(e) => setRotationSettings(prev => ({ ...prev, nextRotationDate: e.target.value }))}
                        className="w-full mt-1.5 p-2.5 bg-white border border-gray-200 rounded-xl font-semibold outline-none focus:ring-1 focus:ring-red-500"
                      />
                    </div>

                    <div className="sm:col-span-4">
                      <label className="text-gray-500 font-semibold">กำหนดรอบเปลี่ยนกะ (Rotation Cycle)</label>
                      <select
                        value={rotationSettings.rotationInterval}
                        onChange={(e) => setRotationSettings(prev => ({ ...prev, rotationInterval: Number(e.target.value) }))}
                        className="w-full mt-1 p-2.5 bg-white border border-gray-200 rounded-xl font-semibold outline-none focus:ring-1 focus:ring-red-500"
                      >
                        <option value={7}>ทุก 7 วัน (7 Days)</option>
                        <option value={14}>ทุก 14 วัน (14 Days)</option>
                      </select>
                    </div>

                    <div className="sm:col-span-3">
                      <button
                        onClick={() => handleSaveRotationSettings(rotationSettings.nextRotationDate, rotationSettings.rotationInterval)}
                        className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 rounded-xl cursor-pointer transition text-xs"
                      >
                        บันทึกการตั้งค่า
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-slate-200 my-2 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="text-[11px] text-slate-500 max-w-md">
                      <span className="font-bold text-slate-700">💡 การสลับกะอัตโนมัติ:</span> ระบบจะสลับกะพนักงานจาก DAY ↔ NIGHT และเลื่อนกำหนดสลับกะรอบถัดไปให้อัตโนมัติทุก 7 หรือ 14 วัน
                    </div>
                    <button
                      onClick={handleTriggerRotation}
                      className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl cursor-pointer shadow-sm shrink-0 transition"
                    >
                      สลับกะพนักงานทุกคนทันที (Rotate All Now)
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto border border-gray-100 rounded-2xl">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50/70 text-gray-500 font-bold border-b border-gray-100">
                      <tr>
                        <th className="p-3">รหัส / ชื่อพนักงาน</th>
                        <th className="p-3">แผนก</th>
                        <th className="p-3 text-center">ตั้งค่ากะเช้าตลอด (Always Day)</th>
                        <th className="p-3 text-center">จัดกะงานปัจจุบัน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((emp) => (
                        <tr key={emp.id} className="border-b last:border-0 hover:bg-gray-50/50">
                          <td className="p-3 font-semibold text-gray-800">
                            {emp.name} {emp.lastName}
                            <div className="text-[10px] text-gray-400 font-mono">{emp.id}</div>
                          </td>
                          <td className="p-3 font-medium text-slate-600">{emp.department}</td>
                          <td className="p-3 text-center">
                            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={!!emp.fixedDayShift}
                                onChange={() => handleToggleFixedDayShift(emp.id, !!emp.fixedDayShift)}
                                className="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
                              />
                              <span className={`text-[10px] font-bold ${emp.fixedDayShift ? "text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-200" : "text-gray-400"}`}>
                                {emp.fixedDayShift ? "ทำเช้าตลอด" : "สลับกะปกติ"}
                              </span>
                            </label>
                          </td>
                          <td className="p-3 text-center">
                            <select
                              value={emp.shiftWork || "DAY"}
                              disabled={!!emp.fixedDayShift}
                              onChange={(e) => handleScheduleShift(emp.id, e.target.value as any)}
                              className={`border rounded-lg px-2.5 py-1 text-xs font-bold focus:outline-none ${
                                emp.shiftWork === "NIGHT" 
                                  ? "bg-slate-900 text-amber-400 border-slate-800" 
                                  : "bg-amber-50/50 text-amber-800 border-amber-200"
                              } ${emp.fixedDayShift ? "opacity-75 cursor-not-allowed" : "cursor-pointer"}`}
                            >
                              <option value="DAY">☀ DAY (กะกลางวัน)</option>
                              <option value="NIGHT">🌙 NIGHT (กะกลางคืน)</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400 italic text-xs space-y-1">
              <ShieldAlert className="w-10 h-10 text-gray-300 mx-auto animate-bounce mb-3" />
              <p className="font-bold">หน้าต่างผู้พิจารณาการจัดตารางกะสำหรับผู้นำสโตร์</p>
              <p>เฉพาะแอดมินหรือหัวหน้าแผนกงาน (leaders/admins) เท่านั้นที่มีสิทธิ์พิจารณาข้อมูลส่วนนี้</p>
            </div>
          )}
        </div>
      </div>

      {/* QR Scanner Guide Modal */}
      {showQRGuide && (
        <div className="fixed inset-0 z-[250] bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 p-5 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Camera className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">คู่มือการใช้ QR Scanner บันทึกเวลา</h3>
                  <p className="text-[10px] text-red-100">ขั้นตอนการสแกนและเคล็ดลับเพื่อความรวดเร็ว</p>
                </div>
              </div>
              <button 
                onClick={() => setShowQRGuide(false)} 
                className="hover:bg-red-850/50 p-1.5 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-slate-700">
              {/* Steps */}
              <div className="space-y-3.5">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-red-500" />
                  <span>ขั้นตอนการสแกนเช็คอิน / เช็คเอาท์</span>
                </h4>
                
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">1</div>
                    <div>
                      <h5 className="font-bold text-xs text-slate-800">เตรียมบัตรหรือ QR Code ของคุณ</h5>
                      <p className="text-[11px] text-slate-500 mt-0.5">เปิดรูปภาพ QR Code พนักงานบนหน้าจอมือถือ หรือเตรียมบัตรพนักงานที่มีรหัสพิมพ์ไว้ให้พร้อม</p>
                    </div>
                  </div>

                  <div className="flex gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">2</div>
                    <div>
                      <h5 className="font-bold text-xs text-slate-800">เล็งให้อยู่ในกรอบสแกน</h5>
                      <p className="text-[11px] text-slate-500 mt-0.5">ถืออุปกรณ์หรือบัตรให้อยู่ในระยะห่างประมาณ 10-15 เซนติเมตร โดยให้รหัส QR อยู่กึ่งกลางภายในกรอบจับภาพ</p>
                    </div>
                  </div>

                  <div className="flex gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">3</div>
                    <div>
                      <h5 className="font-bold text-xs text-slate-800">ตรวจสอบสัญญาณยืนยัน</h5>
                      <p className="text-[11px] text-slate-500 mt-0.5">เมื่อระบบจับภาพสำเร็จ จะมีเสียงแจ้งเตือนหรือข้อความยืนยันการเช็คอิน/เช็คเอาท์ปรากฏบนหน้าจอหลัก</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lighting & Scanning Tips */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  <span>เคล็ดลับการสแกนภายใต้สภาพแสงต่างๆ</span>
                </h4>

                <div className="bg-amber-50/40 border border-amber-100/70 rounded-2xl p-4.5 space-y-3.5 text-xs text-slate-600">
                  <div className="flex gap-3">
                    <span className="text-lg shrink-0">💡</span>
                    <div>
                      <h5 className="font-bold text-amber-800 text-xs">หลีกเลี่ยงพื้นที่มืดและเงาสะท้อน</h5>
                      <p className="text-[11px] text-slate-500 mt-0.5">ควรสแกนในบริเวณที่มีแสงสว่างจากธรรมชาติหรือหลอดไฟส่องถึงอย่างทั่วถึง หลีกเลี่ยงมุมอับแสงหรือเงาของตัวเองที่อาจบังตัวรหัส QR</p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <span className="text-lg shrink-0">🚫</span>
                    <div>
                      <h5 className="font-bold text-amber-800 text-xs">ลดแสงสะท้อนบนพื้นผิวเงา (Glare)</h5>
                      <p className="text-[11px] text-slate-500 mt-0.5">กรณีสแกนจากหน้าจอมือถือหรือบัตรพลาสติกผิวมันเงา ให้เอียงอุปกรณ์ทำมุมกับแสงเล็กน้อย (ประมาณ 15 องศา) เพื่อลดการสะท้อนของแสงไฟเข้าสู่เลนส์กล้อง</p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <span className="text-lg shrink-0">📱</span>
                    <div>
                      <h5 className="font-bold text-amber-800 text-xs">เพิ่มความสว่างหน้าจอมือถือสูงสุด</h5>
                      <p className="text-[11px] text-slate-500 mt-0.5">หากคุณสแกน QR Code จากโทรศัพท์มือถือเครื่องอื่น กรุณาปรับความสว่างหน้าจอของเครื่องนั้นๆ ให้สว่างสุด เพื่อให้กล้องสามารถอ่านสัดส่วนสีขาว-ดำได้คมชัดที่สุด</p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <span className="text-lg shrink-0">🧼</span>
                    <div>
                      <h5 className="font-bold text-amber-800 text-xs">รักษาหน้าเลนส์ของกล้องให้อ่านง่าย</h5>
                      <p className="text-[11px] text-slate-500 mt-0.5">เช็ดทำความสะอาดเลนส์กล้องของอุปกรณ์สแกนอย่างสม่ำเสมอ เพื่อลดคราบรอยนิ้วมือ คราบมัน หรือฝุ่นละอองที่อาจทำให้ภาพมัวจนกล้องจับโฟกัสไม่ได้</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowQRGuide(false)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-5 py-2 rounded-xl text-xs transition"
              >
                รับทราบและปิดหน้านี้
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
