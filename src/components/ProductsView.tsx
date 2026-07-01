import React, { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Product } from "../types";
import { fuzzySearch } from "../utils/fuzzy";
import { getSafeProductId } from "../utils/productUtils";
import * as XLSX from "xlsx";
import { Search, FileSpreadsheet, Package, Upload, HelpCircle, Edit3, Save, Check, Clipboard, X, PlusCircle } from "lucide-react";

export default function ProductsView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("All");
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  // Single product creation state
  const [showAddSingleModal, setShowAddSingleModal] = useState(false);
  const [newCust, setNewCust] = useState("");
  const [newPartNo, setNewPartNo] = useState("");
  const [newPartName, setNewPartName] = useState("");
  const [newSapNo, setNewSapNo] = useState("-");
  const [newZone, setNewZone] = useState("-");
  const [newFullBox, setNewFullBox] = useState<number>(0);
  const [newPkgType, setNewPkgType] = useState("BOX");
  const [newOpeningStock, setNewOpeningStock] = useState<number>(0);

  // Inline edit state for box size fallback
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBoxValue, setEditingBoxValue] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateSingleProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCust.trim() || !newPartNo.trim()) {
      alert("กรุณากรอกข้อมูลลูกค้าและพาร์ทสินค้า");
      return;
    }

    const customerVal = newCust.trim().toUpperCase();
    const partNoVal = newPartNo.trim();
    const compositeId = getSafeProductId(customerVal, partNoVal);

    // Check if product already exists
    const exists = products.some((p) => p.id === compositeId);
    if (exists) {
      alert(`สินค้าพาร์ท ${partNoVal} ของลูกค้า ${customerVal} มีอยู่ในระบบแล้ว`);
      return;
    }

    try {
      const productDoc: Product = {
        id: compositeId,
        customer: customerVal,
        partNo: partNoVal,
        partName: newPartName.trim() || `${customerVal} ${partNoVal}`,
        sapNo: newSapNo.trim(),
        zone: newZone.trim(),
        fullBox: newFullBox,
        packageType: newPkgType.trim() || "BOX",
        openingStock: newOpeningStock,
        receivedTotal: 0,
        shippedTotal: 0,
        stock: newOpeningStock,
      };

      await setDoc(doc(db, "products", compositeId), productDoc);
      alert("เพิ่มสินค้าเดี่ยวลงทะเบียนข้อมูลสินค้าสำเร็จ!");
      
      // Reset & close modal
      setShowAddSingleModal(false);
      setNewCust("");
      setNewPartNo("");
      setNewPartName("");
      setNewSapNo("-");
      setNewZone("-");
      setNewFullBox(0);
      setNewPkgType("BOX");
      setNewOpeningStock(0);
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการสร้างสินค้า");
    }
  };

  // Load products in real-time
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "products"), (snap) => {
      const items: Product[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Product));
      setProducts(items);
    });
    return unsub;
  }, []);

  // Filter products by customer and fuzzy search
  const customers = ["All", ...Array.from(new Set(products.map((p) => p.customer).filter(Boolean)))];

  const filteredProducts = products.filter((prod) => {
    // 1. Customer filter
    if (selectedCustomer !== "All" && prod.customer !== selectedCustomer) return false;
    // 2. Text Search
    if (!searchTerm.trim()) return true;

    const term = searchTerm.toLowerCase();
    return (
      prod.partNo.toLowerCase().includes(term) ||
      prod.partName.toLowerCase().includes(term) ||
      (prod.sapNo && prod.sapNo.toLowerCase().includes(term))
    );
  });

  // Grouped products
  const groupedProducts = filteredProducts.reduce((acc, p) => {
    const cust = p.customer || "UNKNOWN";
    if (!acc[cust]) acc[cust] = [];
    acc[cust].push(p);
    return acc;
  }, {} as Record<string, Product[]>);

  // Handle box size quick update
  const handleStartEditBox = (prod: Product) => {
    setEditingId(prod.id);
    setEditingBoxValue(prod.fullBox || 0);
  };

  const handleSaveBoxValue = async (prodId: string) => {
    try {
      const ref = doc(db, "products", prodId);
      await updateDoc(ref, { fullBox: editingBoxValue });
      setEditingId(null);
    } catch (err) {
      console.error("Error saving box value:", err);
      alert("ไม่สามารถบันทึกข้อมูลกล่องได้");
    }
  };

  // Safe Excel Importer
  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        if (!data) throw new Error("File content is empty");

        const workbook = XLSX.read(data, { type: "binary" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Parse to JSON safely
        const rawRows = XLSX.utils.sheet_to_json<any>(worksheet);

        if (rawRows.length === 0) {
          alert("ไม่พบข้อมูลรายการสินค้าในไฟล์ Excel");
          return;
        }

        let importedCount = 0;

        // Save imported items
        for (const row of rawRows) {
          // Normalize keys to find columns regardless of formatting
          const rowKeys = Object.keys(row);
          const findVal = (possibleKeys: string[], defaultVal: any) => {
            const matchedKey = rowKeys.find(rk => 
              possibleKeys.includes(rk.toLowerCase().trim().replace(/[\s_-]/g, ""))
            );
            return matchedKey !== undefined ? row[matchedKey] : defaultVal;
          };

          const partNo = String(findVal(["partno", "part", "รหัสสินค้า", "พาร์ท"], "")).trim();
          const customer = String(findVal(["customer", "ลูกค้า"], "")).trim().toUpperCase();
          const partName = String(findVal(["partname", "ชื่อสินค้า", "รายการสินค้า", "ชื่อพาร์ท"], "")).trim();

          if (!partNo || !customer) {
            continue; // Skip invalid lines safely
          }

          const sapNo = String(findVal(["sapno", "sap", "รหัสsap"], "-")).trim();
          const zone = String(findVal(["zone", "โซน"], "-")).trim();
          const fullBox = Number(findVal(["fullbox", "ขนาดกล่อง", "จำนวนต่อกล่อง", "บรรจุ"], 0)) || 0;
          const packageType = String(findVal(["packagetype", "ประเภทกล่อง", "บรรจุภัณฑ์"], "BOX")).trim();
          const openingStock = Number(findVal(["beginningstock", "openingstock", "stock", "ยอดยกมา", "สต็อกยอดยกมา"], 0)) || 0;

          const compositeId = getSafeProductId(customer, partNo);

          const productDoc: Product = {
            id: compositeId,
            customer,
            partNo,
            partName: partName || `${customer} ${partNo}`,
            sapNo,
            zone,
            fullBox,
            packageType,
            openingStock,
            receivedTotal: 0,
            shippedTotal: 0,
            stock: openingStock, // initial stock starts with opening balance
          };

          await setDoc(doc(db, "products", compositeId), productDoc);
          importedCount++;
        }

        alert(`อิมพอร์ตข้อมูลเรียบร้อยแล้ว: นำเข้าสำเร็จ ${importedCount} รายการ!`);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (err: any) {
        console.error("Excel import crash error:", err);
        alert(`เกิดข้อผิดพลาดในการอ่านไฟล์ Excel: ${err?.message || err}`);
      }
    };

    reader.readAsBinaryString(file);
  };

  // Safe TSV/CSV Manual Paste Importer
  const handlePasteImport = async () => {
    if (!pastedText.trim()) {
      alert("กรุณาวางข้อมูลดิบจากตาราง (Copy & Paste จาก Excel/Sheets)");
      return;
    }

    setIsImporting(true);
    try {
      const lines = pastedText.split("\n");
      if (lines.length < 2) {
        alert("กรุณาวางข้อมูลอย่างน้อย 2 บรรทัด (รวมแถวหัวข้อคอลัมน์)");
        setIsImporting(false);
        return;
      }

      // Parse headers
      const headers = lines[0].toLowerCase().split(/\t|,/).map(h => h.trim().replace(/[\s_-]/g, ""));
      const partNoIdx = headers.findIndex(h => h === "partno" || h === "part" || h === "รหัสสินค้า" || h === "พาร์ท");
      const customerIdx = headers.findIndex(h => h === "customer" || h === "ลูกค้า");
      const partNameIdx = headers.findIndex(h => h === "partname" || h === "ชื่อสินค้า" || h === "รายการสินค้า");
      const sapNoIdx = headers.findIndex(h => h === "sapno" || h === "รหัสsap" || h === "sap");
      const zoneIdx = headers.findIndex(h => h === "zone" || h === "โซน");
      const fullBoxIdx = headers.findIndex(h => h === "fullbox" || h === "ขนาดกล่อง" || h === "จำนวนต่อกล่อง" || h === "บรรจุ");
      const packageTypeIdx = headers.findIndex(h => h === "packagetype" || h === "ประเภทกล่อง" || h === "บรรจุภัณฑ์");
      const openingStockIdx = headers.findIndex(h => h === "beginningstock" || h === "openingstock" || h === "stock" || h === "ยอดยกมา" || h === "สต็อกยอดยกมา");

      let importedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(/\t|,/);

        const customer = (customerIdx !== -1 && cols[customerIdx] !== undefined ? cols[customerIdx] : cols[0])?.trim().toUpperCase();
        const partNo = (partNoIdx !== -1 && cols[partNoIdx] !== undefined ? cols[partNoIdx] : cols[1])?.trim();

        if (!partNo || !customer || customer === "CUSTOMER" || customer === "CUSTOMER_NAME") {
          continue; // skip headers or empty lines
        }

        const partName = (partNameIdx !== -1 && cols[partNameIdx] !== undefined ? cols[partNameIdx] : cols[2])?.trim() || `${customer} ${partNo}`;
        const fullBox = Number((fullBoxIdx !== -1 && cols[fullBoxIdx] !== undefined ? cols[fullBoxIdx] : cols[3]) || 0) || 0;
        const sapNo = (sapNoIdx !== -1 && cols[sapNoIdx] !== undefined ? cols[sapNoIdx] : cols[4])?.trim() || "-";
        const zone = (zoneIdx !== -1 && cols[zoneIdx] !== undefined ? cols[zoneIdx] : cols[5])?.trim() || "-";
        const packageType = (packageTypeIdx !== -1 && cols[packageTypeIdx] !== undefined ? cols[packageTypeIdx] : cols[6])?.trim() || "BOX";
        const openingStock = Number((openingStockIdx !== -1 && cols[openingStockIdx] !== undefined ? cols[openingStockIdx] : cols[7]) || 0) || 0;

        const compositeId = getSafeProductId(customer, partNo);

        const productDoc: Product = {
          id: compositeId,
          customer,
          partNo,
          partName,
          sapNo,
          zone,
          fullBox,
          packageType,
          openingStock,
          receivedTotal: 0,
          shippedTotal: 0,
          stock: openingStock,
        };

        await setDoc(doc(db, "products", compositeId), productDoc);
        importedCount++;
      }

      alert(`นำเข้าข้อมูลพาสวางสำเร็จเรียบร้อยแล้ว: ${importedCount} รายการ!`);
      setShowPasteModal(false);
      setPastedText("");
    } catch (err: any) {
      console.error(err);
      alert(`เกิดข้อผิดพลาด: ${err?.message || err}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">ทะเบียนข้อมูลสินค้า (Product Master)</h2>
          <p className="text-sm text-gray-500 mt-1">
            ระบุความจุกล่อง (Full Box) และจัดเก็บสินค้าตามกลุ่มแบรนด์ของลูกค้า
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5 self-stretch md:self-auto">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleExcelImport}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />
          <button
            onClick={() => setShowAddSingleModal(true)}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer shadow-xs select-none"
          >
            <PlusCircle className="w-4 h-4 text-white" />
            <span>เพิ่มสินค้าเดี่ยว</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 border border-slate-200 transition cursor-pointer shadow-xs select-none"
          >
            <Upload className="w-4 h-4 text-red-600" />
            <span>อิมพอร์ต Excel / CSV</span>
          </button>
          <button
            onClick={() => setShowPasteModal(true)}
            className="bg-black hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer shadow-xs select-none"
          >
            <Clipboard className="w-4 h-4 text-red-500 animate-pulse" />
            <span>วางข้อมูลตาราง (Paste Table)</span>
          </button>
        </div>
      </div>

      {/* Filter and Search rail */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-white p-4 border border-gray-100 rounded-2xl shadow-xs">
        <div className="md:col-span-8 relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="ค้นหาด้วยรหัสสินค้า (Part No), ชื่อรายการสินค้า หรือรหัส SAP..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <div className="md:col-span-4 flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 shrink-0">กรองลูกค้า:</span>
          <select
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {customers.map((cust, i) => (
              <option key={i} value={cust}>
                {cust === "All" ? "แสดงทั้งหมด" : cust}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Database grouped list */}
      <div className="space-y-8">
        {Object.keys(groupedProducts).length === 0 ? (
          <div className="bg-white border p-12 rounded-2xl text-center text-gray-400 italic">
            ไม่พบข้อมูลสินค้าที่ต้องการค้นหาในระบบ
          </div>
        ) : (
          Object.keys(groupedProducts).map((custName) => (
            <div key={custName} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-xs">
              <div className="bg-gray-50 border-b border-gray-100 px-5 py-4 flex justify-between items-center">
                <span className="font-bold text-gray-800 uppercase flex items-center gap-2">
                  <Package className="w-5 h-5 text-red-600" /> {custName}
                </span>
                <span className="text-xs bg-gray-200/60 text-gray-600 px-2.5 py-1 rounded-full font-bold">
                  {groupedProducts[custName].length} พาร์ท
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-50/50 text-gray-500 font-bold border-b border-gray-100 uppercase">
                    <tr>
                      <th className="p-4">รหัสสินค้า (Part No)</th>
                      <th className="p-4">รหัส SAP No</th>
                      <th className="p-4">ชื่อสินค้า (Part Name)</th>
                      <th className="p-4 text-center">ขนาดกล่อง (Full Box)</th>
                      <th className="p-4 text-right">ยอดยกมา</th>
                      <th className="p-4 text-right">รับรวม</th>
                      <th className="p-4 text-right">โอนรวม</th>
                      <th className="p-4 text-right">สต๊อกปัจจุบัน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedProducts[custName].map((prod) => (
                      <tr key={prod.id} className="border-b last:border-0 hover:bg-gray-50/40 transition">
                        <td className="p-4 font-bold text-gray-900">{prod.partNo}</td>
                        <td className="p-4 text-gray-500 font-mono">{prod.sapNo || "-"}</td>
                        <td className="p-4 text-gray-600 max-w-[200px] truncate">{prod.partName}</td>
                        <td className="p-4 text-center">
                          {editingId === prod.id ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <input
                                type="number"
                                value={editingBoxValue}
                                onChange={(e) => setEditingBoxValue(Number(e.target.value))}
                                className="w-16 px-1.5 py-0.5 border rounded text-center font-bold"
                              />
                              <button
                                onClick={() => handleSaveBoxValue(prod.id)}
                                className="bg-green-600 text-white p-1 rounded hover:bg-green-700"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5">
                              {prod.fullBox ? (
                                <span className="font-bold text-gray-800">
                                  {prod.fullBox} <span className="text-[10px] text-gray-400">/{prod.packageType || "BOX"}</span>
                                </span>
                              ) : (
                                <span className="text-red-500 font-semibold italic text-[11px] bg-red-50 px-2 py-0.5 rounded">
                                  ไม่มีขนาดกล่อง
                                </span>
                              )}
                              <button
                                onClick={() => handleStartEditBox(prod)}
                                className="text-gray-400 hover:text-black transition"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-right text-gray-500">{(prod.openingStock || 0).toLocaleString()}</td>
                        <td className="p-4 text-right text-green-600 font-semibold">+{(prod.receivedTotal || 0).toLocaleString()}</td>
                        <td className="p-4 text-right text-red-500 font-semibold">-{(prod.shippedTotal || 0).toLocaleString()}</td>
                        <td className="p-4 text-right">
                          <span className="font-bold text-sm text-gray-900">
                            {(prod.stock ?? (prod.openingStock + (prod.receivedTotal || 0) - (prod.shippedTotal || 0))).toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Manual Paste Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 z-[250] bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 p-5 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Clipboard className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">วางข้อมูลตารางบันทึกสินค้า (Paste Table Data)</h3>
                  <p className="text-[10px] text-red-100">คัดลอกเซลล์จาก Excel / Google Sheets แล้ววางลงที่นี่เพื่อดึงข้อมูลสินค้าทันที</p>
                </div>
              </div>
              <button 
                onClick={() => { setShowPasteModal(false); setPastedText(""); }} 
                className="hover:bg-red-800 p-1.5 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-700">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                <h4 className="font-bold text-slate-800 text-xs">💡 คำอธิบายและโครงสร้างคอลัมน์คัดลอก:</h4>
                <p className="text-slate-500 leading-relaxed text-[11px]">
                  คุณสามารถครอบคลุมคอลัมน์ทั้งหมดในตาราง Excel (รวมแถวแรกที่เป็นหัวข้อ) กดคัดลอก (Ctrl+C) แล้วมาวางที่นี่ได้ทันที ระบบจะวิเคราะห์ชื่อคอลัมน์ให้อัตโนมัติ:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono font-bold mt-1 text-slate-600">
                  <div className="bg-white px-2.5 py-1.5 rounded border border-slate-200">customer (ลูกค้า)</div>
                  <div className="bg-white px-2.5 py-1.5 rounded border border-slate-200">part_no (รหัสสินค้า)</div>
                  <div className="bg-white px-2.5 py-1.5 rounded border border-slate-200">part_name (ชื่อสินค้า)</div>
                  <div className="bg-white px-2.5 py-1.5 rounded border border-slate-200">full_box (ขนาดกล่อง)</div>
                  <div className="bg-white px-2.5 py-1.5 rounded border border-slate-200">sap_no (รหัส SAP)</div>
                  <div className="bg-white px-2.5 py-1.5 rounded border border-slate-200">zone (โซน)</div>
                  <div className="bg-white px-2.5 py-1.5 rounded border border-slate-200">package_type (ประเภทกล่อง)</div>
                  <div className="bg-white px-2.5 py-1.5 rounded border border-slate-200">Beginning Stock (ยกมา)</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-800">วางข้อมูลตารางของคุณลงในกล่องด้านล่าง:</label>
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={`ตัวอย่างการวางข้อมูล:\ncustomer\tpart_no\tpart_name\tfull_box\tsap_no\tzone\tpackage_type\tBeginning Stock\nHaier\t0010724702N\t\t\t266109130080\tBZ\t\t\nHaier\t0010743580P\t\t75\t590301037000\tBZ\t\t`}
                  className="w-full h-64 p-4 border border-slate-200 rounded-2xl font-mono text-[10px] bg-slate-900 text-slate-100 outline-none focus:ring-2 focus:ring-red-500 shadow-inner"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-between items-center">
              <span className="text-[10px] text-slate-400">
                {pastedText ? `ตรวจพบประมาณ ${pastedText.split('\n').filter(Boolean).length} แถว` : 'รอวางข้อมูล...'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowPasteModal(false); setPastedText(""); }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handlePasteImport}
                  disabled={isImporting || !pastedText.trim()}
                  className="bg-black hover:bg-slate-800 text-white font-bold px-5 py-2 rounded-xl text-xs transition cursor-pointer disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {isImporting ? "กำลังนำเข้าข้อมูล..." : "เริ่มนำเข้าข้อมูล (Import Now)"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Single Product Modal */}
      {showAddSingleModal && (
        <div className="fixed inset-0 z-[250] bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <form onSubmit={handleCreateSingleProduct} className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 p-5 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <PlusCircle className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">เพิ่มข้อมูลสินค้าเดี่ยว (Add Single Product)</h3>
                  <p className="text-[10px] text-red-100">กรอกข้อมูลรายละเอียดของพาร์ทสินค้าใหม่เพื่อเริ่มขึ้นทะเบียนข้อมูล</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setShowAddSingleModal(false)} 
                className="hover:bg-red-800 p-1.5 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-700">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ลูกค้า (Customer) *</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น Haier, Toshiba, Sharp"
                    value={newCust}
                    onChange={(e) => setNewCust(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  />
                </div>
                
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">รหัสพาร์ทสินค้า (Part No) *</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น 0010724702N"
                    value={newPartNo}
                    onChange={(e) => setNewPartNo(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block">ชื่อพาร์ท / รายการสินค้า (Part Name)</label>
                <input
                  type="text"
                  placeholder="หากเว้นว่าง ระบบจะนำชื่อลูกค้าและรหัสสินค้ามาตั้งชื่อให้"
                  value={newPartName}
                  onChange={(e) => setNewPartName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">รหัส SAP (SAP No)</label>
                  <input
                    type="text"
                    value={newSapNo}
                    onChange={(e) => setNewSapNo(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  />
                </div>
                
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">โซนการจัดเก็บ (Zone)</label>
                  <input
                    type="text"
                    value={newZone}
                    onChange={(e) => setNewZone(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ความจุต่อกล่อง (Full Box)</label>
                  <input
                    type="number"
                    value={newFullBox}
                    onChange={(e) => setNewFullBox(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  />
                </div>
                
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ประเภทกล่อง</label>
                  <input
                    type="text"
                    value={newPkgType}
                    onChange={(e) => setNewPkgType(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ยอดยกมา (Opening Stock)</label>
                  <input
                    type="number"
                    value={newOpeningStock}
                    onChange={(e) => setNewOpeningStock(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-end gap-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setShowAddSingleModal(false)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-xl transition cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="bg-red-600 hover:bg-red-700 text-white font-bold px-5 py-2 rounded-xl transition cursor-pointer shadow-xs"
              >
                บันทึกขึ้นทะเบียนสินค้า
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
