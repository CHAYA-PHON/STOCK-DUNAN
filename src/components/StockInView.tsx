import React, { useState, useEffect } from "react";
import { collection, onSnapshot, doc, getDoc, writeBatch, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Product, Employee, InventoryTransaction, LocationItem } from "../types";
import { fuzzySearch } from "../utils/fuzzy";
import { getSafeProductId } from "../utils/productUtils";
import { QRScannerModal } from "./index";
import { Search, Tag, Trash2, Save, Plus, AlertCircle, PlusCircle, Check } from "lucide-react";

interface StockInViewProps {
  currentUser: Employee | null;
}

export default function StockInView({ currentUser }: StockInViewProps) {
  // Database States
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [inTypes, setInTypes] = useState<string[]>(["รับเข้าจากฝ่ายผลิต"]);

  // Form States
  const [subType, setSubType] = useState("รับเข้าจากฝ่ายผลิต");
  const [location, setLocation] = useState("");
  const [shift, setShift] = useState<"DAY" | "NIGHT">("DAY");
  const [partSearch, setPartSearch] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [labelId, setLabelId] = useState("");

  // Product Selection Details
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [fuzzyResults, setFuzzyResults] = useState<Product[]>([]);
  const [editFullBox, setEditFullBox] = useState<number>(0);

  // Queue List
  const [queue, setQueue] = useState<Omit<InventoryTransaction, "id" | "timestamp">[]>([]);

  // Modals & Triggers
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"part" | "label">("part");
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [showNewTypeForm, setShowNewTypeForm] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");

  // New Product fields (if creating on the fly)
  const [newProdCustomer, setNewProdCustomer] = useState("");
  const [newProdPartNo, setNewProdPartNo] = useState("");
  const [newProdPartName, setNewProdPartName] = useState("");
  const [newProdSap, setNewProdSap] = useState("");
  const [newProdZone, setNewProdZone] = useState("");
  const [newProdFullBox, setNewProdFullBox] = useState(10);
  const [newProdPkgType, setNewProdPkgType] = useState("BOX");

  // Load configuration and data
  useEffect(() => {
    // 1. Fetch Products
    const unsubProds = onSnapshot(collection(db, "products"), (snap) => {
      const items: Product[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Product));
      setProducts(items);
    });

    // 2. Fetch Locations
    const unsubLocs = onSnapshot(collection(db, "locations"), (snap) => {
      const items: LocationItem[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as LocationItem));
      setLocations(items);
      if (items.length > 0 && !location) {
        setLocation(items[0].name);
      }
    });

    // 3. Fetch custom In Types from Settings
    const unsubSettings = onSnapshot(doc(db, "settings", "general"), (d) => {
      if (d.exists()) {
        const data = d.data();
        if (data.inTypes) setInTypes(data.inTypes);
      }
    });

    return () => {
      unsubProds();
      unsubLocs();
      unsubSettings();
    };
  }, []);

  // Sync Shift automatically based on current local time if not set manually
  useEffect(() => {
    const now = new Date();
    const hrs = now.getHours();
    // Day shift is typical 08:30 to 20:30, night is 20:30 to 08:30
    if (hrs >= 20 || hrs < 8) {
      setShift("NIGHT");
    } else {
      setShift("DAY");
    }
  }, []);

  // Run Fuzzy Search on Part Search text
  useEffect(() => {
    if (!partSearch.trim()) {
      setFuzzyResults([]);
      return;
    }
    const results = fuzzySearch<Product>(products, partSearch, (p) => p.partNo, 3);
    setFuzzyResults(results);

    // If exact match found
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
  };

  const handleFullBoxChange = async (newVal: number) => {
    setEditFullBox(newVal);
    setQty(newVal); // update default quantity to match box count

    if (selectedProduct && newVal !== selectedProduct.fullBox) {
      if (confirm(`คุณต้องการปรับปรุงจำนวน Full Box ในฐานข้อมูลสินค้าหลักสำหรับพาร์ท ${selectedProduct.partNo} หรือไม่?\n\n(จาก ${selectedProduct.fullBox} เป็น ${newVal})`)) {
        try {
          const prodRef = doc(db, "products", selectedProduct.id);
          await updateDoc(prodRef, { fullBox: newVal });
          // Update local state product reference
          setSelectedProduct({ ...selectedProduct, fullBox: newVal });
          alert("อัปเดตข้อมูลสินค้าหลักสำเร็จ");
        } catch (err) {
          console.error("Error updating full box size:", err);
          alert("ไม่สามารถบันทึกขนาดกล่องได้");
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
      // Search logic triggers via useEffect
    } else {
      setLabelId(text);
    }
  };

  const addCustomInType = async () => {
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลหรือบันทึกใดๆ ได้");
      return;
    }
    if (!newTypeName.trim()) return;
    try {
      const updated = [...inTypes, newTypeName.trim()];
      await setDoc(doc(db, "settings", "general"), { inTypes: updated }, { merge: true });
      setSubType(newTypeName.trim());
      setNewTypeName("");
      setShowNewTypeForm(false);
      alert("เพิ่มประเภทการรับเข้าสำเร็จ");
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddProductOnFly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลหรือบันทึกใดๆ ได้");
      return;
    }
    if (!newProdCustomer.trim() || !newProdPartNo.trim() || !newProdPartName.trim()) {
      alert("กรุณากรอกข้อมูลดาว (*) ให้ครบถ้วน");
      return;
    }

    const compositeId = getSafeProductId(newProdCustomer, newProdPartNo);
    const newProd: Product = {
      id: compositeId,
      customer: newProdCustomer.trim().toUpperCase(),
      partNo: newProdPartNo.trim(),
      partName: newProdPartName.trim(),
      sapNo: newProdSap.trim() || "-",
      zone: newProdZone.trim() || "-",
      fullBox: Number(newProdFullBox) || 0,
      packageType: newProdPkgType.trim() || "BOX",
      openingStock: 0,
      receivedTotal: 0,
      shippedTotal: 0,
      stock: 0,
    };

    try {
      await setDoc(doc(db, "products", compositeId), newProd);
      alert("เพิ่มสินค้าใหม่เข้าสู่ระบบเรียบร้อย");
      setShowNewProductForm(false);
      setPartSearch(newProd.partNo);
      handleSelectProduct(newProd);

      // Reset form fields
      setNewProdCustomer("");
      setNewProdPartNo("");
      setNewProdPartName("");
      setNewProdSap("");
      setNewProdZone("");
    } catch (err) {
      console.error("Error saving on fly product:", err);
      alert("เกิดข้อผิดพลาดในการบันทึกสินค้าใหม่");
    }
  };

  const handleAddToQueue = () => {
    if (!selectedProduct) {
      alert("กรุณาค้นหาและเลือกพาร์ทสินค้าก่อนเพิ่ม");
      return;
    }
    if (!location) {
      alert("กรุณาเลือก Location ปลายทาง");
      return;
    }
    if (qty <= 0) {
      alert("จำนวนรับเข้าต้องมากกว่า 0");
      return;
    }

    const finalLabel = labelId.trim();
    if (!finalLabel) {
      alert("กรุณาสร้างหรือระบุ Label ID");
      return;
    }

    // Prevent duplicate Label IDs in the local queue
    if (queue.some((q) => q.labelId.toLowerCase() === finalLabel.toLowerCase())) {
      alert("พบข้อผิดพลาด: มี Label ID นี้อยู่ในคิวเตรียมบันทึกแล้ว เพื่อความถูกต้องกรุณาใช้ลาเบลอื่น");
      return;
    }

    const item: Omit<InventoryTransaction, "id" | "timestamp"> = {
      labelId: finalLabel,
      partNo: selectedProduct.partNo,
      partName: selectedProduct.partName,
      customer: selectedProduct.customer,
      type: "in",
      subType,
      qty,
      location,
      shift,
      operatorId: currentUser?.id || "00000000",
      operatorName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System User",
    };

    setQueue([...queue, item]);

    // Clear inputs for next item
    setLabelId("");
    setPartSearch("");
    setSelectedProduct(null);
  };

  const handleRemoveFromQueue = (index: number) => {
    setQueue(queue.filter((_, idx) => idx !== index));
  };

  const handleCommitQueue = async () => {
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลหรือบันทึกใดๆ ได้");
      return;
    }
    if (queue.length === 0) return;

    try {
      const batch = writeBatch(db);

      // Process each queue item
      for (const item of queue) {
        // 1. Add log entry (let firebase generate doc id)
        const logRef = doc(collection(db, "inventory_log"));
        batch.set(logRef, {
          ...item,
          timestamp: new Date(),
        });

        // 2. Fetch current Product Master and update statistics
        // Firestore transactions/batches run asynchronously. We should fetch live states or use merge additions.
        const prodId = getSafeProductId(item.customer, item.partNo);
        const prodRef = doc(db, "products", prodId);
        const prodSnap = await getDoc(prodRef);

        if (prodSnap.exists()) {
          const prodData = prodSnap.data() as Product;
          const currentReceived = prodData.receivedTotal || 0;
          const currentStock = prodData.stock || 0;

          batch.update(prodRef, {
            receivedTotal: currentReceived + item.qty,
            stock: currentStock + item.qty,
          });
        }
      }

      await batch.commit();
      alert(`บันทึกรับเข้าสินค้าสำเร็จจำนวน ${queue.length} รายการเรียบร้อยแล้ว`);
      setQueue([]);
    } catch (err) {
      console.error("Batch save error:", err);
      alert("เกิดข้อผิดพลาดในการบันทึกสต๊อกเข้าฐานข้อมูล");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">รับเข้าสินค้า (Stock In)</h2>
          <p className="text-sm text-gray-500 mt-1">สแกน/สร้างลาเบลเพื่อรับสินค้าจากไลน์ผลิตเข้าสู่สโตร์</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Input Controls */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-5 lg:col-span-5">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-gray-800">ฟอร์มบันทึกรับเข้า</h3>
            <span className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded font-semibold">
              ผู้บันทึก: {currentUser?.name}
            </span>
          </div>

          {/* Sub Type and Location row */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">ประเภทการรับเข้า</label>
              <div className="flex gap-1.5 mt-1">
                <select
                  value={subType}
                  onChange={(e) => setSubType(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {inTypes.map((type, i) => (
                    <option key={i} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setShowNewTypeForm(true)}
                  className="bg-black text-white p-2 rounded-xl hover:bg-gray-800 transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {showNewTypeForm && (
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 flex gap-2">
                <input
                  type="text"
                  placeholder="เพิ่มประเภทการรับใหม่..."
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs border rounded-lg bg-white"
                />
                <button
                  onClick={addCustomInType}
                  className="bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg font-bold"
                >
                  เพิ่ม
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600">Location ปลายทาง</label>
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

          {/* Part Search Section */}
          <div className="space-y-3">
            <div>
              <div className="flex justify-between">
                <label className="text-xs font-semibold text-gray-600">ค้นหา / สแกน Part No</label>
                {selectedProduct && (
                  <span className="text-xs text-green-600 font-bold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> เลือกพาร์ทเรียบร้อย
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-1">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="พิมพ์รหัสสินค้าเพื่อค้นหา (Fuzzy)..."
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

              {/* Fuzzy Results Dropdown */}
              {fuzzyResults.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl max-h-[160px] overflow-y-auto shadow-lg p-2 space-y-1 z-10 relative">
                  <p className="text-[10px] text-gray-400 px-2 py-1 font-semibold">แนะนำพาร์ทที่ใกล้เคียง:</p>
                  {fuzzyResults.slice(0, 5).map((prod) => (
                    <button
                      key={prod.id}
                      onClick={() => handleSelectProduct(prod)}
                      className="w-full text-left text-xs p-2 rounded-lg hover:bg-gray-50 flex justify-between border border-transparent hover:border-gray-100 transition"
                    >
                      <span className="font-semibold text-gray-800">{prod.partNo}</span>
                      <span className="text-gray-400 text-[10px]">{prod.customer} ({prod.partName})</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Part Not Found Warning */}
              {partSearch && fuzzyResults.length === 0 && !selectedProduct && (
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex flex-col gap-2 mt-2">
                  <div className="flex items-start gap-2 text-amber-700 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">ไม่พบข้อมูล Part No "{partSearch}" ในระบบ</p>
                      <p className="text-[10px] mt-0.5 text-amber-600">ต้องการเปิดหน้าต่างสร้างพาร์ทสินค้าใหม่นี้ลงระบบ Master หรือไม่?</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setNewProdPartNo(partSearch);
                      setShowNewProductForm(true);
                    }}
                    className="bg-amber-600 text-white text-xs px-3 py-1.5 rounded-lg font-semibold w-fit self-end hover:bg-amber-700 transition"
                  >
                    ใช่, เพิ่มสินค้าใหม่
                  </button>
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
                  <span className="bg-black text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase">
                    {selectedProduct.customer}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs border-t border-gray-200/60 pt-2 mt-1">
                  <div>SAP: <span className="font-medium text-gray-700">{selectedProduct.sapNo}</span></div>
                  <div>Zone: <span className="font-medium text-gray-700">{selectedProduct.zone}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Box count and Label assignment */}
          <div className="grid grid-cols-2 gap-3 pt-1">
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
              <label className="text-xs font-semibold text-gray-600">จำนวนที่รับเข้าจริง (Qty)</label>
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
            <label className="text-xs font-semibold text-gray-600 block">Label ID (เลขลาเบลระบุสินค้า)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="พิมพ์หรือแสกนรหัสลาเบล..."
                  value={labelId}
                  onChange={(e) => setLabelId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
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
                className="bg-black hover:bg-gray-800 text-white text-xs px-3 rounded-xl font-bold transition"
              >
                สร้างลาเบล
              </button>
            </div>
          </div>

          <button
            onClick={handleAddToQueue}
            className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-lg shadow-red-600/10"
          >
            <PlusCircle className="w-5 h-5" />
            <span>ใส่รายการลงตะกร้าเตรียมรับเข้า</span>
          </button>
        </div>

        {/* Live Queue Container */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 lg:col-span-7 flex flex-col h-[580px]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-bold text-gray-800">รายการรับเข้าชั่วคราว ({queue.length})</h3>
              <p className="text-xs text-gray-400">ตรวจสอบและกดปุ่มด้านล่างเพื่อบันทึกข้อมูลเข้าฐานคลาวด์</p>
            </div>
            {queue.length > 0 && (
              <span className="text-xs font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
                ยอดรวม: {queue.reduce((acc, q) => acc + q.qty, 0).toLocaleString()} ชิ้น
              </span>
            )}
          </div>

          {/* Queue Table */}
          <div className="flex-1 overflow-y-auto border border-gray-100 rounded-xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 font-bold sticky top-0 uppercase">
                <tr>
                  <th className="p-3 border-b">Label ID</th>
                  <th className="p-3 border-b">Part No</th>
                  <th className="p-3 border-b">Location</th>
                  <th className="p-3 border-b text-right">จำนวน</th>
                  <th className="p-3 border-b text-center w-12">ลบ</th>
                </tr>
              </thead>
              <tbody>
                {queue.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-gray-400 italic">
                      ยังไม่มีรายการในตะกร้าเตรียมรับเข้า กรุณากรอกข้อมูลในฟอร์มซ้ายมือแล้วเพิ่มรายการ
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
                      <td className="p-3 font-medium text-gray-600">{item.location}</td>
                      <td className="p-3 text-right font-bold text-green-600">{item.qty.toLocaleString()}</td>
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
            <Save className="w-5 h-5" />
            <span>ยืนยันบันทึกข้อมูลเข้าระบบเรียลไทม์ ({queue.length} รายการ)</span>
          </button>
        </div>
      </div>

      {/* MODAL: ADD PRODUCT ON THE FLY */}
      {showNewProductForm && (
        <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="bg-black p-4 text-white flex justify-between items-center">
              <span className="font-bold flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-red-500" /> สร้างสินค้าใหม่ในระบบ (Product Master)
              </span>
              <button
                onClick={() => setShowNewProductForm(false)}
                className="hover:bg-gray-800 p-1 rounded-full text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddProductOnFly} className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">ลูกค้า / Brand *</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น HONDA, TOYOTA"
                    value={newProdCustomer}
                    onChange={(e) => setNewProdCustomer(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Part No *</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น HN-1234"
                    value={newProdPartNo}
                    onChange={(e) => setNewProdPartNo(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600">ชื่อรายการ (Part Name) *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น Front Fender Lining"
                  value={newProdPartName}
                  onChange={(e) => setNewProdPartName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">รหัส SAP No</label>
                  <input
                    type="text"
                    placeholder="เช่น SAP-H01"
                    value={newProdSap}
                    onChange={(e) => setNewProdSap(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">จัดเก็บโซน (Zone)</label>
                  <input
                    type="text"
                    placeholder="เช่น Zone A-3"
                    value={newProdZone}
                    onChange={(e) => setNewProdZone(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">จำนวนต่อกล่อง (Full Box)</label>
                  <input
                    type="number"
                    value={newProdFullBox}
                    onChange={(e) => setNewProdFullBox(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">ประเภทกล่อง (Package Type)</label>
                  <input
                    type="text"
                    value={newProdPkgType}
                    onChange={(e) => setNewProdPkgType(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border rounded-xl"
                  />
                </div>
              </div>

              <div className="flex gap-2.5 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewProductForm(false)}
                  className="flex-1 border py-2.5 rounded-xl font-semibold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-bold hover:bg-red-700 transition"
                >
                  เพิ่มข้อมูลลงฐานระบบ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Code Scanner Overlay */}
      <QRScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
}

// Inline helper close icon
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
