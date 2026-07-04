import { collection, doc, getDoc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { Product } from "../types";

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
export const getSafeProductId = (customer: string, partNo: string) => {
  const safeCust = (customer || "unknown").trim().replace(/[\/.\s#$\[\]]/g, "_");
  const safePart = (partNo || "unknown").trim().replace(/[\/.\s#$\[\]]/g, "_");
  return `${safeCust}_${safePart}`;
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

    await batch.commit();
    return { success: true };
  } catch (err: any) {
    console.error("Sync single item failed:", err);
    return { success: false, error: err.message || "เกิดข้อผิดพลาดในการเซฟข้อมูลสต๊อก" };
  }
};
