import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query, where, getDocs, doc, writeBatch, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { InventoryTransaction, Employee, Product, DeliveryFlow } from "../types";
import * as XLSX from "xlsx";
import { FileText, Download, Printer, Filter, Calendar, Users, Eye, CheckCircle, Trash2, Edit, X, Check } from "lucide-react";

interface ReportsViewProps {
  currentUser: Employee | null;
}

export default function ReportsView({ currentUser }: ReportsViewProps) {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [deliveryFlows, setDeliveryFlows] = useState<DeliveryFlow[]>([]);

  // Filter States
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterType, setFilterType] = useState<"all" | "in" | "out" | "adj_in" | "adj_out">("all");

  // Monthly Stock Log filter states
  const [monthlySearch, setMonthlySearch] = useState("");
  const [monthlyShift, setMonthlyShift] = useState("all");
  const [monthlyDay, setMonthlyDay] = useState("all");
  const [monthlyCustomer, setMonthlyCustomer] = useState("all");

  // Transfer Printing filter states
  const [printStartDate, setPrintStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [printEndDate, setPrintEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [printOperator, setPrintOperator] = useState("all");
  const [printCustomer, setPrintCustomer] = useState("all");
  const [printType, setPrintType] = useState("all");
  const [printStatus, setPrintStatus] = useState<"all" | "unprinted" | "printed">("all");
  const [printShift, setPrintShift] = useState<string>("all");
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

    // 4. Fetch delivery flows for dynamic printing headers
    const unsubFlows = onSnapshot(collection(db, "deliveryFlows"), (snap) => {
      const list: DeliveryFlow[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as DeliveryFlow));
      setDeliveryFlows(list);
    });

    return () => {
      unsubTxs();
      unsubEmps();
      unsubProds();
      unsubFlows();
    };
  }, []);

  // Filter Transactions for general report
  const filteredTxs = transactions.filter((t) => {
    const d = t.timestamp;
    if (d.getMonth() + 1 !== filterMonth || d.getFullYear() !== filterYear) return false;
    if (filterType !== "all" && t.type !== filterType) return false;

    // Filter by specific day (1-31)
    if (monthlyDay !== "all" && d.getDate() !== Number(monthlyDay)) return false;

    // Filter by shift
    if (monthlyShift !== "all" && t.shift !== monthlyShift) return false;

    // Filter by customer
    if (monthlyCustomer !== "all" && t.customer !== monthlyCustomer) return false;

    // Filter by search query (sapNo, Part No, Customer, operatorName)
    if (monthlySearch.trim() !== "") {
      const q = monthlySearch.toLowerCase().trim();
      const prod = products.find(p => p.partNo === t.partNo && p.customer === t.customer) || products.find(p => p.partNo === t.partNo);
      const sapNo = prod ? (prod.sapNo || "").toLowerCase() : "";
      const partNo = (t.partNo || "").toLowerCase();
      const customer = (t.customer || "").toLowerCase();
      const operator = (t.operatorName || "").toLowerCase();

      if (!sapNo.includes(q) && !partNo.includes(q) && !customer.includes(q) && !operator.includes(q)) {
        return false;
      }
    }

    return true;
  });

  // Get unique customers for filtering
  const monthlyCustomers = Array.from(
    new Set([
      ...products.map((p) => p.customer).filter(Boolean),
      ...transactions.map((t) => t.customer).filter(Boolean)
    ])
  ).sort();

  // Get all unique subTypes from transactions dynamically for filtering
  const allUniqueInSubTypes = Array.from(
    new Set(
      transactions
        .filter((t) => t.type === "in" || t.type === "adj_in")
        .map((t) => t.subType)
        .filter((s) => s && s.trim() !== "")
    )
  );

  const allUniqueOutSubTypes = Array.from(
    new Set(
      transactions
        .filter((t) => t.type === "out" || t.type === "adj_out")
        .map((t) => t.subType)
        .filter((s) => s && s.trim() !== "")
    )
  );

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
    if (printType === "all_in") {
      if (t.type !== "in" && t.type !== "adj_in") return false;
    } else if (printType === "all_out") {
      if (t.type !== "out" && t.type !== "adj_out") return false;
    } else if (printType !== "all" && t.subType !== printType) {
      return false;
    }

    // 5. Status filter
    if (printStatus === "unprinted" && t.printed) return false;
    if (printStatus === "printed" && !t.printed) return false;

    // 6. Shift filter
    if (printShift !== "all" && t.shift !== printShift) return false;

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

      // Find the corresponding product first to run safety checks
      const pMatch = products.find(
        (p) =>
          p.partNo.trim().toLowerCase() === editingTx.partNo.trim().toLowerCase() &&
          p.customer.trim().toLowerCase() === editingTx.customer.trim().toLowerCase()
      );

      if (pMatch) {
        const currentProdStock = pMatch.stock || 0;
        let finalStock = currentProdStock;
        if (editingTx.type === "in" || editingTx.type === "adj_in") {
          finalStock = currentProdStock + diff;
        } else if (editingTx.type === "out" || editingTx.type === "adj_out") {
          finalStock = currentProdStock - diff;
        }

        if (finalStock < 0) {
          alert(`⚠️ ไม่สามารถทำการแก้ไขรายการได้!\nเนื่องจากการแก้ไขจำนวนนี้จะส่งผลให้สต๊อกคงเหลือของสินค้าติดลบ (สต๊อกปัจจุบัน: ${currentProdStock} ชิ้น, ยอดคงเหลือหลังแก้ไข: ${finalStock} ชิ้น)`);
          return;
        }

        // 1. Update transaction in Firestore
        const txRef = doc(db, "inventory_log", editingTx.id);
        await updateDoc(txRef, {
          qty: newQty,
          location: editingTxLocation,
          shift: editingTxShift,
          subType: editingTxSubType,
        });

        // 2. Update product stock
        const pRef = doc(db, "products", pMatch.id);
        await updateDoc(pRef, { stock: finalStock });
      } else {
        // If product doesn't exist, just update the transaction log
        const txRef = doc(db, "inventory_log", editingTx.id);
        await updateDoc(txRef, {
          qty: newQty,
          location: editingTxLocation,
          shift: editingTxShift,
          subType: editingTxSubType,
        });
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
      // Find the corresponding product first to run safety checks
      const pMatch = products.find(
        (p) =>
          p.partNo.trim().toLowerCase() === tx.partNo.trim().toLowerCase() &&
          p.customer.trim().toLowerCase() === tx.customer.trim().toLowerCase()
      );

      if (pMatch) {
        const currentProdStock = pMatch.stock || 0;
        let finalStock = currentProdStock;
        if (tx.type === "in" || tx.type === "adj_in") {
          finalStock = currentProdStock - tx.qty;
        } else if (tx.type === "out" || tx.type === "adj_out") {
          finalStock = currentProdStock + tx.qty;
        }

        if (finalStock < 0) {
          alert(`⚠️ ไม่สามารถลบรายการได้!\nเนื่องจากรายการนี้เป็นยอดรับเข้าสินค้า หากทำการลบจะหักสต๊อกออก และส่งผลให้สต๊อกคงเหลือติดลบได้ (สต๊อกปัจจุบัน: ${currentProdStock} ชิ้น, จำนวนที่จะหักออก: ${tx.qty} ชิ้น)`);
          setDeleteConfirmTxId(null);
          return;
        }

        // 1. Delete transaction in Firestore
        await deleteDoc(doc(db, "inventory_log", tx.id));

        // 2. Adjust product stock
        const pRef = doc(db, "products", pMatch.id);
        await updateDoc(pRef, { stock: finalStock });
      } else {
        // Just delete transaction if product is already gone
        await deleteDoc(doc(db, "inventory_log", tx.id));
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
        "ประเภท": t.type === "in" ? "รับเข้า" : t.type === "adj_in" ? "ปรับสต๊อกเข้า" : t.type === "adj_out" ? "ปรับสต๊อกออก" : "โอนออก",
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
          if (t.type === "in" || t.type === "adj_in") {
            closingStock -= t.qty;
          } else if (t.type === "out" || t.type === "adj_out") {
            closingStock += t.qty;
          }
        });

        // Daily IN/OUT arrays
        const dailyIn = Array(32).fill(0);
        const dailyOut = Array(32).fill(0);
        let totalIn = 0;
        let totalOut = 0;
        let totalAdjIn = 0;
        let totalAdjOut = 0;

        txsDuring.forEach((t) => {
          const day = t.timestamp.getDate();
          if (day >= 1 && day <= 31) {
            if (t.type === "in" || t.type === "adj_in") {
              dailyIn[day] += t.qty;
              if (t.type === "in") {
                totalIn += t.qty;
              } else {
                totalAdjIn += t.qty;
              }
            } else if (t.type === "out" || t.type === "adj_out") {
              dailyOut[day] += t.qty;
              if (t.type === "out") {
                totalOut += t.qty;
              } else {
                totalAdjOut += t.qty;
              }
            }
          }
        });

        // Calculate opening stock at the start of the selected month
        const openingStock = closingStock - (totalIn + totalAdjIn) + (totalOut + totalAdjOut);

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

  // Helpers for printing
  const getSlipDate = () => {
    if (selectedTransactions.length === 0) return new Date();
    const tx = selectedTransactions[0];
    if (tx.timestamp) {
      return tx.timestamp.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp);
    }
    return new Date();
  };

  const formatThaiDate = (date: Date) => {
    const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const day = String(date.getDate()).padStart(2, "0");
    const month = months[date.getMonth()];
    const year = date.getFullYear() + 543;
    return `${day}-${month}-${year}`;
  };

  const getShiftBgColor = (shift: string) => {
    if (shift === "DAY") return "#fef08a"; // Light yellow
    if (shift === "NIGHT") return "#1e1b4b"; // Deep dark indigo/blue
    return "#000000"; // Black
  };

  const getShiftTextColor = (shift: string) => {
    if (shift === "DAY") return "#000000";
    return "#ffffff";
  };

  const getSlipShift = () => {
    if (printShift && printShift !== "all") {
      return printShift;
    }
    if (selectedTransactions.length === 0) return "ทั้งหมด";
    const firstShift = selectedTransactions[0].shift || "DAY";
    const allSame = selectedTransactions.every((t) => t.shift === firstShift);
    return allSame ? firstShift : "ทั้งหมด";
  };

  const formatThaiDateTime = (dateObj: any) => {
    if (!dateObj) return "-";
    const date = dateObj.toDate ? dateObj.toDate() : new Date(dateObj);
    const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const day = String(date.getDate()).padStart(2, "0");
    const month = months[date.getMonth()];
    const year = date.getFullYear() + 543;
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}-${month}-${year} ${hours}:${minutes}`;
  };

  const getPackingInfo = (item: any) => {
    const product = products.find(p => p.partNo === item.partNo && p.customer === item.customer);
    if (!product) return "-";
    const boxSize = product.boxSize || "BOX";
    if (product.fullBox && product.fullBox > 0) {
      const boxCount = Math.ceil(item.qty / product.fullBox);
      return `${boxCount} - ${boxSize}`;
    }
    return `1 - ${boxSize}`;
  };

  const getDynamicPrintedTitle = () => {
    if (selectedTransactions.length === 0) {
      return "รายการ บันทึกการส่งงาน สโตร์กลาง - สโตร์ FG.";
    }

    const tx = selectedTransactions[0];
    
    // Check if adjustment
    const isAdjustment = tx.type?.includes("adj") || tx.subType?.includes("ตรวจนับ") || tx.subType?.includes("ปรับยอด");
    if (isAdjustment) {
      return "รายการ บันทึก ตรวจนับและปรับยอดสต๊อก";
    }

    // Find operator/employee department
    const employee = employees.find(e => e.id === tx.operatorId);
    const empDept = employee?.department || "สโตร์กลาง";

    // Find custom flow
    const flow = deliveryFlows.find(f => f.name === tx.subType);
    if (flow) {
      let fromDept = flow.from;
      let toDept = flow.to;
      if (fromDept === "สโตร์กลาง") {
        fromDept = empDept;
      }
      if (toDept === "สโตร์กลาง") {
        toDept = empDept;
      }
      return `รายการ บันทึกการส่งงาน ${fromDept} - ${toDept}`;
    }

    // Legacy fallback mappings
    let fromDept = "สโตร์กลาง";
    let toDept = "สโตร์ FG";

    if (tx.subType?.includes("รับเข้า") || tx.subType?.includes("รับคืน")) {
      fromDept = "ไลน์ผลิต";
      toDept = empDept;
    } else if (tx.subType?.includes("rework") || tx.subType?.includes("Rework")) {
      fromDept = empDept;
      toDept = "ไลน์ผลิต";
    } else if (tx.subType?.includes("FG") || tx.subType?.includes("ส่งมอบ")) {
      fromDept = empDept;
      toDept = "สโตร์ FG";
    } else {
      fromDept = empDept;
    }

    return `รายการ บันทึกการส่งงาน ${fromDept} - ${toDept}`;
  };

  // Printing Slip and Updating Printed state
  const handlePrintSlip = async () => {
    if (selectedTransactions.length === 0) {
      alert("ไม่มีข้อมูลรายการสินค้าที่จะจัดพิมพ์ในใบโอนย้ายนี้");
      return;
    }

    try {
      // Create bulletproof clean window for printing to bypass iframe constraints & support old Win 7 perfectly
      const printContent = document.getElementById("print-area")?.innerHTML;
      if (printContent) {
        const printWindow = window.open("", "_blank", "width=850,height=700");
        if (printWindow) {
          printWindow.document.write(`
            <html>
              <head>
                <title>WSM-DUNAN - ใบจัดเตรียมรับเข้า-ส่งมอบ</title>
                <style>
                  @import url('https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap');
                  @media print {
                    @page {
                      size: A4 portrait;
                      margin: 10mm 15mm 15mm 15mm;
                    }
                    body {
                      margin: 0;
                      padding: 0;
                      background-color: white !important;
                      -webkit-print-color-adjust: exact;
                      print-color-adjust: exact;
                    }
                    .print-page {
                      width: 100% !important;
                      min-height: 250mm !important;
                      box-shadow: none !important;
                      border: none !important;
                      border-radius: 0 !important;
                      margin-bottom: 0 !important;
                      padding: 0 !important;
                      page-break-after: always !important;
                      display: flex !important;
                      flex-direction: column !important;
                    }
                    .print-page:last-child {
                      page-break-after: avoid !important;
                    }
                  }
                  body {
                    font-family: "Tahoma", "Kanit", "Microsoft Sans Serif", "MS Sans Serif", sans-serif;
                    background-color: white;
                    color: black;
                    margin: 0;
                    padding: 0;
                  }
                  .print-page {
                    width: 100%;
                    max-width: 180mm;
                    margin: 0 auto;
                    min-height: 250mm;
                    position: relative;
                    box-sizing: border-box;
                    display: flex;
                    flex-direction: column;
                    padding: 10px;
                  }
                  .print-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                  }
                  .print-table th, .print-table td {
                    border: 2px solid black !important;
                    padding: 8px 6px;
                    font-size: 11px;
                    color: black;
                    vertical-align: middle;
                  }
                  .print-table th {
                    background-color: #cbd5e1 !important;
                    font-weight: bold;
                    text-align: center;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                  }
                  .print-table td {
                    background-color: white !important;
                    text-align: left;
                  }
                  .title-header {
                    font-size: 16px !important;
                    padding: 10px !important;
                    font-weight: bold;
                    text-align: center;
                  }
                  .meta-header {
                    font-size: 13px !important;
                    font-weight: bold;
                    text-align: center;
                  }
                  .meta-value {
                    font-size: 13px !important;
                    font-weight: bold;
                    text-align: center;
                  }
                  .highlight-shift {
                    background-color: #fef08a !important;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                  }
                  .signatures-container {
                    margin-top: auto;
                    padding-top: 30px;
                    display: flex;
                    justify-content: space-between;
                    width: 100%;
                  }
                  .signature-box {
                    width: 45%;
                    text-align: center;
                    font-size: 11px;
                  }
                  .signature-line {
                    height: 1px;
                    background-color: black;
                    width: 180px;
                    margin: 35px auto 5px auto;
                  }
                  .page-footer {
                    text-align: right;
                    font-size: 11px;
                    color: black;
                    margin-top: 15px;
                    border-top: 1px dashed #ccc;
                    padding-top: 5px;
                    width: 100%;
                  }
                </style>
              </head>
              <body>
                <div>${printContent}</div>
                <script>
                  window.onload = function() {
                    setTimeout(function() {
                      window.focus();
                      window.print();
                      setTimeout(function() { window.close(); }, 1000);
                    }, 500);
                  };
                </script>
              </body>
            </html>
          `);
          printWindow.document.close();
        } else {
          // Fallback if pop-up was blocked
          window.print();
        }
      } else {
        window.print();
      }

      // 2. Change state of matched transactions in Firestore to printed = true (พิมพ์แล้ว)
      const batch = writeBatch(db);
      for (const item of selectedTransactions) {
        const ref = doc(db, "inventory_log", item.id);
        batch.update(ref, { printed: true });
      }
      await batch.commit();

      alert("ระบบส่งคำสั่งพิมพ์ไปยังเบราว์เซอร์แล้ว และปรับปรุงสถานะธุรกรรมเป็น 'พิมพ์แล้ว' เรียบร้อย");
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 bg-gray-50/50 p-4 rounded-xl border border-gray-100 text-xs">
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
              <option value="all">แสดงทั้งหมด (ทั้งรับเข้า & โอนออก)</option>
              <option value="all_in">เฉพาะรับเข้าทั้งหมด (All In)</option>
              <option value="all_out">เฉพาะโอนออกทั้งหมด (All Out)</option>
              
              {allUniqueInSubTypes.length > 0 && (
                <optgroup label="ประเภทการรับเข้า (Stock In)">
                  {allUniqueInSubTypes.map((sub, i) => (
                    <option key={`in-${i}`} value={sub}>{sub}</option>
                  ))}
                </optgroup>
              )}
              
              {allUniqueOutSubTypes.length > 0 && (
                <optgroup label="ประเภทการโอนออก (Stock Out)">
                  {allUniqueOutSubTypes.map((sub, i) => (
                    <option key={`out-${i}`} value={sub}>{sub}</option>
                  ))}
                </optgroup>
              )}
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
          <div>
            <label className="text-gray-500 font-semibold mb-1 block">กะทำงาน (Shift)</label>
            <select
              value={printShift}
              onChange={(e) => {
                setPrintShift(e.target.value);
                setSelectedTxIds([]);
              }}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
            >
              <option value="all">ทั้งหมด (All)</option>
              <option value="DAY">DAY (กะวัน)</option>
              <option value="NIGHT">NIGHT (กะคืน)</option>
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
                      <td className="p-3 font-bold text-gray-700 uppercase">
                        <div>{t.customer}</div>
                        {t.subCustomer && (
                          <div className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-0.5 inline-block mt-0.5 normal-case font-bold">
                            {t.subCustomer}
                          </div>
                        )}
                      </td>
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

        {/* Month Year select filter bar with advanced search and additional filters */}
        <div className="space-y-3 bg-gray-50/50 p-4 rounded-xl border border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">ประจำเดือน</label>
              <select
                value={filterMonth}
                onChange={(e) => {
                  setFilterMonth(Number(e.target.value));
                  setMonthlyDay("all"); // Reset day filter on month change
                }}
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
              >
                {thaiMonths.map((m, idx) => (
                  <option key={idx} value={idx + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">ประจำปี</label>
              <select
                value={filterYear}
                onChange={(e) => {
                  setFilterYear(Number(e.target.value));
                  setMonthlyDay("all"); // Reset day filter on year change
                }}
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    พ.ศ. {y + 543}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">ประเภทธุรกรรม</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
              >
                <option value="all">ดูรายการทั้งหมด</option>
                <option value="in">เฉพาะรับเข้า (In)</option>
                <option value="out">เฉพาะโอนออก (Out)</option>
                <option value="adj_in">เฉพาะปรับสต๊อกเข้า (Adjust In)</option>
                <option value="adj_out">เฉพาะปรับสต๊อกออก (Adjust Out)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-gray-100">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">ค้นหาข้อมูล (SAP No, Part No, ลูกค้า, ผู้โอน)</label>
              <input
                type="text"
                value={monthlySearch}
                onChange={(e) => setMonthlySearch(e.target.value)}
                placeholder="พิมพ์เพื่อค้นหา..."
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold placeholder:text-gray-300 focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">ระบุกะ (Shift)</label>
              <select
                value={monthlyShift}
                onChange={(e) => setMonthlyShift(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
              >
                <option value="all">ทั้งหมด (All Shifts)</option>
                <option value="DAY">DAY (กะกลางวัน)</option>
                <option value="NIGHT">NIGHT (กะกลางคืน)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">ระบุวันที่ (Day of Month)</label>
              <select
                value={monthlyDay}
                onChange={(e) => setMonthlyDay(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
              >
                <option value="all">ทั้งหมด (All Days)</option>
                {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((day) => (
                  <option key={day} value={day}>
                    วันที่ {day}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">ระบุลูกค้า (Customer)</label>
              <select
                value={monthlyCustomer}
                onChange={(e) => setMonthlyCustomer(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 focus:outline-none"
              >
                <option value="all">ทั้งหมด (All Customers)</option>
                {monthlyCustomers.map((cust) => (
                  <option key={cust} value={cust}>
                    {cust}
                  </option>
                ))}
              </select>
            </div>
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
                          : t.type === "adj_in"
                          ? "bg-yellow-100 text-yellow-800 border border-yellow-200/60" 
                          : t.type === "adj_out"
                          ? "bg-orange-100 text-orange-800 border border-orange-200/60"
                          : "bg-red-50 text-red-600"
                      }`}>
                        {t.type === "in" ? "รับเข้า" : t.type === "adj_in" ? "ปรับสต๊อกเข้า" : t.type === "adj_out" ? "ปรับสต๊อกออก" : "โอนออก"}
                      </span>
                      <div className="text-[9px] text-gray-400 mt-1">{t.subType}</div>
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-gray-800">{t.partNo}</span>
                      <div className="text-[10px] text-gray-400 truncate max-w-[150px]">{t.partName}</div>
                      <div className="text-[9px] text-gray-400">ผู้ทำ: {t.operatorName}</div>
                    </td>
                    <td className="p-3 text-right">
                      <span className={`font-bold ${
                        t.type === "in"
                          ? "text-green-600"
                          : t.type === "adj_in"
                          ? "text-yellow-600 font-extrabold"
                          : t.type === "adj_out"
                          ? "text-orange-600 font-extrabold"
                          : "text-red-500"
                      }`}>
                        {(t.type === "in" || t.type === "adj_in") ? "+" : "-"}
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
      {slipPreviewOpen && (() => {
        const itemsPerPage = 12;
        const totalQty = selectedTransactions.reduce((acc, t) => acc + t.qty, 0);
        const chunkedPages: any[][] = [];
        for (let i = 0; i < selectedTransactions.length; i += itemsPerPage) {
          chunkedPages.push(selectedTransactions.slice(i, i + itemsPerPage));
        }
        if (chunkedPages.length === 0) {
          chunkedPages.push([]);
        }

        return (
          <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-slate-100 w-full max-w-[850px] rounded-2xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col my-8 h-[90vh]">
              <div className="bg-black p-4 text-white flex justify-between items-center shrink-0">
                <span className="font-bold text-xs flex items-center gap-1.5">
                  <Printer className="w-4 h-4 text-red-600" /> ตรวจสอบใบโอนส่งมอบสินค้า (A4 Portrait Print Preview)
                </span>
                <button
                  onClick={() => setSlipPreviewOpen(false)}
                  className="hover:bg-gray-800 p-1.5 rounded-full text-gray-400 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable pages container */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col items-center bg-slate-200" id="print-area">
                {chunkedPages.map((pageItems, pageIdx) => {
                  const isLastPage = pageIdx === chunkedPages.length - 1;
                  const pageQty = pageItems.reduce((acc, item) => acc + item.qty, 0);
                  const currentShift = getSlipShift();
                  return (
                    <div
                      key={pageIdx}
                      className="print-page bg-white text-black p-8 shadow-lg border border-gray-200 rounded flex flex-col justify-between relative"
                      style={{
                        width: "100%",
                        maxWidth: "700px",
                        minHeight: "950px",
                        boxSizing: "border-box",
                        backgroundColor: "white",
                        color: "black",
                      }}
                    >
                      <div>
                        {/* WSM-DUNAN Branding Top Header Section */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "15px", borderBottom: "2px solid black", paddingBottom: "10px" }}>
                          <div>
                            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "bold", color: "black", letterSpacing: "0.5px" }}>
                              WSM-DUNAN CO., LTD.
                            </h2>
                            <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#334155", fontWeight: "bold" }}>
                              คลังจัดส่งและระบบโอนย้ายสินค้า
                            </p>
                            <p style={{ margin: "2px 0 0 0", fontSize: "10px", color: "#64748b", fontWeight: "bold" }}>
                              ใบโอนสินค้าภายใน / ใบจัดเตรียมรับเข้า-ส่งมอบ
                            </p>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{
                              display: "inline-block",
                              padding: "3px 12px",
                              borderRadius: "9999px",
                              fontSize: "11px",
                              fontWeight: "bold",
                              backgroundColor: getShiftBgColor(currentShift),
                              color: getShiftTextColor(currentShift),
                              border: "1px solid rgba(0,0,0,0.15)",
                              marginBottom: "4px"
                            }}>
                              {currentShift === "DAY" ? "DAY" : currentShift === "NIGHT" ? "NIGHT" : "ทั้งหมด"}
                            </span>
                            <p style={{ margin: 0, fontSize: "10px", color: "black", fontWeight: "bold" }}>
                              วันที่พิมพ์: {new Date().getDate()}/{new Date().getMonth() + 1}/{new Date().getFullYear() + 543}
                            </p>
                            <p style={{ margin: "2px 0 0 0", fontSize: "10px", color: "black", fontWeight: "bold" }}>
                              เวลากำหนด: {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })} น.
                            </p>
                          </div>
                        </div>

                        {/* Table of items */}
                        <table className="print-table w-full" style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th colSpan={7} className="title-header" style={{ backgroundColor: "#cbd5e1", color: "black", border: "2px solid black", padding: "10px", textAlign: "center", fontSize: "15px", fontWeight: "bold" }}>
                                {getDynamicPrintedTitle()}
                              </th>
                            </tr>
                            <tr>
                              <th style={{ backgroundColor: "#cbd5e1", color: "black", border: "2px solid black", padding: "6px", fontSize: "11px", fontWeight: "bold", textAlign: "center", width: "10%" }}>ลำดับ</th>
                              <th style={{ backgroundColor: "#cbd5e1", color: "black", border: "2px solid black", padding: "6px", fontSize: "11px", fontWeight: "bold", textAlign: "center", width: "12%" }}>Customer</th>
                              <th style={{ backgroundColor: "#cbd5e1", color: "black", border: "2px solid black", padding: "6px", fontSize: "11px", fontWeight: "bold", textAlign: "center", width: "22%" }}>Part No.</th>
                              <th style={{ backgroundColor: "#cbd5e1", color: "black", border: "2px solid black", padding: "6px", fontSize: "11px", fontWeight: "bold", textAlign: "center", width: "10%" }}>Q'ty</th>
                              <th style={{ backgroundColor: "#cbd5e1", color: "black", border: "2px solid black", padding: "6px", fontSize: "11px", fontWeight: "bold", textAlign: "center", width: "16%" }}>ผู้โอน</th>
                              <th style={{ backgroundColor: "#cbd5e1", color: "black", border: "2px solid black", padding: "6px", fontSize: "11px", fontWeight: "bold", textAlign: "center", width: "15%" }}>จำนวน บรรจุ</th>
                              <th style={{ backgroundColor: "#cbd5e1", color: "black", border: "2px solid black", padding: "6px", fontSize: "11px", fontWeight: "bold", textAlign: "center", width: "15%" }}>Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageItems.map((item, i) => {
                              const overallIndex = pageIdx * itemsPerPage + i + 1;
                              const formattedIndex = "CS-" + String(overallIndex).padStart(4, "0");
                              return (
                                <tr key={item.id || i}>
                                  <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "center", fontWeight: "bold", color: "black" }}>{formattedIndex}</td>
                                  <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "left", color: "black" }}>{item.customer}</td>
                                  <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "left", fontWeight: "bold", color: "black" }}>{item.partNo}</td>
                                  <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "right", fontWeight: "bold", color: "black" }}>{item.qty.toLocaleString()}</td>
                                  <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "left", color: "black" }}>{item.operatorName}</td>
                                  <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "left", fontWeight: "bold", color: "black" }}>{getPackingInfo(item)}</td>
                                  <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "center", color: "black" }}>{formatThaiDateTime(item.timestamp)}</td>
                                </tr>
                              );
                            })}

                            {/* Page total quantity summary */}
                            <tr style={{ backgroundColor: "#f8fafc" }}>
                              <td colSpan={3} style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "right", fontWeight: "bold", color: "black" }}>
                                สรุปประจำหน้า {pageIdx + 1} (Page Qty Total):
                              </td>
                              <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "right", fontWeight: "extrabold", color: "black" }}>
                                {pageQty.toLocaleString()}
                              </td>
                              <td colSpan={3} style={{ border: "2px solid black", padding: "6px", fontSize: "11px", color: "black", fontWeight: "bold" }}>
                                ชิ้น (Pcs)
                              </td>
                            </tr>

                            {/* Grand total quantity summary on the last page */}
                            {isLastPage && (
                              <tr style={{ backgroundColor: "#fef08a" }}>
                                <td colSpan={3} style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "right", fontWeight: "extrabold", color: "black" }}>
                                  สรุปรวมทั้งสิ้น (Grand Total Qty):
                                </td>
                                <td style={{ border: "2px solid black", padding: "6px", fontSize: "11px", textAlign: "right", fontWeight: "extrabold", color: "#b91c1c" }}>
                                  {totalQty.toLocaleString()}
                                </td>
                                <td colSpan={3} style={{ border: "2px solid black", padding: "6px", fontSize: "11px", color: "black", fontWeight: "bold" }}>
                                  ชิ้น (Pcs)
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Push signatures & page footer to bottom */}
                      <div className="w-full mt-auto flex flex-col">
                        {isLastPage && (
                          <div className="signatures-container w-full" style={{ display: "flex", justifyContent: "space-between", paddingTop: "30px", width: "100%" }}>
                            <div className="signature-box" style={{ width: "45%", textAlign: "center", fontSize: "11px" }}>
                              <p style={{ margin: 0, fontWeight: "bold", color: "black" }}>ลงชื่อผู้ทำการจัดโอนสินค้า (ผู้ส่งมอบ)</p>
                              <div className="signature-line" style={{ height: "1px", backgroundColor: "black", width: "180px", margin: "35px auto 5px auto" }}></div>
                              <p style={{ margin: 0, color: "#444" }}>( ............................................................ )</p>
                            </div>
                            <div className="signature-box" style={{ width: "45%", textAlign: "center", fontSize: "11px" }}>
                              <p style={{ margin: 0, fontWeight: "bold", color: "black" }}>ลงชื่อผู้ทำการตรวจรับเข้าสโตร์ (ผู้รับสินค้า)</p>
                              <div className="signature-line" style={{ height: "1px", backgroundColor: "black", width: "180px", margin: "35px auto 5px auto" }}></div>
                              <p style={{ margin: 0, color: "#444" }}>( ............................................................ )</p>
                            </div>
                          </div>
                        )}

                        <div className="page-footer" style={{ textAlign: "right", fontSize: "11px", color: "black", marginTop: "15px", borderTop: "1px dashed #ccc", paddingTop: "5px", width: "100%" }}>
                          หน้าที่ {pageIdx + 1} จาก {chunkedPages.length}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 bg-gray-50 border-t flex gap-2 justify-end text-xs shrink-0">
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
        );
      })()}

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
