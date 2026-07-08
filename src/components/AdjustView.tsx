import React, { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, setDoc, updateDoc, writeBatch, addDoc, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { Product, Employee, AdjustRequest } from "../types";
import { fuzzySearch } from "../utils/fuzzy";
import { getSafeProductId } from "../utils/productUtils";
import * as XLSX from "xlsx";
import { Search, AlertCircle, Clock, Check, X, ShieldAlert, Edit, Upload, Clipboard, FileSpreadsheet, Sparkles, Plus, Download, Brain, Bot, Loader2, Info, TrendingDown, TrendingUp, AlertTriangle } from "lucide-react";
import { DEFAULT_BOI_CUSTOMERS, BOICustomer } from "../utils/boxSizeUtils";

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

  // BOI Customer States
  const [boiCustomers, setBoiCustomers] = useState<BOICustomer[]>([]);
  const [selectedBoiSubCustomer, setSelectedBoiSubCustomer] = useState("");
  const [isAddingBoi, setIsAddingBoi] = useState(false);
  const [newBoiName, setNewBoiName] = useState("");
  const [newBoiGroup, setNewBoiGroup] = useState<"CTC" | "อื่นๆ">("CTC");

  // Request list filters
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [filterMonth, setFilterMonth] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });
  const [filterDate, setFilterDate] = useState<string>("");
  const [filterCustomer, setFilterCustomer] = useState<string>("all");

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

  // AI Stock Discrepancy Predictor States
  const [aiPredictLoading, setAiPredictLoading] = useState(false);
  const [aiPredictError, setAiPredictError] = useState<string | null>(null);
  const [aiPredictResult, setAiPredictResult] = useState<string | null>(null);

  // Markdown rendering helper for discrepancy analysis
  const renderPredictMarkdown = (text: string) => {
    if (!text) return null;
    return text.split("\n").map((line, idx) => {
      const cleanLine = line.trim();
      
      // Horizontal Rules
      if (cleanLine === "---" || cleanLine === "***") {
        return <hr key={idx} className="border-slate-800 my-3" />;
      }
      
      // Headers
      if (cleanLine.startsWith("### ")) {
        return <h4 key={idx} className="text-xs font-bold text-slate-100 mt-3.5 mb-1.5 flex items-center gap-1 text-red-300">{cleanLine.substring(4)}</h4>;
      }
      if (cleanLine.startsWith("## ")) {
        return <h3 key={idx} className="text-sm font-extrabold text-red-400 mt-4 mb-2 border-b border-slate-800/60 pb-1.5 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-red-400 shrink-0" /> {cleanLine.substring(3)}</h3>;
      }
      if (cleanLine.startsWith("# ")) {
        return <h2 key={idx} className="text-base font-black text-red-500 mt-5 mb-3">{cleanLine.substring(2)}</h2>;
      }

      // Check list items
      if (cleanLine.startsWith("- ") || cleanLine.startsWith("* ")) {
        const content = cleanLine.substring(2);
        const parts = content.split("**");
        return (
          <li key={idx} className="list-disc ml-4 mb-1.5 text-slate-300 leading-relaxed text-[11px]">
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
          <div key={idx} className="flex gap-2.5 mb-2.5 text-[11px] text-slate-300 items-start leading-relaxed">
            <span className="font-bold text-red-400 font-mono shrink-0 bg-red-950/50 w-4.5 h-4.5 rounded-full flex items-center justify-center border border-red-900/35 text-[9px] mt-0.5">{num}</span>
            <div className="flex-1">
              {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-red-300 font-extrabold">{part}</strong> : part)}
            </div>
          </div>
        );
      }

      if (cleanLine === "") return <div key={idx} className="h-1.5" />;

      // Normal paragraph with bold replacements
      const parts = line.split("**");
      return (
        <p key={idx} className="text-slate-300 leading-relaxed text-[11px] mb-1.5">
          {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-red-300 font-extrabold">{part}</strong> : part)}
        </p>
      );
    });
  };

  const handlePredictDiscrepancy = async () => {
    if (!selectedProduct) return;
    setAiPredictLoading(true);
    setAiPredictError(null);
    setAiPredictResult(null);

    try {
      // 1. Fetch recent transactions for this partNo from Firestore
      const logRef = collection(db, "inventory_log");
      const q = query(logRef, where("partNo", "==", selectedProduct.partNo));
      const querySnapshot = await getDocs(q);
      
      const recentTxs: any[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        recentTxs.push({
          id: docSnap.id,
          type: data.type,
          subType: data.subType || "",
          qty: data.qty || 0,
          operatorName: data.operatorName || "",
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
          location: data.location || "",
          shift: data.shift || ""
        });
      });

      // Sort in memory (newest first)
      recentTxs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      // Slice top 15
      const slicedTxs = recentTxs.slice(0, 15);

      // 2. Call backend endpoint
      const response = await fetch("/api/ai/predict-discrepancy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          partNo: selectedProduct.partNo,
          partName: selectedProduct.partName,
          customer: selectedProduct.customer,
          systemStock: selectedProduct.stock || 0,
          countedQty: actualStock,
          fullBox: selectedProduct.fullBox || 0,
          recentTransactions: slicedTxs
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "เกิดข้อผิดพลาดในการวิเคราะห์ด้วย AI");
      }

      const data = await response.json();
      setAiPredictResult(data.analysis);
    } catch (err: any) {
      console.error(err);
      setAiPredictError(err.message || "ไม่สามารถเชื่อมต่อระบบ AI ได้สำเร็จ");
    } finally {
      setAiPredictLoading(false);
    }
  };

  const downloadExcelTemplate = () => {
    // Generate sample data using XLSX
    const templateData = [
      {
        "ลูกค้า (Customer)": "DUNAN",
        "พาร์ท/รหัสสินค้า (Part No)": "AJR76122306",
        "จำนวนที่นับได้/ยอดนับจริง (Actual Stock)": 150
      },
      {
        "ลูกค้า (Customer)": "DAIKIN",
        "พาร์ท/รหัสสินค้า (Part No)": "DK-992384",
        "จำนวนที่นับได้/ยอดนับจริง (Actual Stock)": 75
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "EOM Adjust Template");

    // Adjust column widths for readability
    worksheet["!cols"] = [
      { wch: 20 }, // Customer
      { wch: 25 }, // Part No
      { wch: 35 }  // Actual Stock
    ];

    XLSX.writeFile(workbook, "EOM_Stock_Adjust_Template.xlsx");
  };

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
            const diff = countVal - (match.stock || 0);
            if (diff === 0) {
              // หากยอดไม่มีการแก้ไข ไม่ต้องบันทึก/รับเข้า
              continue;
            }

            const prodRef = doc(db, "products", prodId);
            batch.update(prodRef, {
              stock: countVal,
              openingStock: countVal,
              receivedTotal: 0,
              shippedTotal: 0
            });

            // Log to adjust_requests as an auto-approved EOM adjustment
            const reqId = `REQ-EOM-${Date.now().toString().slice(-4)}-${countUpdated}`;
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
              type: diff >= 0 ? "adj_in" : "adj_out",
              subType: diff >= 0 ? "ยอดตรวจนับสต๊อก (ปรับสอดเข้า)" : "ยอดตรวจนับสต๊อก (ปรับสอดออก)",
              qty: Math.abs(diff),
              location: "ZONE-ADJ-EOM",
              shift: "DAY",
              operatorId: currentUser?.id || "00000000",
              operatorName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
              timestamp: new Date()
            });

            countUpdated++;
          } else {
            // หากมีสินค้าที่ไม่มีในระบบ ให้สอบถามและเพิ่มรายการที่เลือก
            const confirmAdd = window.confirm(
              `พบรหัสพาร์ท "${partNo}" (ลูกค้า: ${customer}) ยอดตรวจนับจริง: ${countVal} ชิ้น ที่ไม่มีอยู่ในฐานข้อมูลของระบบ!\n\nคุณต้องการเพิ่มสินค้าตัวนี้เข้าไปในระบบโดยอัตโนมัติเลยหรือไม่?`
            );
            if (confirmAdd) {
              const newProdRef = doc(db, "products", prodId);
              batch.set(newProdRef, {
                id: prodId,
                customer,
                partNo,
                partName: `${customer} ${partNo}`,
                sapNo: "-",
                zone: "-",
                fullBox: 24,
                packageType: "BOX",
                openingStock: countVal,
                receivedTotal: 0,
                shippedTotal: 0,
                stock: countVal,
              });

              // Log as an adjust request
              const reqId = `REQ-EOM-${Date.now().toString().slice(-4)}-${countUpdated}`;
              const reqRef = doc(db, "adjust_requests", reqId);
              batch.set(reqRef, {
                id: reqId,
                partNo: partNo,
                partName: `${customer} ${partNo}`,
                currentStock: 0,
                actualStock: countVal,
                difference: countVal,
                requesterId: currentUser?.id || "00000000",
                requesterName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
                timestamp: new Date(),
                status: "approved",
                approvedBy: currentUser ? `${currentUser.name} ${currentUser.lastName} (EOM New Part)` : "Supervisor (EOM New Part)",
                approvedTimestamp: new Date()
              });

              // Log to inventory_log
              const logRef = doc(collection(db, "inventory_log"));
              batch.set(logRef, {
                labelId: `ADJ-EOM-${reqId.slice(-4)}`,
                partNo: partNo,
                partName: `${customer} ${partNo}`,
                customer: customer,
                type: "adj_in",
                subType: "ยอดตรวจนับสต๊อก (ปรับสอดเข้า - พาร์ทใหม่)",
                qty: countVal,
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
          const diff = countVal - (match.stock || 0);
          if (diff === 0) {
            // หากยอดไม่มีการแก้ไข ไม่ต้องรับเข้า
            continue;
          }

          const prodRef = doc(db, "products", prodId);
          batch.update(prodRef, {
            stock: countVal,
            openingStock: countVal,
            receivedTotal: 0,
            shippedTotal: 0
          });

          // Also log to adjust_requests as a auto-approved EOM adjustment
          const reqId = `REQ-EOM-${Date.now().toString().slice(-4)}-${countUpdated}`;
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
            type: diff >= 0 ? "adj_in" : "adj_out",
            subType: diff >= 0 ? "ยอดตรวจนับสต๊อก (ปรับสอดเข้า)" : "ยอดตรวจนับสต๊อก (ปรับสอดออก)",
            qty: Math.abs(diff),
            location: "ZONE-ADJ-EOM",
            shift: "DAY",
            operatorId: currentUser?.id || "00000000",
            operatorName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
            timestamp: new Date()
          });

          countUpdated++;
        } else {
          // หากมีสินค้าที่ไม่มีในระบบ ให้สอบถามและเพิ่มรายการที่เลือก
          const confirmAdd = window.confirm(
            `พบรหัสพาร์ท "${partNo}" (ลูกค้า: ${customer}) ยอดตรวจนับจริง: ${countVal} ชิ้น ที่ไม่มีอยู่ในฐานข้อมูลของระบบ!\n\nคุณต้องการเพิ่มสินค้าตัวนี้เข้าไปในระบบโดยอัตโนมัติเลยหรือไม่?`
          );
          if (confirmAdd) {
            const newProdRef = doc(db, "products", prodId);
            batch.set(newProdRef, {
              id: prodId,
              customer,
              partNo,
              partName: `${customer} ${partNo}`,
              sapNo: "-",
              zone: "-",
              fullBox: 24,
              packageType: "BOX",
              openingStock: countVal,
              receivedTotal: 0,
              shippedTotal: 0,
              stock: countVal,
            });

            // Log as an adjust request
            const reqId = `REQ-EOM-${Date.now().toString().slice(-4)}-${countUpdated}`;
            const reqRef = doc(db, "adjust_requests", reqId);
            batch.set(reqRef, {
              id: reqId,
              partNo: partNo,
              partName: `${customer} ${partNo}`,
              currentStock: 0,
              actualStock: countVal,
              difference: countVal,
              requesterId: currentUser?.id || "00000000",
              requesterName: currentUser ? `${currentUser.name} ${currentUser.lastName}` : "System Operator",
              timestamp: new Date(),
              status: "approved",
              approvedBy: currentUser ? `${currentUser.name} ${currentUser.lastName} (EOM New Part)` : "Supervisor (EOM New Part)",
              approvedTimestamp: new Date()
            });

            // Log to inventory_log
            const logRef = doc(collection(db, "inventory_log"));
            batch.set(logRef, {
              labelId: `ADJ-EOM-${reqId.slice(-4)}`,
              partNo: partNo,
              partName: `${customer} ${partNo}`,
              customer: customer,
              type: "adj_in",
              subType: "ยอดตรวจนับสต๊อก (ปรับสอดเข้า - พาร์ทใหม่)",
              qty: countVal,
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

    // 3. Fetch BOI sub customers
    const unsubBoi = onSnapshot(collection(db, "boi_sub_customers"), (snap) => {
      if (snap.empty) {
        DEFAULT_BOI_CUSTOMERS.forEach((c) => {
          addDoc(collection(db, "boi_sub_customers"), c);
        });
      } else {
        const items: BOICustomer[] = [];
        snap.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as BOICustomer);
        });
        setBoiCustomers(items);
      }
    });

    return () => {
      unsubProds();
      unsubReqs();
      unsubBoi();
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
    setSelectedBoiSubCustomer("");
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลหรือบันทึกใดๆ ได้");
      return;
    }
    if (!selectedProduct) {
      alert("กรุณาค้นหาและเลือกสินค้าก่อนส่งปรับปรุงสต๊อก");
      return;
    }
    if (selectedProduct.customer.toUpperCase() === "BOI" && !selectedBoiSubCustomer) {
      alert("กรุณาเลือกชื่อลูกค้าในกลุ่ม BOI");
      return;
    }

    const currentStockVal = selectedProduct.stock || 0;
    const diff = actualStock - currentStockVal;

    if (diff === 0) {
      alert("⚠️ ยอดตรวจนับจริงเท่ากับยอดปัจจุบัน ไม่มีผลต่าง ไม่สามารถส่งคำขอปรับยอดได้");
      return;
    }

    try {
      const reqId = `REQ-${Date.now().toString().slice(-8)}`;
      const request: AdjustRequest = {
        id: reqId,
        partNo: selectedProduct.partNo,
        partName: selectedProduct.partName,
        subCustomer: selectedProduct.customer.toUpperCase() === "BOI" ? (selectedBoiSubCustomer || null) : null,
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
      setSelectedBoiSubCustomer("");
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
          subCustomer: req.subCustomer || null,
          type: req.difference >= 0 ? "adj_in" : "adj_out",
          subType: req.difference >= 0 ? "ยอดตรวจนับสต๊อก (ปรับสอดเข้า)" : "ยอดตรวจนับสต๊อก (ปรับสอดออก)",
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
      if (diff === 0) {
        alert("⚠️ ยอดแก้ไขไม่มีผลต่าง (ผลต่างเป็น 0) กรุณากรอกยอดอื่นหรือยกเลิกการแก้ไข");
        return;
      }
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
    // 1. Status Filter
    if (filterStatus !== "all" && req.status !== filterStatus) return false;

    // 2. Customer Filter
    if (filterCustomer !== "all") {
      const match = products.find(p => p.partNo === req.partNo);
      const cust = match ? match.customer.toUpperCase() : "";
      if (cust !== filterCustomer.toUpperCase()) return false;
    }

    // 3. Date / Month Filter
    const reqDate = req.timestamp;
    const reqY = reqDate.getFullYear();
    const reqM = String(reqDate.getMonth() + 1).padStart(2, "0");
    const reqD = String(reqDate.getDate()).padStart(2, "0");

    if (filterDate) {
      // Specific Date: YYYY-MM-DD
      const targetDate = `${reqY}-${reqM}-${reqD}`;
      if (targetDate !== filterDate) return false;
    } else if (filterMonth) {
      // Month: YYYY-MM
      const targetMonth = `${reqY}-${reqM}`;
      if (targetMonth !== filterMonth) return false;
    }

    return true;
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
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
                    <Upload className="w-4 h-4 text-amber-400" />
                    <span>นำเข้าด้วยไฟล์ Excel (.xlsx / .xls / .csv)</span>
                  </h4>
                  <button
                    type="button"
                    onClick={downloadExcelTemplate}
                    title="ดาวน์โหลดไฟล์ฟอร์ม Excel ตัวอย่างสำหรับกรอกข้อมูลบันทึกสต๊อก"
                    className="flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 bg-white/5 hover:bg-amber-100/10 px-2 py-1 rounded-lg border border-amber-500/20 transition cursor-pointer shrink-0"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>ฟอร์มตัวอย่าง</span>
                  </button>
                </div>
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
        <div className="lg:col-span-4 space-y-6">
          {/* Requester Form */}
          <form onSubmit={handleCreateRequest} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
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

                {/* BOI Sub-Customer Selector */}
                {selectedProduct.customer.toUpperCase() === "BOI" && (
                  <div className="bg-red-50/50 border border-red-200/60 p-3 rounded-xl space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-red-800 flex items-center gap-1">
                        💼 ลูกค้ากลุ่ม BOI
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsAddingBoi(!isAddingBoi)}
                        className="text-[9px] bg-red-600 hover:bg-red-700 text-white font-semibold px-1.5 py-0.5 rounded transition flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-2.5 h-2.5" /> เพิ่ม
                      </button>
                    </div>

                    {isAddingBoi ? (
                      <div className="bg-white border border-red-100 p-2 rounded-lg space-y-2 shadow-xs">
                        <input
                          type="text"
                          placeholder="ระบุชื่อลูกค้า เช่น SAMBO"
                          value={newBoiName}
                          onChange={(e) => setNewBoiName(e.target.value)}
                          className="w-full px-2 py-1 border border-gray-200 rounded text-[11px] outline-none"
                        />
                        <div className="flex items-center justify-between">
                          <div className="flex gap-2">
                            <label className="flex items-center gap-0.5 text-[9px] text-gray-600">
                              <input
                                type="radio"
                                name="boi_group_adj"
                                checked={newBoiGroup === "CTC"}
                                onChange={() => setNewBoiGroup("CTC")}
                              />
                              CTC
                            </label>
                            <label className="flex items-center gap-0.5 text-[9px] text-gray-600">
                              <input
                                type="radio"
                                name="boi_group_adj"
                                checked={newBoiGroup === "อื่นๆ"}
                                onChange={() => setNewBoiGroup("อื่นๆ")}
                              />
                              อื่นๆ
                            </label>
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setIsAddingBoi(false)}
                              className="text-[9px] text-gray-400 hover:text-gray-600 font-medium px-1.5 py-0.5 rounded"
                            >
                              ยกเลิก
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!newBoiName.trim()) {
                                  alert("กรุณากรอกชื่อลูกค้า");
                                  return;
                                }
                                try {
                                  await addDoc(collection(db, "boi_sub_customers"), {
                                    name: newBoiName.trim().toUpperCase(),
                                    group: newBoiGroup
                                  });
                                  setNewBoiName("");
                                  setIsAddingBoi(false);
                                  alert("เพิ่มรายชื่อลูกค้า BOI สำเร็จ!");
                                } catch (err) {
                                  console.error("Error adding BOI sub customer:", err);
                                }
                              }}
                              className="text-[9px] text-white bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded font-semibold"
                            >
                              บันทึก
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <select
                        value={selectedBoiSubCustomer}
                        onChange={(e) => setSelectedBoiSubCustomer(e.target.value)}
                        className="w-full px-2 py-1.5 border border-red-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-red-500 bg-white font-medium"
                      >
                        <option value="">-- กรุณาเลือกชื่อลูกค้า BOI --</option>
                        <optgroup label="กลุ่ม CTC">
                          {boiCustomers
                            .filter((c) => c.group === "CTC")
                            .map((c) => (
                              <option key={c.id || c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label="อื่นๆ">
                          {boiCustomers
                            .filter((c) => c.group === "อื่นๆ")
                            .map((c) => (
                              <option key={c.id || c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                        </optgroup>
                      </select>
                    </div>
                  </div>
                )}

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
              className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-xs font-bold transition disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed select-none cursor-pointer"
            >
              ส่งคำขอไปยังหัวหน้างาน
            </button>
          </form>

          {/* AI Stock Discrepancy Predictor Widget */}
          {selectedProduct && (
            <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
              {/* Decorative subtle gradient background glow */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full filter blur-2xl -mr-10 -mt-10 pointer-events-none" />

              <div className="relative z-10 space-y-3.5">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-800">
                  <div className="w-8.5 h-8.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                    <Bot className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-[11px] flex items-center gap-1 tracking-tight text-white">
                      🔮 AI Predictor (วิเคราะห์คลาดเคลื่อน)
                    </h4>
                    <p className="text-[9px] text-slate-400">หาสาเหตุ ลืมโอนออก / งานเกินสต๊อก ของ {selectedProduct.partNo}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                  <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800 text-center">
                    <span className="text-slate-500 block text-[9px] mb-0.5">ในระบบ</span>
                    <span className="font-bold text-slate-300">{selectedProduct.stock || 0} ชิ้น</span>
                  </div>
                  <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800 text-center">
                    <span className="text-slate-500 block text-[9px] mb-0.5">นับจริง</span>
                    <span className="font-bold text-slate-300">{actualStock} ชิ้น</span>
                  </div>
                  <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800 text-center">
                    <span className="text-slate-500 block text-[9px] mb-0.5">คลาดเคลื่อน</span>
                    <span className={`font-bold ${actualStock - (selectedProduct.stock || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {actualStock - (selectedProduct.stock || 0) >= 0 ? "+" : ""}
                      {actualStock - (selectedProduct.stock || 0)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handlePredictDiscrepancy}
                  disabled={aiPredictLoading}
                  className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-extrabold py-2 px-3 rounded-xl text-[10px] flex items-center justify-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none"
                >
                  {aiPredictLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>กำลังประมวลผลคาดการณ์ด้วย AI...</span>
                    </>
                  ) : (
                    <>
                      <Brain className="w-3.5 h-3.5 text-red-200" />
                      <span>{aiPredictResult ? "เริ่มประมวลผลซ้ำอีกครั้ง" : "วิเคราะห์คาดการณ์ด้วย AI"}</span>
                    </>
                  )}
                </button>

                {/* Response displaying */}
                {aiPredictLoading ? (
                  <div className="py-6 flex flex-col items-center justify-center text-center space-y-2">
                    <div className="w-8 h-8 rounded-full border-3 border-red-500/20 border-t-red-400 animate-spin" />
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold text-slate-300 animate-pulse">กำลังสืบค้นประวัติในคลัง...</p>
                      <p className="text-[9px] text-slate-500 leading-relaxed">ตรวจจับความผิดปกติของตัวเลขและยอดการเคลื่อนไหว</p>
                    </div>
                  </div>
                ) : aiPredictError ? (
                  <div className="bg-red-950/20 border border-red-900/35 rounded-xl p-3 flex gap-2 text-red-200">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="text-[10px] space-y-0.5 leading-relaxed">
                      <span className="font-bold">เชื่อมต่อ AI ล้มเหลว</span>
                      <p className="text-red-300/80">{aiPredictError}</p>
                    </div>
                  </div>
                ) : aiPredictResult ? (
                  <div className="bg-slate-950/45 border border-slate-850/60 rounded-xl p-3.5 space-y-2 max-h-[340px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 text-[11px] border-t-2 border-t-red-500">
                    {renderPredictMarkdown(aiPredictResult)}
                  </div>
                ) : (
                  <div className="py-3.5 border border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center text-center space-y-1.5 bg-slate-950/10">
                    <Info className="w-3.5 h-3.5 text-slate-500" />
                    <div className="space-y-0.5 max-w-[210px]">
                      <span className="text-[10px] font-bold text-slate-300 block">วิเคราะห์ลืมโอนออก / งานเกินสต๊อก</span>
                      <p className="text-[9px] text-slate-500 leading-relaxed">ระบบ AI จะวิเคราะห์ประวัติธุรกรรมเพื่อชี้ความน่าจะเป็นของความผิดพลาดแบบเรียลไทม์</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Requests List Container */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm lg:col-span-8 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
            <div>
              <h3 className="font-bold text-gray-800">ประวัติการขออนุมัติปรับปรุงยอด</h3>
              <p className="text-xs text-gray-400">คำร้องขอทั้งหมดจะถูกจัดหมวดหมู่และแสดงตามลำดับใหม่ล่าสุด</p>
            </div>

            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl shrink-0">
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

          {/* New Filters Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50/50 p-3.5 rounded-xl border border-gray-100">
            {/* Filter Month */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-500 uppercase">เลือกเดือน (เริ่มต้นเป็นเดือนปัจจุบัน)</label>
              <input
                type="month"
                value={filterMonth}
                onChange={(e) => {
                  setFilterMonth(e.target.value);
                  setFilterDate(""); // Clear exact date if user clicks month input
                }}
                disabled={!!filterDate}
                className="w-full text-xs font-semibold border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 bg-white disabled:bg-gray-100 disabled:text-gray-400 cursor-pointer"
              />
            </div>

            {/* Filter Date */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-500 uppercase flex items-center justify-between">
                <span>ระบุเฉพาะวัน (วัน-เดือน-ปี)</span>
                {filterDate && (
                  <button onClick={() => setFilterDate("")} className="text-red-500 hover:text-red-600 font-bold lowercase text-[9px] cursor-pointer">
                    [ล้างค่าวัน]
                  </button>
                )}
              </label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full text-xs font-semibold border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 bg-white cursor-pointer"
              />
            </div>

            {/* Filter Customer */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-500 uppercase">เลือกลูกค้า</label>
              <select
                value={filterCustomer}
                onChange={(e) => setFilterCustomer(e.target.value)}
                className="w-full text-xs font-semibold border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 bg-white cursor-pointer"
              >
                <option value="all">ลูกค้าทั้งหมด (All Customers)</option>
                {Array.from(new Set(products.map(p => p.customer).filter(Boolean))).map((cust) => (
                  <option key={cust} value={cust}>{cust}</option>
                ))}
              </select>
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
