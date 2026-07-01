import React, { useState } from "react";
import { collection, doc, writeBatch, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Employee } from "../types";
import { Settings, Shield, Plus, Key, Layers, Compass, HelpCircle } from "lucide-react";

interface SettingsViewProps {
  currentUser: Employee | null;
}

export default function SettingsView({ currentUser }: SettingsViewProps) {
  // PIN update states
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  // Location Batch Generator
  const [locPrefix, setLocPrefix] = useState("CTC");
  const [locStart, setLocStart] = useState<number>(0);
  const [locEnd, setLocEnd] = useState<number>(12);
  const [batchLoading, setBatchLoading] = useState(false);

  const isAuthorized = currentUser?.role === "admin" || currentUser?.role === "leader";

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (oldPin !== currentUser.pin) {
      alert("PIN เดิมไม่ถูกต้อง");
      return;
    }
    if (newPin.length !== 6) {
      alert("PIN ใหม่ต้องมีความยาว 6 หลัก");
      return;
    }
    if (newPin !== confirmPin) {
      alert("การยืนยัน PIN ใหม่ไม่ตรงกัน");
      return;
    }

    try {
      await setDoc(doc(db, "employees", currentUser.id), { pin: newPin }, { merge: true });
      alert("เปลี่ยน PIN รหัสผ่านสำเร็จ");
      // Update local storage/state reference (handled by App.tsx session sync)
      currentUser.pin = newPin;
      setOldPin("");
      setNewPin("");
      setConfirmPin("");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการแก้ PIN");
    }
  };

  // Automated Location Batch Creator
  const handleGenerateLocations = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locPrefix.trim()) {
      alert("กรุณาระบุคำนำหน้า Location (Prefix)");
      return;
    }
    if (locStart < 0 || locEnd < locStart) {
      alert("ดัชนีเริ่มต้นและสิ้นสุดไม่ถูกต้อง");
      return;
    }

    setBatchLoading(true);
    try {
      const batch = writeBatch(db);
      const generatedCount = locEnd - locStart + 1;

      for (let i = locStart; i <= locEnd; i++) {
        const paddedNum = i.toString().padStart(2, "0");
        const locName = `${locPrefix.trim().toUpperCase()}-${paddedNum}`;
        const ref = doc(db, "locations", locName);
        batch.set(ref, {
          name: locName,
          created: new Date(),
        });
      }

      await batch.commit();
      alert(`สร้างพิกัดจัดเก็บสินค้า Location จำนวน ${generatedCount} พิกัด สำเร็จเรียบร้อย!`);
    } catch (err) {
      console.error("Batch Location Generation failure:", err);
      alert("ไม่สามารถบันทึกคีย์ Location ลงระบบได้");
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">ตั้งค่าระบบ (Settings)</h2>
          <p className="text-sm text-gray-500 mt-1">เปลี่ยนรหัสผ่านพนักงาน และจัดการตั้งค่าพิกัดสโตร์อัตโนมัติ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Settings */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Key className="w-5 h-5 text-red-600" /> เปลี่ยน PIN ล็อกอินส่วนตัว
          </h3>
          <p className="text-xs text-gray-400">PIN ใช้สำหรับยืนยันสแกนเข้าทำงาน และแก้ไขข้อมูลสิทธิ์สำคัญในระบบ</p>

          <form onSubmit={handleUpdatePin} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block">กรอก PIN ปัจจุบันของคุณ</label>
              <input
                type="password"
                maxLength={6}
                required
                placeholder="• • • • • •"
                value={oldPin}
                onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ""))}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 block">กรอก PIN 6 หลักใหม่</label>
                <input
                  type="password"
                  maxLength={6}
                  required
                  placeholder="• • • • • •"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block">ยืนยัน PIN ใหม่</label>
                <input
                  type="password"
                  maxLength={6}
                  required
                  placeholder="• • • • • •"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="bg-black hover:bg-gray-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer"
            >
              อัปเดตรหัส PIN พนักงาน
            </button>
          </form>
        </div>

        {/* Location Generator */}
        {isAuthorized ? (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Compass className="w-5 h-5 text-red-600" /> สร้างชุดพิกัดจัดเก็บสินค้าอัตโนมัติ (Location Batch Creator)
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              เครื่องมือสร้างรหัส Location สโตร์อย่างรวดเร็ว โดยโปรแกรมจะสร้าง Location (ตั้งแต่เริ่มถึงสิ้นสุด) และจัดเก็บลงฐานข้อมูลให้อัตโนมัติ เช่น กำหนด CTC ตั้งแต่ 0 ถึง 12 จะสร้างรหัส CTC-00, CTC-01, จนถึง CTC-12 ทันที
            </p>

            <form onSubmit={handleGenerateLocations} className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Prefix คำนำหน้า</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น CTC, WIP, FG"
                    value={locPrefix}
                    onChange={(e) => setLocPrefix(e.target.value)}
                    className="w-full mt-1 p-2 border rounded-lg font-bold uppercase"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600">เลขดัชนีเริ่มต้น</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={locStart}
                    onChange={(e) => setLocStart(Number(e.target.value))}
                    className="w-full mt-1 p-2 border rounded-lg text-center"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600">เลขดัชนีสิ้นสุด</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={locEnd}
                    onChange={(e) => setLocEnd(Number(e.target.value))}
                    className="w-full mt-1 p-2 border rounded-lg text-center"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={batchLoading}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-1 transition shadow-sm cursor-pointer disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span>{batchLoading ? "กำลังทำการบันทึกข้อมูล..." : "สร้างและเขียนพิกัดลงฐานข้อมูล"}</span>
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-gray-50 border p-12 rounded-2xl text-center text-gray-400 italic">
            ส่วนเครื่องมือแอดมินสำหรับสร้าง Location อัตโนมัติ (เฉพาะสิทธิ์ผู้ดูแลระบบ/หัวหน้างานขึ้นไป)
          </div>
        )}
      </div>

      {/* System info */}
      <div className="bg-gray-900 text-gray-400 p-6 rounded-2xl space-y-3.5 border border-gray-800">
        <h4 className="text-white font-bold text-sm flex items-center gap-1.5">
          <Settings className="w-4.5 h-4.5 text-red-500 animate-spin" /> ข้อมูลระบบเวอร์ชันแอปพลิเคชัน
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px] font-mono leading-relaxed">
          <div>
            <p className="text-gray-500">เวอร์ชันรหัสสินค้า:</p>
            <p className="font-bold text-white mt-0.5">v2.5.0-Stable</p>
          </div>
          <div>
            <p className="text-gray-500">อัปเดตล่าสุดเมื่อ:</p>
            <p className="font-bold text-white mt-0.5">30 มิถุนายน พ.ศ. 2569</p>
          </div>
          <div>
            <p className="text-gray-500">สภาพแวดล้อมจัดเก็บ:</p>
            <p className="font-bold text-green-400 mt-0.5">Google Cloud Firestore</p>
          </div>
          <div>
            <p className="text-gray-500">ผู้พัฒนาแอป:</p>
            <p className="font-bold text-white mt-0.5">Full-Stack AI Architect</p>
          </div>
        </div>
      </div>
    </div>
  );
}
