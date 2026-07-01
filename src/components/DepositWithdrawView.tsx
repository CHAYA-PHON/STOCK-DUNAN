import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Product, Employee, DepositWithdrawal } from "../types";
import { fuzzySearch } from "../utils/fuzzy";
import { Search, PlusCircle, ArrowDownCircle, ArrowUpCircle, Trash2, Edit, CheckCircle, ShieldAlert } from "lucide-react";

interface DepositWithdrawViewProps {
  currentUser: Employee | null;
}

export default function DepositWithdrawView({ currentUser }: DepositWithdrawViewProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [records, setRecords] = useState<DepositWithdrawal[]>([]);

  // Search and form inputs
  const [partSearch, setPartSearch] = useState("");
  const [fuzzyResults, setFuzzyResults] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState<number>(0);
  const [actionType, setActionType] = useState<"deposit" | "withdraw">("deposit");

  // Edit record state
  const [editingRecord, setEditingRecord] = useState<DepositWithdrawal | null>(null);
  const [editingQty, setEditingQty] = useState<number>(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const isStorekeeper = currentUser?.role === "user_store" || currentUser?.role === "admin" || currentUser?.role === "leader";

  useEffect(() => {
    // 1. Fetch products
    const unsubProds = onSnapshot(collection(db, "products"), (snap) => {
      const items: Product[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Product));
      setProducts(items);
    });

    // 2. Fetch deposits and withdrawals (ordered by newest first)
    const unsubReqs = onSnapshot(collection(db, "deposits_withdrawals"), (snap) => {
      const items: DepositWithdrawal[] = [];
      snap.forEach((d) => {
        const data = d.data();
        items.push({
          id: d.id,
          ...data,
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
        } as DepositWithdrawal);
      });
      items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      setRecords(items);
    });

    return () => {
      unsubProds();
      unsubReqs();
    };
  }, []);

  // Sync Fuzzy search
  useEffect(() => {
    if (!partSearch.trim()) {
      setFuzzyResults([]);
      return;
    }
    const results = fuzzySearch<Product>(products, partSearch, (p) => p.partNo, 3);
    setFuzzyResults(results);

    const exact = products.find((p) => p.partNo.toLowerCase() === partSearch.trim().toLowerCase());
    if (exact) {
      handleSelectProduct(exact);
    }
  }, [partSearch, products]);

  const handleSelectProduct = (prod: Product) => {
    setSelectedProduct(prod);
    setFuzzyResults([]);
  };

  // Helper: calculate total verified deposit balance in system for a part No
  const getVerifiedDepositBalance = (partNo: string) => {
    const totalDeposited = records
      .filter((r) => r.partNo === partNo && r.type === "deposit" && r.status === "verified")
      .reduce((acc, r) => acc + r.qty, 0);

    const totalWithdrawn = records
      .filter((r) => r.partNo === partNo && r.type === "withdraw" && r.status === "verified")
      .reduce((acc, r) => acc + r.qty, 0);

    return totalDeposited - totalWithdrawn;
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      alert("กรุณาเลือกสินค้าก่อนยื่นฝาก/เบิก");
      return;
    }
    if (qty <= 0) {
      alert("จำนวนชิ้นงานต้องมากกว่า 0");
      return;
    }

    // Constraint: Withdrawal balance check
    if (actionType === "withdraw") {
      const activeBalance = getVerifiedDepositBalance(selectedProduct.partNo);
      if (qty > activeBalance) {
        alert(`ไม่สามารถเบิกงานได้: มียอดชิ้นงานฝากคงค้างทั้งหมดเพียง ${activeBalance} ชิ้น (คุณร้องขอเบิก ${qty} ชิ้น)`);
        return;
      }
    }

    try {
      const recId = `DEP-${Date.now().toString().slice(-8)}`;
      const newRec: DepositWithdrawal = {
        id: recId,
        partNo: selectedProduct.partNo,
        partName: selectedProduct.partName,
        customer: selectedProduct.customer,
        qty,
        type: actionType,
        status: "pending",
        operatorId: currentUser?.id || "00000000",
        operatorName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "Operator",
        timestamp: new Date(),
      };

      await setDoc(doc(db, "deposits_withdrawals", recId), newRec);
      alert(`บันทึกคำร้องขอ ${actionType === "deposit" ? "ฝากงาน" : "เบิกงาน"} เรียบร้อยแล้ว (รอเจ้าหน้าที่สโตร์ตรวจรับตรวจสอบ)`);
      
      // Reset inputs
      setPartSearch("");
      setSelectedProduct(null);
      setQty(0);
    } catch (err) {
      console.error(err);
    }
  };

  const handleVerify = async (record: DepositWithdrawal) => {
    if (!isStorekeeper) {
      alert("บัญชีของคุณไม่มีสิทธิ์ทำการตรวจรับหรือจัดงานคืน");
      return;
    }

    // Double check balance before verifying a withdraw request
    if (record.type === "withdraw") {
      const activeBalance = getVerifiedDepositBalance(record.partNo);
      if (record.qty > activeBalance) {
        alert(`ไม่สามารถยืนยันการเบิกได้: ยอดชิ้นงานฝากจริงในระบบถูกใช้ออกไปแล้ว เหลือคงค้างเพียง ${activeBalance} ชิ้น (คำขอต้องการเบิก ${record.qty} ชิ้น)`);
        return;
      }
    }

    try {
      await updateDoc(doc(db, "deposits_withdrawals", record.id), {
        status: "verified",
        verifiedBy: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "Storekeeper",
        verifiedTimestamp: new Date(),
      });
      alert(`ตรวจรับ / ตรวจสอบจัดส่ง คืนงาน ${record.partNo} สำเร็จเสร็จสิ้น`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, "deposits_withdrawals", id));
      alert("ลบข้อมูลสำเร็จ");
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenEdit = (record: DepositWithdrawal) => {
    setEditingRecord(record);
    setEditingQty(record.qty);
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    try {
      await updateDoc(doc(db, "deposits_withdrawals", editingRecord.id), {
        qty: editingQty,
      });
      setEditingRecord(null);
      alert("แก้ไขจำนวนยอดฝาก/เบิกสำเร็จ");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">ระบบรับฝากและเบิกงาน (Deposit / Withdrawal)</h2>
          <p className="text-sm text-gray-500 mt-1">คลังจัดเก็บแยกเฉพาะสำหรับชิ้นงานฝากประกอบ ชิ้นงานซ่อมบำรุง หรือ Rework</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Input panel */}
        <form onSubmit={handleCreateRequest} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4.5 lg:col-span-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-red-600" /> สร้างคำขอฝากหรือเบิกชิ้นงาน
          </h3>

          <div className="flex gap-1.5 p-1 bg-gray-100 rounded-xl">
            <button
              type="button"
              onClick={() => setActionType("deposit")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                actionType === "deposit" ? "bg-white text-green-700 shadow-xs" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <ArrowDownCircle className="w-4 h-4" />
              <span>ฝากชิ้นงาน (Deposit)</span>
            </button>
            <button
              type="button"
              onClick={() => setActionType("withdraw")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                actionType === "withdraw" ? "bg-white text-red-700 shadow-xs" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <ArrowUpCircle className="w-4 h-4" />
              <span>เบิกคืน (Withdraw)</span>
            </button>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block">ค้นหา Part No (Fuzzy Search)</label>
            <div className="relative mt-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="พิมพ์รหัสสินค้าเพื่อฝาก/เบิก..."
                value={partSearch}
                onChange={(e) => setPartSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm"
              />
            </div>

            {fuzzyResults.length > 0 && (
              <div className="bg-white border rounded-xl max-h-[140px] overflow-y-auto shadow-md p-1 mt-1 space-y-0.5 relative z-10">
                {fuzzyResults.slice(0, 5).map((prod) => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => handleSelectProduct(prod)}
                    className="w-full text-left text-xs p-2 rounded-lg hover:bg-gray-50 flex justify-between"
                  >
                    <span className="font-bold">{prod.partNo}</span>
                    <span className="text-gray-400">ฝากค้าง: {getVerifiedDepositBalance(prod.partNo)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedProduct && (
            <div className="bg-gray-50 p-4 rounded-xl border space-y-2.5 text-xs">
              <div className="flex justify-between font-bold">
                <span className="text-gray-800">{selectedProduct.partNo}</span>
                <span className="text-gray-400 font-medium">ลูกค้า: {selectedProduct.customer}</span>
              </div>
              <p className="text-gray-500">{selectedProduct.partName}</p>

              <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-gray-100 font-semibold">
                <span className="text-gray-500">ยอดฝากค้าง verified ในระบบ:</span>
                <span className="text-gray-900 font-bold text-sm">
                  {getVerifiedDepositBalance(selectedProduct.partNo).toLocaleString()} ชิ้น
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block">จำนวนพาร์ทที่จะทำรายการ *</label>
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold focus:ring-1 focus:ring-red-500 outline-none"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!selectedProduct}
            className={`w-full text-white py-2.5 rounded-xl text-xs font-bold transition disabled:bg-gray-100 disabled:text-gray-400 ${
              actionType === "deposit" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            ยื่นขออนุมัติ {actionType === "deposit" ? "ฝากสินค้า" : "เบิกคืนชิ้นงาน"}
          </button>
        </form>

        {/* List pane */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-8 space-y-4">
          <div>
            <h3 className="font-bold text-gray-800">ประวัติการฝาก/เบิกงานแยกส่วน</h3>
            <p className="text-xs text-gray-400">รายการรับฝากจากฝ่ายผลิตและตรวจสอบจัดงานคืนโดยสโตร์</p>
          </div>

          <div className="overflow-x-auto border border-gray-50 rounded-xl max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 font-bold uppercase border-b">
                <tr>
                  <th className="p-3">วันเวลา</th>
                  <th className="p-3">ประเภท</th>
                  <th className="p-3">พาร์ทสินค้า / ลูกค้า</th>
                  <th className="p-3 text-right">จำนวน Qty</th>
                  <th className="p-3 text-center">สถานะ</th>
                  <th className="p-3 text-center w-28">การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-gray-400 italic">
                      ยังไม่มีข้อมูลประวัติรายการรับฝากหรือเบิกชิ้นงานในระบบ
                    </td>
                  </tr>
                ) : (
                  records.map((rec) => (
                    <tr key={rec.id} className="border-b last:border-0 hover:bg-gray-50/40 transition">
                      <td className="p-3 text-gray-400 font-mono">
                        {rec.timestamp.toLocaleDateString("th-TH")}
                        <div className="text-[10px]">{rec.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} น.</div>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                          rec.type === "deposit" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        }`}>
                          {rec.type === "deposit" ? "ฝากงาน" : "เบิกงาน"}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-gray-800">{rec.partNo}</div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[150px]">{rec.partName}</div>
                        <div className="text-[9px] text-gray-400 font-medium">ยื่นโดย: {rec.operatorName}</div>
                      </td>
                      <td className="p-3 text-right font-bold text-gray-800">{rec.qty.toLocaleString()}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                          rec.status === "verified" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700 animate-pulse"
                        }`}>
                          {rec.status === "verified" ? "สโตร์รับแล้ว" : "รอดำเนินการ"}
                        </span>
                        {rec.verifiedBy && (
                          <div className="text-[9px] text-gray-400 mt-1">ผู้ตรวจ: {rec.verifiedBy}</div>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {rec.status === "pending" && isStorekeeper && (
                            <button
                              onClick={() => handleVerify(rec)}
                              className="bg-green-600 hover:bg-green-700 text-white p-1 rounded-md"
                              title="อนุมัติ/ตรวจรับเสร็จสิ้น"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEdit(rec)}
                            className="text-gray-400 hover:text-black p-1 rounded-md"
                            title="แก้ไขจำนวน"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(rec.id)}
                            className="text-gray-400 hover:text-red-600 p-1 rounded-md cursor-pointer"
                            title="ลบรายการ"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* DEPOSIT INVENTORY REPORT PANEL */}
      <div className="bg-slate-950 text-white p-6 rounded-3xl border border-slate-800 shadow-2xl space-y-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="inline-flex items-center gap-2 bg-red-600/10 text-red-500 font-bold text-[10px] uppercase px-2.5 py-1 rounded-full border border-red-500/20 mb-2">
              <span>Real-time Ledger</span>
            </div>
            <h3 className="text-lg font-bold tracking-tight">รายงานยอดชิ้นงานฝากค้างและ Rework คงเหลือ (Deposit & Rework Inventory Report)</h3>
            <p className="text-xs text-slate-400 mt-1">สรุปข้อมูลเฉพาะชิ้นงานที่ยังฝากค้างอยู่ในคลังแยกส่วน ณ ปัจจุบัน</p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                const activeDepositsReport = products
                  .map((prod) => {
                    const balance = getVerifiedDepositBalance(prod.partNo);
                    return { ...prod, depositBalance: balance };
                  })
                  .filter((p) => p.depositBalance > 0);

                const header = "ลำดับ\tลูกค้า (Customer)\tรหัสสินค้า (Part No)\tชื่อสินค้า (Part Name)\tโซนเก็บ (Zone)\tยอดฝากคงค้าง (Qty)\n";
                const rows = activeDepositsReport.map((p, idx) => 
                  `${idx + 1}\t${p.customer}\t${p.partNo}\t${p.partName}\t${p.zone || '-'}\t${p.depositBalance}`
                ).join("\n");
                
                const clipboardText = header + rows;
                navigator.clipboard.writeText(clipboardText);
                alert("คัดลอกรายงานยอดฝากคงค้างไปยังคลิปบอร์ดแล้ว! สามารถวางลงใน Excel ได้ทันที");
              }}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-slate-700 cursor-pointer select-none"
            >
              <span>คัดลอกรายงานเพื่อ Excel</span>
            </button>
          </div>
        </div>

        {/* Dashboard summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-[11px] font-bold">จำนวนประเภทพาร์ทที่มีงานฝากค้าง</p>
              <h4 className="text-2xl font-black mt-1 text-red-500">
                {products.filter(p => getVerifiedDepositBalance(p.partNo) > 0).length.toLocaleString()} <span className="text-xs text-slate-400 font-normal">รายการ</span>
              </h4>
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <span className="text-xl">📦</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-[11px] font-bold">ยอดจำนวนชิ้นงานฝากคงค้างสะสมทั้งหมด</p>
              <h4 className="text-2xl font-black mt-1 text-emerald-400">
                {products.reduce((sum, p) => sum + getVerifiedDepositBalance(p.partNo), 0).toLocaleString()} <span className="text-xs text-slate-400 font-normal">ชิ้น</span>
              </h4>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <span className="text-xl">📊</span>
            </div>
          </div>
        </div>

        {/* Details list */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800/80 overflow-hidden">
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs text-left text-slate-300">
              <thead className="bg-slate-950/80 text-slate-400 font-bold border-b border-slate-800 sticky top-0">
                <tr>
                  <th className="p-3">ลูกค้า</th>
                  <th className="p-3">รหัสสินค้า (Part No)</th>
                  <th className="p-3">ชื่อสินค้า (Part Name)</th>
                  <th className="p-3">โซนเก็บ</th>
                  <th className="p-3 text-right">ยอดฝากคงค้างปัจจุบัน</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const activeDepositsReport = products
                    .map((prod) => {
                      const balance = getVerifiedDepositBalance(prod.partNo);
                      return { ...prod, depositBalance: balance };
                    })
                    .filter((p) => p.depositBalance > 0);

                  if (activeDepositsReport.length === 0) {
                    return (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-500 italic">
                          ไม่มีชิ้นงานฝากคงค้างในระบบ ณ ปัจจุบัน
                        </td>
                      </tr>
                    );
                  }

                  return activeDepositsReport.map((item) => (
                    <tr key={item.id} className="border-b last:border-0 border-slate-800/50 hover:bg-slate-800/30 transition">
                      <td className="p-3">
                        <span className="font-bold text-slate-100">{item.customer}</span>
                      </td>
                      <td className="p-3 font-mono font-bold text-red-400">{item.partNo}</td>
                      <td className="p-3 text-slate-400 truncate max-w-[200px]">{item.partName}</td>
                      <td className="p-3 font-mono text-slate-400">{item.zone || "-"}</td>
                      <td className="p-3 text-right font-black text-emerald-400 text-sm">
                        {item.depositBalance.toLocaleString()} <span className="text-[10px] text-slate-500 font-normal">ชิ้น</span>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* EDIT RECORD MODAL */}
      {editingRecord && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border animate-in fade-in zoom-in duration-200">
            <div className="bg-black p-4 text-white font-bold flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-500" />
              <span>แก้ไขจำนวนยอดฝาก/เบิก</span>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-500">
                คุณกำลังแก้ไขจำนวนสำหรับพาร์ท {editingRecord.partNo} ({editingRecord.type === "deposit" ? "ฝากงาน" : "เบิกงาน"})
              </p>
              <div>
                <label className="text-xs font-semibold text-gray-600">กรอกจำนวนใหม่</label>
                <input
                  type="number"
                  value={editingQty}
                  onChange={(e) => setEditingQty(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 border rounded-xl font-bold text-center text-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex gap-2 pt-2 text-xs">
                <button
                  onClick={() => setEditingRecord(null)}
                  className="flex-1 border py-2 rounded-xl font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 bg-red-600 text-white py-2 rounded-xl font-bold hover:bg-red-700 cursor-pointer"
                >
                  บันทึกยอดแก้ไข
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border border-gray-100 p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-600 mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">ยืนยันการลบรายการฝาก/เบิก?</h3>
              <p className="text-xs text-gray-500">
                คุณแน่ใจหรือไม่ว่าต้องการลบรายการธุรกรรมนี้ออกอย่างถาวร?
              </p>
            </div>
            <div className="flex justify-center gap-2 text-xs pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 border rounded-xl hover:bg-gray-100 font-semibold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                onClick={async () => {
                  const id = deleteConfirmId;
                  setDeleteConfirmId(null);
                  await handleDelete(id);
                }}
                className="px-5 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 font-bold cursor-pointer"
              >
                ยืนยันลบรายการ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
