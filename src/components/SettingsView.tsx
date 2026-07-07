import React, { useState, useEffect } from "react";
import { collection, doc, writeBatch, setDoc, onSnapshot, deleteDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { Employee, APP_VERSION } from "../types";
import { 
  Settings, Shield, Plus, Key, Layers, Compass, HelpCircle, User, 
  Phone, Image, Calendar, History, UploadCloud, Loader2, CloudLightning, CheckCircle2,
  Trash2, Edit, ArrowRight
} from "lucide-react";

interface SettingsViewProps {
  currentUser: Employee | null;
}

interface LocationBatch {
  id: string;
  prefix: string;
  startIndex: number;
  endIndex: number;
  totalCreated: number;
  createdBy: string;
  createdAt: any;
}

export default function SettingsView({ currentUser }: SettingsViewProps) {
  // PIN update states
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  // Profile Edit states
  const [profileName, setProfileName] = useState(currentUser?.name || "");
  const [profileLastName, setProfileLastName] = useState(currentUser?.lastName || "");
  const [profilePhone, setProfilePhone] = useState(currentUser?.phone || "");

  // Location Batch Generator
  const [locPrefix, setLocPrefix] = useState("CTC");
  const [locStart, setLocStart] = useState<number>(0);
  const [locEnd, setLocEnd] = useState<number>(12);
  const [batchLoading, setBatchLoading] = useState(false);

  // Edit batch states
  const [editingBatch, setEditingBatch] = useState<LocationBatch | null>(null);
  const [editPrefix, setEditPrefix] = useState("");
  const [editStart, setEditStart] = useState<number>(0);
  const [editEnd, setEditEnd] = useState<number>(12);

  // History list of location batches
  const [batches, setBatches] = useState<LocationBatch[]>([]);

  // Delivery Flow settings states
  const [deliveryFlows, setDeliveryFlows] = useState<any[]>([]);
  const [flowType, setFlowType] = useState("รับงาน");
  const [flowName, setFlowName] = useState("");
  const [flowFrom, setFlowFrom] = useState("");
  const [flowTo, setFlowTo] = useState("");
  const [editingFlow, setEditingFlow] = useState<any | null>(null);

  const isAuthorized = currentUser?.role === "admin" || currentUser?.role === "leader";

  // Sync profile editing fields with current logged-in user when it changes
  useEffect(() => {
    if (currentUser) {
      setProfileName(currentUser.name || "");
      setProfileLastName(currentUser.lastName || "");
      setProfilePhone(currentUser.phone || "");
    }
  }, [currentUser]);

  // Read previously created location batches
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "location_batches"), (snapshot) => {
      const items: LocationBatch[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...d.data() } as LocationBatch);
      });
      // Sort by createdAt descending safely
      items.sort((a, b) => {
        const t1 = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
        const t2 = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
        return t2 - t1;
      });
      setBatches(items);
    });
    return unsub;
  }, []);

  // Read and seed dynamic delivery flows
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "deliveryFlows"), async (snapshot) => {
      if (snapshot.empty) {
        // Seed default flows!
        const defaultFlows = [
          { type: "รับงาน", name: "รับเข้าจากฝ่ายผลิต", from: "ไลน์ผลิต", to: "สโตร์กลาง" },
          { type: "รับงาน", name: "รับเข้าคืนซ่อม (Rework)", from: "ไลน์ผลิต", to: "สโตร์กลาง" },
          { type: "รับงาน", name: "รับคืนจากแผนกประกอบ", from: "แผนกประกอบ", to: "สโตร์กลาง" },
          { type: "โอนงาน", name: "โอนย้ายภายใน", from: "สโตร์กลาง", to: "สโตร์กลาง" },
          { type: "ส่งงาน", name: "ส่งสโตร์ FG", from: "สโตร์กลาง", to: "สโตร์ FG" },
          { type: "โอนงาน", name: "เบิกงาน Rework", from: "สโตร์กลาง", to: "ไลน์ผลิต" },
          { type: "โอนงาน", name: "เบิกงานจาก TN", from: "สโตร์ TN", to: "สโตร์กลาง" },
          { type: "โอนงาน", name: "เบิกเพื่อประกอบ", from: "สโตร์กลาง", to: "แผนกประกอบ" },
          { type: "ส่งงาน", name: "จัดส่งลูกค้า", from: "สโตร์ FG", to: "ลูกค้า" },
          { type: "ส่งงาน", name: "ทำลายสินค้า (Scrap)", from: "สโตร์กลาง", to: "Scrap" }
        ];
        try {
          const batch = writeBatch(db);
          defaultFlows.forEach((flow) => {
            const ref = doc(collection(db, "deliveryFlows"));
            batch.set(ref, flow);
          });
          await batch.commit();
        } catch (e) {
          console.error("Seeding error:", e);
        }
      } else {
        const items: any[] = [];
        snapshot.forEach((d) => {
          items.push({ id: d.id, ...d.data() });
        });
        setDeliveryFlows(items);
      }
    });
    return unsub;
  }, []);

  const syncSettingsGeneralWithFlows = async (customFlowList?: any[]) => {
    try {
      let flowsToUse = customFlowList;
      if (!flowsToUse) {
        const { getDocs } = await import("firebase/firestore");
        const snap = await getDocs(collection(db, "deliveryFlows"));
        const items: any[] = [];
        snap.forEach(d => items.push(d.data()));
        flowsToUse = items;
      }
      
      const updatedInTypes = flowsToUse.filter(f => f.type === "รับงาน").map(f => f.name);
      const updatedOutTypes = flowsToUse.filter(f => f.type === "ส่งงาน" || f.type === "โอนงาน").map(f => f.name);

      await setDoc(doc(db, "settings", "general"), {
        inTypes: updatedInTypes,
        outTypes: updatedOutTypes
      }, { merge: true });
    } catch (err) {
      console.error("Sync general error:", err);
    }
  };

  const handleSaveFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลส่วนตัวได้");
      return;
    }
    if (!flowName.trim() || !flowFrom.trim() || !flowTo.trim()) {
      alert("กรุณากรอกข้อมูลให้ครบถ้วน");
      return;
    }

    try {
      const flowData = {
        type: flowType,
        name: flowName.trim(),
        from: flowFrom.trim(),
        to: flowTo.trim()
      };

      if (editingFlow) {
        await setDoc(doc(db, "deliveryFlows", editingFlow.id), flowData, { merge: true });
        const updatedList = deliveryFlows.map(f => f.id === editingFlow.id ? { id: f.id, ...flowData } : f);
        await syncSettingsGeneralWithFlows(updatedList);
        alert(`แก้ไขประเภทการจัดส่ง "${flowName.trim()}" สำเร็จเรียบร้อย!`);
        setEditingFlow(null);
      } else {
        const newRef = doc(collection(db, "deliveryFlows"));
        await setDoc(newRef, flowData);
        const updatedList = [...deliveryFlows, { id: newRef.id, ...flowData }];
        await syncSettingsGeneralWithFlows(updatedList);
        alert(`เพิ่มประเภทการจัดส่ง "${flowName.trim()}" สำเร็จเรียบร้อย!`);
      }

      setFlowName("");
      setFlowFrom("");
      setFlowTo("");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการบันทึกข้อมูลประเภทการส่งงาน");
    }
  };

  const handleDeleteFlow = async (id: string, name: string) => {
    if (!currentUser) return;
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลส่วนตัวได้");
      return;
    }

    const confirmDelete = window.confirm(`คุณต้องการลบประเภทการจัดส่ง "${name}" หรือไม่?`);
    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, "deliveryFlows", id));
      const updatedList = deliveryFlows.filter(f => f.id !== id);
      await syncSettingsGeneralWithFlows(updatedList);
      alert(`ลบประเภทการจัดส่ง "${name}" สำเร็จ!`);
      if (editingFlow?.id === id) {
        setEditingFlow(null);
        setFlowName("");
        setFlowFrom("");
        setFlowTo("");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการลบประเภทการส่งงาน");
    }
  };

  const handleEditFlow = (flow: any) => {
    setEditingFlow(flow);
    setFlowType(flow.type);
    setFlowName(flow.name);
    setFlowFrom(flow.from);
    setFlowTo(flow.to);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลส่วนตัวได้");
      return;
    }

    try {
      await setDoc(
        doc(db, "employees", currentUser.id),
        {
          name: profileName.trim(),
          lastName: profileLastName.trim(),
          phone: profilePhone.trim(),
        },
        { merge: true }
      );
      alert("อัปเดตข้อมูลส่วนตัวในระบบสำเร็จเรียบร้อย!");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการอัปเดตข้อมูลส่วนตัว");
    }
  };

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
      // Update local state reference
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
    if (!currentUser) return;
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถสร้างพิกัดได้");
      return;
    }
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

      // Log metadata to location_batches collection
      const batchLogRef = doc(collection(db, "location_batches"));
      await setDoc(batchLogRef, {
        prefix: locPrefix.trim().toUpperCase(),
        startIndex: locStart,
        endIndex: locEnd,
        totalCreated: generatedCount,
        createdBy: `${currentUser.name} ${currentUser.lastName}`,
        createdAt: new Date(),
      });

      alert(`สร้างพิกัดจัดเก็บสินค้า Location จำนวน ${generatedCount} พิกัด สำเร็จเรียบร้อย!`);
    } catch (err) {
      console.error("Batch Location Generation failure:", err);
      alert("ไม่สามารถบันทึกคีย์ Location ลงระบบได้");
    } finally {
      setBatchLoading(false);
    }
  };

  const handleDeleteBatch = async (batchItem: LocationBatch) => {
    if (!currentUser) return;
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการลบได้");
      return;
    }

    const deleteLocations = window.confirm(
      `คุณต้องการลบประวัติการสร้างชุดพิกัด "${batchItem.prefix}" หรือไม่?\n\n*ต้องการลบตำแหน่ง Location ทั้งหมด (${batchItem.prefix}-${batchItem.startIndex.toString().padStart(2, "0")} ถึง ${batchItem.prefix}-${batchItem.endIndex.toString().padStart(2, "0")}) ออกจากฐานข้อมูลระบบด้วยหรือไม่?`
    );

    if (deleteLocations) {
      try {
        const batch = writeBatch(db);
        
        // 1. Delete generated locations from the locations collection
        for (let i = batchItem.startIndex; i <= batchItem.endIndex; i++) {
          const paddedNum = i.toString().padStart(2, "0");
          const locName = `${batchItem.prefix.toUpperCase()}-${paddedNum}`;
          const locRef = doc(db, "locations", locName);
          batch.delete(locRef);
        }

        // 2. Delete the batch log doc
        const batchLogRef = doc(db, "location_batches", batchItem.id);
        batch.delete(batchLogRef);

        await batch.commit();
        alert("ลบข้อมูลประวัติชุดพิกัดและตำแหน่ง Location สำเร็จเรียบร้อย!");
      } catch (err) {
        console.error(err);
        alert("เกิดข้อผิดพลาดในการลบข้อมูล: " + (err instanceof Error ? err.message : String(err)));
      }
    }
  };

  const handleStartEditBatch = (batchItem: LocationBatch) => {
    setEditingBatch(batchItem);
    setEditPrefix(batchItem.prefix);
    setEditStart(batchItem.startIndex);
    setEditEnd(batchItem.endIndex);
  };

  const handleUpdateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBatch || !currentUser) return;

    try {
      const batch = writeBatch(db);

      // 1. Delete old generated locations first (safely based on the old batch metadata)
      for (let i = editingBatch.startIndex; i <= editingBatch.endIndex; i++) {
        const paddedNum = i.toString().padStart(2, "0");
        const locName = `${editingBatch.prefix.toUpperCase()}-${paddedNum}`;
        const locRef = doc(db, "locations", locName);
        batch.delete(locRef);
      }

      // 2. Write new generated locations
      const generatedCount = editEnd - editStart + 1;
      for (let i = editStart; i <= editEnd; i++) {
        const paddedNum = i.toString().padStart(2, "0");
        const locName = `${editPrefix.trim().toUpperCase()}-${paddedNum}`;
        const locRef = doc(db, "locations", locName);
        batch.set(locRef, {
          name: locName,
          created: new Date(),
        });
      }

      // 3. Update the batch metadata document
      const batchLogRef = doc(db, "location_batches", editingBatch.id);
      batch.set(batchLogRef, {
        prefix: editPrefix.trim().toUpperCase(),
        startIndex: editStart,
        endIndex: editEnd,
        totalCreated: generatedCount,
        createdBy: `${currentUser.name} ${currentUser.lastName}`,
        createdAt: new Date(),
      });

      await batch.commit();
      alert("แก้ไขข้อมูลชุดพิกัดและอัปเดตตำแหน่ง Location สำเร็จเรียบร้อย!");
      setEditingBatch(null);
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการแก้ไขข้อมูลชุดพิกัด: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleQuickCreateDitGmt = async () => {
    if (!currentUser) return;
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถสร้างพิกัดได้");
      return;
    }
    const confirmSeed = window.confirm("คุณต้องการจำลองสร้างข้อมูลพิกัด DIT-00 ถึง DIT-12 และ GMT-00 ถึง GMT-12 ทั้งหมดพร้อมบันทึกลงประวัติทันทีเลยหรือไม่?");
    if (!confirmSeed) return;

    setBatchLoading(true);
    try {
      const batch = writeBatch(db);
      
      // DIT (0 to 12)
      for (let i = 0; i <= 12; i++) {
        const paddedNum = i.toString().padStart(2, "0");
        const locName = `DIT-${paddedNum}`;
        const ref = doc(db, "locations", locName);
        batch.set(ref, { name: locName, created: new Date() });
      }
      
      // GMT (0 to 12)
      for (let i = 0; i <= 12; i++) {
        const paddedNum = i.toString().padStart(2, "0");
        const locName = `GMT-${paddedNum}`;
        const ref = doc(db, "locations", locName);
        batch.set(ref, { name: locName, created: new Date() });
      }

      await batch.commit();

      // Log both to location_batches
      const batchLogRef1 = doc(collection(db, "location_batches"));
      await setDoc(batchLogRef1, {
        prefix: "DIT",
        startIndex: 0,
        endIndex: 12,
        totalCreated: 13,
        createdBy: `${currentUser.name} ${currentUser.lastName}`,
        createdAt: new Date(),
      });

      const batchLogRef2 = doc(collection(db, "location_batches"));
      await setDoc(batchLogRef2, {
        prefix: "GMT",
        startIndex: 0,
        endIndex: 12,
        totalCreated: 13,
        createdBy: `${currentUser.name} ${currentUser.lastName}`,
        createdAt: new Date(),
      });

      alert("สร้างชุดข้อมูลพิกัด DIT และ GMT (00-12) อัตโนมัติในระบบฐานข้อมูลเรียบร้อยแล้ว!");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการสร้างข้อมูลพิกัด DIT และ GMT: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">ตั้งค่าระบบ (Settings)</h2>
          <p className="text-sm text-gray-500 mt-1">แก้ไขข้อมูลส่วนตัว และสร้างพิกัดอัตโนมัติ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* LEFT COLUMN: Profile & PIN Settings */}
        <div className="space-y-6">
          
          {/* Profile Details Edit Card */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <User className="w-5 h-5 text-red-600" /> แก้ไขข้อมูลส่วนตัว (Edit Personal Profile)
            </h3>
            <p className="text-xs text-gray-400">อัปเดตข้อมูล ชื่อ นามสกุล และเบอร์โทรศัพท์ของคุณ</p>

            <form onSubmit={handleUpdateProfile} className="space-y-4">
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ชื่อจริง</label>
                  <input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="เช่น สมชาย"
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-xs focus:ring-1 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 block">นามสกุล</label>
                  <input
                    type="text"
                    required
                    value={profileLastName}
                    onChange={(e) => setProfileLastName(e.target.value)}
                    placeholder="เช่น ใจดี"
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-xs focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">เบอร์โทรศัพท์ (Phone Number)</label>
                  <div className="relative mt-1">
                    <Phone className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value.replace(/[^\d+-\s]/g, ""))}
                      placeholder="เช่น 089-123-4567"
                      className="w-full pl-9 pr-3 py-2 border rounded-xl text-xs focus:ring-1 focus:ring-red-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer w-full flex items-center justify-center gap-1.5"
              >
                <User className="w-4 h-4" />
                <span>บันทึกข้อมูลส่วนตัว</span>
              </button>
            </form>
          </div>

          {/* Change Password / PIN Card */}
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
                  className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500 font-mono"
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
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500 font-mono"
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
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500 font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="bg-black hover:bg-gray-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer w-full flex items-center justify-center gap-1.5"
              >
                <Key className="w-4 h-4" />
                <span>อัปเดตรหัส PIN พนักงาน</span>
              </button>
            </form>
          </div>

        </div>

        {/* RIGHT COLUMN: Automated Location Batch Creator & List */}
        <div className="space-y-6">
          
          {/* Location Generator Form Card */}
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

                {/* Quick Presets Row */}
                <div className="flex flex-wrap gap-2 items-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                  <span className="text-[10px] text-gray-500 font-semibold">ปุ่มลัดระบุ Prefix ด่วน:</span>
                  {["CTC", "WIP", "FG", "DIT", "GMT"].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setLocPrefix(preset);
                        setLocStart(0);
                        setLocEnd(12);
                      }}
                      className="text-[10px] bg-red-50 hover:bg-red-100 text-red-600 border border-red-200/50 px-2 py-0.5 rounded-md font-extrabold transition cursor-pointer"
                    >
                      {preset} (00-12)
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleQuickCreateDitGmt}
                    className="text-[10px] bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded-md font-extrabold transition ml-auto flex items-center gap-1 cursor-pointer"
                  >
                    ⚡ สร้างชุด DIT + GMT ทั้งหมดด่วน
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={batchLoading}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-1 transition shadow-sm cursor-pointer disabled:bg-gray-300 disabled:cursor-not-allowed w-full"
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

          {/* Newly requested list of previously created batches */}
          {isAuthorized && (
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <History className="w-5 h-5 text-red-600" /> ชุดพิกัดที่สร้างไปแล้ว (Created Location Batches)
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                แสดงประวัติและรายการชุดรหัสพิกัดจัดเก็บสินค้าที่เคยถูกสร้างขึ้นอัตโนมัติในฐานข้อมูลระบบ
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50 text-slate-500 font-bold uppercase">
                      <th className="py-2.5 px-3">ชื่อ (Prefix)</th>
                      <th className="py-2.5 px-3 text-center">เริ่มต้น</th>
                      <th className="py-2.5 px-3 text-center">สิ้นสุด</th>
                      <th className="py-2.5 px-3 text-center">รวมที่สร้าง</th>
                      <th className="py-2.5 px-3">ผู้บันทึก</th>
                      <th className="py-2.5 px-3 text-center w-24">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 italic bg-slate-50/20 rounded-b-xl">
                          ยังไม่มีประวัติการจัดสร้างในระบบคลาวด์
                        </td>
                      </tr>
                    ) : (
                      batches.map((batchItem) => (
                        <tr key={batchItem.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition font-medium">
                          <td className="py-2 px-3 font-extrabold text-red-600 uppercase font-mono">{batchItem.prefix}</td>
                          <td className="py-2 px-3 text-center font-mono text-slate-600">{batchItem.startIndex.toString().padStart(2, "0")}</td>
                          <td className="py-2 px-3 text-center font-mono text-slate-600">{batchItem.endIndex.toString().padStart(2, "0")}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="bg-slate-100 text-slate-800 font-bold font-mono text-[10px] px-2 py-0.5 rounded-full">
                              {batchItem.totalCreated} พิกัด
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-500 truncate max-w-[100px]" title={batchItem.createdBy}>
                            {batchItem.createdBy || "System"}
                          </td>
                          <td className="py-2 px-3 text-center flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleStartEditBatch(batchItem)}
                              className="bg-gray-50 hover:bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200 text-[10px] font-bold transition cursor-pointer"
                              title="แก้ไขพิกัด"
                            >
                              แก้ไข
                            </button>
                            <button
                              onClick={() => handleDeleteBatch(batchItem)}
                              className="bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1 rounded border border-red-200/30 text-[10px] font-bold transition cursor-pointer"
                              title="ลบพิกัด"
                            >
                              ลบ
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* DELIVERY FLOWS CONFIGURATION CARD */}
      {isAuthorized && (
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Layers className="w-5 h-5 text-red-600" /> จัดการประเภทการจัดส่งงาน (Manage Delivery Types)
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              เพิ่ม ลบ หรือแก้ไขประเภทการจัดส่งงาน กำหนดต้นทางและปลายทาง สำหรับแสดงผลในระบบและพิมพ์ใบส่งงานโอนสินค้า
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            
            {/* Form Column */}
            <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4 h-fit">
              <h4 className="font-bold text-xs text-gray-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                <Plus className="w-4 h-4 text-red-600" />
                <span>{editingFlow ? "แก้ไขประเภทการจัดส่ง" : "เพิ่มประเภทการจัดส่งใหม่"}</span>
              </h4>

              <form onSubmit={handleSaveFlow} className="space-y-4 text-xs">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">กลุ่มประเภทการจัดส่ง</label>
                  <select
                    value={flowType}
                    onChange={(e) => setFlowType(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-xs bg-white focus:ring-1 focus:ring-red-500"
                  >
                    <option value="รับงาน">รับงาน (Inward / Receiving)</option>
                    <option value="โอนงาน">โอนงาน (Internal / Transfer)</option>
                    <option value="ส่งงาน">ส่งงาน (Outward / Shipping)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ชื่อประเภทการจัดส่ง</label>
                  <input
                    type="text"
                    required
                    value={flowName}
                    onChange={(e) => setFlowName(e.target.value)}
                    placeholder="เช่น รับงานเข้าจากไลน์ผลิต"
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-xs bg-white focus:ring-1 focus:ring-red-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block">รับจาก (ต้นทาง)</label>
                    <input
                      type="text"
                      required
                      value={flowFrom}
                      onChange={(e) => setFlowFrom(e.target.value)}
                      placeholder="เช่น ไลน์ผลิต"
                      className="w-full mt-1 px-3 py-2 border rounded-xl text-xs bg-white focus:ring-1 focus:ring-red-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-600 block">ส่งไป (ปลายทาง)</label>
                    <input
                      type="text"
                      required
                      value={flowTo}
                      onChange={(e) => setFlowTo(e.target.value)}
                      placeholder="เช่น สโตร์กลาง"
                      className="w-full mt-1 px-3 py-2 border rounded-xl text-xs bg-white focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  {editingFlow && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingFlow(null);
                        setFlowName("");
                        setFlowFrom("");
                        setFlowTo("");
                      }}
                      className="flex-1 px-3 py-2 border text-slate-600 rounded-xl hover:bg-slate-50 transition font-bold text-xs cursor-pointer text-center"
                    >
                      ยกเลิก
                    </button>
                  )}
                  <button
                    type="submit"
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {editingFlow ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    <span>{editingFlow ? "บันทึกแก้ไข" : "เพิ่มข้อมูล"}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* List/Table Column */}
            <div className="xl:col-span-2 space-y-3">
              <h4 className="font-bold text-xs text-gray-700 uppercase tracking-wider">
                รายการประเภทการจัดส่งปัจจุบัน ({deliveryFlows.length} รายการ)
              </h4>

              <div className="border border-slate-100 rounded-2xl overflow-hidden bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50 text-slate-500 font-bold uppercase">
                        <th className="py-2.5 px-3">กลุ่ม</th>
                        <th className="py-2.5 px-3">ชื่อประเภทการจัดส่ง</th>
                        <th className="py-2.5 px-3">เส้นทางจัดส่ง (จาก ➔ ไป)</th>
                        <th className="py-2.5 px-3 text-center w-24">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveryFlows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-slate-400 italic">
                            ไม่พบข้อมูลประเภทการจัดส่งในระบบ
                          </td>
                        </tr>
                      ) : (
                        deliveryFlows.map((flow) => (
                          <tr key={flow.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition font-medium">
                            <td className="py-2.5 px-3">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                flow.type === "รับงาน"
                                  ? "bg-blue-50 text-blue-600 border border-blue-100"
                                  : flow.type === "โอนงาน"
                                  ? "bg-amber-50 text-amber-600 border border-amber-100"
                                  : "bg-green-50 text-green-600 border border-green-100"
                              }`}>
                                {flow.type}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-950">{flow.name}</td>
                            <td className="py-2.5 px-3 text-slate-600">
                              <div className="flex items-center gap-1.5">
                                <span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-700">{flow.from}</span>
                                <ArrowRight className="w-3 h-3 text-slate-400" />
                                <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded font-bold">{flow.to}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleEditFlow(flow)}
                                className="bg-slate-50 hover:bg-slate-100 text-slate-700 p-1 rounded border border-slate-200 transition cursor-pointer"
                                title="แก้ไขประเภทการจัดส่ง"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteFlow(flow.id, flow.name)}
                                className="bg-red-50 hover:bg-red-100 text-red-600 p-1 rounded border border-red-200/30 transition cursor-pointer"
                                title="ลบประเภทการจัดส่ง"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* System info */}
      <div className="bg-gray-900 text-gray-400 p-6 rounded-2xl space-y-3.5 border border-gray-800">
        <h4 className="text-white font-bold text-sm flex items-center gap-1.5">
          <Settings className="w-4.5 h-4.5 text-red-505 animate-spin" /> ข้อมูลระบบเวอร์ชันแอปพลิเคชัน
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px] font-mono leading-relaxed">
          <div>
            <p className="text-gray-500">เวอร์ชันรหัสสินค้า:</p>
            <p className="font-bold text-white mt-0.5">{APP_VERSION}</p>
          </div>
          <div>
            <p className="text-gray-500">อัปเดตล่าสุดเมื่อ:</p>
            <p className="font-bold text-white mt-0.5">6 กรกฎาคม พ.ศ. 2569</p>
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

      {/* EDIT LOCATION BATCH MODAL */}
      {editingBatch && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border border-gray-100 p-6 space-y-4 text-xs">
            <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-1.5 border-b pb-2">
              <Compass className="w-4 h-4 text-red-600 animate-spin" /> แก้ไขชุดรหัสพิกัดจัดเก็บ (Edit Location Batch)
            </h3>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              *การแก้ไขจะทำการลบพิกัดตำแหน่งของชุดนี้เดิมออกทั้งหมด และสร้างใหม่ตามพารามิเตอร์ด้านล่างนี้โดยอัตโนมัติ
            </p>

            <form onSubmit={handleUpdateBatch} className="space-y-4">
              <div>
                <label className="font-bold text-gray-600">Prefix คำนำหน้า</label>
                <input
                  type="text"
                  required
                  value={editPrefix}
                  onChange={(e) => setEditPrefix(e.target.value)}
                  className="w-full mt-1 p-2 border rounded-lg font-bold uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-gray-600">เลขดัชนีเริ่มต้น</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editStart}
                    onChange={(e) => setEditStart(Number(e.target.value))}
                    className="w-full mt-1 p-2 border rounded-lg text-center"
                  />
                </div>
                <div>
                  <label className="font-bold text-gray-600">เลขดัชนีสิ้นสุด</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editEnd}
                    onChange={(e) => setEditEnd(Number(e.target.value))}
                    className="w-full mt-1 p-2 border rounded-lg text-center"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setEditingBatch(null)}
                  className="flex-1 px-4 py-2 border rounded-xl hover:bg-gray-50 transition cursor-pointer text-gray-600 text-center"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition font-bold cursor-pointer text-center"
                >
                  บันทึกการแก้ไข
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
