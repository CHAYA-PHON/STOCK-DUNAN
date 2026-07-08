import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // API endpoint for AI stock analysis
  app.post("/api/ai/insights", async (req, res) => {
    try {
      const { products, stats } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ 
          error: "API Key สำหรับ Gemini ไม่ได้ตั้งค่าในระบบคลาวด์ กรุณาตั้งค่าผ่าน Settings > Secrets หรือไฟล์ .env" 
        });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const systemInstruction = 
        "คุณคือ 'ผู้เชี่ยวชาญด้านคลังสินค้าและซัพพลายเชน AI ของ WSM-DUNAN' (WSM-DUNAN AI Inventory Analyst) " +
        "หน้าที่ของคุณคือวิเคราะห์ข้อมูลสต็อกสินค้า รายการธุรกรรมรับเข้า-โอนออก และความต้องการของลูกค้า " +
        "แล้วรายงานข้อสรุปในระดับมืออาชีพ ชัดเจน เข้าใจง่าย และให้คำแนะนำเชิงกลยุทธ์ที่เป็นประโยชน์ " +
        "กรุณาตอบเป็นภาษาไทย โดยใช้ Markdown จัดรูปแบบให้สวยงาม (ใช้หัวข้อ ตาราง หรือ Bullet point เพื่อเพิ่มความน่าอ่าน) " +
        "หลีกเลี่ยงการใช้คำศัพท์เทคนิคที่เข้าใจยากเกินไป ให้เน้นผลลัพธ์ที่เป็นประโยชน์จริงต่อการวางแผนการผลิตและการจัดการสต็อก " +
        "เมื่อพูดถึงปริมาณสินค้า ให้ระบุหน่วยเป็น 'ชิ้น' หรือ 'PCS' เสมอ";

      const prompt = `
วิเคราะห์ข้อมูลสต็อกคลังสินค้า WSM-DUNAN ต่อไปนี้:

1. ข้อมูลสรุปทั่วไป:
   - จำนวนสินค้าคงคลังรวมทั้งหมดในคลังตอนนี้: ${stats.totalCurrentStock} ชิ้น
   - ยอดรับเข้าวันนี้ (Stock In): ${stats.dailyIn} ชิ้น
   - ยอดโอนออกวันนี้ (Stock Out): ${stats.dailyOut} ชิ้น
   - ยอดรับเข้าสะสมประจำเดือนนี้: ${stats.monthlyIn} ชิ้น
   - ยอดโอนออกสะสมประจำเดือนนี้: ${stats.monthlyOut} ชิ้น
   - เดือนที่ประมวลผล: เดือนที่ ${stats.selectedMonth} ค.ศ. ${stats.selectedYear}

2. ข้อมูลสินค้าคงคลังแยกตามลูกค้ารายใหญ่ (Top Customers/Brands Stock):
${JSON.stringify(stats.customerStocks, null, 2)}

3. ข้อมูลสินค้าและระดับสต็อกในระบบ (Products list & stock levels):
${JSON.stringify(products.map((p: any) => ({ 
  partNo: p.partNo, 
  partName: p.partName,
  customer: p.customer, 
  stock: p.stock ?? 0,
  fullBox: p.fullBox ?? 0
})), null, 2)}

กรุณาสรุปและวิเคราะห์ผลลัพธ์โดยแบ่งเป็น 4 หัวข้อสำคัญดังนี้:
1. **บทสรุปและสุขภาพคลังสินค้าในปัจจุบัน (Executive Summary & Health Check)**: วิเคราะห์ภาพรวมสุขภาพคลังสินค้า ยอดรวมสมดุลหรือไม่ ลูกค้าแบรนด์ไหนครองสัดส่วนคลังสูงสุดและมีความเสี่ยงหรือไม่
2. **สินค้าหรือแบรนด์ที่ต้องการการควบคุมเข้มงวด (Inventory Control & Target Items)**: สต็อกสินค้าตัวใดมีระดับสูงหรือต่ำเกินไปที่ควรระวัง
3. **แนวโน้มการโอนออกและความสามารถในการหมุนเวียนคลังสินค้า (Inventory Movement Trends)**: วิเคราะห์แนวโน้มการเข้า-ออกของสินค้าในรอบเดือน
4. **คำแนะนำเชิงกลยุทธ์จาก AI (Actionable AI Recommendations)**: คำแนะนำระดับปฏิบัติการเพื่อเพิ่มประสิทธิภาพคลังสินค้า เช่น การจัดสรรพื้นที่ หรือรอบการหมุนเวียนของแต่ละแบรนด์
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      res.json({ insights: response.text });
    } catch (error: any) {
      console.error("AI Insights Error:", error);
      res.status(500).json({ error: error.message || "เกิดข้อผิดพลาดในการประมวลผลด้วย AI" });
    }
  });

  // API endpoint for AI stock discrepancy prediction (losing stock / excess stock)
  app.post("/api/ai/predict-discrepancy", async (req, res) => {
    try {
      const { partNo, partName, customer, systemStock, countedQty, fullBox, recentTransactions } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ 
          error: "API Key สำหรับ Gemini ไม่ได้ตั้งค่าในระบบคลาวด์ กรุณาตั้งค่าผ่าน Settings > Secrets หรือไฟล์ .env" 
        });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const difference = countedQty - systemStock;
      const discrepancyType = difference < 0 ? "งานลืมโอนออก (ลืมบันทึกตัดสต๊อก / Dispatched without record)" : "งานเกินสต๊อก (สต๊อกในคลังมากกว่าระบบ / Excess Stock)";

      const systemInstruction = 
        "คุณคือ 'ผู้เชี่ยวชาญด้านคลังสินค้าและซัพพลายเชน AI ของ WSM-DUNAN' (WSM-DUNAN AI Stock Auditor) " +
        "หน้าที่ของคุณคือคาดการณ์และวิเคราะห์สาเหตุเชิงลึกเมื่อพบผลต่างระหว่างสต๊อกในระบบและยอดนับจริงในคลัง " +
        "โดยเน้นกรณีหลักคือ 'งานลืมโอนออก' (นับจริงน้อยกว่าระบบ) และ 'งานเกินสต๊อก' (นับจริงมากกว่าระบบ) " +
        "วิเคราะห์ประวัติธุรกรรมเพื่อชี้จุดที่น่าสงสัย คาดการณ์เปอร์เซ็นต์ความน่าจะเป็น และเสนอแนะจุดตรวจสอบทางกายภาพจริง " +
        "กรุณาตอบเป็นภาษาไทย โดยใช้ Markdown จัดรูปแบบให้สวยงาม (ใช้หัวข้อ ตาราง หรือ Bullet point เพื่อเพิ่มความน่าอ่าน) " +
        "ระบุหน่วยสินค้าเป็น 'ชิ้น' หรือ 'PCS' เสมอ";

      const prompt = `
กรุณาทำหน้าที่เป็น AI ผู้ตรวจสอบคลังสินค้าอัจฉริยะ (AI Stock Discrepancy Auditor) เพื่อวิเคราะห์ผลต่างสต๊อกของพาร์ทนี้:

ข้อมูลเบื้องต้นของสินค้า:
- รหัสสินค้า (Part No): ${partNo}
- ชื่อสินค้า (Part Name): ${partName}
- ลูกค้า (Customer): ${customer}
- สต๊อกในระบบปัจจุบัน (System Stock): ${systemStock} ชิ้น
- จำนวนที่พนักงานตรวจนับได้จริง (Counted Physical Qty): ${countedQty} ชิ้น
- ผลต่างสต๊อก (Discrepancy): ${difference >= 0 ? "+" : ""}${difference} ชิ้น
- ขนาดกล่องบรรจุเต็ม (Full Box Capacity): ${fullBox || "ไม่ได้ระบุ"} ชิ้น/กล่อง
- ทิศทางวิเคราะห์คาดการณ์หลัก: ${discrepancyType}

ประวัติธุรกรรมล่าสุด 15 รายการของสินค้าตัวนี้ในระบบ (Newest to Oldest):
${JSON.stringify((recentTransactions || []).map((t: any) => ({
  date: t.timestamp,
  type: t.type === "in" ? "รับเข้า (Stock In)" : t.type === "out" ? "โอนออก (Stock Out)" : t.type === "adj_in" ? "ปรับเข้า (Adjust In)" : t.type === "adj_out" ? "ปรับออก (Adjust Out)" : t.type,
  subType: t.subType,
  qty: t.qty,
  operator: t.operatorName,
  shift: t.shift
})), null, 2)}

กรุณาวิเคราะห์และรายงานผลโดยแบ่งออกเป็น 4 หัวข้อสำคัญอย่างละเอียด:
1. **การประเมินเปอร์เซ็นต์และคาดการณ์สาเหตุหลัก (Discrepancy Cause & Probability Evaluation)**:
   - ประเมินความน่าจะเป็น (%) ของสาเหตุหลัก เช่น:
     - "งานลืมโอนออก (Forgot to Stock Out)" (หากนับจริงน้อยกว่าระบบ) หรือ
     - "งานเกินสต๊อก/ลืมบันทึกรับเข้า/นับซ้ำซ้อน" (หากนับจริงมากกว่าระบบ)
     - หรือความผิดพลาดในปริมาณต่อกล่อง (เช่น คลาดเคลื่อนเป็นทวีคูณของขนาดกล่องเต็ม ${fullBox || "กล่อง"} ชิ้น)
2. **การจับผิดและข้อสังเกตจากประวัติธุรกรรม (Anomaly Detection in Transaction History)**:
   - ตรวจสอบประวัติธุรกรรมล่าสุดที่ให้มาอย่างละเอียด มีจุดที่น่าสงสัยหรือไม่? เช่น มีการบันทึกซ้ำซ้อนในวันเดียวกัน หรือไม่มีการบันทึกโอนออกในช่วงวันหยุด หรือมียอดคลาดเคลื่อนที่ตรงกับจำนวนในประวัติรายการใดรายการหนึ่งหรือไม่
3. **แนวทางการตรวจสอบทางกายภาพ (Actionable Physical Verification Guide)**:
   - แนะนำขั้นตอนที่พนักงานควรเดินไปเช็คที่คลังจริงๆ (เช่น ไปตรวจดูบิลจัดของ, ตรวจสอบโซนวางสินค้าที่อาจปะปนกับลูกค้ารายอื่น, หรือตรวจสอบตามรอบกะการทำงาน DAY/NIGHT)
4. **แนวทางแก้ไขและมาตรการป้องกันเชิงรุก (App Correction & Prevention Steps)**:
   - แนะนำวิธีลงรายการปรับปรุงยอดในระบบอย่างถูกต้อง และวิธีหลีกเลี่ยงไม่ให้เกิดซ้ำอีก
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.75,
        },
      });

      res.json({ analysis: response.text });
    } catch (error: any) {
      console.error("AI Discrepancy Predictor Error:", error);
      res.status(500).json({ error: error.message || "เกิดข้อผิดพลาดในการประมวลผลคาดการณ์ด้วย AI" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
