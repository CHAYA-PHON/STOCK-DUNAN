import { collection, doc, getDoc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { Product } from "../types";
import { getSafeProductId } from "./productUtils";
import { appendTransactionToGoogleSheets, getCachedAccessToken } from "./googleSheets";

export interface SyncItem {
  id: string; // unique local ID
  type: "in" | "out";
  partNo: string;
  partName: string;
  customer: string;
  subCustomer?: string | null;
  qty: number;
  labelId: string;
  location: string;
  shift: string;
  operatorId: string;
  operatorName: string;
  subType?: string;
  boxSize?: string;
  fullBoxCount?: number;
  timestamp: string; // ISO String
  status: "pending" | "syncing" | "failed";
  errorMessage?: string;
}

// Generate a safe document ID for the product master, identical to StockInView and StockOutView
export { getSafeProductId };

// Generate a safe document ID for the location stock
export const getSafeLocationStockId = (locationName: string, partNo: string) => {
  const safeLoc = (locationName || "unknown").trim().replace(/[\/.\s#$\[\]]/g, "_");
  const safePart = (partNo || "unknown").trim().replace(/[\/.\s#$\[\]]/g, "_");
  return `${safeLoc}_${safePart}`;
};

const STORAGE_KEY = "wsm_local_sync_queue";

// Get all items in queue
export const getSyncQueue = (): SyncItem[] => {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch (err) {
    console.error("Failed to parse sync queue:", err);
    return [];
  }
};

// Save items in queue
export const saveSyncQueue = (queue: SyncItem[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
};

// Clear all items in queue
export const clearSyncQueue = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
};

// Add items to queue
export const addToSyncQueue = (type: "in" | "out", items: Omit<SyncItem, "id" | "status" | "timestamp" | "type">[]): SyncItem[] => {
  const current = getSyncQueue();
  const newItems: SyncItem[] = items.map((item) => ({
    ...item,
    id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    status: "pending",
    timestamp: new Date().toISOString(),
  }));
  const updated = [...current, ...newItems];
  saveSyncQueue(updated);
  return updated;
};

// Sync a single transaction item to Firestore
export const syncSingleItem = async (item: SyncItem): Promise<{ success: boolean; error?: string }> => {
  try {
    const trimmedLabel = item.labelId ? item.labelId.trim() : "";

    // 1. Check for duplicates if a Label ID exists
    if (trimmedLabel !== "") {
      const q = query(
        collection(db, "inventory_log"),
        where("labelId", "==", trimmedLabel),
        where("type", "==", item.type)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        return {
          success: false,
          error: `ตรวจพบเลขลาเบลซ้ำในระบบ: ${trimmedLabel}`,
        };
      }
    }

    const batch = writeBatch(db);

    // 2. Create the transaction log entry in inventory_log
    const logRef = doc(collection(db, "inventory_log"));
    batch.set(logRef, {
      labelId: trimmedLabel,
      partNo: item.partNo,
      partName: item.partName,
      customer: item.customer,
      subCustomer: item.subCustomer || null,
      type: item.type,
      subType: item.subType || (item.type === "in" ? "สแกนรับเข้า" : "สแกนโอนออก"),
      qty: item.qty,
      location: item.location,
      shift: item.shift,
      operatorId: item.operatorId,
      operatorName: item.operatorName,
      boxSize: item.boxSize || null,
      fullBoxCount: item.fullBoxCount || null,
      timestamp: new Date(item.timestamp),
    });

    // 3. Update master stock in product collection
    const prodId = getSafeProductId(item.customer, item.partNo);
    const prodRef = doc(db, "products", prodId);
    const prodSnap = await getDoc(prodRef);

    if (prodSnap.exists()) {
      const prodData = prodSnap.data() as Product;
      if (item.type === "in") {
        const currentReceived = prodData.receivedTotal || 0;
        const currentStock = prodData.stock || 0;
        batch.update(prodRef, {
          receivedTotal: currentReceived + item.qty,
          stock: currentStock + item.qty,
        });
      } else {
        const currentShipped = prodData.shippedTotal || 0;
        const currentStock = prodData.stock || 0;
        batch.update(prodRef, {
          shippedTotal: currentShipped + item.qty,
          stock: Math.max(0, currentStock - item.qty),
        });
      }
    }

    // 4. Update location stock in location_stocks collection
    if (item.location) {
      const locStockId = getSafeLocationStockId(item.location, item.partNo);
      const locStockRef = doc(db, "location_stocks", locStockId);
      const locStockSnap = await getDoc(locStockRef);

      if (item.type === "in") {
        if (locStockSnap.exists()) {
          const currentQty = locStockSnap.data().qty || 0;
          batch.update(locStockRef, {
            qty: currentQty + item.qty,
            lastUpdated: new Date()
          });
        } else {
          batch.set(locStockRef, {
            id: locStockId,
            locationName: item.location.trim(),
            partNo: item.partNo,
            partName: item.partName,
            customer: item.customer,
            qty: item.qty,
            lastUpdated: new Date()
          });
        }
      } else { // type === "out"
        if (locStockSnap.exists()) {
          const currentQty = locStockSnap.data().qty || 0;
          const newQty = Math.max(0, currentQty - item.qty);
          batch.update(locStockRef, {
            qty: newQty,
            lastUpdated: new Date()
          });
        } else {
          batch.set(locStockRef, {
            id: locStockId,
            locationName: item.location.trim(),
            partNo: item.partNo,
            partName: item.partName,
            customer: item.customer,
            qty: 0,
            lastUpdated: new Date()
          });
        }
      }
    }

    await batch.commit();
    
    // Auto-sync to Google Sheets in background if enabled
    try {
      appendTransactionToGoogleSheets({
        ...item,
        // Ensure id is present for sheet row mapping
        id: item.id || `sync_${Date.now()}`
      }).catch(err => console.error("Sheets background auto-sync failed:", err));
    } catch (e) {
      console.error("Sheets auto-sync trigger err:", e);
    }

    return { success: true };
  } catch (err: any) {
    console.error("Sync single item failed:", err);
    
    // Check if we can fall back and sync directly to Google Sheets (e.g. under Quota Exceeded or fully offline)
    const errMsg = err?.message || String(err);
    const isQuotaExceeded = errMsg.includes("Quota") || errMsg.includes("quota") || err?.code === "resource-exhausted";
    const isOffline = errMsg.includes("offline") || errMsg.includes("network") || err?.code === "unavailable" || localStorage.getItem("wsm_sandbox_mode") === "true";
    
    const spreadsheetId = typeof window !== "undefined" ? localStorage.getItem("wsm_sheets_id") : null;
    const accessToken = getCachedAccessToken();
    
    if ((isQuotaExceeded || isOffline) && spreadsheetId && accessToken) {
      console.warn("Firestore write blocked or offline. Attempting direct Google Sheets sync fallback...");
      try {
        await appendTransactionToGoogleSheets({
          ...item,
          id: item.id || `sync_${Date.now()}`
        }, true); // force sync to Sheets bypassing auto-sync check
        
        console.log("Direct Google Sheets sync fallback succeeded for item:", item.id);
        return { success: true };
      } catch (sheetsErr: any) {
        console.error("Direct Sheets fallback sync failed:", sheetsErr);
        return { 
          success: false, 
          error: `Firestore Error: ${errMsg}. Direct Sheets Sync Error: ${sheetsErr.message || sheetsErr}` 
        };
      }
    }
    
    return { success: false, error: err.message || "เกิดข้อผิดพลาดในการเซฟข้อมูลสต๊อก" };
  }
};

// Reconcile and fix any discrepancies in product master stocks based on inventory_log transactions
export const reconcileProductMasterStocks = async (): Promise<{ success: boolean; updatedCount: number }> => {
  try {
    // 1. Get all products from DB
    const prodCol = collection(db, "products");
    const prodSnap = await getDocs(prodCol);
    const productsMap: { [id: string]: Product } = {};
    prodSnap.forEach((doc) => {
      productsMap[doc.id] = { id: doc.id, ...doc.data() } as Product;
    });

    // 2. Get all transaction logs from inventory_log
    const logCol = collection(db, "inventory_log");
    const logSnap = await getDocs(logCol);

    // Calculate received and shipped totals for each product from the logs
    const calculated: { [prodId: string]: { received: number; shipped: number } } = {};

    logSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const customer = data.customer;
      const partNo = data.partNo;
      const type = data.type; // "in" or "out"
      const qty = Number(data.qty) || 0;

      if (!customer || !partNo) return;

      const prodId = getSafeProductId(customer, partNo);
      if (!calculated[prodId]) {
        calculated[prodId] = { received: 0, shipped: 0 };
      }

      if (type === "in") {
        calculated[prodId].received += qty;
      } else if (type === "out") {
        calculated[prodId].shipped += qty;
      }
    });

    // 3. Compare and update products where discrepancies exist
    let updatedCount = 0;
    let batch = writeBatch(db);
    let batchSize = 0;

    for (const prodId of Object.keys(productsMap)) {
      const prod = productsMap[prodId];
      const calc = calculated[prodId] || { received: 0, shipped: 0 };

      const currentReceived = prod.receivedTotal || 0;
      const currentShipped = prod.shippedTotal || 0;
      const expectedStock = (prod.openingStock || 0) + calc.received - calc.shipped;
      const currentStock = prod.stock ?? ((prod.openingStock || 0) + currentReceived - currentShipped);

      if (
        currentReceived !== calc.received ||
        currentShipped !== calc.shipped ||
        currentStock !== expectedStock
      ) {
        const prodRef = doc(db, "products", prodId);
        batch.update(prodRef, {
          receivedTotal: calc.received,
          shippedTotal: calc.shipped,
          stock: expectedStock,
        });
        updatedCount++;
        batchSize++;

        if (batchSize >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          batchSize = 0;
        }
      }
    }

    if (batchSize > 0) {
      await batch.commit();
    }

    console.log(`Reconciliation complete. Updated ${updatedCount} products.`);
    return { success: true, updatedCount };
  } catch (err) {
    console.error("Reconciliation failed:", err);
    return { success: false, updatedCount: 0 };
  }
};

