import { collection, getDocs, doc, writeBatch, setDoc, query, limit } from "firebase/firestore";
import { db } from "../firebase";

export async function seedDatabaseIfEmpty() {
  try {
    const empRef = collection(db, "employees");
    const empSnap = await getDocs(query(empRef, limit(1)));

    if (!empSnap.empty) {
      console.log("Database already has data. Skipping seed.");
      return;
    }

    console.log("Database is empty. Starting seed process...");
    const batch = writeBatch(db);

    // 1. Seed Employees
    const employees = [
      {
        id: "00000001",
        pin: "123456",
        name: "สมเกียรติ",
        lastName: "ยิ่งคุณ",
        position: "Manager",
        jobPosition: "ผู้ดูแลระบบอาวุโส",
        department: "สโตร์กลาง",
        status: "Active" as const,
        role: "admin",
        shiftWork: "DAY" as const,
      },
      {
        id: "00000002",
        pin: "222222",
        name: "ธนา",
        lastName: "มั่งมี",
        position: "Leader",
        jobPosition: "หัวหน้าแผนกผลิต",
        department: "ฝ่ายผลิต",
        status: "Active" as const,
        role: "leader",
        shiftWork: "DAY" as const,
      },
      {
        id: "00000003",
        pin: "333333",
        name: "วิชัย",
        lastName: "สระพัง",
        position: "Store Keeper",
        jobPosition: "เจ้าหน้าที่คลังสินค้า FG",
        department: "สโตร์ FG",
        status: "Active" as const,
        role: "user_store",
        shiftWork: "DAY" as const,
      },
      {
        id: "00000004",
        pin: "444444",
        name: "พงษ์",
        lastName: "มีลาภ",
        position: "Operator",
        jobPosition: "ฝ่ายปฏิบัติการผลิต",
        department: "ฝ่ายผลิต",
        status: "Active" as const,
        role: "user_production",
        shiftWork: "NIGHT" as const,
      }
    ];

    employees.forEach((emp) => {
      const ref = doc(db, "employees", emp.id);
      batch.set(ref, emp);
    });

    // 2. Seed Locations
    const locations = ["ลานโอน-00", "CTC-01", "CTC-02", "CTC-03", "WIP-01", "WIP-02", "FG-01", "FG-02"];
    locations.forEach((loc) => {
      const ref = doc(db, "locations", loc);
      batch.set(ref, { name: loc, created: new Date() });
    });

    // 3. Seed Products (Composite ID: Customer-PartNo)
    const products = [
      {
        id: "HONDA-HN-1234",
        sapNo: "SAP-H01",
        zone: "Zone A",
        customer: "HONDA",
        partNo: "HN-1234",
        partName: "Front Bumper Mount Bracket",
        fullBox: 24,
        packageType: "Plastic Tray",
        openingStock: 120,
        receivedTotal: 0,
        shippedTotal: 0,
        stock: 120,
      },
      {
        id: "TOYOTA-TY-5678",
        sapNo: "SAP-T02",
        zone: "Zone B",
        customer: "TOYOTA",
        partNo: "TY-5678",
        partName: "Side Mirror Cover LH",
        fullBox: 50,
        packageType: "Cardboard Box",
        openingStock: 250,
        receivedTotal: 0,
        shippedTotal: 0,
        stock: 250,
      },
      {
        id: "NISSAN-NS-9999",
        sapNo: "SAP-N03",
        zone: "Zone C",
        customer: "NISSAN",
        partNo: "NS-9999",
        partName: "Radiator Grill Spacer",
        fullBox: 10,
        packageType: "Bubble Wrap Container",
        openingStock: 50,
        receivedTotal: 0,
        shippedTotal: 0,
        stock: 50,
      }
    ];

    products.forEach((prod) => {
      const ref = doc(db, "products", prod.id);
      batch.set(ref, prod);
    });

    // 4. Seed metadata configs
    const configRef = doc(db, "settings", "general");
    batch.set(configRef, {
      departments: ["ฝ่ายผลิต", "สโตร์กลาง", "สโตร์ FG", "สโตร์ WIP", "Planning", "เซลล์"],
      roles: ["admin", "leader", "user_production", "user_store", "user_planning", "sales"],
      inTypes: ["รับเข้าจากฝ่ายผลิต", "รับเข้าคืนซ่อม (Rework)", "รับคืนจากแผนกประกอบ", "โอนย้ายภายใน"],
      outTypes: ["ส่งสโตร์ FG", "เบิกงาน Rework", "เบิกงานจาก TN", "เบิกเพื่อประกอบ", "จัดส่งลูกค้า", "ทำลายสินค้า (Scrap)"]
    });

    await batch.commit();
    console.log("Database seeded successfully with default values!");
  } catch (err) {
    console.error("Error seeding database:", err);
  }
}
