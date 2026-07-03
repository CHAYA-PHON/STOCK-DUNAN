// Utility functions for Box Size options and BOI customer groups

export const BOX_SIZE_OPTIONS = [
  "เขียว S",
  "เขียว M",
  "เขียว L",
  "เขียว XL",
  "ฟ้า S",
  "ฟ้า M",
  "ฟ้า L",
  "ฟ้า XL",
  "ฟ้า XXL",
  "น้ำเงิน S",
  "น้ำเงิน M",
  "น้ำเงิน L",
  "เทา",
  "กล่องกระดาษ",
  "ตู้",
  "ตะกร้า",
  "ลังไม้",
  "กระบอก",
  "ถุง"
];

export interface BOICustomer {
  id?: string;
  name: string;
  group: "CTC" | "อื่นๆ";
}

export const DEFAULT_BOI_CUSTOMERS: BOICustomer[] = [
  { name: "SAMBO", group: "CTC" },
  { name: "AMAKASAKI", group: "CTC" },
  { name: "SCT", group: "CTC" },
  { name: "IMP", group: "CTC" },
  { name: "IL JIN", group: "CTC" },
  { name: "SMAT", group: "อื่นๆ" }
];

export function getCustomerGroup(customerName: string): string {
  const name = (customerName || "").trim().toUpperCase();
  if (!name) return "Other";
  
  // DIT group
  const ditCustomers = [
    "GOODMAN", 
    "DIT", 
    "DAIKIN MEXICO", 
    "DTL", 
    "DCI", 
    "DAIKIN MALAYSIA", 
    "DAT", 
    "SCI", 
    "DAIKIN"
  ];
  if (ditCustomers.some(c => name === c || name.includes(c) || c.includes(name))) {
    return "DIT";
  }
  
  // CTC group
  const ctcCustomers = ["CTC", "SAMBO", "AMAKASAKI", "SCT", "IMP", "IL JIN"];
  // Note: if name is BOI itself, it is BOI.
  if (name === "BOI") return "CTC"; // BOI belongs to CTC group or we check specifically
  if (ctcCustomers.some(c => name === c || name.includes(c) || c.includes(name))) {
    return "CTC";
  }
  
  // GMT group
  const gmtCustomers = ["ATLANTIC", "GMT", "PSL", "HPT"];
  if (gmtCustomers.some(c => name === c || name.includes(c) || c.includes(name))) {
    return "GMT";
  }
  
  // MCP group
  const mcpCustomers = ["MCP"];
  if (mcpCustomers.some(c => name === c || name.includes(c) || c.includes(name))) {
    return "MCP";
  }
  
  // Default is "Other"
  return "Other";
}

export function getRecommendedBoxSizes(customerName: string): string[] {
  const group = getCustomerGroup(customerName);
  const name = (customerName || "").trim().toUpperCase();

  const list: string[] = [];
  
  // Always include "All" box sizes
  // "กล่องกระดาษ", "ตะกร้า", "ถุง" are All
  const allSizes = ["กล่องกระดาษ", "ตะกร้า", "ถุง"];
  
  if (group === "DIT") {
    list.push("เขียว S", "เขียว M", "เขียว L", "เขียว XL");
    if (name.includes("GOODMAN")) {
      list.push("กระบอก");
    }
  } else if (group === "GMT") {
    list.push("ฟ้า S", "ฟ้า M", "ฟ้า L", "ฟ้า XL", "ฟ้า XXL", "ตู้");
  } else if (group === "CTC") {
    list.push("ฟ้า XL", "น้ำเงิน S", "น้ำเงิน M", "น้ำเงิน L");
  } else if (group === "MCP") {
    list.push("น้ำเงิน S", "น้ำเงิน M", "น้ำเงิน L");
  } else {
    // Other
    list.push("ฟ้า XL", "น้ำเงิน S", "น้ำเงิน M", "น้ำเงิน L", "ตู้", "ลังไม้");
    if (name.includes("LG")) {
      list.push("เทา");
    }
  }
  
  // Merge allSizes and remove duplicates
  return Array.from(new Set([...list, ...allSizes]));
}
