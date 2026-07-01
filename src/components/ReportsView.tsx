import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query, where, getDocs, doc, writeBatch, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { InventoryTransaction, Employee, Product } from "../types";
import * as XLSX from "xlsx";
import { FileText, Download, Printer, Filter, Calendar, Users, Eye, CheckCircle, Trash2, Edit, X, Check } from "lucide-react";

interface ReportsViewProps {
  currentUser: Employee | null;
}

export default function ReportsView({ currentUser }: ReportsViewProps) {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Filter States
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterType, setFilterType] = useState<"all" | "in" | "out">("all");

  // Transfer Printing filter states
  const [printStartDate, setPrintStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [printEndDate, setPrintEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [printOperator, setPrintOperator] = useState("all");
  const [printCustomer, setPrintCustomer] = useState("all");
  const [printType, setPrintType] = useState("ส่งสโตร์ FG");
  const [printStatus, setPrintStatus] = useState<"all" | "unprinted" | "printed">("all");
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([]);

  // Editing & Deleting states for Monthly Stock Log transactions
  const [editingTx, setEditingTx] = useState<InventoryTransaction | null>(null);
  const [editingTxQty, setEditingTxQty] = useState<number>(0);
  const [editingTxLocation, setEditingTxLocation] = useState<string>("");
  const [editingTxShift, setEditingTxShift] = useState<string>("");
  const [editingTxSubType, setEditingTxSubType] = useState<string>("");
  const [deleteConfirmTxId, setDeleteConfirmTxId] = useState<string | null>(null);

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

    // 3. Fetch products
    const unsubProds = onSnapshot(collection(db, "products"), (snap) => {
      const list: Product[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Product));
      setProducts(list);
    });

    return () => {
      unsubTxs();
      unsubEmps();
      unsubProds();
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
  const printableTransactions = transactions.filter((t) => {
    // 1. Filter by Date range (start to end inclusive)
    const tDateStr = t.timestamp.toISOString().split("T")[0];
    if (tDateStr < printStartDate || tDateStr > printEndDate) return false;

    // 2. Operator filter
    if (printOperator !== "all" && t.operatorId !== printOperator) return false;

    // 3. Customer filter
    if (printCustomer !== "all" && t.customer.toLowerCase() !== printCustomer.toLowerCase()) return false;

    // 4. Transfer SubType filter
    if (printType !== "all" && t.subType !== printType) return false;

    // 5. Status filter
    if (printStatus === "unprinted" && t.printed) return false;
    if (printStatus === "printed" && !t.printed) return false;

    return true;
  });

  const selectedTransactions = printableTransactions.filter((t) => selectedTxIds.includes(t.id));

  // Edit / Delete handlers for the Monthly Stock transactions
  const handleOpenEditTx = (tx: InventoryTransaction) => {
    setEditingTx(tx);
    setEditingTxQty(tx.qty);
    setEditingTxLocation(tx.location || "");
    setEditingTxShift(tx.shift || "DAY");
    setEditingTxSubType(tx.subType || "");
  };

  const handleSaveEditTx = async () => {
    if (!editingTx) return;
    try {
      const oldQty = editingTx.qty;
      const newQty = editingTxQty;
      const diff = newQty - oldQty;

      // 1. Update transaction in Firestore
      const txRef = doc(db, "inventory_log", editingTx.id);
      await updateDoc(txRef, {
        qty: newQty,
        location: editingTxLocation,
        shift: editingTxShift,
        subType: editingTxSubType,
      });

      // 2. Adjust corresponding product stock
      const pMatch = products.find(
        (p) =>
          p.partNo.trim().toLowerCase() === editingTx.partNo.trim().toLowerCase() &&
          p.customer.trim().toLowerCase() === editingTx.customer.trim().toLowerCase()
      );

      if (pMatch) {
        const pRef = doc(db, "products", pMatch.id);
        const currentProdStock = pMatch.stock || 0;
        let finalStock = currentProdStock;
        if (editingTx.type === "in") {
          finalStock = currentProdStock + diff;
        } else if (editingTx.type === "out") {
          finalStock = currentProdStock - diff;
        }
        await updateDoc(pRef, { stock: finalStock });
      }

      setEditingTx(null);
      alert("แก้ไขรายการและปรับปรุงสต๊อกสินค้าสำเร็จ");
    } catch (err: any) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการแก้ไข: " + err.message);
    }
  };

  const handleDeleteTx = async (tx: InventoryTransaction) => {
    try {
      // 1. Delete transaction in Firestore
      await deleteDoc(doc(db, "inventory_log", tx.id));

      // 2. Adjust corresponding product stock
      const pMatch = products.find(
        (p) =>
          p.partNo.trim().toLowerCase() === tx.partNo.trim().toLowerCase() &&
          p.customer.trim().toLowerCase() === tx.customer.trim().toLowerCase()
      );

      if (pMatch) {
        const pRef = doc(db, "products", pMatch.id);
        const currentProdStock = pMatch.stock || 0;
        let finalStock = currentProdStock;
        if (tx.type === "in") {
          finalStock = currentProdStock - tx.qty;
        } else if (tx.type === "out") {
          finalStock = currentProdStock + tx.qty;
        }
        await updateDoc(pRef, { stock: finalStock });
      }

      setDeleteConfirmTxId(null);
      alert("ลบรายการและคืนยอดสต๊อกสินค้าสำเร็จ");
    } catch (err: any) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการลบ: " + err.message);
    }
  };

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

  const handleExportMonthlySummaryExcel = () => {
    if (products.length === 0) {
      alert("ไม่พบข้อมูลสินค้าในระบบ");
      return;
    }

    try {
      // Calculate start and end dates of selected month in local timezone
      const startOfMonth = new Date(filterYear, filterMonth - 1, 1);
      const endOfMonth = new Date(filterYear, filterMonth, 0, 23, 59, 59, 999);

      const aoa: any[][] = [];

      // Row 0: Days 1 to 31 headers
      const row0: any[] = ["SAP No", "Customer", "Part No", "Part Name", "Opening"];
      for (let d = 1; d <= 31; d++) {
        row0.push(d);
        row0.push(""); // spacer for merged column
      }
      row0.push("Closing");
      aoa.push(row0);

      // Row 1: IN/OUT sub-headers
      const row1: any[] = ["", "", "", "", ""];
      for (let d = 1; d <= 31; d++) {
        row1.push("IN");
        row1.push("OUT");
      }
      row1.push("");
      aoa.push(row1);

      // Process each product
      products.forEach((prod) => {
        const partNo = prod.partNo || "";
        const partName = prod.partName || "";
        const customer = prod.customer || "";
        const sapNo = prod.sapNo || "-";
        const currentStock = prod.stock || 0;

        // Transactions after the selected month
        const txsAfter = transactions.filter((t) => {
          const tKey = (t.customer || "").trim().toUpperCase() + "-" + (t.partNo || "").trim();
          const pKey = customer.trim().toUpperCase() + "-" + partNo.trim();
          return tKey === pKey && t.timestamp.getTime() > endOfMonth.getTime();
        });

        // Transactions during the selected month
        const txsDuring = transactions.filter((t) => {
          const tKey = (t.customer || "").trim().toUpperCase() + "-" + (t.partNo || "").trim();
          const pKey = customer.trim().toUpperCase() + "-" + partNo.trim();
          return tKey === pKey && 
                 t.timestamp.getTime() >= startOfMonth.getTime() && 
                 t.timestamp.getTime() <= endOfMonth.getTime();
        });

        // Calculate closing stock at the end of the selected month
        let closingStock = currentStock;
        txsAfter.forEach((t) => {
          if (t.type === "in") {
            closingStock -= t.qty;
          } else if (t.type === "out") {
            closingStock += t.qty;
          }
        });

        // Daily IN/OUT arrays
        const dailyIn = Array(32).fill(0);
        const dailyOut = Array(32).fill(0);
        let totalIn = 0;
        let totalOut = 0;

        txsDuring.forEach((t) => {
          const day = t.timestamp.getDate();
          if (day >= 1 && day <= 31) {
            if (t.type === "in") {
              dailyIn[day] += t.qty;
              totalIn += t.qty;
            } else if (t.type === "out") {
              dailyOut[day] += t.qty;
              totalOut += t.qty;
            }
          }
        });

        // Calculate opening stock at the start of the selected month
        const openingStock = closingStock - totalIn + totalOut;

        // Create product data row
        const row: any[] = [
          sapNo,
          customer,
          partNo,
          partName,
          openingStock
        ];

        for (let d = 1; d <= 31; d++) {
          row.push(dailyIn[d] > 0 ? dailyIn[d] : "");
          row.push(dailyOut[d] > 0 ? dailyOut[d] : "");
        }

        row.push(closingStock);
        aoa.push(row);
      });

      // Construct Workbook
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      const workbook = XLSX.utils.book_new();

      // Setup merges
      const merges: any[] = [];
      // Vertical merges for SAP No, Customer, Part No, Part Name, Opening, Closing
      merges.push({ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } });
      merges.push({ s: { r: 0, c: 1 }, e: { r: 1, c: 1 } });
      merges.push({ s: { r: 0, c: 2 }, e: { r: 1, c: 2 } });
      merges.push({ s: { r: 0, c: 3 }, e: { r: 1, c: 3 } });
      merges.push({ s: { r: 0, c: 4 }, e: { r: 1, c: 4 } });
      merges.push({ s: { r: 0, c: 67 }, e: { r: 1, c: 67 } });

      // Horizontal merges for day numbers 1 to 31
      for (let d = 1; d <= 31; d++) {
        const startCol = 5 + (d - 1) * 2;
        merges.push({
          s: { r: 0, c: startCol },
          e: { r: 0, c: startCol + 1 }
        });
      }

      worksheet["!merges"] = merges;

      // Column widths
      const colWidths = [
        { wch: 15 }, // SAP No
        { wch: 10 }, // Customer
        { wch: 18 }, // Part No
        { wch: 25 }, // Part Name
        { wch: 10 }, // Opening
      ];
      for (let d = 1; d <= 31; d++) {
        colWidths.push({ wch: 5 }); // IN
        colWidths.push({ wch: 5 }); // OUT
      }
      colWidths.push({ wch: 10 }); // Closing
      worksheet["!cols"] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Monthly Summary");
      XLSX.writeFile(workbook, `Monthly_Stock_Summary_${filterMonth}_${filterYear}.xlsx`);
      alert("ดาวน์โหลดตารางสรุปสต๊อกเข้าออกรายเดือนสำเร็จ!");
    } catch (err: any) {
      console.error("Export monthly summary failure:", err);
      alert("ไม่สามารถสร้างไฟล์ Excel ได้: " + err.message);
    }
  };

  // Printing Slip and Updating Printed state
  const handlePrintSlip = async () => {
    if (selectedTransactions.length === 0) {
      alert("ไม่มีข้อมูลรายการสินค้าที่จะจัดพิมพ์ในใบโอนย้ายนี้");
      return;
    }

    try {
      // 1. Trigger browser print (standard popup)
      window.print();

      // 2. Change state of matched transactions in Firestore to printed = true (พิมพ์แล้ว)
      const batch = writeBatch(db);
      for (const item of selectedTransactions) {
        const ref = doc(db, "inventory_log", item.id);
        batch.update(ref, { printed: true });
      }
      await batch.commit();

      alert("ระบบพิมพ์เอกสารสำเร็จ และปรับปรุงสถานะธุรกรรมเป็น 'พิมพ์แล้ว' เรียบร้อย");
      setSelectedTxIds([]); // Clear selection!
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

      {/* SECTION 1: พิมพ์ใบโอน */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex justify-between items-center pb-4 border-b border-gray-100">
          <div>
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-1.5">
              <Printer className="w-5 h-5 text-red-600" /> พิมพ์ใบโอน
            </h3>
            <p className="text-xs text-gray-500 mt-1">{printableTransactions.length} รายการ / เลือก {selectedTransactions.length}</p>
          </div>
          <button
            onClick={() => {
              if (selectedTransactions.length === 0) {
                alert("กรุณาเลือกรายการที่ต้องการจัดพิมพ์");
                return;
              }
              setSlipPreviewOpen(true);
            }}
            disabled={selectedTransactions.length === 0}
            className={`px-5 py-2.5 rounded-xl font-bold flex items-center gap-1.5 transition select-none ${
              selectedTransactions.length === 0
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-black text-white hover:bg-gray-800 shadow-md cursor-pointer"
            }`}
          >
            <Printer className="w-4 h-4" />
            <span>พิมพ์ที่เลือก</span>
          </button>
        </div>

        {/* Filters Grid matching screenshot */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 bg-gray-50/50 p-4 rounded-xl border border-gray-100 text-xs">
          <div>
            <label className="text-gray-500 font-semibold mb-1 block">ตั้งแต่</label>
            <input
              type="date"
              value={printStartDate}
              onChange={(e) => {
                setPrintStartDate(e.target.value);
                setSelectedTxIds([]);
              }}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-gray-500 font-semibold mb-1 block">ถึง</label>
            <input
              type="date"
              value={printEndDate}
              onChange={(e) => {
                setPrintEndDate(e.target.value);
                setSelectedTxIds([]);
              }}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-gray-500 font-semibold mb-1 block">ประเภท</label>
            <select
              value={printType}
              onChange={(e) => {
                setPrintType(e.target.value);
                setSelectedTxIds([]);
              }}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
            >
              <option value="ส่งสโตร์ FG">ส่งสโตร์ FG</option>
              <option value="เบิกงาน Rework">เบิกงาน Rework</option>
              <option value="เบิกงานจาก TN">เบิกงานจาก TN</option>
              <option value="all">แสดงประเภทโอนออกทั้งหมด</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 font-semibold mb-1 block">ลูกค้า</label>
            <select
              value={printCustomer}
              onChange={(e) => {
                setPrintCustomer(e.target.value);
                setSelectedTxIds([]);
              }}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
            >
              <option value="all">— ทั้งหมด —</option>
              {uniqueCustomers.map((cust, i) => (
                <option key={i} value={cust}>
                  {cust}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-500 font-semibold mb-1 block">ผู้โอน</label>
            <select
              value={printOperator}
              onChange={(e) => {
                setPrintOperator(e.target.value);
                setSelectedTxIds([]);
              }}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
            >
              <option value="all">— ทั้งหมด —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-500 font-semibold mb-1 block">สถานะ</label>
            <select
              value={printStatus}
              onChange={(e) => {
                setPrintStatus(e.target.value as any);
                setSelectedTxIds([]);
              }}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
            >
              <option value="all">ทั้งหมด</option>
              <option value="unprinted">ยังไม่พิมพ์</option>
              <option value="printed">พิมพ์แล้ว</option>
            </select>
          </div>
        </div>

        {/* Transfer Table */}
        <div className="overflow-x-auto border border-gray-100 rounded-2xl max-h-[400px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-700 font-bold border-b sticky top-0 z-10">
              <tr>
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    className="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
                    checked={
                      printableTransactions.length > 0 &&
                      printableTransactions.every((t) => selectedTxIds.includes(t.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTxIds(printableTransactions.map((t) => t.id));
                      } else {
                        setSelectedTxIds([]);
                      }
                    }}
                  />
                </th>
                <th className="p-3">วันที่</th>
                <th className="p-3">Shift</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Part No</th>
                <th className="p-3 text-right">Q'ty</th>
                <th className="p-3">ผู้โอน</th>
                <th className="p-3">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {printableTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-gray-400 italic bg-white">
                    ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา
                  </td>
                </tr>
              ) : (
                printableTransactions.map((t) => {
                  const isChecked = selectedTxIds.includes(t.id);
                  return (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-gray-50/50 bg-white transition">
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          className="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setSelectedTxIds(selectedTxIds.filter((id) => id !== t.id));
                            } else {
                              setSelectedTxIds([...selectedTxIds, t.id]);
                            }
                          }}
                        />
                      </td>
                      <td className="p-3 font-mono text-gray-500">
                        {t.timestamp.toLocaleDateString("th-TH")}
                        <span className="text-[10px] text-gray-400 ml-2">
                          {t.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.shift === "NIGHT" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700"
                        }`}>
                          {t.shift}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-gray-700 uppercase">{t.customer}</td>
                      <td className="p-3 font-mono font-semibold text-gray-900">{t.partNo}</td>
                      <td className="p-3 text-right font-bold text-gray-800 text-sm">{t.qty.toLocaleString()}</td>
                      <td className="p-3 text-gray-600">{t.operatorName}</td>
                      <td className="p-3">
                        {t.printed ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                            <Check className="w-3 h-3 text-emerald-600" /> พิมพ์แล้ว
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                            ยังไม่พิมพ์
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: ตารางสรุปสต๊อกเข้าออกรายเดือน */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex flex-col xl:flex-row justify-between xl:items-center gap-3 pb-3 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-1.5 shrink-0 text-lg">
              <Calendar className="w-5 h-5 text-red-600" /> ตารางสรุปสต๊อกเข้าออกรายเดือน
            </h3>
            <p className="text-xs text-gray-500 mt-1">ระบบเพิ่มการ ลบ และ แก้ไข รายการตามความเหมาะสม</p>
          </div>

          <div className="flex flex-wrap gap-2 self-stretch xl:self-auto">
            <button
              onClick={handleExportMonthlySummaryExcel}
              className="flex-1 sm:flex-initial bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-sm justify-center select-none"
            >
              <Download className="w-4 h-4 text-white" />
              <span>ส่งออก Report รายเดือน</span>
            </button>
            
            <button
              onClick={handleExportExcel}
              className="flex-1 sm:flex-initial bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 border border-slate-200 transition cursor-pointer shadow-sm justify-center select-none"
            >
              <Download className="w-4 h-4 text-red-600" />
              <span>ดาวน์โหลดประวัติรายการ</span>
            </button>
          </div>
        </div>

        {/* Month Year select filter bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-gray-50/50 p-3 rounded-xl border border-gray-100">
          <div>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(Number(e.target.value))}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none"
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
              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none"
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
              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none"
            >
              <option value="all">ดูรายการทั้งหมด</option>
              <option value="in">เฉพาะรับเข้า (In)</option>
              <option value="out">เฉพาะโอนออก (Out)</option>
            </select>
          </div>
        </div>

        {/* List transactions with Edit / Delete actions */}
        <div className="overflow-x-auto border border-gray-100 rounded-2xl max-h-[450px] overflow-y-auto text-xs">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-gray-500 font-bold border-b sticky top-0 z-10">
              <tr>
                <th className="p-3">วันเวลา</th>
                <th className="p-3">ประเภท</th>
                <th className="p-3">พาร์ทสินค้า / รายการ</th>
                <th className="p-3 text-right">จำนวน</th>
                <th className="p-3">พิกัด / กะ</th>
                <th className="p-3 text-center">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filteredTxs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-gray-400 italic bg-white">
                    ไม่พบประวัติธุรกรรมในรอบเดือนที่เลือก
                  </td>
                </tr>
              ) : (
                filteredTxs.map((t) => (
                  <tr key={t.id} className="border-b hover:bg-gray-50/50 bg-white transition">
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
                    <td className="p-3 text-center">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => handleOpenEditTx(t)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                          title="แก้ไขรายการ"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmTxId(t.id)}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
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

      {/* PRINT DIALOG SLIP OVERLAY PREVIEW */}
      {slipPreviewOpen && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col my-8">
            <div className="bg-black p-4 text-white flex justify-between items-center">
              <span className="font-bold text-xs flex items-center gap-1.5">
                <Printer className="w-4 h-4 text-red-600" /> ตรวจสอบใบโอนส่งมอบสินค้า (Transfer Slip)
              </span>
              <button
                onClick={() => setSlipPreviewOpen(false)}
                className="hover:bg-gray-800 p-1.5 rounded-full text-gray-400 cursor-pointer"
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
                  <p className="text-gray-500 mt-1">คลังจัดส่งและระบบโอนย้ายสินค้า</p>
                  <p className="text-gray-500">ใบโอนสินค้าภายใน / ใบจัดเตรียมส่งมอบ</p>
                </div>
                <div className="text-right">
                  <span className="bg-black text-white text-[10px] px-2.5 py-1 rounded font-bold uppercase tracking-wider block mb-2">
                    {printType === "all" ? "โอนออกทั้งหมด" : printType}
                  </span>
                  <p className="text-gray-500">วันที่พิมพ์: {new Date().toLocaleDateString("th-TH")}</p>
                  <p className="text-gray-500">เวลากำหนด: {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} น.</p>
                </div>
              </div>

              {/* Meta details */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-gray-50 p-4 border rounded-xl">
                <div>
                  <p className="text-gray-400">ผู้ส่งมอบสินค้า:</p>
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
                    {selectedTransactions.map((item, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2 border-r font-bold text-gray-900">{item.partNo}</td>
                        <td className="p-2 border-r text-gray-600 max-w-[150px] truncate">{item.partName}</td>
                        <td className="p-2 border-r text-center font-bold">
                          {getResolvedShiftForTime(item.timestamp)}
                        </td>
                        <td className="p-2 border-r font-medium text-gray-600">{item.location}</td>
                        <td className="p-2 text-right font-bold text-gray-900">{item.qty.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50/50 font-bold">
                      <td colSpan={4} className="p-2 border-r text-right uppercase">ยอดรวมส่งโอนย้ายทั้งสิ้น:</td>
                      <td className="p-2 text-right text-sm underline underline-offset-4">
                        {selectedTransactions.reduce((acc, t) => acc + t.qty, 0).toLocaleString()} ชิ้น
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

            <div className="p-4 bg-gray-50 border-t flex gap-2 justify-end text-xs">
              <button
                onClick={() => setSlipPreviewOpen(false)}
                className="px-4 py-2 border rounded-xl font-semibold hover:bg-gray-100 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                onClick={handlePrintSlip}
                className="bg-black text-white font-bold px-5 py-2.5 rounded-xl flex items-center gap-1 hover:bg-gray-800 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>ยืนยันพิมพ์และส่งมอบ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT TRANSACTION MODAL */}
      {editingTx && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-gray-900 text-sm">แก้ไขข้อมูลธุรกรรม</h3>
              <button onClick={() => setEditingTx(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-gray-700 block mb-1">รหัสพาร์ทสินค้า</label>
                <input
                  type="text"
                  disabled
                  value={editingTx.partNo}
                  className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg font-semibold text-gray-500 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1">จำนวนชิ้น Q'ty *</label>
                <input
                  type="number"
                  value={editingTxQty}
                  onChange={(e) => setEditingTxQty(Math.max(0, Number(e.target.value)))}
                  className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1">พิกัดจัดเก็บ Location *</label>
                <input
                  type="text"
                  value={editingTxLocation}
                  onChange={(e) => setEditingTxLocation(e.target.value)}
                  className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1">กะทำงาน (Shift) *</label>
                <select
                  value={editingTxShift}
                  onChange={(e) => setEditingTxShift(e.target.value)}
                  className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                >
                  <option value="DAY">DAY</option>
                  <option value="NIGHT">NIGHT</option>
                </select>
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1">ประเภทการโอนย้าย *</label>
                <select
                  value={editingTxSubType}
                  onChange={(e) => setEditingTxSubType(e.target.value)}
                  className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:outline-none"
                >
                  <option value="รับเข้าจากฝ่ายผลิต">รับเข้าจากฝ่ายผลิต</option>
                  <option value="ส่งสโตร์ FG">ส่งสโตร์ FG</option>
                  <option value="เบิกงาน Rework">เบิกงาน Rework</option>
                  <option value="เบิกงานจาก TN">เบิกงานจาก TN</option>
                  <option value="ปรับยอดเพิ่ม (บวกสต๊อก)">ปรับยอดเพิ่ม (บวกสต๊อก)</option>
                  <option value="ปรับยอดลด (ลบสต๊อก)">ปรับยอดลด (ลบสต๊อก)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t text-xs">
              <button
                onClick={() => setEditingTx(null)}
                className="px-4 py-2 border rounded-xl hover:bg-gray-100 font-semibold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveEditTx}
                className="px-5 py-2 bg-black text-white rounded-xl hover:bg-gray-800 font-bold cursor-pointer"
              >
                บันทึกการแก้ไข
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE TRANSACTION CONFIRMATION MODAL */}
      {deleteConfirmTxId && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border border-gray-100 p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-600 mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">ยืนยันการลบรายการธุรกรรม?</h3>
              <p className="text-xs text-gray-500">
                การลบรายการจะคืนค่าสต๊อกสินค้าพาร์ทนี้ตามประเภทธุรกรรม (รับเข้าจะลบสต๊อก / โอนออกจะคืนสต๊อกกลับ)
              </p>
            </div>
            <div className="flex justify-center gap-2 text-xs pt-2">
              <button
                onClick={() => setDeleteConfirmTxId(null)}
                className="px-4 py-2 border rounded-xl hover:bg-gray-100 font-semibold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => {
                  const tx = transactions.find((t) => t.id === deleteConfirmTxId);
                  if (tx) handleDeleteTx(tx);
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
