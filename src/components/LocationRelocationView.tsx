import React, { useState, useEffect } from "react";
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy, limit, doc, getDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { Product, Employee, LocationItem, LocationRelocation } from "../types";
import { fuzzySearch } from "../utils/fuzzy";
import { getSafeLocationStockId } from "../utils/syncQueue";
import { Search, AlertCircle, ArrowRightLeft, MoveRight, Clock, Check, Loader2, Info, MapPin, Calendar, ClipboardList, Layers, Activity, HelpCircle } from "lucide-react";

interface LocationRelocationViewProps {
  currentUser: Employee | null;
  prefill?: { fromLocation: string; partNo: string; qty: number } | null;
  onClearPrefill?: () => void;
}

export default function LocationRelocationView({ currentUser, prefill, onClearPrefill }: LocationRelocationViewProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [relocations, setRelocations] = useState<LocationRelocation[]>([]);
  
  // Form states
  const [partSearch, setPartSearch] = useState("");
  const [fuzzyResults, setFuzzyResults] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Prefill handler when navigated from Location Inspection board
  useEffect(() => {
    if (prefill && products.length > 0) {
      const prod = products.find((p) => p.partNo.toLowerCase() === prefill.partNo.toLowerCase());
      if (prod) {
        setSelectedProduct(prod);
        setPartSearch(prod.partNo);
        setFromLocation(prefill.fromLocation);
        setQty(prefill.qty);
        if (onClearPrefill) {
          onClearPrefill();
        }
      }
    }
  }, [prefill, products, onClearPrefill]);


  // Filter states
  const [filterPart, setFilterPart] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterLoc, setFilterLoc] = useState("all");

  // Tab-state inside right panel: "stocks" | "history"
  const [activeSubTab, setActiveSubTab] = useState<"stocks" | "history">("stocks");

  // Real-time location stocks state
  const [locationStocks, setLocationStocks] = useState<any[]>([]);
  const [inspectSearchQuery, setInspectSearchQuery] = useState("");
  const [selectedInspectLoc, setSelectedInspectLoc] = useState("all");

  // Load products, locations, and relocation history
  useEffect(() => {
    // 1. Fetch products
    const unsubProds = onSnapshot(collection(db, "products"), (snap) => {
      const items: Product[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Product));
      setProducts(items);
    });

    // 2. Fetch locations
    const unsubLocs = onSnapshot(collection(db, "locations"), (snap) => {
      const items: LocationItem[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as LocationItem));
      // Sort locations alphabetically
      items.sort((a, b) => a.name.localeCompare(b.name));
      setLocations(items);
    });

    // 3. Fetch latest 100 relocation logs
    const q = query(collection(db, "location_relocations"), orderBy("timestamp", "desc"), limit(100));
    const unsubRelocs = onSnapshot(q, (snap) => {
      const items: LocationRelocation[] = [];
      snap.forEach((d) => {
        items.push({ id: d.id, ...d.data() } as LocationRelocation);
      });
      setRelocations(items);
    });

    // 4. Fetch location stocks
    const unsubLocStocks = onSnapshot(collection(db, "location_stocks"), (snap) => {
      const items: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data.qty > 0) {
          items.push({ id: d.id, ...data });
        }
      });
      setLocationStocks(items);
    });

    return () => {
      unsubProds();
      unsubLocs();
      unsubRelocs();
      unsubLocStocks();
    };
  }, []);

  // Fuzzy search handler
  useEffect(() => {
    if (!partSearch.trim()) {
      setFuzzyResults([]);
      return;
    }
    const results = fuzzySearch<Product>(products, partSearch, (p) => p.partNo, 3);
    setFuzzyResults(results);

    // If exact match is typed, select it but keep search active
    const exact = products.find((p) => p.partNo.toLowerCase() === partSearch.trim().toLowerCase());
    if (exact && (!selectedProduct || selectedProduct.partNo !== exact.partNo)) {
      setSelectedProduct(exact);
      setQty(exact.fullBox || 0);
    }
  }, [partSearch, products]);

  const handleSelectProduct = (prod: Product) => {
    setSelectedProduct(prod);
    setQty(prod.fullBox || 0);
    setPartSearch(prod.partNo);
    setFuzzyResults([]);
  };

  const handleRelocateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!currentUser) return;
    if (currentUser?.approved === false) {
      setErrorMessage("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการย้ายตำแหน่งได้");
      return;
    }

    if (!selectedProduct) {
      setErrorMessage("กรุณาเลือกพาร์ทสินค้าที่ต้องการย้ายตำแหน่ง");
      return;
    }

    if (!fromLocation) {
      setErrorMessage("กรุณาระบุตำแหน่งต้นทาง");
      return;
    }

    if (!toLocation) {
      setErrorMessage("กรุณาระบุตำแหน่งปลายทาง");
      return;
    }

    if (fromLocation === toLocation) {
      setErrorMessage("ตำแหน่งต้นทางและตำแหน่งปลายทางต้องไม่ซ้ำกัน");
      return;
    }

    if (qty <= 0) {
      setErrorMessage("กรุณาระบุจำนวนที่ต้องการย้ายมากกว่า 0");
      return;
    }

    setIsSubmitting(true);

    try {
      // Determine shift based on current local hours
      const now = new Date();
      const hrs = now.getHours();
      const currentShift = (hrs >= 20 || hrs < 8) ? "NIGHT" : "DAY";

      // Check if original location has sufficient balance
      const fromLocStockId = getSafeLocationStockId(fromLocation, selectedProduct.partNo);
      const fromLocRef = doc(db, "location_stocks", fromLocStockId);
      const fromLocSnap = await getDoc(fromLocRef);
      const currentFromQty = fromLocSnap.exists() ? (fromLocSnap.data().qty || 0) : 0;

      if (currentFromQty < qty) {
        setErrorMessage(`ยอดในตำแหน่งต้นทางไม่เพียงพอ! (ตำแหน่ง ${fromLocation} มีพาร์ท ${selectedProduct.partNo} อยู่เพียง ${currentFromQty} ชิ้น)`);
        setIsSubmitting(false);
        return;
      }

      const batch = writeBatch(db);

      // 1. Create the relocation log
      const logRef = doc(collection(db, "location_relocations"));
      batch.set(logRef, {
        partNo: selectedProduct.partNo,
        partName: selectedProduct.partName,
        customer: selectedProduct.customer,
        fromLocation,
        toLocation,
        qty,
        operatorId: currentUser.id,
        operatorName: `${currentUser.name} ${currentUser.lastName}`,
        shift: currentShift,
        timestamp: serverTimestamp(),
      });

      // 2. Reduce qty in fromLocation
      const newFromQty = Math.max(0, currentFromQty - qty);
      batch.update(fromLocRef, {
        qty: newFromQty,
        lastUpdated: new Date()
      });

      // 3. Increase qty in toLocation
      const toLocStockId = getSafeLocationStockId(toLocation, selectedProduct.partNo);
      const toLocRef = doc(db, "location_stocks", toLocStockId);
      const toLocSnap = await getDoc(toLocRef);
      if (toLocSnap.exists()) {
        const currentToQty = toLocSnap.data().qty || 0;
        batch.update(toLocRef, {
          qty: currentToQty + qty,
          lastUpdated: new Date()
        });
      } else {
        batch.set(toLocRef, {
          id: toLocStockId,
          locationName: toLocation.trim(),
          partNo: selectedProduct.partNo,
          partName: selectedProduct.partName,
          customer: selectedProduct.customer,
          qty: qty,
          lastUpdated: new Date()
        });
      }

      await batch.commit();

      setSuccessMessage(`ย้ายตำแหน่งพาร์ท ${selectedProduct.partNo} จาก ${fromLocation} ไปยัง ${toLocation} สำเร็จ! (หักลดยอดและเพิ่มยอดจัดเก็บเรียบร้อย)`);
      
      // Reset form states
      setPartSearch("");
      setSelectedProduct(null);
      setFromLocation("");
      setToLocation("");
      setQty(0);
    } catch (err) {
      console.error("Relocation error:", err);
      setErrorMessage("เกิดข้อผิดพลาดในการบันทึกข้อมูลย้ายตำแหน่งลงคลาวด์");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter relocation list
  const filteredRelocations = relocations.filter((r) => {
    // 1. Part search filter
    if (filterPart && !r.partNo.toLowerCase().includes(filterPart.toLowerCase())) {
      return false;
    }

    // 2. Location filter (matches source or destination)
    if (filterLoc !== "all" && r.fromLocation !== filterLoc && r.toLocation !== filterLoc) {
      return false;
    }

    // 3. Date filter
    if (filterDate) {
      if (!r.timestamp) return false;
      let dateStr = "";
      if (r.timestamp.toDate) {
        const d = r.timestamp.toDate();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        dateStr = `${year}-${month}-${day}`;
      } else if (r.timestamp instanceof Date) {
        const year = r.timestamp.getFullYear();
        const month = String(r.timestamp.getMonth() + 1).padStart(2, "0");
        const day = String(r.timestamp.getDate()).padStart(2, "0");
        dateStr = `${year}-${month}-${day}`;
      } else {
        const d = new Date(r.timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        dateStr = `${year}-${month}-${day}`;
      }
      if (dateStr !== filterDate) return false;
    }

    return true;
  });

  const formatTime = (ts: any) => {
    if (!ts) return "กำลังโหลด...";
    let date: Date;
    if (ts.toDate) {
      date = ts.toDate();
    } else if (ts instanceof Date) {
      date = ts;
    } else {
      date = new Date(ts);
    }
    return date.toLocaleString("th-TH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + " น.";
  };

  return (
    <div className="space-y-6" id="location-relocation-view">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6 text-red-600 shrink-0" /> ย้ายตำแหน่งจัดเก็บ (Location Relocation)
          </h2>
          <p className="text-xs text-gray-500 font-medium">ทำรายการบันทึกย้ายตำแหน่งชิ้นงานภายในคลังสินค้าเพื่อวัตถุประสงค์ในการจัดระเบียบเชิงกายภาพ</p>
        </div>
      </div>

      {/* Info Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 text-amber-900 shadow-sm">
        <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <strong className="font-extrabold text-amber-900 block">📢 ทราบเงื่อนไขระบบ:</strong>
          <p className="text-amber-800 leading-relaxed font-semibold">
            การทำรายการย้ายตำแหน่งจัดเก็บ ณ ตรงนี้มีผลสำหรับ <span className="underline">บันทึกทางประวัติกายภาพเท่านั้น</span> ระบบจะ<strong>ไม่มีผลกระทบต่อยอดรวมสะสมสต๊อกหลักของพาร์ทสินค้านั้นๆ</strong> ในหน้าสินค้าแต่อย่างใด
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Relocation Form */}
        <form onSubmit={handleRelocateSubmit} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4 lg:col-span-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2 pb-2 border-b">
            <MapPin className="w-5 h-5 text-red-600" /> สร้างคำขอย้ายตำแหน่ง
          </h3>

          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Part Selection */}
          <div>
            <label className="text-xs font-bold text-gray-600 block mb-1">ค้นหา Part No (Fuzzy Search) *</label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="พิมพ์พาร์ทชิ้นงาน..."
                value={partSearch}
                onChange={(e) => setPartSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>

            {fuzzyResults.length > 0 && (
              <div className="bg-white border rounded-xl max-h-[140px] overflow-y-auto shadow-md p-1 mt-1 space-y-0.5 relative z-10">
                {fuzzyResults.map((prod) => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => handleSelectProduct(prod)}
                    className="w-full text-left text-xs p-2 rounded-lg hover:bg-gray-50 flex justify-between cursor-pointer"
                  >
                    <span className="font-bold text-gray-800">{prod.partNo}</span>
                    <span className="text-gray-400">รวมคงค้าง: {prod.stock || 0}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedProduct && (
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-150 space-y-2 text-xs">
              <div className="flex justify-between font-bold">
                <span className="text-gray-800">{selectedProduct.partNo}</span>
                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold uppercase">
                  {selectedProduct.customer}
                </span>
              </div>
              <p className="text-gray-500 leading-snug">{selectedProduct.partName}</p>
              <div className="flex justify-between items-center bg-white p-2 rounded border border-gray-100">
                <span className="text-gray-400 font-medium">สต๊อกระบบทั้งหมด:</span>
                <span className="font-black text-gray-900 text-sm">{selectedProduct.stock || 0} ชิ้น</span>
              </div>
            </div>
          )}

          {/* Source Location */}
          <div>
            <label className="text-xs font-bold text-gray-600 block mb-1">ตำแหน่งต้นทาง (Source Location) *</label>
            <select
              value={fromLocation}
              onChange={(e) => setFromLocation(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-1 focus:ring-red-500 bg-white"
            >
              <option value="">-- กรุณาเลือกต้นทาง --</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.name}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          {/* Destination Location */}
          <div>
            <label className="text-xs font-bold text-gray-600 block mb-1">ตำแหน่งปลายทาง (Destination Location) *</label>
            <select
              value={toLocation}
              onChange={(e) => setToLocation(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-1 focus:ring-red-500 bg-white"
            >
              <option value="">-- กรุณาเลือกปลายทาง --</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.name}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label className="text-xs font-bold text-gray-600 block mb-1">จำนวนที่ย้ายจัดเก็บ *</label>
            <input
              type="number"
              min={1}
              required
              placeholder="ป้อนจำนวนตัวเลข เช่น 20"
              value={qty || ""}
              onChange={(e) => setQty(Math.max(0, Number(e.target.value)))}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-bold focus:ring-1 focus:ring-red-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !selectedProduct}
            className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl text-xs font-bold tracking-wider transition disabled:bg-gray-150 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer select-none"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>กำลังบันทึกข้อมูลย้ายตำแหน่ง...</span>
              </>
            ) : (
              <span>ย้ายตำแหน่งสินค้า</span>
            )}
          </button>
        </form>

        {/* Right Container: Stocks & History Tabs */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-8 space-y-5">
          {/* Tabs header */}
          <div className="flex border-b border-gray-100 pb-2 justify-between items-center flex-wrap gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveSubTab("stocks")}
                className={`px-4 py-2 rounded-xl text-xs font-black tracking-wider transition-all cursor-pointer ${
                  activeSubTab === "stocks"
                    ? "bg-red-600 text-white shadow-sm"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                }`}
              >
                <Layers className="w-3.5 h-3.5 inline mr-1.5 shrink-0" />
                สต๊อกใน Location
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab("history")}
                className={`px-4 py-2 rounded-xl text-xs font-black tracking-wider transition-all cursor-pointer ${
                  activeSubTab === "history"
                    ? "bg-red-600 text-white shadow-sm"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5 inline mr-1.5 shrink-0" />
                ประวัติการย้ายตำแหน่ง
              </button>
            </div>
            <span className="text-[10px] font-black text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">
              ระบบตรวจสอบเรียลไทม์ (Real-Time)
            </span>
          </div>

          {/* Sub Tab: STOCKS IN LOCATION */}
          {activeSubTab === "stocks" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2">
                  <Layers className="w-4.5 h-4.5 text-red-600" /> 
                  ตรวจสอบรายการสินค้าแยกตามตำแหน่งจัดเก็บ
                </h3>
              </div>

              {/* Filters for Stocks */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50 p-4 rounded-xl border border-gray-100 text-xs">
                <div>
                  <label className="font-black text-gray-600 block mb-1">เลือกตำแหน่งที่ต้องการตรวจสอบ</label>
                  <select
                    value={selectedInspectLoc}
                    onChange={(e) => setSelectedInspectLoc(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-500 bg-white font-bold"
                  >
                    <option value="all">-- ตรวจสอบทุกตำแหน่ง (แสดงทั้งหมด) --</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.name}>
                        ตำแหน่ง: {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-black text-gray-600 block mb-1">ค้นหาพาร์ท / ลูกค้า (กรองด่วน)</label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="พิมพ์รหัสพาร์ท หรือ ชื่อลูกค้า..."
                      value={inspectSearchQuery}
                      onChange={(e) => setInspectSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-500 bg-white font-semibold"
                    />
                  </div>
                </div>
              </div>

              {/* Stats Panel */}
              {(() => {
                const filteredStocks = locationStocks.filter((stock) => {
                  if (selectedInspectLoc !== "all" && stock.locationName !== selectedInspectLoc) {
                    return false;
                  }
                  if (inspectSearchQuery) {
                    const q = inspectSearchQuery.toLowerCase();
                    const matchPart = stock.partNo?.toLowerCase().includes(q);
                    const matchCust = stock.customer?.toLowerCase().includes(q);
                    const matchName = stock.partName?.toLowerCase().includes(q);
                    const matchLoc = stock.locationName?.toLowerCase().includes(q);
                    if (!matchPart && !matchCust && !matchName && !matchLoc) {
                      return false;
                    }
                  }
                  return true;
                });

                const uniquePartsCount = new Set(filteredStocks.map((s) => s.partNo)).size;
                const totalStocksQty = filteredStocks.reduce((sum, s) => sum + (s.qty || 0), 0);

                return (
                  <>
                    <div className="grid grid-cols-2 gap-4 bg-red-50/40 p-4 rounded-xl border border-red-100">
                      <div className="text-center">
                        <span className="text-[10px] text-gray-500 font-extrabold uppercase tracking-wider block mb-1">จำนวนรุ่น/พาร์ทจัดเก็บ</span>
                        <span className="text-lg font-black text-red-600">{uniquePartsCount} รุ่น (Models)</span>
                      </div>
                      <div className="text-center border-l border-gray-200">
                        <span className="text-[10px] text-gray-500 font-extrabold uppercase tracking-wider block mb-1">ยอดชิ้นงานคงค้างทั้งหมด</span>
                        <span className="text-lg font-black text-gray-900">{totalStocksQty.toLocaleString()} ชิ้น (pcs)</span>
                      </div>
                    </div>

                    {/* Stock items listing */}
                    {filteredStocks.length === 0 ? (
                      <div className="py-12 text-center text-gray-400 font-medium text-xs space-y-1 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        <Layers className="w-8 h-8 text-gray-300 mx-auto animate-pulse" />
                        <p className="font-bold">ไม่มีรายการสินค้าอยู่ในพิกัด/ตำแหน่งนี้</p>
                        <p className="text-[10px] text-gray-400">เมื่อทำรายการสแกนรับเข้า ยอดจะถูกจัดเก็บลงตำแหน่งโดยอัตโนมัติ</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-gray-100">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                              <th className="p-3">ตำแหน่ง (Location)</th>
                              <th className="p-3">ลูกค้า</th>
                              <th className="p-3">รหัสสินค้า / ชื่อพาร์ท (Part info)</th>
                              <th className="p-3 text-right">ยอดชิ้นงานที่จัดเก็บ</th>
                              <th className="p-3 text-center">แก้ไขล่าสุด</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {filteredStocks.map((stock) => (
                              <tr key={stock.id} className="hover:bg-gray-50/50 transition">
                                <td className="p-3 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1.5 bg-red-50 text-red-700 font-black px-2.5 py-1 rounded-lg">
                                    <MapPin className="w-3.5 h-3.5 text-red-500" />
                                    {stock.locationName}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <span className="inline-block text-[10px] bg-gray-100 text-gray-800 px-2 py-0.5 rounded font-black uppercase border border-gray-200">
                                    {stock.customer}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <div className="font-extrabold text-gray-950 text-xs">{stock.partNo}</div>
                                  <div className="text-[10px] text-gray-400 truncate max-w-[220px]">{stock.partName}</div>
                                </td>
                                <td className="p-3 text-right font-black text-gray-900 text-sm whitespace-nowrap">
                                  {stock.qty.toLocaleString()} <span className="text-[10px] text-gray-400 font-bold">ชิ้น</span>
                                </td>
                                <td className="p-3 text-center text-gray-400 text-[10px]">
                                  {stock.lastUpdated ? (
                                    stock.lastUpdated.toDate ? (
                                      stock.lastUpdated.toDate().toLocaleDateString("th-TH")
                                    ) : (
                                      new Date(stock.lastUpdated).toLocaleDateString("th-TH")
                                    )
                                  ) : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* Sub Tab: HISTORY LOGS */}
          {activeSubTab === "history" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2">
                  <ClipboardList className="w-4.5 h-4.5 text-gray-600" /> ประวัติการย้ายตำแหน่ง (ล่าสุด 100 รายการ)
                </h3>
              </div>

              {/* Filters Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50 p-4 rounded-xl border border-gray-100 text-xs">
                <div>
                  <label className="font-bold text-gray-600 block mb-1">ค้นหาพาร์ท</label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="พิมพ์พาร์ทสินค้า..."
                      value={filterPart}
                      onChange={(e) => setFilterPart(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-500 bg-white font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-bold text-gray-600 block mb-1">ตัวกรองตำแหน่ง (รวมทั้งสองฝั่ง)</label>
                  <select
                    value={filterLoc}
                    onChange={(e) => setFilterLoc(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-500 bg-white font-semibold"
                  >
                    <option value="all">ทั้งหมด</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.name}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-gray-600 block mb-1">ตัวกรองวันที่</label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="date"
                      value={filterDate}
                      onChange={(e) => setFilterDate(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-red-500 bg-white font-semibold"
                    />
                  </div>
                </div>
              </div>

              {/* Relocation Logs Table */}
              {filteredRelocations.length === 0 ? (
                <div className="py-12 text-center text-gray-400 font-medium text-xs space-y-1">
                  <Clock className="w-8 h-8 text-gray-300 mx-auto" />
                  <p>ไม่มีประวัติการย้ายตำแหน่งที่ตรงกับเงื่อนไข</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                        <th className="p-3">วัน-เวลา</th>
                        <th className="p-3">ข้อมูลพาร์ท</th>
                        <th className="p-3">ตำแหน่งต้นทาง</th>
                        <th className="p-3"></th>
                        <th className="p-3">ตำแหน่งปลายทาง</th>
                        <th className="p-3 text-right">จำนวน</th>
                        <th className="p-3">ผู้บันทึก (กะ)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium">
                      {filteredRelocations.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50/50 transition">
                          <td className="p-3 text-gray-500 whitespace-nowrap">
                            {formatTime(item.timestamp)}
                          </td>
                          <td className="p-3">
                            <div className="font-bold text-gray-900">{item.partNo}</div>
                            <div className="text-[10px] text-gray-400 truncate max-w-[150px]">{item.partName}</div>
                            <div className="inline-block mt-0.5 text-[9px] bg-gray-100 text-gray-700 px-1 py-0.2 rounded font-black uppercase">{item.customer}</div>
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 font-bold px-2 py-1 rounded-lg">
                              <MapPin className="w-3 h-3 text-red-500" />
                              {item.fromLocation}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <MoveRight className="w-4 h-4 text-gray-400 mx-auto" />
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 font-bold px-2 py-1 rounded-lg">
                              <MapPin className="w-3 h-3 text-green-500" />
                              {item.toLocation}
                            </span>
                          </td>
                          <td className="p-3 text-right font-black text-gray-900 text-sm whitespace-nowrap">
                            {item.qty.toLocaleString()}
                          </td>
                          <td className="p-3 text-gray-600 whitespace-nowrap">
                            <div>{item.operatorName}</div>
                            <span className={`inline-block text-[9px] px-1 py-0.1 rounded font-black mt-0.5 ${
                              item.shift === "DAY" ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-800"
                            }`}>
                              กะ {item.shift === "DAY" ? "กลางวัน" : "กลางคืน"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
