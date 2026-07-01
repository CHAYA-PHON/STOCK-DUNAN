import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, getDoc, getDocs, query, where, writeBatch, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Product, Employee, InventoryTransaction, LocationItem, AdjustRequest } from "../types";
import { fuzzySearch } from "../utils/fuzzy";
import { getSafeProductId } from "../utils/productUtils";
import { QRScannerModal } from "./index";
import { Search, Tag, Trash2, ArrowUpRight, AlertTriangle, RefreshCw, Send, CheckCircle } from "lucide-react";

interface StockOutViewProps {
  currentUser: Employee | null;
}

export default function StockOutView({ currentUser }: StockOutViewProps) {
  // DB States
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [outTypes, setOutTypes] = useState<string[]>([
    "ส่งสโตร์ FG", "เบิกงาน Rework", "เบิกงานจาก TN", "เบิกเพื่อประกอบ", "จัดส่งลูกค้า", "ทำลายสินค้า (Scrap)"
  ]);

  // Form States
  const [subType, setSubType] = useState("ส่งสโตร์ FG");
  const [location, setLocation] = useState("");
  const [shift, setShift] = useState<"DAY" | "NIGHT">("DAY");
  const [partSearch, setPartSearch] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [labelId, setLabelId] = useState("");

  // Resolution Details
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [fuzzyResults, setFuzzyResults] = useState<Product[]>([]);
  const [editFullBox, setEditFullBox] = useState<number>(0);

  // Queue List
  const [queue, setQueue] = useState<Omit<InventoryTransaction, "id" | "timestamp">[]>([]);

  // Modals & Triggers
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"part" | "label">("part");

  // Negative Stock Override State
  const [negativeError, setNegativeError] = useState<{
    partNo: string;
    missingQty: number;
    currentStock: number;
    compositeId: string;
  } | null>(null);
  const [actualPhysicalCount, setActualPhysicalCount] = useState<number>(0);
  const [adjustRequestSent, setAdjustRequestSent] = useState(false);

  // Load configuration and data
  useEffect(() => {
    const unsubProds = onSnapshot(collection(db, "products"), (snap) => {
      const items: Product[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Product));
      setProducts(items);
    });

    const unsubLocs = onSnapshot(collection(db, "locations"), (snap) => {
      const items: LocationItem[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as LocationItem));
      setLocations(items);
      if (items.length > 0 && !location) {
        setLocation(items[0].name);
      }
    });

    const unsubSettings = onSnapshot(doc(db, "settings", "general"), (d) => {
      if (d.exists()) {
        const data = d.data();
        if (data.outTypes) setOutTypes(data.outTypes);
      }
    });

    return () => {
      unsubProds();
      unsubLocs();
      unsubSettings();
    };
  }, []);

  // Set Shift based on time
  useEffect(() => {
    const now = new Date();
    const hrs = now.getHours();
    if (hrs >= 20 || hrs < 8) {
      setShift("NIGHT");
    } else {
      setShift("DAY");
    }
  }, []);

  // Monitor Label ID inputs: if user types or scans Label ID, check if it matches prior IN log
  useEffect(() => {
    const label = labelId.trim();
    if (!label || label.length < 5) return;

    const resolveLabel = async () => {
      try {
        const q = query(collection(db, "inventory_log"), where("labelId", "==", label), where("type", "==", "in"));
        const snap = await getDocs(q);
        if (!snap.empty) {
          // Found matching stock in record! Resolve details
          const firstIn = snap.docs[0].data() as InventoryTransaction;
          const compositeId = getSafeProductId(firstIn.customer, firstIn.partNo);
          const prodDoc = await getDoc(doc(db, "products", compositeId));
          if (prodDoc.exists()) {
            const prod = { id: prodDoc.id, ...prodDoc.data() } as Product;
            setSelectedProduct(prod);
            setQty(firstIn.qty);
            setEditFullBox(prod.fullBox);
            setPartSearch(prod.partNo);
          }
        }
      } catch (err) {
        console.error("Error resolving label ID:", err);
      }
    };

    // Debounce label search
    const timer = setTimeout(resolveLabel, 400);
    return () => clearTimeout(timer);
  }, [labelId]);

  // Run Fuzzy Search on Part search input
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
    setQty(prod.fullBox || 0);
    setEditFullBox(prod.fullBox || 0);
    setFuzzyResults([]);
    setNegativeError(null);
    setAdjustRequestSent(false);
  };

  const handleFullBoxChange = async (newVal: number) => {
    setEditFullBox(newVal);
    setQty(newVal);

    if (selectedProduct && newVal !== selectedProduct.fullBox) {
      if (confirm(`คุณต้องการปรับปรุงจำนวน Full Box ในฐานข้อมูลสินค้าหลักสำหรับพาร์ท ${selectedProduct.partNo} หรือไม่?\n\n(จาก ${selectedProduct.fullBox} เป็น ${newVal})`)) {
        try {
          const prodRef = doc(db, "products", selectedProduct.id);
          await setDoc(prodRef, { fullBox: newVal }, { merge: true });
          setSelectedProduct({ ...selectedProduct, fullBox: newVal });
          alert("อัปเดตข้อมูลสินค้าหลักสำเร็จ");
        } catch (err) {
          console.error("Error updating full box:", err);
        }
      }
    }
  };

  const generateAutoLabel = () => {
    const lb = `LB-${Date.now().toString().slice(-8)}`;
    setLabelId(lb);
  };

  const handleScanSuccess = (text: string) => {
    if (scannerTarget === "part") {
      setPartSearch(text);
    } else {
      setLabelId(text);
    }
  };

  const handleAddToQueue = () => {
    if (!selectedProduct) {
      alert("กรุณาเลือกสินค้าก่อน");
      return;
    }
    if (qty <= 0) {
      alert("จำนวนโอนออกต้องมากกว่า 0");
      return;
    }
    const finalLabel = labelId.trim();
    if (!finalLabel) {
      alert("กรุณาสร้างหรือระบุ Label ID");
      return;
    }

    // Prevent duplicate Label IDs in the queue
    if (queue.some((q) => q.labelId.toLowerCase() === finalLabel.toLowerCase())) {
      alert("มี Label ID นี้ในคิวเตรียมเบิกแล้ว");
      return;
    }

    // Calculate projected stock (deducting what is in the local queue as well)
    const alreadyQueuedForThisProd = queue
      .filter((q) => q.partNo === selectedProduct.partNo && q.customer === selectedProduct.customer)
      .reduce((sum, q) => sum + q.qty, 0);

    const liveStock = selectedProduct.stock || 0;
    const projectedStock = liveStock - alreadyQueuedForThisProd - qty;

    if (projectedStock < 0) {
      const deficit = Math.abs(projectedStock);
      setNegativeError({
        partNo: selectedProduct.partNo,
        missingQty: deficit,
        currentStock: liveStock,
        compositeId: selectedProduct.id,
      });
      setActualPhysicalCount(liveStock); // suggest current stock as fallback
      return; // STOP addition
    }

    const item: Omit<InventoryTransaction, "id" | "timestamp"> = {
      labelId: finalLabel,
      partNo: selectedProduct.partNo,
      partName: selectedProduct.partName,
      customer: selectedProduct.customer,
      type: "out",
      subType,
      qty,
      location,
      shift,
      operatorId: currentUser?.id || "00000000",
      operatorName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System User",
    };

    setQueue([...queue, item]);

    // Reset fields
    setLabelId("");
    setPartSearch("");
    setSelectedProduct(null);
    setNegativeError(null);
    setAdjustRequestSent(false);
  };

  const handleRemoveFromQueue = (index: number) => {
    setQueue(queue.filter((_, idx) => idx !== index));
  };

  const handleSubmitAdjustRequest = async () => {
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลหรือบันทึกใดๆ ได้");
      return;
    }
    if (!negativeError || !currentUser) return;

    try {
      const reqId = `REQ-${Date.now().toString().slice(-8)}`;
      const requestDoc: AdjustRequest = {
        id: reqId,
        partNo: negativeError.partNo,
        partName: selectedProduct?.partName || "-",
        currentStock: negativeError.currentStock,
        actualStock: actualPhysicalCount,
        difference: actualPhysicalCount - negativeError.currentStock,
        requesterId: currentUser.id,
        requesterName: `${currentUser.name} ${currentUser.lastName}`,
        timestamp: new Date(),
        status: "pending",
      };

      await setDoc(doc(db, "adjust_requests", reqId), requestDoc);
      setAdjustRequestSent(true);
      alert("ส่งคำขอปรับยอดนับจริงให้หัวหน้างาน/ผู้ดูแลระบบอนุมัติเรียบร้อยแล้ว");
    } catch (err) {
      console.error("Error sending count adjust request:", err);
      alert("ไม่สามารถบันทึกคำขอปรับยอดได้");
    }
  };

  const handleCommitQueue = async () => {
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลหรือบันทึกใดๆ ได้");
      return;
    }
    if (queue.length === 0) return;

    try {
      const batch = writeBatch(db);

      for (const item of queue) {
        // 1. Log transaction
        const logRef = doc(collection(db, "inventory_log"));
        batch.set(logRef, {
          ...item,
          timestamp: new Date(),
        });

        // 2. Decrement product stock master
        const prodId = getSafeProductId(item.customer, item.partNo);
        const prodRef = doc(db, "products", prodId);
        const prodSnap = await getDoc(prodRef);

        if (prodSnap.exists()) {
          const prodData = prodSnap.data() as Product;
          const currentShipped = prodData.shippedTotal || 0;
          const currentStock = prodData.stock || 0;

          batch.update(prodRef, {
            shippedTotal: currentShipped + item.qty,
            stock: currentStock - item.qty,
          });
        }
      }

      await batch.commit();
      alert(`บันทึกโอนออก / เบิกสินค้าสำเร็จจำนวน ${queue.length} รายการเรียบร้อยแล้ว`);
      setQueue([]);
    } catch (err) {
      console.error("Batch write out error:", err);
      alert("เกิดข้อผิดพลาดในการบันทึกตัดสต๊อก");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">โอนออกสินค้า (Stock Out)</h2>
          <p className="text-sm text-gray-500 mt-1">เบิกสินค้า โอนย้าย หรือส่งมอบลูกค้าเพื่อทำการผลิต/บรรจุ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Input Form */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-5 lg:col-span-5">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-gray-800">ฟอร์มโอนออก / ย้ายสโตร์</h3>
            <span className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded font-semibold">
              ผู้บันทึก: {currentUser?.name}
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">ประเภทการโอนออก / ย้ายงาน</label>
              <select
                value={subType}
                onChange={(e) => setSubType(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {outTypes.map((type, i) => (
                  <option key={i} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600">Location ต้นทาง</label>
                <input
                  type="text"
                  list="locations-datalist"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="พิมพ์ค้นหา/เลือกสถานที่..."
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                />
                <datalist id="locations-datalist">
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.name}>
                      {loc.name}
                    </option>
                  ))}
                </datalist>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600">กะ (Shift)</label>
                <select
                  value={shift}
                  onChange={(e) => setShift(e.target.value as "DAY" | "NIGHT")}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="DAY">DAY (08:30 - 17:30)</option>
                  <option value="NIGHT">NIGHT (20:30 - 05:30)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 my-4" />

          {/* Search section */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block">ค้นหา / สแกนสินค้า</label>
              <div className="flex gap-2 mt-1">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="ค้นหาด้วยรหัสสินค้า (Fuzzy search)..."
                    value={partSearch}
                    onChange={(e) => setPartSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <button
                  onClick={() => {
                    setScannerTarget("part");
                    setScannerOpen(true);
                  }}
                  className="bg-red-50 hover:bg-red-100 text-red-600 p-2 rounded-xl transition border border-red-200/50"
                >
                  <Tag className="w-4 h-4" />
                </button>
              </div>

              {fuzzyResults.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl max-h-[160px] overflow-y-auto shadow-lg p-2 space-y-1 z-10 relative">
                  {fuzzyResults.slice(0, 5).map((prod) => (
                    <button
                      key={prod.id}
                      onClick={() => handleSelectProduct(prod)}
                      className="w-full text-left text-xs p-2 rounded-lg hover:bg-gray-50 flex justify-between transition"
                    >
                      <span className="font-semibold text-gray-800">{prod.partNo}</span>
                      <span className="text-gray-400 text-[10px]">สต๊อก: {prod.stock || 0} ({prod.customer})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedProduct && (
              <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-100 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-gray-800 text-sm">{selectedProduct.partNo}</h4>
                    <p className="text-xs text-gray-500">{selectedProduct.partName}</p>
                  </div>
                  <span className="bg-red-600 text-white text-[10px] px-2.5 py-0.5 rounded font-bold uppercase">
                    คลัง: {selectedProduct.stock || 0}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">Full Box (จำนวนต่อกล่อง)</label>
              <input
                type="number"
                disabled={!selectedProduct}
                value={editFullBox}
                onChange={(e) => handleFullBoxChange(Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">จำนวนที่จะโอนออกจริง</label>
              <input
                type="number"
                disabled={!selectedProduct}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600 block">Label ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="สแกนฉลากระบุตัวตนสินค้า..."
                value={labelId}
                onChange={(e) => setLabelId(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                onClick={() => {
                  setScannerTarget("label");
                  setScannerOpen(true);
                }}
                className="bg-gray-50 hover:bg-gray-100 text-gray-600 p-2 rounded-xl transition border"
              >
                <Tag className="w-4 h-4" />
              </button>
              <button
                onClick={generateAutoLabel}
                className="bg-black text-white text-xs px-3 rounded-xl font-bold hover:bg-gray-800 transition"
              >
                สร้างลาเบล
              </button>
            </div>
          </div>

          {/* Negative Balance Warn */}
          {negativeError && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-2xl space-y-3">
              <div className="flex items-start gap-2.5 text-red-700 text-xs">
                <AlertTriangle className="w-4.5 h-4.5 shrink-0 text-red-600 animate-bounce" />
                <div>
                  <p className="font-bold">คลังสินค้าติดลบ (สต๊อกไม่พอจ่าย)</p>
                  <p className="mt-0.5 leading-relaxed">
                    พาร์ท <span className="font-bold underline">{negativeError.partNo}</span> ขาดสต๊อกรวม 
                    <span className="font-bold text-red-600 bg-red-100 px-1.5 py-0.5 mx-1 rounded">{negativeError.missingQty}</span> ชิ้น 
                    (ยอดในระบบเหลือ {negativeError.currentStock} ชิ้น)
                  </p>
                </div>
              </div>

              {!adjustRequestSent ? (
                <div className="border-t border-red-200/50 pt-3 space-y-2.5">
                  <p className="text-[10px] text-red-600 font-medium leading-relaxed">
                    * หากจำนวนสินค้าทางกายภาพยังมีอยู่จริงในสโตร์ คุณสามารถกรอกยอดจำนวนที่นับได้จริงด้านล่าง เพื่อยื่นคำขอปรับสต๊อกให้หัวหน้างานอนุมัติ
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="ยอดนับจริง..."
                      value={actualPhysicalCount}
                      onChange={(e) => setActualPhysicalCount(Number(e.target.value))}
                      className="w-24 px-3 py-1.5 text-xs border rounded-lg bg-white"
                    />
                    <button
                      onClick={handleSubmitAdjustRequest}
                      className="flex-1 bg-red-600 text-white text-xs font-bold py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 hover:bg-red-700"
                    >
                      <Send className="w-3 h-3" />
                      <span>ส่งคำขอปรับยอดเข้า</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 text-green-700 text-[11px] p-2 rounded-xl flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>ส่งคำขอปรับยอดเรียบร้อยแล้ว รอหัวหน้างานอนุมัติ</span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleAddToQueue}
            className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-lg shadow-red-600/10"
          >
            <ArrowUpRight className="w-5 h-5" />
            <span>โอนออก (เข้าตะกร้าตรวจสอบ)</span>
          </button>
        </div>

        {/* Temporary queue layout */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 lg:col-span-7 flex flex-col h-[580px]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-bold text-gray-800">รายการโอนออกชั่วคราว ({queue.length})</h3>
              <p className="text-xs text-gray-400">คิวเตรียมยื่นตัดสต๊อกจากระบบหลังบ้านแบบเรียลไทม์</p>
            </div>
            {queue.length > 0 && (
              <span className="text-xs font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
                ยอดรวม: {queue.reduce((acc, q) => acc + q.qty, 0).toLocaleString()} ชิ้น
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto border border-gray-100 rounded-xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 font-bold sticky top-0 uppercase">
                <tr>
                  <th className="p-3 border-b">Label ID</th>
                  <th className="p-3 border-b">Part No</th>
                  <th className="p-3 border-b">ประเภทการเบิก</th>
                  <th className="p-3 border-b text-right">จำนวน</th>
                  <th className="p-3 border-b text-center w-12">ลบ</th>
                </tr>
              </thead>
              <tbody>
                {queue.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-gray-400 italic">
                      ยังไม่มีรายการในตะกร้าโอนออก กรุณากรอกข้อมูลในฟอร์มซ้ายมือแล้วกดโอนออก
                    </td>
                  </tr>
                ) : (
                  queue.map((item, index) => (
                    <tr key={index} className="border-b hover:bg-gray-50/60 transition">
                      <td className="p-3 font-semibold text-gray-800">{item.labelId}</td>
                      <td className="p-3">
                        <div className="font-semibold text-gray-900">{item.partNo}</div>
                        <div className="text-[10px] text-gray-400">{item.customer}</div>
                      </td>
                      <td className="p-3 font-medium text-gray-600">{item.subType}</td>
                      <td className="p-3 text-right font-bold text-red-600">{item.qty.toLocaleString()}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleRemoveFromQueue(index)}
                          className="text-gray-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleCommitQueue}
            disabled={queue.length === 0}
            className={`w-full py-4.5 rounded-xl font-bold flex items-center justify-center gap-2 transition mt-4 ${
              queue.length === 0
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-black hover:bg-gray-900 text-white shadow-xl cursor-pointer"
            }`}
          >
            <Trash2 className="w-5 h-5" />
            <span>ยืนยันตัดสต๊อกออก ({queue.length} รายการ)</span>
          </button>
        </div>
      </div>

      <QRScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
}
