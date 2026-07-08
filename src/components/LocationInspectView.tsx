import React, { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, writeBatch, query, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { Product, Employee, LocationItem } from "../types";
import { getSafeLocationStockId } from "../utils/syncQueue";
import { 
  Search, MapPin, Layers, Box, CheckCircle2, AlertTriangle, ArrowRight, Activity, 
  Loader2, ArrowRightLeft, HelpCircle, Bell, History, Sparkles, RefreshCw, X, ArrowUpRight
} from "lucide-react";

interface LocationInspectViewProps {
  currentUser: Employee | null;
  onNavigateToTab?: (tab: string, prefill?: { fromLocation: string; partNo: string; qty: number }) => void;
}

interface ToastNotification {
  id: string;
  type: "relocate" | "out" | "in";
  title: string;
  message: string;
  timestamp: Date;
}

export default function LocationInspectView({ currentUser, onNavigateToTab }: LocationInspectViewProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [locationStocks, setLocationStocks] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocFilter, setSelectedLocFilter] = useState<string>("all");
  const [isSyncingData, setIsSyncingData] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  // Real-time Event Feed States
  const [recentRelocations, setRecentRelocations] = useState<any[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [liveMergedEvents, setLiveMergedEvents] = useState<any[]>([]);

  // Toast Notifications State
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  // Track locations currently under highlight flash (expires after 8 seconds)
  const [highlightedLocations, setHighlightedLocations] = useState<Record<string, { type: "relocate" | "out" | "in"; timestamp: number }>>({});

  // Session start tracker to prevent notification spam on first load
  const sessionStartTime = useRef<number>(Date.now());
  const notifiedIds = useRef<Set<string>>(new Set());

  // Load physical locations, products, and location_stocks in real-time
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
      items.sort((a, b) => a.name.localeCompare(b.name));
      setLocations(items);
    });

    // 3. Fetch location stocks
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

    // 4. Fetch Relocations in Real-Time (Latest 15)
    const qRelocs = query(collection(db, "location_relocations"), orderBy("timestamp", "desc"), limit(15));
    const unsubRelocs = onSnapshot(qRelocs, (snap) => {
      const items: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        let ts = data.timestamp;
        let dateObj = new Date();
        if (ts) {
          if (ts.toDate) dateObj = ts.toDate();
          else dateObj = new Date(ts);
        }
        items.push({
          id: d.id,
          source: "relocate",
          partNo: data.partNo,
          partName: data.partName,
          customer: data.customer,
          fromLocation: data.fromLocation,
          toLocation: data.toLocation,
          qty: data.qty,
          operatorName: data.operatorName || "เจ้าหน้าที่คลัง",
          timestamp: dateObj,
        });
      });
      setRecentRelocations(items);
    });

    // 5. Fetch Inventory Logs (Stock In/Out) in Real-Time (Latest 15)
    const qInvLogs = query(collection(db, "inventory_log"), orderBy("timestamp", "desc"), limit(15));
    const unsubInvLogs = onSnapshot(qInvLogs, (snap) => {
      const items: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        let ts = data.timestamp;
        let dateObj = new Date();
        if (ts) {
          if (ts.toDate) dateObj = ts.toDate();
          else dateObj = new Date(ts);
        }
        items.push({
          id: d.id,
          source: "transaction",
          type: data.type, // "in" or "out"
          subType: data.subType || "",
          partNo: data.partNo,
          partName: data.partName,
          customer: data.customer,
          location: data.location || data.locationName || "ลานโอน-00",
          qty: data.qty,
          operatorName: data.operatorName || "เจ้าหน้าที่คลัง",
          timestamp: dateObj,
        });
      });
      setRecentTransactions(items);
    });

    return () => {
      unsubProds();
      unsubLocs();
      unsubLocStocks();
      unsubRelocs();
      unsubInvLogs();
    };
  }, []);

  // Merge, sort, and process notifications/visual highlights for live events
  useEffect(() => {
    const allEvents = [...recentRelocations, ...recentTransactions];
    // Sort descending chronologically
    allEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    // Store sliced events for dashboard ticker feed (Limit to 12)
    setLiveMergedEvents(allEvents.slice(0, 12));

    // Check for brand new updates to trigger alerts and visual highlight flashes
    allEvents.forEach((ev) => {
      const evMs = ev.timestamp.getTime();

      // Only notify if event occurred after page loads and hasn't been notified yet
      if (evMs > sessionStartTime.current && !notifiedIds.current.has(ev.id)) {
        notifiedIds.current.add(ev.id);

        let toastTitle = "";
        let toastMsg = "";
        let toastType: "relocate" | "out" | "in" = "in";
        const affectedLocs: string[] = [];

        if (ev.source === "relocate") {
          toastTitle = "📦 โอนย้ายตำแหน่งพิกัด";
          toastMsg = `ย้าย ${ev.partNo} (${ev.qty} ชิ้น) จาก ${ev.fromLocation} ➔ ${ev.toLocation} โดยคุณ ${ev.operatorName}`;
          toastType = "relocate";
          affectedLocs.push(ev.fromLocation, ev.toLocation);
        } else if (ev.source === "transaction") {
          if (ev.type === "out") {
            toastTitle = "📤 เบิกโอนจ่ายสินค้า";
            toastMsg = `เบิกพาร์ท ${ev.partNo} (${ev.qty} ชิ้น) จากพิกัด ${ev.location} โดยคุณ ${ev.operatorName}`;
            toastType = "out";
            affectedLocs.push(ev.location);
          } else {
            toastTitle = "📥 ตรวจสอบรับเข้าคลัง";
            toastMsg = `รับพาร์ท ${ev.partNo} (${ev.qty} ชิ้น) ไปพิกัด ${ev.location} โดยคุณ ${ev.operatorName}`;
            toastType = "in";
            affectedLocs.push(ev.location);
          }
        }

        // Add toast to display
        const newToast: ToastNotification = {
          id: ev.id,
          type: toastType,
          title: toastTitle,
          message: toastMsg,
          timestamp: ev.timestamp,
        };

        setToasts((prev) => [newToast, ...prev].slice(0, 4));

        // Activate glowing highlight classes on affected coordinates
        setHighlightedLocations((prev) => {
          const next = { ...prev };
          affectedLocs.forEach((loc) => {
            if (loc) {
              next[loc] = {
                type: toastType,
                timestamp: Date.now(),
              };
            }
          });
          return next;
        });

        // Autodismiss highlights after 8 seconds
        affectedLocs.forEach((loc) => {
          if (loc) {
            setTimeout(() => {
              setHighlightedLocations((prev) => {
                const copy = { ...prev };
                if (copy[loc] && Date.now() - copy[loc].timestamp >= 7500) {
                  delete copy[loc];
                }
                return copy;
              });
            }, 8000);
          }
        });

        // Dynamic audio chime generator (non-intrusive sound)
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);

          if (toastType === "relocate") {
            osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
            osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
          } else if (toastType === "out") {
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.setValueAtTime(440.00, ctx.currentTime + 0.1); // A4
          } else {
            osc.frequency.setValueAtTime(440.00, ctx.currentTime); // A4
            osc.frequency.setValueAtTime(554.37, ctx.currentTime + 0.1); // C#5
          }

          gain.gain.setValueAtTime(0.04, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
          osc.start();
          osc.stop(ctx.currentTime + 0.3);
        } catch (e) {
          // Blocked by audio policies
        }
      }
    });
  }, [recentRelocations, recentTransactions]);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Background Data Reconciliation for Unallocated Stocks
  useEffect(() => {
    if (products.length === 0 || isSyncingData) return;

    const canWrite = currentUser && currentUser.approved !== false;
    if (!canWrite) return;

    const runReconciliation = async () => {
      try {
        const stockProducts = products.filter((p) => (p.stock || 0) > 0);
        if (stockProducts.length === 0) return;

        const allocatedPartNos = new Set(locationStocks.map((ls) => ls.partNo));
        const unallocatedProds = stockProducts.filter((p) => !allocatedPartNos.has(p.partNo));

        if (unallocatedProds.length > 0) {
          console.log(`Reconciliation needed: ${unallocatedProds.length} parts have no location allocation. Auto-repairing...`);
          setIsSyncingData(true);
          setSyncStatusMsg(`ตรวจพบสินค้าค้างสต๊อกที่ยังไม่จัดระเบียบตำแหน่ง ${unallocatedProds.length} รายการ ระบบกำลังนำส่งเข้า "ลานโอน-00" อัตโนมัติ...`);

          const batch = writeBatch(db);
          
          for (const prod of unallocatedProds) {
            const locName = "ลานโอน-00";
            const locStockId = getSafeLocationStockId(locName, prod.partNo);
            const locStockRef = doc(db, "location_stocks", locStockId);
            
            batch.set(locStockRef, {
              id: locStockId,
              locationName: locName,
              partNo: prod.partNo,
              partName: prod.partName,
              customer: prod.customer,
              qty: prod.stock,
              lastUpdated: new Date()
            });
          }

          await batch.commit();
          setSyncStatusMsg("จัดระเบียบตำแหน่งสินค้าค้างคลังอัตโนมัติเสร็จสิ้น!");
          setTimeout(() => setSyncStatusMsg(null), 4000);
        }
      } catch (err) {
        console.error("Reconciliation failed:", err);
      } finally {
        setIsSyncingData(false);
      }
    };

    const timer = setTimeout(() => {
      runReconciliation();
    }, 2000);

    return () => clearTimeout(timer);
  }, [products, locationStocks, currentUser]);

  // Filter stocks based on selected location and query
  const filteredStocks = locationStocks.filter((stock) => {
    if (selectedLocFilter !== "all" && stock.locationName !== selectedLocFilter) {
      return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
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

  // Calculate summary stats
  const totalLocations = locations.length;
  const activeLocationsCount = new Set(locationStocks.map((ls) => ls.locationName)).size;
  const totalModelsCount = new Set(locationStocks.map((ls) => ls.partNo)).size;
  const totalQtyCount = locationStocks.reduce((sum, item) => sum + (item.qty || 0), 0);

  // Group location stocks by location to show on the cards
  const locationStatsMap = locations.reduce((acc, loc) => {
    const stocksInLoc = locationStocks.filter((s) => s.locationName === loc.name);
    const uniqueParts = new Set(stocksInLoc.map((s) => s.partNo)).size;
    const totalQty = stocksInLoc.reduce((sum, s) => sum + (s.qty || 0), 0);
    acc[loc.name] = { uniqueParts, totalQty };
    return acc;
  }, {} as Record<string, { uniqueParts: number; totalQty: number }>);

  const formatLastUpdated = (lu: any) => {
    if (!lu) return "-";
    let d: Date;
    if (lu.toDate) d = lu.toDate();
    else if (lu instanceof Date) d = lu;
    else d = new Date(lu);
    
    return d.toLocaleString("th-TH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " น.";
  };

  const getRelativeTime = (time: Date) => {
    const diffMs = Date.now() - time.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);

    if (diffSecs < 10) return "เมื่อครู่นี้";
    if (diffSecs < 60) return `${diffSecs} วินาทีที่แล้ว`;
    if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
    return time.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-6 relative" id="location-inspect-dashboard">
      
      {/* Floating Real-Time Notifications Overlay Panel */}
      <div className="fixed top-4 right-4 z-50 space-y-3 pointer-events-none max-w-sm w-full px-4 sm:px-0">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-2xl shadow-xl border flex gap-3 animate-slide-in transition-all duration-300 bg-white ${
              toast.type === "relocate"
                ? "border-orange-200 shadow-orange-500/10"
                : toast.type === "out"
                ? "border-red-200 shadow-red-500/10"
                : "border-green-200 shadow-green-500/10"
            }`}
          >
            {/* Indicator Icon */}
            <div className={`p-2 h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
              toast.type === "relocate"
                ? "bg-orange-50 text-orange-600"
                : toast.type === "out"
                ? "bg-red-50 text-red-600"
                : "bg-green-50 text-green-600"
            }`}>
              {toast.type === "relocate" ? (
                <ArrowRightLeft className="w-5 h-5 animate-pulse" />
              ) : toast.type === "out" ? (
                <ArrowUpRight className="w-5 h-5 animate-bounce" />
              ) : (
                <RefreshCw className="w-5 h-5 animate-spin" />
              )}
            </div>

            {/* Message Body */}
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start">
                <h4 className="text-xs font-black text-gray-900 leading-none">{toast.title}</h4>
                <button
                  onClick={() => dismissToast(toast.id)}
                  className="text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] font-bold text-gray-500 mt-1.5 leading-relaxed">
                {toast.message}
              </p>
              <span className="text-[9px] text-gray-400 font-bold block mt-1">
                {getRelativeTime(toast.timestamp)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Header and Title */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-red-600 shrink-0" /> ระบบตรวจสอบงานใน Location (Location Stock Inspector)
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            เครื่องมือตรวจสอบโมเดลสินค้า ยอดจัดเก็บสะสม และการเคลื่อนไหวตามตำแหน่งพิกัดจัดเก็บแบบเรียลไทม์ (Real-Time)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-black text-red-600 bg-red-50 border border-red-150 px-3.5 py-1.5 rounded-full shadow-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
          </span>
          <span>ระบบเชื่อมโยงเรียลไทม์แอกทีฟ</span>
        </div>
      </div>

      {/* Sync Reconciliation Alert Banner */}
      {syncStatusMsg && (
        <div className="bg-red-50/60 border border-red-200 text-red-800 rounded-xl p-3.5 text-xs flex items-center gap-2.5 animate-pulse">
          <Loader2 className="w-4 h-4 text-red-600 animate-spin shrink-0" />
          <span className="font-semibold">{syncStatusMsg}</span>
        </div>
      )}

      {/* Top statistics summary panel */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-gray-150 shadow-xs">
          <span className="text-[10px] text-gray-400 font-bold tracking-wider uppercase block mb-1">ตำแหน่งทั้งหมด</span>
          <div className="flex items-center justify-between">
            <span className="text-xl font-black text-gray-900">{totalLocations} พิกัด</span>
            <MapPin className="w-5 h-5 text-gray-400" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-150 shadow-xs">
          <span className="text-[10px] text-gray-400 font-bold tracking-wider uppercase block mb-1">ตำแหน่งที่มีสินค้าใช้งาน</span>
          <div className="flex items-center justify-between">
            <span className="text-xl font-black text-red-600">{activeLocationsCount} พิกัด</span>
            <CheckCircle2 className="w-5 h-5 text-red-500" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-150 shadow-xs">
          <span className="text-[10px] text-gray-400 font-bold tracking-wider uppercase block mb-1">จำนวนรุ่น/พาร์ทรวม</span>
          <div className="flex items-center justify-between">
            <span className="text-xl font-black text-gray-900">{totalModelsCount} รุ่น</span>
            <Box className="w-5 h-5 text-gray-400" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-150 shadow-xs">
          <span className="text-[10px] text-gray-400 font-bold tracking-wider uppercase block mb-1">ยอดชิ้นงานคงคลังสะสม</span>
          <div className="flex items-center justify-between">
            <span className="text-xl font-black text-gray-900">{totalQtyCount.toLocaleString()} ชิ้น</span>
            <Activity className="w-5 h-5 text-red-500 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Core Grid Layout: 3-Panel system */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Panel 1: Location Map Grid (col-span-4) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-black text-gray-600 uppercase tracking-widest flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-red-600" />
              <span>แผนผัง / ตําแหน่งจัดเก็บ</span>
            </h3>
            {selectedLocFilter !== "all" && (
              <button
                onClick={() => setSelectedLocFilter("all")}
                className="text-[10px] font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-lg hover:bg-red-100 transition cursor-pointer"
              >
                เคลียร์เลือกทั้งหมด
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 max-h-[550px] overflow-y-auto pr-1">
            {/* "All" Select Card */}
            <div
              onClick={() => setSelectedLocFilter("all")}
              className={`p-3.5 rounded-2xl border cursor-pointer transition flex flex-col justify-between h-24 ${
                selectedLocFilter === "all"
                  ? "border-red-600 bg-red-600 text-white shadow-md shadow-red-600/10"
                  : "border-gray-200 bg-white hover:bg-gray-50/50"
              }`}
            >
              <div className="flex justify-between items-start">
                <span className={`text-xs font-black ${selectedLocFilter === "all" ? "text-white" : "text-gray-900"}`}>
                  ทุกตำแหน่งจัดเก็บ
                </span>
                <Layers className={`w-4 h-4 ${selectedLocFilter === "all" ? "text-red-200" : "text-gray-400"}`} />
              </div>
              <div>
                <span className={`text-xs block font-bold ${selectedLocFilter === "all" ? "text-red-100" : "text-gray-400"}`}>
                  โมเดลรวมสะสม
                </span>
                <span className="text-base font-black leading-none">{totalModelsCount} รุ่น</span>
              </div>
            </div>

            {/* Iterated Location Cards with highlights */}
            {locations.map((loc) => {
              const stats = locationStatsMap[loc.name] || { uniqueParts: 0, totalQty: 0 };
              const isSelected = selectedLocFilter === loc.name;
              const hasStock = stats.totalQty > 0;
              
              // Real-time changes highlighting
              const isHighlighted = highlightedLocations[loc.name];
              const hType = isHighlighted?.type;

              return (
                <div
                  key={loc.id}
                  onClick={() => setSelectedLocFilter(loc.name)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition flex flex-col justify-between h-24 relative overflow-hidden ${
                    isSelected
                      ? "border-red-600 bg-red-600 text-white shadow-md shadow-red-600/10"
                      : isHighlighted
                      ? hType === "relocate"
                        ? "border-orange-500 bg-orange-50/70 ring-4 ring-orange-500/30 animate-pulse"
                        : hType === "out"
                        ? "border-red-500 bg-red-50/70 ring-4 ring-red-500/30 animate-pulse"
                        : "border-green-500 bg-green-50/70 ring-4 ring-green-500/30 animate-pulse"
                      : hasStock
                      ? "border-red-100 bg-red-50/20 hover:bg-red-50/40"
                      : "border-gray-200 bg-white hover:bg-gray-50/50"
                  }`}
                >
                  {/* Floating Action Badge for Alerts */}
                  {isHighlighted && (
                    <span className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded text-[8px] font-black uppercase text-white animate-bounce tracking-wider shadow-sm ${
                      hType === "relocate" ? "bg-orange-600" : hType === "out" ? "bg-red-600" : "bg-green-600"
                    }`}>
                      {hType === "relocate" ? "ย้ายตำแหน่ง" : hType === "out" ? "โอนออก" : "รับเข้า"}
                    </span>
                  )}

                  {/* Pulsing state dot */}
                  {hasStock && !isSelected && !isHighlighted && (
                    <span className="absolute top-3.5 right-3.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  )}

                  <div className="flex justify-between items-start">
                    <span className={`text-xs font-black truncate max-w-[90px] ${isSelected ? "text-white" : "text-gray-900"}`}>
                      {loc.name}
                    </span>
                    <MapPin className={`w-3.5 h-3.5 ${isSelected ? "text-red-200" : hasStock ? "text-red-500" : "text-gray-300"}`} />
                  </div>

                  <div>
                    {hasStock ? (
                      <div className="space-y-0.5">
                        <span className={`text-[10px] block font-bold ${isSelected ? "text-red-100" : "text-gray-500"}`}>
                          {stats.uniqueParts} รุ่นจัดเก็บ
                        </span>
                        <span className="text-sm font-black leading-none">
                          {stats.totalQty.toLocaleString()}{" "}
                          <span className={`text-[9px] font-bold ${isSelected ? "text-red-100" : "text-gray-400"}`}>ชิ้น</span>
                        </span>
                      </div>
                    ) : (
                      <span className={`text-[10px] font-bold ${isSelected ? "text-red-100" : "text-gray-400"}`}>
                        ไม่มีชิ้นงานจัดเก็บ
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel 2: Detailed Table of location contents (col-span-5) */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-gray-150 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-red-600 shrink-0" />
                <span>สินค้าพิกัด: {selectedLocFilter === "all" ? "ทั้งหมด" : selectedLocFilter}</span>
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                แสดงจำแนกจำนวนแต่ละโมเดล และพิกัดคงเหลือแบบเรียลไทม์
              </p>
            </div>
            <div className="text-[10px] font-black text-gray-500 bg-gray-50 px-2 py-1 rounded-lg shrink-0 border border-gray-100">
              {filteredStocks.length} รายการ
            </div>
          </div>

          {/* Quick Search inside Table */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="รหัสพาร์ท, ชื่อพาร์ท, ลูกค้า หรือตำแหน่ง..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-1 focus:ring-red-500 bg-white"
            />
          </div>

          {/* Table displaying results */}
          {filteredStocks.length === 0 ? (
            <div className="py-16 text-center text-gray-400 font-medium text-xs space-y-2 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              <Layers className="w-8 h-8 text-gray-300 mx-auto" />
              <p className="font-bold text-gray-800">ไม่พบสินค้าจัดเก็บ</p>
              <p className="text-[10px] text-gray-400 max-w-xs mx-auto">
                {selectedLocFilter === "all"
                  ? "ไม่มีบันทึกข้อมูลปริมาณสินค้าในตำแหน่งจัดเก็บขณะนี้"
                  : `ไม่มีรุ่นสินค้าคงเหลือในตำแหน่ง "${selectedLocFilter}" แล้ว`}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100 max-h-[500px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                    <th className="p-3">ตำแหน่ง (Location)</th>
                    <th className="p-3">ข้อมูลสินค้า (Part details)</th>
                    <th className="p-3 text-right">จำนวนสะสม</th>
                    {onNavigateToTab && <th className="p-3 text-center">ควบคุม</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-150 font-medium text-gray-700">
                  {filteredStocks.map((stock) => {
                    const isRowHighlighted = highlightedLocations[stock.locationName];
                    const rowHType = isRowHighlighted?.type;

                    return (
                      <tr 
                        key={stock.id} 
                        className={`transition duration-500 ${
                          isRowHighlighted 
                            ? rowHType === "relocate"
                              ? "bg-orange-50/80 font-black text-orange-900 border-l-2 border-l-orange-500 animate-pulse"
                              : rowHType === "out"
                              ? "bg-red-50/80 font-black text-red-900 border-l-2 border-l-red-500 animate-pulse"
                              : "bg-green-50/80 font-black text-green-900 border-l-2 border-l-green-500 animate-pulse"
                            : "hover:bg-gray-50/50"
                        }`}
                      >
                        <td className="p-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 bg-red-50 text-red-700 font-black px-2 py-0.5 rounded-lg">
                            <MapPin className="w-3 h-3 text-red-500" />
                            {stock.locationName}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="font-black text-gray-900 text-xs flex items-center gap-1.5">
                            <span>{stock.partNo}</span>
                            <span className="text-[9px] bg-gray-100 text-gray-500 px-1 py-0.2 rounded uppercase scale-90 border border-gray-150">
                              {stock.customer}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400 truncate max-w-[130px]" title={stock.partName}>
                            {stock.partName}
                          </div>
                        </td>
                        <td className="p-3 text-right font-black text-gray-900 text-xs whitespace-nowrap">
                          {stock.qty.toLocaleString()} <span className="text-[9px] text-gray-400 font-bold">ชิ้น</span>
                        </td>
                        {onNavigateToTab && (
                          <td className="p-3 text-center whitespace-nowrap">
                            <button
                              onClick={() => {
                                onNavigateToTab("location_relocate", {
                                  fromLocation: stock.locationName,
                                  partNo: stock.partNo,
                                  qty: stock.qty
                                });
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-800 font-black text-[10px] transition cursor-pointer"
                              title="คลิกเพื่อป้อนเข้าฟอร์มจัดระเบียบชั้นย้ายตำแหน่งทันที"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                              <span>ย้ายตำแหน่ง</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Panel 3: Live Alerts & Relocation Feed Sidebar Ticker (col-span-3) */}
        <div className="lg:col-span-3 bg-gray-900 text-white p-5 rounded-2xl border border-gray-850 shadow-md space-y-4">
          <div className="flex items-center justify-between border-b border-gray-800 pb-3">
            <h3 className="font-black text-xs uppercase tracking-wider text-red-400 flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-red-500 animate-bounce" />
              <span>แจ้งเตือนสต๊อกพิกัดล่าสุด</span>
            </h3>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
          </div>

          {/* Event Stream List */}
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 text-[11px] leading-relaxed">
            {liveMergedEvents.length === 0 ? (
              <div className="py-16 text-center text-gray-500 space-y-2 font-medium">
                <History className="w-6 h-6 text-gray-600 mx-auto" />
                <p>ไม่มีแอกทิวิตี้บันทึกขณะนี้</p>
                <p className="text-[9px] text-gray-600">ทำรายการย้ายคลังหรือรับ/เบิกเพื่ออัปเดตแบบเรียลไทม์</p>
              </div>
            ) : (
              liveMergedEvents.map((ev, index) => {
                const isRelocate = ev.source === "relocate";
                const isOut = !isRelocate && ev.type === "out";
                const isIn = !isRelocate && ev.type === "in";

                return (
                  <div 
                    key={ev.id || index}
                    className={`p-3 rounded-xl border transition-all duration-300 bg-gray-850/60 ${
                      index === 0 ? "border-red-500/30 ring-1 ring-red-500/20 bg-gray-850" : "border-gray-800"
                    }`}
                  >
                    {/* Event Tag */}
                    <div className="flex justify-between items-center mb-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase text-white ${
                        isRelocate 
                          ? "bg-orange-600" 
                          : isOut 
                          ? "bg-red-600" 
                          : "bg-green-600"
                      }`}>
                        {isRelocate ? "โอนย้ายคลัง" : isOut ? "โอนออกคลัง" : "รับเข้าคลัง"}
                      </span>
                      <span className="text-[9px] text-gray-500 font-bold">
                        {getRelativeTime(ev.timestamp)}
                      </span>
                    </div>

                    {/* Part Details */}
                    <div className="font-extrabold text-white text-xs mb-1">
                      {ev.partNo}
                    </div>

                    {/* Movement info */}
                    <div className="text-gray-400 font-bold text-[10px] space-y-0.5">
                      <div>
                        จำนวน: <span className="text-white font-black">{ev.qty.toLocaleString()}</span> ชิ้น
                      </div>
                      
                      {isRelocate ? (
                        <div className="flex items-center gap-1 text-orange-400">
                          <span>{ev.fromLocation}</span>
                          <ArrowRight className="w-2.5 h-2.5 inline shrink-0 text-white" />
                          <span>{ev.toLocation}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-gray-300">
                          <span>พิกัดคลัง:</span>
                          <span className={isOut ? "text-red-400" : "text-green-400"}>{ev.location}</span>
                        </div>
                      )}
                    </div>

                    {/* Operator Name */}
                    <div className="text-[9px] text-gray-500 font-bold border-t border-gray-800 mt-2 pt-1 flex justify-between">
                      <span>โดย: {ev.operatorName}</span>
                      <span className="uppercase tracking-wider font-black text-[8px] text-gray-600">WSM-DUNAN</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Guide Banner */}
      <div className="p-4 bg-gray-50 rounded-2xl border border-gray-150 flex items-start gap-3 text-xs leading-normal">
        <HelpCircle className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
        <div className="text-gray-500 font-medium">
          <span className="font-black text-gray-700">คำแนะนำระบบควบคุมพิกัดจัดเก็บ (Location Storage Control):</span>
          <ul className="list-disc ml-4 mt-1 space-y-1 text-[11px]">
            <li>แดชบอร์ดด้านขวาจะรายงาน <strong className="text-red-600">ฟีดความเคลื่อนไหว (Active Location Feed)</strong> โดยอัตโนมัติในแบบเรียลไทม์ พร้อมส่งสัญญาณเตือนภัย (Real-time Audio Chime) และการแจ้งเตือน Pop-up ทันทีที่มีรายการเกิดขึ้น</li>
            <li>ตำแหน่งพิกัดจัดเก็บที่ถูกกระทบ (ย้ายเข้า ย้ายออก หรือเบิกโอนจ่าย) จะกะพริบและเปล่งแสง <strong className="text-amber-500">Highlight Pulse</strong> เป็นสีเหลือง/แดง/เขียว เพื่อเป็นสัญญาณระบุการอัปเดตแบบเรียลไทม์เป็นเวลา 8 วินาที</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
