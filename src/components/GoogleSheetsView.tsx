import React, { useState, useEffect } from "react";
import { collection, getDocs, writeBatch, doc, setDoc, onSnapshot, getDocsFromCache } from "firebase/firestore";
import { db } from "../firebase";
import { Product, Employee } from "../types";
import { 
  sheetsSignIn, 
  sheetsLogout, 
  initSheetsAuth, 
  extractSpreadsheetId, 
  getSpreadsheetMetadata, 
  ensureSheetsExist, 
  overwriteSheetValues, 
  readSheetValues, 
  appendSheetValues 
} from "../utils/googleSheets";
import { 
  Database, RefreshCw, UploadCloud, DownloadCloud, AlertTriangle, CheckCircle2, 
  LogOut, Play, ShieldCheck, FileText, Settings, HelpCircle, ArrowRight, TableProperties,
  Lock
} from "lucide-react";

interface GoogleSheetsViewProps {
  currentUser: Employee | null;
}

export default function GoogleSheetsView({ currentUser }: GoogleSheetsViewProps) {
  const [sheetUrl, setSheetUrl] = useState<string>(() => {
    return localStorage.getItem("wsm_sheets_url") || "https://docs.google.com/spreadsheets/d/1v2rCUctvfjwOFlduh4UZaCq1WEDdrew1g0CqzdW2Wkw/edit?gid=0#gid=0";
  });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "info" | "success" | "error" } | null>(null);
  const [spreadsheetTitle, setSpreadsheetTitle] = useState<string>("");
  const [sheetsList, setSheetsList] = useState<string[]>([]);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => {
    return localStorage.getItem("wsm_sheets_auto_sync") === "true";
  });

  const isAuthorized = currentUser?.role === "admin" || currentUser?.role === "leader";

  // Real-time synchronization of the central Google Sheet URL from Firestore (Admin Central Database)
  useEffect(() => {
    const unsubscribeGeneral = onSnapshot(doc(db, "settings", "general"), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.googleSheetsUrl) {
          setSheetUrl(data.googleSheetsUrl);
          localStorage.setItem("wsm_sheets_url", data.googleSheetsUrl);
          if (data.googleSheetsId) {
            localStorage.setItem("wsm_sheets_id", data.googleSheetsId);
          }
        }
      }
    }, (error) => {
      console.warn("Error listening to central settings/general in GoogleSheetsView:", error);
    });
    return () => unsubscribeGeneral();
  }, []);

  // Track Auth state
  useEffect(() => {
    const unsubscribe = initSheetsAuth(
      (user, token) => {
        setGoogleUser(user);
        setAccessToken(token);
        setNeedsAuth(false);
        verifySpreadsheet(token);
      },
      () => {
        setNeedsAuth(true);
        setAccessToken(null);
      }
    );
    return () => unsubscribe();
  }, [sheetUrl]);

  const verifySpreadsheet = async (token: string) => {
    const sId = extractSpreadsheetId(sheetUrl);
    if (!sId) return;
    try {
      const meta = await getSpreadsheetMetadata(sId, token);
      setSpreadsheetTitle(meta.properties?.title || "ไม่ทราบชื่อสเปรดชีต");
      setSheetsList(meta.sheets?.map((s: any) => s.properties.title) || []);
    } catch (err: any) {
      console.error(err);
      setSpreadsheetTitle("");
    }
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setStatusMessage(null);
    try {
      const result = await sheetsSignIn();
      if (result) {
        setAccessToken(result.accessToken);
        setGoogleUser(result.user);
        setNeedsAuth(false);
        setStatusMessage({ text: "เข้าสู่ระบบด้วย Google สำเร็จ!", type: "success" });
        verifySpreadsheet(result.accessToken);
      }
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: `เข้าสู่ระบบไม่สำเร็จ: ${err.message || err}`, type: "error" });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await sheetsLogout();
      setAccessToken(null);
      setGoogleUser(null);
      setNeedsAuth(true);
      setSpreadsheetTitle("");
      setStatusMessage({ text: "ออกจากระบบ Google สำเร็จ", type: "info" });
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleSaveUrl = async () => {
    const sId = extractSpreadsheetId(sheetUrl);
    if (!sId) {
      setStatusMessage({ text: "รูปแบบ Google Sheet URL ไม่ถูกต้อง", type: "error" });
      return;
    }

    if (!isAuthorized) {
      setStatusMessage({ text: "ขออภัย เฉพาะผู้ดูแลระบบ (Admin) หรือ หัวหน้างาน (Leader) เท่านั้นที่สามารถเปลี่ยน URL ของฐานข้อมูลกลางได้", type: "error" });
      return;
    }

    setLoading(true);
    setStatusMessage({ text: "กำลังบันทึกข้อมูลและเชื่อมโยงชีตเป็นฐานข้อมูลกลาง...", type: "info" });
    
    try {
      // Save locally
      localStorage.setItem("wsm_sheets_url", sheetUrl);
      localStorage.setItem("wsm_sheets_id", sId);
      
      // Save globally in Firestore central database settings
      await setDoc(doc(db, "settings", "general"), {
        googleSheetsUrl: sheetUrl,
        googleSheetsId: sId
      }, { merge: true });
      
      setStatusMessage({ text: "บันทึกและเชื่อมโยง Google Sheet URL เป็นฐานข้อมูลกลางสําเร็จ!", type: "success" });
      if (accessToken) {
        verifySpreadsheet(accessToken);
      }
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: `บันทึกข้อมูลไม่สำเร็จ: ${err.message || err}`, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAutoSync = (checked: boolean) => {
    setAutoSyncEnabled(checked);
    localStorage.setItem("wsm_sheets_auto_sync", checked ? "true" : "false");
    setStatusMessage({
      text: checked 
        ? "เปิดใช้งาน Auto-Sync ทุกรายการธุรกรรม (Stock-In/Out, ย้าย Location) จะซิงค์ลงชีตโดยอัตโนมัติ" 
        : "ปิดใช้งาน Auto-Sync แบบเรียลไทม์",
      type: "info"
    });
  };

  // Helper to ensure default tabs are prepared
  const setupRequiredSheets = async (token: string, sId: string) => {
    setStatusMessage({ text: "กำลังตรวจสอบและสร้างแท็บชีตที่จำเป็น...", type: "info" });
    await ensureSheetsExist(sId, token, ["Products", "InventoryLogs", "Locations"]);
    await verifySpreadsheet(token);
  };

  // Export local products database to Google Sheets
  const handleExportProducts = async () => {
    if (!accessToken) {
      setStatusMessage({ text: "กรุณาเข้าสู่ระบบ Google ก่อนดำเนินการ", type: "error" });
      return;
    }
    const sId = extractSpreadsheetId(sheetUrl);
    if (!sId) {
      setStatusMessage({ text: "กรุณาระบุ Google Sheet URL ที่ถูกต้อง", type: "error" });
      return;
    }

    const confirmExport = window.confirm("คุณต้องการเขียนทับข้อมูลแท็บ 'Products' ใน Google Sheets ด้วยข้อมูลจากฐานข้อมูลหลักปัจจุบันใช่หรือไม่?");
    if (!confirmExport) return;

    setLoading(true);
    setStatusMessage({ text: "กำลังส่งออกข้อมูลสินค้า...", type: "info" });

    try {
      // 1. Ensure tab exists
      await setupRequiredSheets(accessToken, sId);

      // 2. Fetch products from Firestore with fallback to cache if server fails (e.g., Quota Exceeded / Offline Sandbox)
      let snap;
      try {
        snap = await getDocs(collection(db, "products"));
      } catch (err: any) {
        console.warn("Could not fetch products from server, trying local cache fallback:", err);
        snap = await getDocsFromCache(collection(db, "products"));
      }
      
      const productsList: Product[] = [];
      snap.forEach((docSnap) => {
        productsList.push({ id: docSnap.id, ...docSnap.data() } as Product);
      });

      // 3. Define headers and rows
      const headers = [
        "Product ID (Composite Key)",
        "SAP No",
        "Zone",
        "Customer Name",
        "Part Number",
        "Part Name",
        "Standard Box Qty",
        "Package Type",
        "Opening Stock",
        "Total Received",
        "Total Shipped",
        "Current Stock",
        "Box Size"
      ];

      const rows = productsList.map((p) => [
        p.id,
        p.sapNo || "-",
        p.zone || "-",
        p.customer || "",
        p.partNo || "",
        p.partName || "",
        Number(p.fullBox) || 0,
        p.packageType || "BOX",
        Number(p.openingStock) || 0,
        Number(p.receivedTotal) || 0,
        Number(p.shippedTotal) || 0,
        Number(p.stock) || 0,
        p.boxSize || ""
      ]);

      // 4. Overwrite Sheet
      await overwriteSheetValues(sId, accessToken, "Products", headers, rows);
      
      setStatusMessage({ 
        text: `ส่งออกข้อมูลสินค้าเรียบร้อยแล้ว! อัปโหลดสำเร็จทั้งหมด ${productsList.length} รายการ`, 
        type: "success" 
      });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: `ส่งออกล้มเหลว: ${err.message || err}`, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // Import products from Google Sheets to Firestore
  const handleImportProducts = async () => {
    if (!accessToken) {
      setStatusMessage({ text: "กรุณาเข้าสู่ระบบ Google ก่อนดำเนินการ", type: "error" });
      return;
    }
    const sId = extractSpreadsheetId(sheetUrl);
    if (!sId) {
      setStatusMessage({ text: "กรุณาระบุ Google Sheet URL ที่ถูกต้อง", type: "error" });
      return;
    }

    const confirmImport = window.confirm(
      "คำเตือน: การนำเข้าข้อมูลสินค้าจาก Google Sheets แท็บ 'Products' จะเข้าไปเพิ่มหรืออัปเดตข้อมูลสินค้าในฐานข้อมูลหลักปัจจุบัน คุณต้องการดำเนินการต่อหรือไม่?"
    );
    if (!confirmImport) return;

    setLoading(true);
    setStatusMessage({ text: "กำลังดึงข้อมูลจาก Google Sheets...", type: "info" });

    try {
      const rows = await readSheetValues(sId, accessToken, "Products");
      if (rows.length === 0) {
        throw new Error("ไม่พบข้อมูลสินค้า หรือไม่พบชีต 'Products' ใน Google Sheets ของคุณ");
      }

      setStatusMessage({ text: `ตรวจพบสินค้า ${rows.length} รายการ กำลังอัปเดตลงฐานข้อมูลระบบ...`, type: "info" });

      const batch = writeBatch(db);
      let successCount = 0;

      rows.forEach((row) => {
        // Headers mapping:
        // 0: id, 1: sapNo, 2: zone, 3: customer, 4: partNo, 5: partName, 6: fullBox, 7: packageType, 8: openingStock, 9: receivedTotal, 10: shippedTotal, 11: stock, 12: boxSize
        const id = row[0];
        if (!id) return;

        const prodData: Partial<Product> = {
          sapNo: row[1] || "-",
          zone: row[2] || "-",
          customer: row[3] || "",
          partNo: row[4] || "",
          partName: row[5] || "",
          fullBox: Number(row[6]) || 0,
          packageType: row[7] || "BOX",
          openingStock: Number(row[8]) || 0,
          receivedTotal: Number(row[9]) || 0,
          shippedTotal: Number(row[10]) || 0,
          stock: Number(row[11]) || 0,
          boxSize: row[12] || ""
        };

        const prodRef = doc(db, "products", id);
        batch.set(prodRef, prodData, { merge: true });
        successCount++;
      });

      await batch.commit();
      setStatusMessage({ 
        text: `นำเข้าสินค้าเรียบร้อย! อัปเดตสินค้าทั้งหมด ${successCount} รายการเข้าสู่ระบบเรียบร้อยแล้ว`, 
        type: "success" 
      });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: `นำเข้าล้มเหลว: ${err.message || err}`, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // Export transaction logs to Google Sheets
  const handleExportLogs = async () => {
    if (!accessToken) {
      setStatusMessage({ text: "กรุณาเข้าสู่ระบบ Google ก่อนดำเนินการ", type: "error" });
      return;
    }
    const sId = extractSpreadsheetId(sheetUrl);
    if (!sId) {
      setStatusMessage({ text: "กรุณาระบุ Google Sheet URL ที่ถูกต้อง", type: "error" });
      return;
    }

    const confirmExport = window.confirm("คุณต้องการส่งออกประวัติธุรกรรมคลังสินค้า (Inventory Logs) ทั้งหมด ไปยัง Google Sheets หรือไม่?");
    if (!confirmExport) return;

    setLoading(true);
    setStatusMessage({ text: "กำลังประมวลผลข้อมูลประวัติและอัปโหลด...", type: "info" });

    try {
      await setupRequiredSheets(accessToken, sId);

      // Fetch all inventory logs from Firestore with fallback to cache if server fails (e.g., Quota Exceeded / Offline Sandbox)
      let snap;
      try {
        snap = await getDocs(collection(db, "inventory_log"));
      } catch (err: any) {
        console.warn("Could not fetch inventory logs from server, trying local cache fallback:", err);
        snap = await getDocsFromCache(collection(db, "inventory_log"));
      }

      const logsList: any[] = [];
      snap.forEach((d) => {
        logsList.push({ id: d.id, ...d.data() });
      });

      // Sort logs by timestamp
      logsList.sort((a, b) => {
        const timeA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp).getTime();
        const timeB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp).getTime();
        return timeA - timeB;
      });

      const headers = [
        "Transaction ID",
        "Label ID",
        "Part Number",
        "Part Name",
        "Customer Name",
        "Sub-Customer (BOI)",
        "Type (in / out / adj_in / adj_out)",
        "Sub-Type / Detail",
        "Quantity",
        "Location",
        "Shift",
        "Operator ID",
        "Operator Name",
        "Date Time (Timestamp)",
        "Printed"
      ];

      const rows = logsList.map((l) => {
        let tsStr = "";
        if (l.timestamp?.seconds) {
          tsStr = new Date(l.timestamp.seconds * 1000).toLocaleString("th-TH");
        } else if (l.timestamp) {
          tsStr = new Date(l.timestamp).toLocaleString("th-TH");
        }
        return [
          l.id,
          l.labelId || "-",
          l.partNo || "",
          l.partName || "",
          l.customer || "",
          l.subCustomer || "-",
          l.type || "",
          l.subType || "-",
          Number(l.qty) || 0,
          l.location || "-",
          l.shift || "-",
          l.operatorId || "-",
          l.operatorName || "-",
          tsStr,
          l.printed ? "YES" : "NO"
        ];
      });

      await overwriteSheetValues(sId, accessToken, "InventoryLogs", headers, rows);
      setStatusMessage({ 
        text: `ส่งออกประวัติธุรกรรมคลังสินค้าเรียบร้อย! อัปโหลดลงชีตสำเร็จจำนวน ${logsList.length} แถวธุรกรรม`, 
        type: "success" 
      });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: `ส่งออกประวัติล้มเหลว: ${err.message || err}`, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // Export local location stocks database to Google Sheets
  const handleExportLocations = async () => {
    if (!accessToken) {
      setStatusMessage({ text: "กรุณาเข้าสู่ระบบ Google ก่อนดำเนินการ", type: "error" });
      return;
    }
    const sId = extractSpreadsheetId(sheetUrl);
    if (!sId) {
      setStatusMessage({ text: "กรุณาระบุ Google Sheet URL ที่ถูกต้อง", type: "error" });
      return;
    }

    const confirmExport = window.confirm("คุณต้องการเขียนทับข้อมูลแท็บ 'Locations' ใน Google Sheets ด้วยยอดคงเหลือรายโลเคชั่นจากคลังหลักปัจจุบันใช่หรือไม่?");
    if (!confirmExport) return;

    setLoading(true);
    setStatusMessage({ text: "กำลังส่งออกข้อมูลยอดรายโลเคชั่น...", type: "info" });

    try {
      await setupRequiredSheets(accessToken, sId);

      // Fetch location stocks with fallback to cache
      let snap;
      try {
        snap = await getDocs(collection(db, "location_stocks"));
      } catch (err: any) {
        console.warn("Could not fetch location stocks from server, trying local cache fallback:", err);
        snap = await getDocsFromCache(collection(db, "location_stocks"));
      }

      const locationsList: any[] = [];
      snap.forEach((d) => {
        locationsList.push({ id: d.id, ...d.data() });
      });

      const headers = [
        "Location Stock ID",
        "Location Name",
        "Part Number",
        "Part Name",
        "Customer Name",
        "Current Quantity",
        "Last Updated"
      ];

      const rows = locationsList.map((l) => {
        let tsStr = "";
        if (l.lastUpdated?.seconds) {
          tsStr = new Date(l.lastUpdated.seconds * 1000).toLocaleString("th-TH");
        } else if (l.lastUpdated) {
          tsStr = new Date(l.lastUpdated).toLocaleString("th-TH");
        }
        return [
          l.id,
          l.locationName || "-",
          l.partNo || "",
          l.partName || "",
          l.customer || "",
          Number(l.qty) || 0,
          tsStr
        ];
      });

      await overwriteSheetValues(sId, accessToken, "Locations", headers, rows);
      setStatusMessage({ 
        text: `ส่งออกข้อมูลยอดคลังรายโลเคชั่นเรียบร้อยแล้ว! อัปโหลดสำเร็จทั้งหมด ${locationsList.length} แถวข้อมูล`, 
        type: "success" 
      });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: `ส่งออกข้อมูลโลเคชั่นล้มเหลว: ${err.message || err}`, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const isSetupActive = sheetUrl && sheetsList.length > 0;

  return (
    <div className="space-y-6 font-sans">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden text-white">
        <div className="absolute top-0 right-0 w-36 h-36 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
              <TableProperties className="w-5 h-5 stroke-[1.5]" />
            </span>
            <h1 className="text-xl font-black tracking-tight text-white">ระบบเชื่อมโยง Google Sheets</h1>
          </div>
          <p className="text-xs text-slate-400 font-medium">สลับเปลี่ยนหรือซิงค์ฐานข้อมูลคลังสินค้าของคุณกับสเปรดชีตออนไลน์ทันที</p>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Connection Info & URL Setup */}
        <div className="lg:col-span-1 space-y-6">
          {/* Step 1: Google login */}
          <div className="bg-white border border-slate-200/60 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] text-white">1</span>
              สิทธิ์การเข้าถึง (Google Account)
            </h3>

            {needsAuth ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">
                  เพื่อเริ่มใช้งาน โปรดเข้าสู่ระบบด้วยบัญชี Google ของท่าน เพื่อให้สิทธิ์แอปพลิเคชันเชื่อมต่อไปยัง Google Sheets และ Google Drive
                </p>
                <button
                  onClick={handleLogin}
                  disabled={isLoggingIn}
                  className="w-full bg-white hover:bg-slate-50 text-slate-700 font-bold border border-slate-300 rounded-2xl py-3 px-4 flex items-center justify-center gap-2.5 cursor-pointer shadow-xs active:scale-[0.98] transition text-xs disabled:opacity-50"
                >
                  {isLoggingIn ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />
                  ) : (
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4 shrink-0">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                    </svg>
                  )}
                  <span>ลงชื่อเข้าใช้งานด้วย Google</span>
                </button>
              </div>
            ) : (
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/50 space-y-3">
                <div className="flex items-center gap-3">
                  {googleUser?.photoURL ? (
                    <img src={googleUser.photoURL} alt="Avatar" className="w-10 h-10 rounded-full border border-slate-200 shrink-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white font-extrabold shrink-0">G</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">{googleUser?.displayName || "Google User"}</p>
                    <p className="text-[10px] text-slate-500 truncate">{googleUser?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-emerald-600 font-bold bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>เชื่อมโยงรับสิทธิ์ Workspace สำเร็จ</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full bg-slate-200/60 hover:bg-slate-200 text-slate-700 font-bold text-[11px] py-2 px-3 rounded-xl flex items-center justify-center gap-1 transition cursor-pointer active:scale-[0.98]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>ออกจากระบบ Google</span>
                </button>
              </div>
            )}
          </div>

          {/* Step 2: Spreadsheet URL */}
          <div className="bg-white border border-slate-200/60 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] text-white">2</span>
                ตั้งค่าฐานข้อมูลกลาง
              </h3>
              <span className="text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-200 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                Admin Central Database
              </span>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-500 block">Google Sheets URL หรือ ID ของส่วนกลาง:</label>
                {!isAuthorized && (
                  <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                    <Lock className="w-3 h-3 text-slate-400" /> Read-Only
                  </span>
                )}
              </div>
              <input
                type="text"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                disabled={!isAuthorized}
                className={`w-full border rounded-xl py-2.5 px-3 text-xs focus:outline-none font-mono ${
                  !isAuthorized 
                    ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed" 
                    : "bg-slate-50 border-slate-200 hover:border-slate-300 focus:border-slate-400 focus:bg-white text-slate-800"
                }`}
              />
              {isAuthorized ? (
                <button
                  onClick={handleSaveUrl}
                  disabled={loading}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 px-3 rounded-xl cursor-pointer active:scale-[0.98] transition disabled:opacity-50"
                >
                  {loading ? "กำลังบันทึก..." : "บันทึกและเชื่อมโยงเป็นชีตกลาง"}
                </button>
              ) : (
                <div className="bg-slate-50 text-[10px] text-slate-500 border border-slate-200/50 p-3 rounded-xl leading-relaxed">
                  🔒 คุณกำลังใช้ฐานข้อมูลกลางของ Admin (เฉพาะผู้ดูแลระบบและหัวหน้างานเท่านั้นที่มีสิทธิ์เปลี่ยน URL นี้ได้)
                </div>
              )}
            </div>

            {spreadsheetTitle && (
              <div className="bg-emerald-500/5 rounded-2xl p-4.5 border border-emerald-500/20 space-y-2">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">สเปรดชีตที่เชื่อมโยงในปัจจุบัน</p>
                <p className="text-xs font-black text-slate-800 leading-snug">{spreadsheetTitle}</p>
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {sheetsList.map((tab) => (
                    <span key={tab} className="text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-lg">
                      #{tab}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Synchronization Control Hub */}
        <div className="lg:col-span-2 space-y-6">
          {/* Global Auto-sync & Realtime Mode */}
          <div className="bg-white border border-slate-200/60 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Database className="w-4.5 h-4.5 text-emerald-500" />
                  โหมดบันทึกข้อมูลเรียลไทม์ลง Google Sheets (Real-time Sync)
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  เมื่อเปิดใช้งาน ระบบจะทำการคัดลอกและเขียนทุกธุรกรรมที่เกิดขึ้นในระบบคลัง (รับเข้า, เบิกออก, ย้ายโลเคชั่น) ลงไปยังชีตในบัญชีคุณทันทีแบบวินาทีต่อวินาที
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoSyncEnabled}
                  onChange={(e) => handleToggleAutoSync(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>

            {autoSyncEnabled && (
              <div className="bg-emerald-50 border border-emerald-200/40 text-emerald-800 rounded-2xl p-4 text-xs flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <div className="space-y-1 leading-normal font-medium">
                  <p className="font-bold text-emerald-900">เปิดใช้งานการบันทึกแบบเรียลไทม์สำเร็จ!</p>
                  <p className="text-emerald-700">
                    ธุรกรรมใหม่ๆ จะถูกส่งขึ้นฐานข้อมูลคลาวด์ Firestore พร้อมเขียนบันทึกซ้ำลงในแท็บ <strong className="font-bold">"InventoryLogs"</strong> ของ Google Sheet ทันที ช่วยป้องกันข้อมูลสูญหายและแชร์ข้อมูลกับทีมภายนอกได้เรียลไทม์
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Sync actions block */}
          <div className="bg-white border border-slate-200/60 rounded-3xl p-6 shadow-sm space-y-5">
            <h3 className="text-sm font-bold text-slate-800">ศูนย์กลางการซิงค์ข้อมูลด้วยตนเอง (Manual Data Sync Core)</h3>
            
            {statusMessage && (
              <div className={`p-4 rounded-2xl border text-xs flex items-start gap-2.5 ${
                statusMessage.type === "success" 
                  ? "bg-emerald-50 border-emerald-200/50 text-emerald-800" 
                  : statusMessage.type === "error" 
                  ? "bg-rose-50 border-rose-200/50 text-rose-800" 
                  : "bg-slate-50 border-slate-200/50 text-slate-800"
              }`}>
                {statusMessage.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                ) : statusMessage.type === "error" ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                ) : (
                  <HelpCircle className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
                )}
                <p className="font-medium leading-relaxed">{statusMessage.text}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Product Sync Section */}
              <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 space-y-4 flex flex-col justify-between">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 bg-blue-500 rounded-full"></span>
                    ฐานข้อมูลพาร์ทสินค้า (Products)
                  </h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    ใช้เพื่อเริ่มย้ายข้อมูลชุดใหม่เข้าสู่คลังสินค้า หรืออัปเดตพาร์ทสินค้าทั้งหมดจากระบบของคุณลงสเปรดชีต
                  </p>
                </div>
                
                <div className="space-y-2 pt-2">
                  {/* Export Button */}
                  <button
                    onClick={handleExportProducts}
                    disabled={loading || !accessToken}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50 active:scale-[0.98]"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>อัปโหลดสินค้า (Export Products)</span>
                  </button>

                  {/* Import Button */}
                  <button
                    onClick={handleImportProducts}
                    disabled={loading || !accessToken}
                    className="w-full bg-white hover:bg-slate-50 text-slate-700 font-bold border border-slate-200 text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50 active:scale-[0.98]"
                  >
                    <DownloadCloud className="w-4 h-4 text-emerald-600" />
                    <span>นำเข้าสินค้าเข้าระบบ (Import)</span>
                  </button>
                </div>
              </div>

              {/* Inventory Logs Section */}
              <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 space-y-4 flex flex-col justify-between">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 bg-amber-500 rounded-full"></span>
                    ประวัติธุรกรรมคลังสินค้า (Inventory Logs)
                  </h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    ส่งออกบันทึกการรับเข้า โอนออก และปรับสัดส่วนสินค้าคงคลังประเภทย้อนหลังทั้งหมดลงในชีตเพื่อทำรายงาน
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  {/* Export Logs Button */}
                  <button
                    onClick={handleExportLogs}
                    disabled={loading || !accessToken}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50 active:scale-[0.98]"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>ส่งออกประวัติธุรกรรม (Export Logs)</span>
                  </button>

                  <div className="text-[10px] text-slate-400 leading-normal text-center italic">
                    *ประวัติจะเขียนทับในแท็บ 'InventoryLogs'
                  </div>
                </div>
              </div>

              {/* Location Stocks Section */}
              <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 space-y-4 flex flex-col justify-between">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 bg-indigo-500 rounded-full"></span>
                    ยอดคลังรายโลเคชั่น (Location Stocks)
                  </h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    ส่งออกข้อมูลยอดสต๊อกคงเหลือจริงแบ่งแยกตามตลาดย่อยหรือตำแหน่งจัดเก็บทั้งหมด ลงไปยังชีตส่วนกลาง
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  {/* Export Locations Button */}
                  <button
                    onClick={handleExportLocations}
                    disabled={loading || !accessToken}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50 active:scale-[0.98]"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>ส่งออกยอดโลเคชั่น (Export Stocks)</span>
                  </button>

                  <div className="text-[10px] text-slate-400 leading-normal text-center italic">
                    *ยอดจะเขียนทับในแท็บ 'Locations'
                  </div>
                </div>
              </div>
            </div>

            {/* Warning for unlogged/unlinked */}
            {!accessToken && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4.5 text-xs text-amber-700 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <div className="space-y-1 font-medium leading-relaxed">
                  <p className="font-extrabold text-amber-800">โปรดเข้าสู่ระบบบัญชี Google</p>
                  <p className="text-[11px] text-amber-700">
                    คุณจำเป็นต้องลงชื่อเข้าใช้ Google ด้วยปุ่มด้านซ้ายเสียก่อน เพื่อปลดล็อกแผงควบคุมการซิงค์ข้อมูลสินค้าและประวัติธุรกรรมคลังสินค้าไปยังคลาวด์ชีตโดยตรง
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
