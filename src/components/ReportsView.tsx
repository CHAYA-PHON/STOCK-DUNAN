import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query, where, getDocs, doc, writeBatch, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { InventoryTransaction, Employee } from "../types";
import * as XLSX from "xlsx";
import { FileText, Download, Printer, Filter, Calendar, Users, Eye, CheckCircle } from "lucide-react";

interface ReportsViewProps {
  currentUser: Employee | null;
}

export default function ReportsView({ currentUser }: ReportsViewProps) {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Filter States
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterType, setFilterType] = useState<"all" | "in" | "out">("all");

  // Transfer Printing filter states
  const [printDate, setPrintDate] = useState(new Date().toISOString().split("T")[0]);
  const [printOperator, setPrintOperator] = useState("all");
  const [printCustomer, setPrintCustomer] = useState("all");
  const [printType, setPrintType] = useState("ส่งสโตร์ FG");

  // Printable matches
  const [printableTransactions, setPrintableTransactions] = useState<InventoryTransaction[]>([]);

  // Active printable slip layout states
  const [slipPreviewOpen, setSlipPreviewOpen] = useState(false);

  useEffect(() => {
    // 1. Fetch transactions
    const unsubTxs = onSnapshot(collection(db, "inventory_log"), (snap) => {
      const list: InventoryTransaction[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          ...data,
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
        } as InventoryTransaction);
      });
      // Sort newest first
      list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      setTransactions(list);
    });

    // 2. Fetch employees for print filters
    const unsubEmps = onSnapshot(collection(db, "employees"), (snap) => {
      const list: Employee[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Employee));
      setEmployees(list);
    });

    return () => {
      unsubTxs();
      unsubEmps();
    };
  }, []);

  // Filter Transactions for general report
  const filteredTxs = transactions.filter((t) => {
    const d = t.timestamp;
    if (d.getMonth() + 1 !== filterMonth || d.getFullYear() !== filterYear) return false;
    if (filterType !== "all" && t.type !== filterType) return false;
    return true;
  });

  // Calculate printable transactions based on print filters
  useEffect(() => {
    const list = transactions.filter((t) => {
      // 1. Filter by Date (local date string check YYYY-MM-DD)
      const tDateStr = t.timestamp.toISOString().split("T")[0];
      if (tDateStr !== printDate) return false;

      // 2. Operator filter
      if (printOperator !== "all" && t.operatorId !== printOperator) return false;

      // 3. Customer filter
      if (printCustomer !== "all" && t.customer.toLowerCase() !== printCustomer.toLowerCase()) return false;

      // 4. Transfer SubType filter
      if (printType !== "all" && t.subType !== printType) return false;

      return true;
    });

    setPrintableTransactions(list);
  }, [transactions, printDate, printOperator, printCustomer, printType]);

  // Excel download logic
  const handleExportExcel = () => {
    if (filteredTxs.length === 0) {
      alert("ไม่มีข้อมูลที่จะส่งออกในรอบเดือนนี้");
      return;
    }

    try {
      // Create clean rows format
      const sheetData = filteredTxs.map((t) => ({
        "วันที่ทำรายการ": t.timestamp.toLocaleString("th-TH"),
        "ประเภท": t.type === "in" ? "รับเข้า" : "โอนออก",
        "การจัดหมวดหมู่": t.subType,
        "แบรนด์ / ลูกค้า": t.customer,
        "รหัสสินค้า (Part No)": t.partNo,
        "ชื่อพาร์ทสินค้า": t.partName,
        "จำนวน Qty": t.qty,
        "สถานที่จัดเก็บ (Location)": t.location,
        "กะ (Shift)": t.shift,
        "ผู้บันทึกข้อมูล": t.operatorName,
        "รหัสฉลากสินค้า (Label ID)": t.labelId,
        "พิมพ์แล้ว": t.printed ? "พิมพ์แล้ว" : "ยังไม่ได้พิมพ์",
      }));

      const worksheet = XLSX.utils.json_to_sheet(sheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory Reports");

      // Set width
      const max_width = sheetData.reduce((w, r) => Math.max(w, Object.values(r).join("").length / 2), 10);
      worksheet["!cols"] = Array(12).fill({ wch: Math.max(15, max_width) });

      XLSX.writeFile(workbook, `Inventory_Report_${filterMonth}_${filterYear}.xlsx`);
    } catch (err) {
      console.error("Export excel failure:", err);
      alert("ไม่สามารถสร้างไฟล์ Excel ได้");
    }
  };

  // Printing Slip and Updating Printed state
  const handlePrintSlip = async () => {
    if (printableTransactions.length === 0) {
      alert("ไม่มีข้อมูลรายการสินค้าที่จะจัดพิมพ์ในใบโอนย้ายนี้");
      return;
    }

    try {
      // 1. Trigger browser print (standard popup)
      window.print();

      // 2. Change state of matched transactions in Firestore to printed = true (พิมพ์แล้ว)
      const batch = writeBatch(db);
      for (const item of printableTransactions) {
        const ref = doc(db, "inventory_log", item.id);
        batch.update(ref, { printed: true });
      }
      await batch.commit();

      alert("ระบบพิมพ์เอกสารสำเร็จ และปรับปรุงสถานะธุรกรรมเป็น 'พิมพ์แล้ว' เรียบร้อย");
      setSlipPreviewOpen(false);
    } catch (err) {
      console.error("Print commit error:", err);
    }
  };

  // Helper: auto resolve shift based on actual transaction hours (DAY: 08:30 - 20:29, NIGHT: 20:30 - 08:29)
  const getResolvedShiftForTime = (d: Date) => {
    const hrs = d.getHours();
    const mins = d.getMinutes();
    const totalMins = hrs * 60 + mins;

    // DAY: 08:30 (510 mins) to 20:29 (1229 mins)
    if (totalMins >= 510 && totalMins < 1230) {
      return "DAY";
    } else {
      return "NIGHT";
    }
  };

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);
  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];

  const uniqueCustomers = Array.from(new Set(transactions.map((t) => t.customer).filter(Boolean)));
  const uniqueSubTypes = Array.from(new Set(transactions.map((t) => t.subType).filter(Boolean)));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">ระบบรายงานสินค้าและพิมพ์เอกสาร</h2>
          <p className="text-sm text-gray-500 mt-1">วิเคราะห์ประวัติสต๊อก เข้า-ออก คลังสินค้า พร้อมจัดพิมพ์ใบส่งของโอนย้าย</p>
        </div>
      </div>

      {/* Tabs / Multi grid design */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Reports panel */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-7 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
            <h3 className="font-bold text-gray-800 flex items-center gap-1.5">
              <Calendar className="w-5 h-5 text-red-600" /> ตารางสรุปสต๊อกเข้าออกรายเดือน
            </h3>

            <button
              onClick={handleExportExcel}
              className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-sm self-stretch sm:self-auto justify-center"
            >
              <Download className="w-4 h-4" />
              <span>ดาวน์โหลด Excel</span>
            </button>
          </div>

          {/* Month Year select filter bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-gray-50 p-3 rounded-xl border">
            <div>
              <select
                value={filterMonth}
                onChange={(e) => setFilterMonth(Number(e.target.value))}
                className="w-full p-2 bg-white border rounded-lg text-xs font-semibold"
              >
                {thaiMonths.map((m, idx) => (
                  <option key={idx} value={idx + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(Number(e.target.value))}
                className="w-full p-2 bg-white border rounded-lg text-xs font-semibold"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    พ.ศ. {y + 543}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="w-full p-2 bg-white border rounded-lg text-xs font-semibold"
              >
                <option value="all">ดูรายการทั้งหมด</option>
                <option value="in">เฉพาะรับเข้า (In)</option>
                <option value="out">เฉพาะโอนออก (Out)</option>
              </select>
            </div>
          </div>

          {/* List transactions */}
          <div className="overflow-x-auto border border-gray-50 rounded-xl max-h-[350px] overflow-y-auto text-xs">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-gray-500 font-bold border-b sticky top-0">
                <tr>
                  <th className="p-3">วันเวลา</th>
                  <th className="p-3">ประเภท</th>
                  <th className="p-3">พาร์ทสินค้า / รายการ</th>
                  <th className="p-3 text-right">จำนวน</th>
                  <th className="p-3">พิกัด / กะ</th>
                </tr>
              </thead>
              <tbody>
                {filteredTxs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-gray-400 italic">
                      ไม่พบประวัติธุรกรรมในรอบเดือนที่เลือก
                    </td>
                  </tr>
                ) : (
                  filteredTxs.map((t) => (
                    <tr key={t.id} className="border-b hover:bg-gray-50/50 transition">
                      <td className="p-3 text-gray-400 font-mono">
                        {t.timestamp.toLocaleDateString("th-TH")}
                        <div className="text-[10px]">{t.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                          t.type === "in"
                            ? "bg-green-50 text-green-700" 
                            : t.subType.includes("ปรับยอด") 
                            ? "bg-yellow-50 text-yellow-700" 
                            : "bg-red-50 text-red-600"
                        }`}>
                          {t.type === "in" ? "รับเข้า" : "โอนออก"}
                        </span>
                        <div className="text-[9px] text-gray-400 mt-1">{t.subType}</div>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-gray-800">{t.partNo}</span>
                        <div className="text-[10px] text-gray-400 truncate max-w-[150px]">{t.partName}</div>
                        <div className="text-[9px] text-gray-400">ผู้ทำ: {t.operatorName}</div>
                      </td>
                      <td className="p-3 text-right">
                        <span className={`font-bold ${t.type === "in" ? "text-green-600" : "text-red-500"}`}>
                          {t.type === "in" ? "+" : "-"}
                          {t.qty.toLocaleString()}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-gray-700">{t.location}</div>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                          t.shift === "NIGHT" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700"
                        }`}>
                          {t.shift}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Print Slip section */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-5 space-y-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-1.5">
            <Printer className="w-5 h-5 text-red-600" /> ระบบจัดพิมพ์ใบโอน / ใบเบิกสโตร์
          </h3>

          <div className="space-y-3.5 bg-gray-50 p-4 rounded-xl border text-xs">
            <div>
              <label className="text-xs font-bold text-gray-700 block">กรองวันทำการโอนย้าย *</label>
              <input
                type="date"
                value={printDate}
                onChange={(e) => setPrintDate(e.target.value)}
                className="w-full mt-1 p-2 bg-white border rounded-lg font-semibold"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 block">กรองประเภทการโอนย้าย</label>
              <select
                value={printType}
                onChange={(e) => setPrintType(e.target.value)}
                className="w-full mt-1 p-2 bg-white border rounded-lg font-semibold"
              >
                <option value="ส่งสโตร์ FG">ส่งสโตร์ FG (Default)</option>
                <option value="เบิกงาน Rework">เบิกงาน Rework</option>
                <option value="เบิกงานจาก TN">เบิกงานจาก TN</option>
                <option value="all">แสดงประเภทโอนออกทั้งหมด</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-bold text-gray-700 block">พนักงานผู้ส่งมอบ</label>
                <select
                  value={printOperator}
                  onChange={(e) => setPrintOperator(e.target.value)}
                  className="w-full mt-1 p-2 bg-white border rounded-lg font-semibold"
                >
                  <option value="all">พนักงานทุกคน</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block">ลูกค้า / แบรนด์ปลายทาง</label>
                <select
                  value={printCustomer}
                  onChange={(e) => setPrintCustomer(e.target.value)}
                  className="w-full mt-1 p-2 bg-white border rounded-lg font-semibold"
                >
                  <option value="all">ลูกค้าทั้งหมด</option>
                  {uniqueCustomers.map((cust, i) => (
                    <option key={i} value={cust}>
                      {cust}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="border border-red-100 p-4 rounded-xl bg-red-50/50 flex justify-between items-center text-xs">
            <div>
              <p className="font-bold text-gray-800">รายการที่ตรงเงื่อนไข:</p>
              <p className="text-sm font-bold text-red-600 mt-0.5">{printableTransactions.length} รายการโอนย้าย</p>
            </div>
            <button
              onClick={() => setSlipPreviewOpen(true)}
              disabled={printableTransactions.length === 0}
              className={`px-4 py-2.5 rounded-xl font-bold flex items-center gap-1.5 transition ${
                printableTransactions.length === 0
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-red-600 text-white hover:bg-red-700 shadow-sm cursor-pointer"
              }`}
            >
              <Eye className="w-4 h-4" />
              <span>เปิดดูและสั่งพิมพ์</span>
            </button>
          </div>
        </div>
      </div>

      {/* PRINT DIALOG SLIP OVERLAY PREVIEW */}
      {slipPreviewOpen && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col my-8">
            <div className="bg-black p-4 text-white flex justify-between items-center">
              <span className="font-bold text-xs flex items-center gap-1.5">
                <Printer className="w-4 h-4 text-red-600" /> ตรวจสอบใบโอนส่งมอบสินค้า (Transfer Slip Slip)
              </span>
              <button
                onClick={() => setSlipPreviewOpen(false)}
                className="hover:bg-gray-800 p-1.5 rounded-full text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* PRINT PORTION START */}
            <div className="p-8 flex-1 space-y-6" id="print-area">
              {/* Slip Header */}
              <div className="flex justify-between items-start border-b-2 border-black pb-4 text-xs">
                <div>
                  <h1 className="text-lg font-bold text-gray-900 tracking-tight">WSM-DUNAN CO., LTD.</h1>
                  <p className="text-gray-500 mt-1">คลังจัดส่งและระบบโอนย้ายสโมสรสินค้า</p>
                  <p className="text-gray-500">ใบโอนสินค้าภายใน / ใบจัดเตรียมส่งมอบ</p>
                </div>
                <div className="text-right">
                  <span className="bg-black text-white text-[10px] px-2.5 py-1 rounded font-bold uppercase tracking-wider block mb-2">
                    {printType}
                  </span>
                  <p className="text-gray-500">วันที่พิมพ์: {new Date().toLocaleDateString("th-TH")}</p>
                  <p className="text-gray-500">เวลากำหนด: {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} น.</p>
                </div>
              </div>

              {/* Meta details */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-gray-50 p-4 border rounded-xl">
                <div>
                  <p className="text-gray-400">ผู้รับผิดชอบงาน:</p>
                  <p className="font-bold text-gray-800 mt-0.5">
                    {printOperator === "all" ? "พนักงานแผนกโอนย้ายรวม" : employees.find((e) => e.id === printOperator)?.name || "System Operator"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">ลูกค้าแบรนด์ปลายทาง:</p>
                  <p className="font-bold text-gray-800 mt-0.5 uppercase">
                    {printCustomer === "all" ? "ลูกค้าทั่วไปทั้งหมด" : printCustomer}
                  </p>
                </div>
              </div>

              {/* Transactions list */}
              <div className="space-y-2 text-xs">
                <p className="font-bold text-gray-800">รายการสินค้า (พาร์ท) ที่ส่งมอบโอนย้าย:</p>
                <table className="w-full text-left border">
                  <thead>
                    <tr className="bg-gray-100 border-b">
                      <th className="p-2 border-r">รหัสสินค้า (Part No)</th>
                      <th className="p-2 border-r">ชื่อพาร์ทสินค้า (Part Name)</th>
                      <th className="p-2 border-r text-center">กะจริง (Shift)</th>
                      <th className="p-2 border-r">พิกัด Location</th>
                      <th className="p-2 text-right">จำนวนชิ้น Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printableTransactions.map((item, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2 border-r font-bold text-gray-900">{item.partNo}</td>
                        <td className="p-2 border-r text-gray-600 max-w-[150px] truncate">{item.partName}</td>
                        <td className="p-2 border-r text-center font-bold">
                          {/* Resolved Shift info from transaction timestamp */}
                          {getResolvedShiftForTime(item.timestamp)}
                        </td>
                        <td className="p-2 border-r font-medium text-gray-600">{item.location}</td>
                        <td className="p-2 text-right font-bold text-gray-900">{item.qty.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50/50 font-bold">
                      <td colSpan={4} className="p-2 border-r text-right uppercase">ยอดรวมส่งโอนย้ายทั้งสิ้น:</td>
                      <td className="p-2 text-right text-sm underline underline-offset-4">
                        {printableTransactions.reduce((acc, t) => acc + t.qty, 0).toLocaleString()} ชิ้น
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Delivery signatures */}
              <div className="grid grid-cols-2 gap-8 pt-10 border-t border-dashed">
                <div className="text-center space-y-12">
                  <p className="text-xs text-gray-500 font-medium">ลงชื่อผู้ทำการจัดโอนสินค้า (ผู้ส่งมอบ)</p>
                  <div>
                    <div className="h-0.5 w-44 bg-gray-300 mx-auto" />
                    <p className="text-[10px] text-gray-400 mt-1.5">( ............................................................ )</p>
                  </div>
                </div>

                <div className="text-center space-y-12">
                  <p className="text-xs text-gray-500 font-medium">ลงชื่อผู้ทำการตรวจรับเข้าสโตร์ (ผู้รับสินค้า)</p>
                  <div>
                    <div className="h-0.5 w-44 bg-gray-300 mx-auto" />
                    <p className="text-[10px] text-gray-400 mt-1.5">( ............................................................ )</p>
                  </div>
                </div>
              </div>
            </div>
            {/* PRINT PORTION END */}

            <div className="p-4 bg-gray-50 border-t flex gap-2 justify-end">
              <button
                onClick={() => setSlipPreviewOpen(false)}
                className="px-4 py-2 border rounded-xl text-xs font-semibold hover:bg-gray-100"
              >
                ยกเลิก
              </button>
              <button
                onClick={handlePrintSlip}
                className="bg-black text-white text-xs font-bold px-5 py-2.5 rounded-xl flex items-center gap-1 hover:bg-gray-800"
              >
                <Printer className="w-4 h-4" />
                <span>ยืนยันพิมพ์และส่งมอบ</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
