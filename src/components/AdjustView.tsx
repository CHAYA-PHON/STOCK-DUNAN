import React, { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { Product, Employee, AdjustRequest } from "../types";
import { fuzzySearch } from "../utils/fuzzy";
import { getSafeProductId } from "../utils/productUtils";
import * as XLSX from "xlsx";
import { Search, AlertCircle, Clock, Check, X, ShieldAlert, Edit, Upload, Clipboard, FileSpreadsheet, Sparkles } from "lucide-react";

interface AdjustViewProps {
  currentUser: Employee | null;
}

export default function AdjustView({ currentUser }: AdjustViewProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [adjustRequests, setAdjustRequests] = useState<AdjustRequest[]>([]);

  // Search/Input form states
  const [partSearch, setPartSearch] = useState("");
  const [fuzzyResults, setFuzzyResults] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [actualStock, setActualStock] = useState<number>(0);

  // Request list filters
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");

  // Edit popups for Approver
  const [editingRequest, setEditingRequest] = useState<AdjustRequest | null>(null);
  const [editingActualValue, setEditingActualValue] = useState<number>(0);

  // Authorization checks
  const isApprover = currentUser?.role === "admin" || currentUser?.role === "leader";

  // EOM states
  const [showEomPanel, setShowEomPanel] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleEomImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json<any>(worksheet);

        let countUpdated = 0;
        let countNotFound = 0;
        const batch = writeBatch(db);

        for (const row of rawRows) {
          const rowKeys = Object.keys(row);
          const findVal = (possibleKeys: string[], defaultVal: any) => {
            const matchedKey = rowKeys.find(rk => 
              possibleKeys.includes(rk.toLowerCase().trim().replace(/[\s_-]/g, ""))
            );
            return matchedKey !== undefined ? row[matchedKey] : defaultVal;
          };

          const partNo = String(findVal(["partno", "part", "รหัสสินค้า", "พาร์ท"], "")).trim();
          const customer = String(findVal(["customer", "ลูกค้า"], "")).trim().toUpperCase();
          const countVal = Number(findVal(["actualstock", "physicalcount", "stock", "count", "จำนวนที่นับได้", "นับได้", "ยอดนับจริง"], null));

          if (!partNo || !customer || countVal === null || isNaN(countVal)) {
            continue;
          }

          const prodId = getSafeProductId(customer, partNo);
          const match = products.find(p => p.id === prodId);

          if (match) {
            const prodRef = doc(db, "products", prodId);
            batch.update(prodRef, {
              stock: countVal,
              openingStock: countVal,
              receivedTotal: 0,
              shippedTotal: 0
            });

            // Log to adjust_requests as an auto-approved EOM adjustment
            const reqId = `REQ-EOM-${Date.now().toString().slice(-4)}-${countUpdated}`;
            const diff = countVal - (match.stock || 0);
            const reqRef = doc(db, "adjust_requests", reqId);
            batch.set(reqRef, {
              id: reqId,
              partNo: match.partNo,
              partName: match.partName,
              currentStock: match.stock || 0,
              actualStock: countVal,
              difference: diff,
              requesterId: currentUser?.id || "00000000",
              requesterName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
              timestamp: new Date(),
              status: "approved",
              approvedBy: currentUser ? `${currentUser.name} ${currentUser.lastName} (EOM Batch)` : "Supervisor (EOM Batch)",
              approvedTimestamp: new Date()
            });

            // Log to inventory_log
            const logRef = doc(collection(db, "inventory_log"));
            batch.set(logRef, {
              labelId: `ADJ-EOM-${reqId.slice(-4)}`,
              partNo: match.partNo,
              partName: match.partName,
              customer: match.customer,
              type: diff >= 0 ? "in" : "out",
              subType: "ตรวจนับสต๊อกสิ้นเดือนประจำเดือน (End of Month Count)",
              qty: Math.abs(diff),
              location: "ZONE-ADJ-EOM",
              shift: "DAY",
              operatorId: currentUser?.id || "00000000",
              operatorName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
              timestamp: new Date()
            });

            countUpdated++;
          } else {
            countNotFound++;
          }
        }

        if (countUpdated > 0) {
          await batch.commit();
          alert(`ปรับปรุงยอดสต๊อกสิ้นเดือนเสร็จเรียบร้อยแล้ว!\n- ปรับปรุงสำเร็จ: ${countUpdated} รายการ\n- ไม่พบพาร์ทในระบบ: ${countNotFound} รายการ`);
        } else {
          alert("ไม่พบข้อมูลสินค้าที่ตรงกับพาร์ทในระบบ หรือ ข้อมูลรูปแบบไม่ถูกต้อง");
        }

        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (err: any) {
        console.error(err);
        alert(`เกิดข้อผิดพลาดในการนำเข้าข้อมูล: ${err.message || err}`);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handlePasteEomSubmit = async () => {
    if (!pastedText.trim()) {
      alert("กรุณาวางข้อมูลจากตาราง Excel");
      return;
    }

    try {
      const rows = pastedText.split("\n").map(r => r.split("\t"));
      if (rows.length < 2) {
        alert("ข้อมูลตารางมีจำนวนแถวไม่เพียงพอ (อย่างน้อยต้องมีแถวหัวตารางและข้อมูล)");
        return;
      }

      const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[\s_-]/g, ""));
      const findColIndex = (possibleKeys: string[]) => {
        return headers.findIndex(h => possibleKeys.includes(h));
      };

      const partNoIdx = findColIndex(["partno", "part", "รหัสสินค้า", "พาร์ท"]);
      const customerIdx = findColIndex(["customer", "ลูกค้า"]);
      const countIdx = findColIndex(["actualstock", "physicalcount", "stock", "count", "จำนวนที่นับได้", "นับได้", "ยอดนับจริง"]);

      if (partNoIdx === -1 || customerIdx === -1 || countIdx === -1) {
        alert("ไม่พบหัวตารางที่ระบุ 'พาร์ท/รหัสสินค้า', 'ลูกค้า', และ 'ยอดนับจริง/จำนวนที่นับได้' กรุณาตรวจสอบและคัดลอกให้ครอบคลุมส่วนหัวตาราง");
        return;
      }

      let countUpdated = 0;
      let countNotFound = 0;
      const batch = writeBatch(db);

      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if (cols.length < Math.max(partNoIdx, customerIdx, countIdx) + 1) continue;

        const partNo = cols[partNoIdx]?.trim() || "";
        const customer = cols[customerIdx]?.trim().toUpperCase() || "";
        const countVal = Number(cols[countIdx]?.trim() || null);

        if (!partNo || !customer || countVal === null || isNaN(countVal)) continue;

        const prodId = getSafeProductId(customer, partNo);
        const match = products.find(p => p.id === prodId);

        if (match) {
          const prodRef = doc(db, "products", prodId);
          batch.update(prodRef, {
            stock: countVal,
            openingStock: countVal,
            receivedTotal: 0,
            shippedTotal: 0
          });

          // Also log to adjust_requests as a auto-approved EOM adjustment
          const reqId = `REQ-EOM-${Date.now().toString().slice(-4)}-${countUpdated}`;
          const diff = countVal - (match.stock || 0);
          const reqRef = doc(db, "adjust_requests", reqId);
          batch.set(reqRef, {
            id: reqId,
            partNo: match.partNo,
            partName: match.partName,
            currentStock: match.stock || 0,
            actualStock: countVal,
            difference: diff,
            requesterId: currentUser?.id || "00000000",
            requesterName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
            timestamp: new Date(),
            status: "approved",
            approvedBy: currentUser ? `${currentUser.name} ${currentUser.lastName} (EOM Paste)` : "Supervisor (EOM Paste)",
            approvedTimestamp: new Date()
          });

          // Log to inventory_log
          const logRef = doc(collection(db, "inventory_log"));
          batch.set(logRef, {
            labelId: `ADJ-EOM-${reqId.slice(-4)}`,
            partNo: match.partNo,
            partName: match.partName,
            customer: match.customer,
            type: diff >= 0 ? "in" : "out",
            subType: "ตรวจนับสต๊อกสิ้นเดือนประจำเดือน (End of Month Count)",
            qty: Math.abs(diff),
            location: "ZONE-ADJ-EOM",
            shift: "DAY",
            operatorId: currentUser?.id || "00000000",
            operatorName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
            timestamp: new Date()
          });

          countUpdated++;
        } else {
          countNotFound++;
        }
      }

      if (countUpdated > 0) {
        await batch.commit();
        alert(`ปรับปรุงยอดสต๊อกสิ้นเดือน (Paste Table) สำเร็จแล้ว!\n- ปรับปรุงสำเร็จ: ${countUpdated} รายการ\n- ไม่พบพาร์ทในระบบ: ${countNotFound} รายการ`);
        setShowPasteModal(false);
        setPastedText("");
      } else {
        alert("ไม่พบสินค้าที่ตรงกันในระบบ กรุณาตรวจสอบรหัสลูกค้าและพาร์ทใหม่อีกครั้ง");
      }
    } catch (err: any) {
      console.error(err);
      alert(`เกิดข้อผิดพลาด: ${err.message || err}`);
    }
  };

  useEffect(() => {
    // 1. Fetch products
    const unsubProds = onSnapshot(collection(db, "products"), (snap) => {
      const items: Product[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Product));
      setProducts(items);
    });

    // 2. Fetch adjustment requests (ordered by newest first)
    const unsubReqs = onSnapshot(collection(db, "adjust_requests"), (snap) => {
      const items: AdjustRequest[] = [];
      snap.forEach((d) => {
        const data = d.data();
        items.push({
          id: d.id,
          ...data,
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
        } as AdjustRequest);
      });
      // Sort newest on top
      items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      setAdjustRequests(items);
    });

    return () => {
      unsubProds();
      unsubReqs();
    };
  }, []);

  // Sync Fuzzy Results
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
    setActualStock(prod.stock || 0);
    setFuzzyResults([]);
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      alert("กรุณาค้นหาและเลือกสินค้าก่อนส่งปรับปรุงสต๊อก");
      return;
    }

    const currentStockVal = selectedProduct.stock || 0;
    const diff = actualStock - currentStockVal;

    try {
      const reqId = `REQ-${Date.now().toString().slice(-8)}`;
      const request: AdjustRequest = {
        id: reqId,
        partNo: selectedProduct.partNo,
        partName: selectedProduct.partName,
        currentStock: currentStockVal,
        actualStock,
        difference: diff,
        requesterId: currentUser?.id || "00000000",
        requesterName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
        timestamp: new Date(),
        status: "pending",
      };

      await setDoc(doc(db, "adjust_requests", reqId), request);
      alert("ยื่นเรื่องขอปรับปรุงสต๊อกส่งให้หัวหน้างานพิจารณาเรียบร้อยแล้ว");
      // Reset
      setPartSearch("");
      setSelectedProduct(null);
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการบันทึกคำขอ");
    }
  };

  const handleApprove = async (req: AdjustRequest) => {
    if (!isApprover) {
      alert("บัญชีผู้ใช้ของคุณไม่มีสิทธิ์อนุมัติการปรับปรุงสต๊อก");
      return;
    }

    try {
      const batch = writeBatch(db);

      // 1. Update request status to Approved
      const reqRef = doc(db, "adjust_requests", req.id);
      batch.update(reqRef, {
        status: "approved",
        approvedBy: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "Supervisor",
        approvedTimestamp: new Date(),
      });

      // 2. Adjust Product Master Stock
      // Locate product id by composite key Customer-PartNo. Let's find product.
      // Since AdjustRequest doesn't store Customer in standard schema, we find the matching product.
      const match = products.find((p) => p.partNo === req.partNo);
      if (match) {
        const prodRef = doc(db, "products", match.id);
        batch.update(prodRef, {
          stock: req.actualStock,
          // Update openingStock or offset totals to align with physical counts
          openingStock: req.actualStock,
          receivedTotal: 0,
          shippedTotal: 0,
        });

        // 3. Log this adjustment as an audit transaction
        const logRef = doc(collection(db, "inventory_log"));
        batch.set(logRef, {
          labelId: `ADJ-${req.id.slice(-5)}`,
          partNo: req.partNo,
          partName: req.partName,
          customer: match.customer,
          type: req.difference >= 0 ? "in" : "out",
          subType: "ปรับยอดสโตร์ประจำเดือน (Stock Count)",
          qty: Math.abs(req.difference),
          location: "ZONE-ADJ",
          shift: "DAY",
          operatorId: req.requesterId,
          operatorName: req.requesterName,
          timestamp: new Date(),
        });
      }

      await batch.commit();
      alert("อนุมัติและปรับยอดสต๊อกคลังหลักเรียบร้อยแล้ว");
    } catch (err) {
      console.error("Approval error:", err);
      alert("เกิดข้อผิดพลาดในการอนุมัติ");
    }
  };

  const handleReject = async (reqId: string) => {
    if (!isApprover) return;
    try {
      await updateDoc(doc(db, "adjust_requests", reqId), {
        status: "rejected",
        approvedBy: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "Supervisor",
        approvedTimestamp: new Date(),
      });
      alert("ปฏิเสธคำขอการปรับปรุงสต๊อกเรียบร้อย");
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenEditRequest = (req: AdjustRequest) => {
    setEditingRequest(req);
    setEditingActualValue(req.actualStock);
  };

  const handleSaveEditRequest = async () => {
    if (!editingRequest) return;
    try {
      const diff = editingActualValue - editingRequest.currentStock;
      await updateDoc(doc(db, "adjust_requests", editingRequest.id), {
        actualStock: editingActualValue,
        difference: diff,
      });
      setEditingRequest(null);
      alert("แก้ไขยอดขอนับจริงในคำขอสำเร็จ");
    } catch (err) {
      console.error(err);
    }
  };

  const filteredRequests = adjustRequests.filter((req) => {
    if (filterStatus === "all") return true;
    return req.status === filterStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-gray-100 pb-5 gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">ตรวจนับและปรับยอดสต๊อก (Stock Adjust)</h2>
          <p className="text-sm text-gray-500 mt-1">ยื่นคำขอปรับสต๊อกระบบเมื่อยอดนับจริงคลังสินค้าคลาดเคลื่อน</p>
        </div>
        {isApprover && (
          <button
            onClick={() => setShowEomPanel(!showEomPanel)}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition shadow-sm cursor-pointer select-none"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>{showEomPanel ? "❌ ปิดระบบนับสต๊อกสิ้นเดือน" : "📊 ระบบนับสต๊อกสิ้นเดือน (EOM)"}</span>
          </button>
        )}
      </div>

      {showEomPanel && isApprover && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-850 text-white p-6 rounded-3xl border border-slate-800 shadow-xl space-y-5 animate-in fade-in duration-200">
          <div className="flex justify-between items-center border-b border-white/10 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-sm">ระบบปรับปรุงสต๊อกตรวจนับสิ้นเดือน (EOM Stock Adjuster)</h3>
                <p className="text-[10px] text-slate-400">อัปเดตยอดสต๊อกคลังหลักทั้งหมดแบบรวดเร็ว และรีเซ็ตยอดรับ/โอนสะสม</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Box 1: File Upload */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3.5 flex flex-col justify-between">
              <div>
                <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>นำเข้าด้วยไฟล์ Excel (.xlsx / .xls / .csv)</span>
                </h4>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  รองรับหัวคอลัมน์ภาษาไทย/อังกฤษ: ลูกค้า (Customer), พาร์ท/รหัสสินค้า (Part No), และ จำนวนที่นับได้/ยอดนับจริง (Actual Stock)
                </p>
              </div>
              <div>
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleEomImportExcel}
                  ref={fileInputRef}
                  className="hidden"
                  id="eom-file-upload"
                />
                <label
                  htmlFor="eom-file-upload"
                  className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2.5 rounded-xl cursor-pointer transition text-xs shadow-md"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  เลือกไฟล์และอัปเดตสต๊อกสิ้นเดือน
                </label>
              </div>
            </div>

            {/* Box 2: Paste Table */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3.5 flex flex-col justify-between">
              <div>
                <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
                  <Clipboard className="w-4 h-4 text-amber-400" />
                  <span>วางข้อมูลจากตาราง (Paste Table)</span>
                </h4>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  คัดลอกข้อมูลเป็นตารางจาก Excel หรือ Google Sheets โดยต้องรวมบรรทัดหัวคอลัมน์มาด้วย แล้วกดวางได้ทันที
                </p>
              </div>
              <button
                onClick={() => setShowPasteModal(true)}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-750 text-white font-bold py-2.5 rounded-xl cursor-pointer transition text-xs border border-white/15"
              >
                <Clipboard className="w-4 h-4 text-amber-400" />
                เปิดช่องวางข้อมูลตาราง
              </button>
            </div>
          </div>
          
          <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4 text-[11px] text-amber-200/90 leading-relaxed">
            💡 <strong>คำแนะนำเพิ่มเติม:</strong> การปรับยอดแบบ EOM นี้จะอัปเดตยอดสต๊อกจริง (Stock) และยอดยกมา (Opening Stock) เป็นค่าที่นับได้ล่าสุด และรีเซ็ตยอดรับสะสม (Received) กับยอดโอนสะสม (Shipped) ให้เป็น 0 ทั้งหมดเพื่อเริ่มต้นรอบเดือนใหม่ และจะเก็บบันทึกประวัติและธุรกรรมการตรวจปรับยอดอัตโนมัติลงประวัติทุกรายการ
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Requester Form */}
        <form onSubmit={handleCreateRequest} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4 lg:col-span-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 animate-pulse" /> ยื่นคำขอปรับปรุงสต๊อก
          </h3>

          <div>
            <label className="text-xs font-semibold text-gray-600 block">ค้นหา Part No (Fuzzy Search)</label>
            <div className="relative mt-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="พิมพ์พาร์ทที่นับจริงคลาดเคลื่อน..."
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
                    <span className="text-gray-400">ระบบเหลือ: {prod.stock || 0}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedProduct && (
            <div className="bg-gray-50 p-4 rounded-xl border space-y-2.5">
              <div className="flex justify-between">
                <span className="font-bold text-gray-800 text-xs">{selectedProduct.partNo}</span>
                <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold uppercase">
                  {selectedProduct.customer}
                </span>
              </div>
              <p className="text-[11px] text-gray-500">{selectedProduct.partName}</p>

              <div className="flex justify-between items-center bg-white p-2.5 rounded-lg border border-gray-100 text-xs font-semibold">
                <span className="text-gray-500">ยอดสต๊อกในระบบปัจจุบัน:</span>
                <span className="text-gray-900 text-sm font-bold">{selectedProduct.stock || 0} ชิ้น</span>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block">ยอดจำนวนที่นับได้ทางกายภาพจริง *</label>
                <input
                  type="number"
                  value={actualStock}
                  onChange={(e) => setActualStock(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold focus:ring-1 focus:ring-red-500 outline-none"
                />
              </div>

              <div className="flex justify-between items-center text-xs font-bold text-gray-700 pt-1 border-t border-dashed">
                <span>ส่วนต่างคลาดเคลื่อน:</span>
                <span className={`text-sm ${actualStock - (selectedProduct.stock || 0) >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {actualStock - (selectedProduct.stock || 0) >= 0 ? "+" : ""}
                  {actualStock - (selectedProduct.stock || 0)} ชิ้น
                </span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!selectedProduct}
            className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-xs font-bold transition disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            ส่งคำขอไปยังหัวหน้างาน
          </button>
        </form>

        {/* Requests List Container */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-8 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
            <div>
              <h3 className="font-bold text-gray-800">ประวัติการขออนุมัติปรับปรุงยอด</h3>
              <p className="text-xs text-gray-400">คำร้องขอทั้งหมดจะถูกจัดหมวดหมู่และแสดงตามลำดับใหม่ล่าสุด</p>
            </div>

            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {(["all", "pending", "approved", "rejected"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition uppercase ${
                    filterStatus === status ? "bg-white text-gray-800 shadow-xs" : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {status === "all" ? "ทั้งหมด" : status === "pending" ? "รออนุมัติ" : status === "approved" ? "อนุมัติแล้ว" : "ปฏิเสธ"}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto border border-gray-50 rounded-xl max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 font-semibold uppercase">
                <tr>
                  <th className="p-3">วันที่ยื่นเรื่อง</th>
                  <th className="p-3">พาร์ทสินค้า</th>
                  <th className="p-3 text-right">ยอดระบบ</th>
                  <th className="p-3 text-right">ยอดนับจริง</th>
                  <th className="p-3 text-right">คลาดเคลื่อน</th>
                  <th className="p-3 text-center">สถานะ</th>
                  {isApprover && <th className="p-3 text-center">การจัดการ</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-gray-400 italic">
                      ไม่พบประวัติรายการคำร้องขอในหมวดหมู่นี้
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => (
                    <tr key={req.id} className="border-b last:border-0 hover:bg-gray-50/50 transition">
                      <td className="p-3 text-gray-400 font-mono">
                        {req.timestamp.toLocaleDateString("th-TH")} 
                        <div className="text-[10px]">{req.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} น.</div>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-gray-900">{req.partNo}</span>
                        <div className="text-[10px] text-gray-400 max-w-[140px] truncate">{req.partName}</div>
                        <div className="text-[9px] text-gray-400 font-medium">ยื่นโดย: {req.requesterName}</div>
                      </td>
                      <td className="p-3 text-right font-mono text-gray-500">{req.currentStock}</td>
                      <td className="p-3 text-right font-mono font-bold text-gray-800">{req.actualStock}</td>
                      <td className="p-3 text-right font-mono">
                        <span className={`font-bold ${req.difference >= 0 ? "text-green-600" : "text-red-500"}`}>
                          {req.difference >= 0 ? "+" : ""}
                          {req.difference}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          req.status === "approved"
                            ? "bg-green-100 text-green-700"
                            : req.status === "rejected"
                            ? "bg-red-100 text-red-600"
                            : "bg-amber-100 text-amber-700 animate-pulse"
                        }`}>
                          {req.status === "approved" ? "อนุมัติ" : req.status === "rejected" ? "ปฏิเสธ" : "รอพิจารณา"}
                        </span>
                        {req.approvedBy && (
                          <div className="text-[9px] text-gray-400 mt-1 font-medium">โดย: {req.approvedBy}</div>
                        )}
                      </td>
                      {isApprover && (
                        <td className="p-3 text-center">
                          {req.status === "pending" ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleApprove(req)}
                                className="bg-green-600 hover:bg-green-700 text-white p-1 rounded-md"
                                title="อนุมัติยอดนับจริง"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleOpenEditRequest(req)}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 p-1 rounded-md"
                                title="แก้ไขคำร้องขอนับจริง"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleReject(req.id)}
                                className="bg-red-100 hover:bg-red-200 text-red-600 p-1 rounded-md"
                                title="ปฏิเสธคำขอ"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-300 font-semibold">-</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* EDIT REQUEST POPUP */}
      {editingRequest && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border animate-in fade-in zoom-in duration-200">
            <div className="bg-black p-4 text-white font-bold flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-500" />
              <span>แก้ไขค่าจำนวนนับจริงในคำขอ</span>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-500">
                คุณกำลังแก้ไขจำนวนยอดนับจริงสำหรับพาร์ท {editingRequest.partNo} (ยอดระบบเดิมคือ {editingRequest.currentStock} ชิ้น)
              </p>
              <div>
                <label className="text-xs font-semibold text-gray-600">กรอกยอดจำนวนที่นับได้จริงใหม่</label>
                <input
                  type="number"
                  value={editingActualValue}
                  onChange={(e) => setEditingActualValue(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 border rounded-xl font-bold text-center text-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex gap-2 pt-2 text-xs">
                <button
                  onClick={() => setEditingRequest(null)}
                  className="flex-1 border py-2 rounded-xl font-semibold"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleSaveEditRequest}
                  className="flex-1 bg-red-600 text-white py-2 rounded-xl font-bold hover:bg-red-700"
                >
                  บันทึกการแก้ไข
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* PASTE DATA MODAL FOR EOM COUNT */}
      {showPasteModal && isApprover && (
        <div className="fixed inset-0 z-[120] bg-black/65 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-gray-150 animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 p-4.5 text-white font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clipboard className="w-5 h-5 text-amber-400" />
                <span>วางข้อมูลจากตารางตระกูล Excel (EOM Adjust)</span>
              </div>
              <button 
                onClick={() => { setShowPasteModal(false); setPastedText(""); }}
                className="text-gray-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="text-xs text-gray-500 space-y-1">
                <p>📋 <strong>วิธีการใช้งาน:</strong></p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>เปิดไฟล์ Excel หรือ Google Sheets</li>
                  <li>คัดลอก (Copy) แถวหัวตารางและแถวข้อมูล เช่น ลูกค้า, รหัสสินค้า, ยอดนับจริง</li>
                  <li>นำมากดวาง (Paste) ในกล่องข้อความด้านล่างนี้ และกดปุ่มประมวลผล</li>
                </ol>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">วางข้อมูลข้อความตารางที่นี่:</label>
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="ลูกค้า&#9;รหัสสินค้า&#9;ยอดนับจริง&#10;CUSTOMER_A&#9;PART-001&#9;500&#10;CUSTOMER_B&#9;PART-002&#9;1200"
                  className="w-full h-64 p-3 border border-gray-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-slate-800 outline-none resize-none bg-gray-50"
                />
              </div>

              <div className="flex gap-3 pt-1 text-xs">
                <button
                  onClick={() => { setShowPasteModal(false); setPastedText(""); }}
                  className="flex-1 border border-gray-200 py-2.5 rounded-xl font-semibold hover:bg-gray-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handlePasteEomSubmit}
                  className="flex-1 bg-slate-900 text-white py-2.5 rounded-xl font-bold hover:bg-slate-800 transition"
                >
                  ประมวลผลข้อมูลวางและปรับสต๊อก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
