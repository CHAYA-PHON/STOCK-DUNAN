import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Employee } from "../types";
import { ShieldAlert, UserPlus, Users, Trash2, Edit3, Check, X, ShieldCheck } from "lucide-react";

interface EmployeesViewProps {
  currentUser: Employee | null;
}

export default function EmployeesView({ currentUser }: EmployeesViewProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<string[]>([
    "ฝ่ายผลิต", "สโตร์กลาง", "สโตร์ FG", "สโตร์ WIP", "Planning", "เซลล์"
  ]);
  const [roles, setRoles] = useState<string[]>([
    "admin", "leader", "user_production", "user_store", "user_planning", "sales"
  ]);

  // Form edit states
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // New Employee State
  const [newId, setNewId] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newName, setNewName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [newJobPosition, setNewJobPosition] = useState("");
  const [newDept, setNewDept] = useState("ฝ่ายผลิต");
  const [newRole, setNewRole] = useState("user_production");
  const [newStatus, setNewStatus] = useState<"Active" | "Inactive">("Active");
  const [newShift, setNewShift] = useState<"DAY" | "NIGHT">("DAY");

  // Admin Verification Gate
  const [verificationModalOpen, setVerificationModalOpen] = useState(false);
  const [verificationPin, setVerificationPin] = useState("");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Config settings add
  const [showAddDeptForm, setShowAddDeptForm] = useState(false);
  const [showAddRoleForm, setShowAddRoleForm] = useState(false);
  const [customDeptName, setCustomDeptName] = useState("");
  const [customRoleName, setCustomRoleName] = useState("");

  // Permissions Check: only admin and leader can view/edit
  const isAuthorizedToEdit = currentUser?.role === "admin" || currentUser?.role === "leader";

  useEffect(() => {
    // Roster real-time
    const unsub = onSnapshot(collection(db, "employees"), (snap) => {
      const list: Employee[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Employee));
      setEmployees(list);
    });

    // Custom config
    const unsubSettings = onSnapshot(doc(db, "settings", "general"), (d) => {
      if (d.exists()) {
        const data = d.data();
        if (data.departments) setDepartments(data.departments);
        if (data.roles) setRoles(data.roles);
      }
    });

    return () => {
      unsub();
      unsubSettings();
    };
  }, []);

  const triggerVerifiedAction = (action: () => void) => {
    // If current user is admin, request PIN validation
    if (currentUser?.role === "admin") {
      setPendingAction(() => action);
      setVerificationPin("");
      setVerificationModalOpen(true);
    } else {
      // Just run it if not admin but leader, or warn
      action();
    }
  };

  const handleVerifyPinAndExecute = () => {
    if (verificationPin === currentUser?.pin) {
      if (pendingAction) {
        pendingAction();
      }
      setVerificationModalOpen(false);
      setPendingAction(null);
    } else {
      alert("PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง");
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId || newId.length !== 8) {
      alert("รหัสพนักงานต้องเป็นตัวเลข 8 หลัก");
      return;
    }
    if (!newPin || newPin.length !== 6) {
      alert("PIN สำหรับลงชื่อเข้างานต้องมี 6 หลัก");
      return;
    }

    const emp: Employee = {
      id: newId,
      pin: newPin,
      name: newName,
      lastName: newLastName,
      position: newPosition,
      jobPosition: newJobPosition,
      department: newDept,
      status: newStatus,
      role: newRole,
      shiftWork: newShift,
    };

    try {
      await setDoc(doc(db, "employees", newId), emp);
      alert(`เพิ่มพนักงาน ${newName} เข้าสู่ระบบสำเร็จ`);
      setShowAddForm(false);
      // Reset
      setNewId("");
      setNewPin("");
      setNewName("");
      setNewLastName("");
      setNewPosition("");
      setNewJobPosition("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteEmployee = (id: string, name: string) => {
    triggerVerifiedAction(async () => {
      if (confirm(`คุณต้องการลบพนักงาน ${name} ออกจากระบบถาวรหรือไม่?`)) {
        try {
          await deleteDoc(doc(db, "employees", id));
          alert("ลบข้อมูลสำเร็จ");
        } catch (err) {
          console.error(err);
        }
      }
    });
  };

  const handleUpdateRole = (empId: string, currentEmpName: string, selectedNewRole: string) => {
    if (!isAuthorizedToEdit) {
      alert("สิทธิ์ของคุณไม่สามารถปรับเปลี่ยน Role ของผู้อื่นได้");
      return;
    }

    triggerVerifiedAction(async () => {
      try {
        await setDoc(doc(db, "employees", empId), { role: selectedNewRole }, { merge: true });
        alert(`ปรับเปลี่ยนสิทธิ์ของ ${currentEmpName} เป็น ${selectedNewRole} สำเร็จ`);
      } catch (err) {
        console.error(err);
      }
    });
  };

  const handleAddDept = async () => {
    if (!customDeptName.trim()) return;
    try {
      const list = [...departments, customDeptName.trim()];
      await setDoc(doc(db, "settings", "general"), { departments: list }, { merge: true });
      setCustomDeptName("");
      setShowAddDeptForm(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddRole = async () => {
    if (!customRoleName.trim()) return;
    try {
      const list = [...roles, customRoleName.trim()];
      await setDoc(doc(db, "settings", "general"), { roles: list }, { merge: true });
      setCustomRoleName("");
      setShowAddRoleForm(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">จัดการรายชื่อพนักงานและสิทธิ์การใช้งาน</h2>
          <p className="text-sm text-gray-500 mt-1">กำหนดบทบาทพนักงาน แผนก กะ และสิทธิ์การใช้งานเข้าถึงระบบ</p>
        </div>

        {isAuthorizedToEdit && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer shadow-sm self-stretch md:self-auto justify-center"
          >
            <UserPlus className="w-4 h-4" />
            <span>{showAddForm ? "ซ่อนฟอร์มพนักงาน" : "เพิ่มพนักงานใหม่"}</span>
          </button>
        )}
      </div>

      {/* Roster form */}
      {showAddForm && (
        <form onSubmit={handleAddEmployee} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2 text-base">
            <Users className="w-5 h-5 text-red-600" /> กรอกข้อมูลเพื่อสร้างประวัติพนักงาน
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600">รหัสพนักงาน (8 หลัก) *</label>
              <input
                type="text"
                required
                maxLength={8}
                placeholder="เช่น 00000004"
                value={newId}
                onChange={(e) => setNewId(e.target.value.replace(/\D/g, ""))}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">PIN (6 หลักสำหรับล็อกอิน) *</label>
              <input
                type="password"
                required
                maxLength={6}
                placeholder="เช่น 123456"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">ชื่อจริง *</label>
              <input
                type="text"
                required
                placeholder="ภาษาไทย"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">นามสกุล *</label>
              <input
                type="text"
                required
                placeholder="ภาษาไทย"
                value={newLastName}
                onChange={(e) => setNewLastName(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600">ตำแหน่งงาน (Position)</label>
              <input
                type="text"
                placeholder="เช่น Operator"
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">คำอธิบายตำแหน่ง (Job Position)</label>
              <input
                type="text"
                placeholder="เช่น เจ้าหน้าที่ฝ่ายสโตร์กลาง"
                value={newJobPosition}
                onChange={(e) => setNewJobPosition(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">แผนก (Department)</label>
              <select
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              >
                {departments.map((dept, i) => (
                  <option key={i} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">กะเริ่มต้น (Shift)</label>
              <select
                value={newShift}
                onChange={(e) => setNewShift(e.target.value as "DAY" | "NIGHT")}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              >
                <option value="DAY">DAY (กะกลางวัน)</option>
                <option value="NIGHT">NIGHT (กะกลางคืน)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600">สิทธิ์การใช้งาน (Role)</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              >
                {roles.map((role, i) => (
                  <option key={i} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">สถานะพนักงาน</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as "Active" | "Inactive")}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
              >
                <option value="Active">Active (เปิดใช้งาน)</option>
                <option value="Inactive">Inactive (ระงับชั่วคราว)</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="bg-black hover:bg-gray-800 text-white px-6 py-2.5 rounded-xl font-bold text-sm"
          >
            บันทึกและขึ้นทะเบียนพนักงาน
          </button>
        </form>
      )}

      {/* Expandable Department / Role setups */}
      {isAuthorizedToEdit && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Dept config */}
          <div className="bg-white p-4 border border-gray-100 rounded-2xl">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase">แผนกที่ใช้งานในระบบ</h4>
              <button
                onClick={() => setShowAddDeptForm(!showAddDeptForm)}
                className="text-xs font-bold text-red-600 hover:underline"
              >
                + เพิ่มแผนกใหม่
              </button>
            </div>
            {showAddDeptForm && (
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="เช่น แผนกขนส่ง..."
                  value={customDeptName}
                  onChange={(e) => setCustomDeptName(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50"
                />
                <button onClick={handleAddDept} className="bg-black text-white text-xs px-3 rounded-lg font-bold">
                  บันทึก
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {departments.map((dept, i) => (
                <span key={i} className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2.5 py-1 rounded-md">
                  {dept}
                </span>
              ))}
            </div>
          </div>

          {/* Role config */}
          <div className="bg-white p-4 border border-gray-100 rounded-2xl">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase">สิทธิ์ (Role) ที่ใช้งานในระบบ</h4>
              <button
                onClick={() => setShowAddRoleForm(!showAddRoleForm)}
                className="text-xs font-bold text-red-600 hover:underline"
              >
                + เพิ่มสิทธิ์ใหม่
              </button>
            </div>
            {showAddRoleForm && (
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="เช่น supervisor..."
                  value={customRoleName}
                  onChange={(e) => setCustomRoleName(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50"
                />
                <button onClick={handleAddRole} className="bg-black text-white text-xs px-3 rounded-lg font-bold">
                  บันทึก
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {roles.map((role, i) => (
                <span key={i} className="bg-gray-900 text-white text-[10px] font-bold px-2.5 py-1 rounded-md">
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Roster table */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100 uppercase">
              <tr>
                <th className="p-4">ID (รหัสพนักงาน)</th>
                <th className="p-4">ชื่อ - นามสกุล</th>
                <th className="p-4">ฝ่ายปฏิบัติงาน</th>
                <th className="p-4">สิทธิ์การใช้งาน (Role)</th>
                <th className="p-4">กะทำงาน (Shift)</th>
                <th className="p-4">สถานะ</th>
                {isAuthorizedToEdit && <th className="p-4 text-center w-20">ลบ</th>}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b last:border-0 hover:bg-gray-50/50 transition">
                  <td className="p-4 font-mono font-bold text-gray-900">{emp.id}</td>
                  <td className="p-4">
                    <div className="font-semibold text-gray-800">{emp.name} {emp.lastName}</div>
                    <div className="text-[10px] text-gray-400 font-medium">{emp.jobPosition || emp.position}</div>
                  </td>
                  <td className="p-4 font-medium text-gray-600">{emp.department}</td>
                  <td className="p-4">
                    {isAuthorizedToEdit ? (
                      <select
                        value={emp.role}
                        onChange={(e) => handleUpdateRole(emp.id, emp.name, e.target.value)}
                        className="bg-gray-50 border rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-500"
                      >
                        {roles.map((roleOption, idx) => (
                          <option key={idx} value={roleOption}>
                            {roleOption}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded text-[10px]">
                        {emp.role}
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      emp.shiftWork === "NIGHT" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700"
                    }`}>
                      {emp.shiftWork}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                      emp.status === "Active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"
                    }`}>
                      {emp.status}
                    </span>
                  </td>
                  {isAuthorizedToEdit && (
                    <td className="p-4 text-center">
                      <button
                        onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* VERIFICATION DIALOG MODAL */}
      {verificationModalOpen && (
        <div className="fixed inset-0 z-[220] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border border-gray-100 animate-in fade-in zoom-in duration-200">
            <div className="bg-red-600 p-4 text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              <span className="font-bold">ระบบตรวจสอบความปลอดภัย</span>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                การแก้ไขข้อมูลพนักงานหรือการลบประวัติพนักงาน มีผลต่อระบบเช็คอินและข้อมูลธุรกรรมสต๊อก เพื่อความปลอดภัยโปรดยืนยันด้วย PIN 6 หลักของคุณ
              </p>
              <div>
                <label className="text-xs font-semibold text-gray-600 block">กรอก PIN 6 หลักของคุณเพื่อยืนยัน</label>
                <input
                  type="password"
                  maxLength={6}
                  value={verificationPin}
                  onChange={(e) => setVerificationPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="• • • • • •"
                  className="w-full mt-1 px-3 py-2 text-center text-lg tracking-widest border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex gap-2.5 pt-2">
                <button
                  onClick={() => {
                    setVerificationModalOpen(false);
                    setPendingAction(null);
                  }}
                  className="flex-1 border py-2 rounded-lg text-xs font-semibold"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleVerifyPinAndExecute}
                  className="flex-1 bg-black text-white py-2 rounded-lg text-xs font-bold hover:bg-gray-800"
                >
                  ยืนยันคำขอ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
