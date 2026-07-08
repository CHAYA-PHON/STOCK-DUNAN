import { useState, useEffect } from "react";
import { collection, onSnapshot, query, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { Product, InventoryTransaction } from "../types";
import { 
  TrendingUp, ArrowDownRight, ArrowUpRight, Inbox, Clock, Calendar, 
  ShieldCheck, BarChart3, Layers, ArrowUpCircle, ArrowDownCircle,
  Sparkles, Brain, Bot, Loader2, Info, Copy, CheckCircle2, AlertTriangle
} from "lucide-react";

export default function DashboardView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);

  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copiedAI, setCopiedAI] = useState(false);

  // Markdown rendering helper
  const renderMarkdown = (text: string) => {
    if (!text) return null;
    return text.split("\n").map((line, idx) => {
      const cleanLine = line.trim();
      
      // Horizontal Rules
      if (cleanLine === "---" || cleanLine === "***") {
        return <hr key={idx} className="border-slate-800 my-4" />;
      }
      
      // Headers
      if (cleanLine.startsWith("### ")) {
        return <h4 key={idx} className="text-sm font-bold text-slate-100 mt-4 mb-2 flex items-center gap-1.5 text-red-300">{cleanLine.substring(4)}</h4>;
      }
      if (cleanLine.startsWith("## ")) {
        return <h3 key={idx} className="text-base font-extrabold text-red-400 mt-5 mb-3 border-b border-slate-800/60 pb-1.5 flex items-center gap-2"><Sparkles className="w-4.5 h-4.5 text-red-400 shrink-0" /> {cleanLine.substring(3)}</h3>;
      }
      if (cleanLine.startsWith("# ")) {
        return <h2 key={idx} className="text-lg font-black text-red-500 mt-6 mb-4">{cleanLine.substring(2)}</h2>;
      }

      // Check list items
      if (cleanLine.startsWith("- ") || cleanLine.startsWith("* ")) {
        const content = cleanLine.substring(2);
        const parts = content.split("**");
        return (
          <li key={idx} className="list-disc ml-5 mb-1.5 text-slate-300 leading-relaxed text-xs">
            {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-red-300 font-extrabold">{part}</strong> : part)}
          </li>
        );
      }

      // Numbered lists
      if (/^\d+\.\s/.test(cleanLine)) {
        const content = cleanLine.replace(/^\d+\.\s/, "");
        const match = cleanLine.match(/^\d+/);
        const num = match ? match[0] : "1";
        const parts = content.split("**");
        return (
          <div key={idx} className="flex gap-2.5 mb-2.5 text-xs text-slate-300 items-start leading-relaxed">
            <span className="font-bold text-red-400 font-mono shrink-0 bg-red-950/50 w-5 h-5 rounded-full flex items-center justify-center border border-red-900/35 text-[10px] mt-0.5">{num}</span>
            <div className="flex-1">
              {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-red-300 font-extrabold">{part}</strong> : part)}
            </div>
          </div>
        );
      }

      if (cleanLine === "") return <div key={idx} className="h-2" />;

      // Normal paragraph with bold replacements
      const parts = line.split("**");
      return (
        <p key={idx} className="text-slate-300 leading-relaxed text-xs mb-2">
          {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-red-300 font-extrabold">{part}</strong> : part)}
        </p>
      );
    });
  };

  const handleGenerateAIInsights = async () => {
    setIsLoadingAI(true);
    setAiError(null);
    try {
      const statsPayload = {
        totalCurrentStock,
        dailyIn,
        dailyOut,
        monthlyIn,
        monthlyOut,
        selectedMonth,
        selectedYear,
        customerStocks
      };

      const res = await fetch("/api/ai/insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          products,
          stats: statsPayload
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "ล้มเหลวในการประมวลผลสต็อกด้วยระบบ AI");
      }

      const data = await res.json();
      setAiInsights(data.insights);
    } catch (err: any) {
      console.error(err);
      setAiError(err?.message || "เกิดข้อผิดพลาดในการดึงรายงานวิเคราะห์สต็อกด้วย AI");
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleCopyAI = () => {
    if (!aiInsights) return;
    navigator.clipboard.writeText(aiInsights);
    setCopiedAI(true);
    setTimeout(() => setCopiedAI(false), 2000);
  };

  // Real-time stock listener
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "products"), (snap) => {
      const prods: Product[] = [];
      snap.forEach((doc) => prods.push({ id: doc.id, ...doc.data() } as Product));
      setProducts(prods);
    });
    return unsub;
  }, []);

  // Real-time transactions listener
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "inventory_log"), (snap) => {
      const txs: InventoryTransaction[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        txs.push({
          id: doc.id,
          ...data,
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
        } as InventoryTransaction);
      });
      setTransactions(txs);
    });
    return unsub;
  }, []);

  // Calculation boundaries based on 8:30 AM Cutoff
  const getDailyBoundaries = () => {
    const now = new Date();
    const today830 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 30, 0, 0);
    let start: Date;
    let end: Date;

    if (now < today830) {
      // Before 8:30 AM today: work day belongs to yesterday
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 8, 30, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 29, 59, 999);
    } else {
      // After 8:30 AM today: work day belongs to today
      start = today830;
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 29, 59, 999);
    }
    return { start, end };
  };

  const getMonthlyBoundaries = (m: number, y: number) => {
    // Starts on the 1st day of month at 8:30 AM
    const start = new Date(y, m - 1, 1, 8, 30, 0, 0);
    // Ends on the 1st day of next month at 8:29:59 AM
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    const end = new Date(nextYear, nextMonth - 1, 1, 8, 29, 59, 999);
    return { start, end };
  };

  // Metric summaries
  const totalCurrentStock: number = products.reduce((acc: number, p: Product) => acc + Math.max(0, p.stock || 0), 0);

  // Daily totals
  const { start: dayStart, end: dayEnd } = getDailyBoundaries();
  const dailyIn = transactions
    .filter((t) => t.type === "in" && t.timestamp >= dayStart && t.timestamp <= dayEnd)
    .reduce((acc, t) => acc + (t.qty || 0), 0);

  const dailyOut = transactions
    .filter((t) => t.type === "out" && t.timestamp >= dayStart && t.timestamp <= dayEnd)
    .reduce((acc, t) => acc + (t.qty || 0), 0);

  // Monthly totals
  const { start: monthStart, end: monthEnd } = getMonthlyBoundaries(selectedMonth, selectedYear);
  const monthlyIn = transactions
    .filter((t) => t.type === "in" && t.timestamp >= monthStart && t.timestamp <= monthEnd)
    .reduce((acc, t) => acc + (t.qty || 0), 0);

  const monthlyOut = transactions
    .filter((t) => t.type === "out" && t.timestamp >= monthStart && t.timestamp <= monthEnd)
    .reduce((acc, t) => acc + (t.qty || 0), 0);

  // Get last 7 operational days trend data
  const getPastOperationalDays = (count = 7) => {
    const daysData = [];
    const now = new Date();
    
    // Thai month abbreviation
    const thaiAbbrMonths = [
      "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
      "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
    ];

    for (let i = count - 1; i >= 0; i--) {
      const targetDay = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const currentActual830 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 30, 0, 0);
      const isBeforeCutoffToday = now < currentActual830;
      
      const shift = isBeforeCutoffToday ? -1 : 0;
      const baseDay = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate() + shift);
      
      const start = new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate(), 8, 30, 0, 0);
      const end = new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate() + 1, 8, 29, 59, 999);
      
      const dayLabel = `${baseDay.getDate()} ${thaiAbbrMonths[baseDay.getMonth()]}`;
      
      daysData.push({
        start,
        end,
        label: dayLabel,
        in: 0,
        out: 0,
      });
    }
    
    return daysData;
  };

  const recentDays = getPastOperationalDays(7);
  recentDays.forEach((day) => {
    day.in = transactions
      .filter((t) => t.type === "in" && t.timestamp >= day.start && t.timestamp <= day.end)
      .reduce((acc, t) => acc + (t.qty || 0), 0);
      
    day.out = transactions
      .filter((t) => t.type === "out" && t.timestamp >= day.start && t.timestamp <= day.end)
      .reduce((acc, t) => acc + (t.qty || 0), 0);
  });

  // Find max value in past 7 days to scale the bar chart
  const maxVal = Math.max(...recentDays.flatMap((d) => [d.in, d.out]), 100);

  // Group current products stock by customer
  const customerStocks = products.reduce((acc: { [key: string]: number }, p: Product) => {
    const cust = p.customer?.trim() || "ทั่วไป (General)";
    acc[cust] = (acc[cust] || 0) + Math.max(0, p.stock || 0);
    return acc;
  }, {});

  const sortedCustomerStocks = Object.entries(customerStocks)
    .map(([name, stock]: [string, number]) => {
      const percentage = totalCurrentStock > 0 ? (stock / totalCurrentStock) * 100 : 0;
      return { name, stock: Number(stock), percentage: Number(percentage) };
    })
    .sort((a, b) => Number(b.stock) - Number(a.stock));

  // Years for dropdown
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  // Months name
  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-850">Operational Dashboard</h2>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>ระบบตัดรอบการทำงาน ณ เวลา 08:30 น. (Real-time update active)</span>
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white p-1.5 border border-slate-200 rounded-xl shadow-sm self-stretch md:self-auto">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="bg-transparent text-sm font-semibold text-slate-700 px-3 py-2 outline-none cursor-pointer"
          >
            {thaiMonths.map((m, idx) => (
              <option key={idx} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>
          <div className="h-4 w-px bg-slate-200" />
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-transparent text-sm font-semibold text-slate-700 px-3 py-2 outline-none cursor-pointer"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                พ.ศ. {y + 543}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Large Main Metric - Total Balance */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between min-h-[180px]">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Inventory Balance</span>
            <span className="text-green-500 text-xs font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
              Real-time Central Stock
            </span>
          </div>
          <div className="flex items-baseline gap-2 py-3">
            <span className="text-5xl font-black text-slate-900 tracking-tight">{totalCurrentStock.toLocaleString()}</span>
            <span className="text-slate-400 font-semibold text-lg">PCS</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-red-600 w-3/4 rounded-full"></div>
          </div>
        </div>

        {/* Today Activity */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between min-h-[180px]">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Today Activity (ยอดวันนี้)</span>
          <div className="flex-1 flex flex-col justify-center space-y-4 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                <span className="text-sm font-semibold text-slate-600">รับเข้า (Stock In)</span>
              </div>
              <span className="text-lg font-extrabold text-slate-900">+{dailyIn.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                <span className="text-sm font-semibold text-slate-600">โอนออก (Stock Out)</span>
              </div>
              <span className="text-lg font-extrabold text-slate-900">-{dailyOut.toLocaleString()}</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            <span>ตัดยอดกะปัจจุบัน</span>
          </div>
        </div>

        {/* Monthly Summary Statistics */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between min-h-[190px]">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">ภาพรวมประจำเดือน</span>
            <span className="text-slate-500 text-xs font-bold bg-slate-100 px-2 py-0.5 rounded-md">
              {thaiMonths[selectedMonth - 1]} {selectedYear + 543}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 my-auto py-2">
            <div className="bg-green-50/50 p-4 rounded-xl border border-green-100/50">
              <span className="text-xs font-bold text-green-700 block">รับเข้าทั้งหมด (Monthly In)</span>
              <span className="text-3xl font-black text-green-600 block mt-1">+{monthlyIn.toLocaleString()}</span>
            </div>
            <div className="bg-red-50/50 p-4 rounded-xl border border-red-100/50">
              <span className="text-xs font-bold text-red-700 block">โอนออกทั้งหมด (Monthly Out)</span>
              <span className="text-3xl font-black text-red-600 block mt-1">-{monthlyOut.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Comparison Monthly Ratio Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between min-h-[190px]">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">เปรียบเทียบสัดส่วน เข้า-ออก ประจำเดือน</span>
          <div className="space-y-4 my-auto py-1">
            <div>
              <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>รับเข้า (In Ratio)</span>
                <span>{monthlyIn.toLocaleString()} Qty ({monthlyIn + monthlyOut > 0 ? ((monthlyIn / (monthlyIn + monthlyOut)) * 100).toFixed(1) : 0}%)</span>
              </div>
              <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  style={{ width: `${monthlyIn + monthlyOut > 0 ? (monthlyIn / (monthlyIn + monthlyOut)) * 100 : 0}%` }}
                  className="h-full bg-green-500 transition-all duration-500"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>โอนออก (Out Ratio)</span>
                <span>{monthlyOut.toLocaleString()} Qty ({monthlyIn + monthlyOut > 0 ? ((monthlyOut / (monthlyIn + monthlyOut)) * 100).toFixed(1) : 0}%)</span>
              </div>
              <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  style={{ width: `${monthlyIn + monthlyOut > 0 ? (monthlyOut / (monthlyIn + monthlyOut)) * 100 : 0}%` }}
                  className="h-full bg-red-500 transition-all duration-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Current Inventory Counts by Customer */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between min-h-[360px]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-600">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">ยอดคงคลังแยกตามแบรนด์/ลูกค้า (Customer Stock Breakdown)</h3>
                <p className="text-[11px] text-slate-400">สัดส่วนและปริมาณสินค้าสะสมแยกตามกลุ่มลูกค้าผู้สั่งผลิต</p>
              </div>
            </div>

            <div className="mt-5 max-h-[220px] overflow-y-auto space-y-3.5 pr-1 scrollbar-thin">
              {sortedCustomerStocks.length === 0 ? (
                <div className="py-12 text-center text-slate-400 italic text-xs">
                  ไม่มีข้อมูลจำนวนสินค้าในระบบคลัง
                </div>
              ) : (
                sortedCustomerStocks.map((item, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-semibold">
                      <span className="text-slate-700">{item.name}</span>
                      <span className="font-mono text-slate-900">
                        {item.stock.toLocaleString()} <span className="text-slate-400 text-[10px]">PCS</span>
                        <span className="text-slate-400 text-[10px] ml-1.5 font-sans">({item.percentage.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${item.percentage}%` }}
                        className="h-full bg-gradient-to-r from-red-500 to-red-600 rounded-full transition-all duration-500"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>คำนวณจากยอด Opening + In - Out สะสม</span>
            <span className="font-bold text-slate-500">รวม {sortedCustomerStocks.length} รายการ</span>
          </div>
        </div>

        {/* 7-Day Movement Trends Bar Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between min-h-[360px]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">แนวโน้มการเคลื่อนไหวสต็อก 7 วันที่ผ่านมา (7-Day Trends)</h3>
                <p className="text-[11px] text-slate-400">ปริมาณการนำเข้า (Stock In) และการโอนออก (Stock Out) รายวัน</p>
              </div>
            </div>

            {/* Interactive Dynamic Detail Display */}
            <div className="mt-4 grid grid-cols-3 gap-2 bg-slate-50/70 p-2.5 rounded-xl border border-slate-100/50 text-center">
              <div className="text-left flex flex-col justify-center pl-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">ช่วงเวลา</span>
                <span className="text-[11px] font-extrabold text-slate-700 truncate block mt-0.5">
                  {hoveredDayIndex !== null ? recentDays[hoveredDayIndex].label : "รวม 7 วันล่าสุด"}
                </span>
              </div>
              <div className="bg-white/80 p-1.5 rounded-lg border border-slate-100">
                <span className="text-[9px] font-bold text-green-600 uppercase tracking-wide block">รับเข้า (In)</span>
                <span className="text-[12px] font-black text-green-600 block mt-0.5 font-mono">
                  +{ (hoveredDayIndex !== null ? recentDays[hoveredDayIndex].in : recentDays.reduce((s, d) => s + d.in, 0)).toLocaleString() }
                </span>
              </div>
              <div className="bg-white/80 p-1.5 rounded-lg border border-slate-100">
                <span className="text-[9px] font-bold text-red-500 uppercase tracking-wide block">โอนออก (Out)</span>
                <span className="text-[12px] font-black text-red-500 block mt-0.5 font-mono">
                  -{ (hoveredDayIndex !== null ? recentDays[hoveredDayIndex].out : recentDays.reduce((s, d) => s + d.out, 0)).toLocaleString() }
                </span>
              </div>
            </div>

            {/* Custom SVG/HTML Bar Chart Visualization */}
            <div className="mt-4 h-[150px] w-full flex items-end justify-between px-1.5 pb-2 pt-6 bg-slate-50/30 rounded-xl border border-slate-100/50 relative">
              {recentDays.map((day, idx) => {
                const inPct = maxVal > 0 ? (day.in / maxVal) * 100 : 0;
                const outPct = maxVal > 0 ? (day.out / maxVal) * 100 : 0;
                const isHovered = hoveredDayIndex === idx;

                return (
                  <div
                    key={idx}
                    className="flex-1 flex flex-col items-center group relative cursor-pointer"
                    onMouseEnter={() => setHoveredDayIndex(idx)}
                    onMouseLeave={() => setHoveredDayIndex(null)}
                  >
                    {/* Bars Container */}
                    <div className="flex items-end justify-center gap-1 h-[95px] w-full relative">
                      {/* In Bar (Green) */}
                      <div
                        style={{ height: `${Math.max(inPct, 2)}%` }}
                        className={`w-2.5 sm:w-3 bg-green-500 rounded-t-sm transition-all duration-300 ease-out hover:bg-green-600 ${
                          isHovered ? "shadow-xs ring-1 ring-white" : "opacity-90"
                        }`}
                      />
                      {/* Out Bar (Red) */}
                      <div
                        style={{ height: `${Math.max(outPct, 2)}%` }}
                        className={`w-2.5 sm:w-3 bg-red-500 rounded-t-sm transition-all duration-300 ease-out hover:bg-red-600 ${
                          isHovered ? "shadow-xs ring-1 ring-white" : "opacity-90"
                        }`}
                      />
                    </div>

                    {/* Date Label */}
                    <span
                      className={`text-[9px] font-bold mt-1.5 font-mono transition-colors duration-200 ${
                        isHovered ? "text-slate-900 font-extrabold" : "text-slate-400"
                      }`}
                    >
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                รับเข้า (Stock In)
              </span>
              <span className="flex items-center gap-1 font-medium">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                โอนออก (Stock Out)
              </span>
            </div>
            <span className="italic text-[10px]">วางเมาส์ที่แท่งกราฟเพื่อดูยอดรายวัน</span>
          </div>
        </div>

        {/* WSM-DUNAN AI Stock Analytics Section */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden text-white shadow-xl">
          {/* Decorative glowing gradient effect */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-red-500/10 rounded-full filter blur-3xl -mr-20 -mt-20 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-blue-500/5 rounded-full filter blur-3xl -ml-20 -mb-20 pointer-events-none" />

          <div className="relative z-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-5 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 shadow-inner">
                  <Bot className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                    ระบบวิเคราะห์สต็อกอัจฉริยะ (AI Inventory Analytics)
                    <span className="text-[9px] font-extrabold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30 uppercase tracking-widest animate-pulse">Gemini Active</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">ใช้ความฉลาดของ AI วิเคราะห์สุขภาพคลัง แจ้งเตือนสินค้า และแนะนำกลยุทธ์ตามรอบประมวลผล</p>
                </div>
              </div>

              <div className="flex gap-2 w-full md:w-auto">
                {aiInsights && (
                  <button
                    onClick={handleCopyAI}
                    className="flex-1 md:flex-initial bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer select-none"
                  >
                    {copiedAI ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                        <span>คัดลอกสำเร็จ!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>คัดลอกบทวิเคราะห์</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  onClick={handleGenerateAIInsights}
                  disabled={isLoadingAI}
                  className="flex-1 md:flex-initial bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold px-5 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-lg shadow-red-950/20 disabled:opacity-50 disabled:cursor-not-allowed select-none"
                >
                  {isLoadingAI ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>กำลังวิเคราะห์คลัง...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-red-200" />
                      <span>{aiInsights ? "วิเคราะห์ซ้ำอีกครั้ง" : "เริ่มวิเคราะห์คลังด้วย AI"}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* AI Insights Content area */}
            {isLoadingAI ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-4 border-red-500/20 border-t-red-500 animate-spin" />
                  <Brain className="w-6 h-6 text-red-400 absolute inset-0 m-auto animate-pulse" />
                </div>
                <div className="space-y-1 max-w-md">
                  <p className="text-xs font-bold text-slate-200 animate-pulse">ระบบ AI กำลังวิเคราะห์แนวโน้มสต็อก...</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">กำลังประมวลผลความจุกล่อง (Full Box), ยอดเข้าออกของแต่ละกลุ่มลูกค้า และสินค้าที่ต้องควบคุมปริมาณเป็นพิเศษเพื่อจัดทำคำแนะนำ</p>
                </div>
              </div>
            ) : aiError ? (
              <div className="bg-red-950/30 border border-red-900/45 rounded-2xl p-4 flex gap-3 text-red-200">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <span className="font-bold block">ล้มเหลวในการเชื่อมต่อกับ AI</span>
                  <p className="text-red-300/80 leading-relaxed">{aiError}</p>
                </div>
              </div>
            ) : aiInsights ? (
              <div className="bg-slate-950/40 border border-slate-850/60 rounded-2xl p-5 md:p-6 space-y-2 max-h-[450px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                {renderMarkdown(aiInsights)}
              </div>
            ) : (
              <div className="py-10 border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center space-y-3.5 bg-slate-950/20">
                <div className="w-12 h-12 rounded-full bg-slate-800/40 border border-slate-800 flex items-center justify-center text-slate-400">
                  <Info className="w-5 h-5" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <span className="text-xs font-bold text-slate-300 block">พร้อมประมวลผลข้อมูลสต็อกเรียลไทม์</span>
                  <p className="text-[11px] text-slate-500 leading-relaxed">กดปุ่มเริ่มวิเคราะห์คลังด้วย AI ด้านบน เพื่อสรุปสุขภาพคลัง แนะนำปริมาณสินค้าที่ต้องสั่งผลิต และแนวโน้มอย่างแม่นยำ</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Security / System Guarantee banner */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0 border border-green-100 text-green-600">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-slate-800 text-sm">การทำงานด้วยระบบ Real-time Synchronization</h4>
              <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                ฐานข้อมูล WSM-DUNAN เชื่อมโยงระบบคลาวด์ Firestore ตลอดเวลา ทุกธุรกรรมและจำนวนสินค้าจะคำนวณและเผยแพร่ไปยังผู้ใช้ทุกคนทันที ป้องกันความซ้ำซ้อนอย่างสมบูรณ์แบบ
              </p>
            </div>
          </div>
          <span className="text-[10px] font-extrabold text-green-700 bg-green-100 px-3 py-1.5 rounded-lg tracking-wider uppercase shrink-0">
            ระบบทำงานปกติ 100% (LIVE)
          </span>
        </div>
      </div>
    </div>
  );
}
