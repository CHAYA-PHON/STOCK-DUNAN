import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../firebase";

const provider = new GoogleAuthProvider();
// Add required Google Workspace scopes
provider.addScope("https://www.googleapis.com/auth/spreadsheets");
provider.addScope("https://www.googleapis.com/auth/drive");

let cachedAccessToken: string | null = null;
let isSigningIn = false;

// Initialize Google OAuth state listener
export const initSheetsAuth = (
  onSuccess?: (user: User, token: string) => void,
  onFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // Check if we have a token stored in session state (in-memory)
      if (cachedAccessToken) {
        if (onSuccess) onSuccess(user, cachedAccessToken);
      } else {
        // If not, we might need a re-login to grab a fresh token
        if (onFailure) onFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onFailure) onFailure();
    }
  });
};

// Sign in using Google Auth and obtain fresh Access Token
export const sheetsSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get Google OAuth access token from login.");
    }
    cachedAccessToken = credential.accessToken;
    // Persist sheets settings if not already
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Google sheets login error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getCachedAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const sheetsLogout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// Spreadsheet ID Extractor from arbitrary URL
export const extractSpreadsheetId = (url: string): string | null => {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : url.trim();
};

// Helper for making standard Google Sheets API requests
async function makeSheetsRequest(
  endpoint: string,
  method: string = "GET",
  body: any = null,
  token: string
) {
  const options: any = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${endpoint}`, options);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Sheets API Error (${response.status}): ${errText}`);
  }
  return await response.json();
}

// 1. Get spreadsheet metadata and tabs list
export const getSpreadsheetMetadata = async (spreadsheetId: string, token: string) => {
  return makeSheetsRequest(spreadsheetId, "GET", null, token);
};

// 2. Add multiple sheets/tabs at once if they don't exist
export const ensureSheetsExist = async (spreadsheetId: string, token: string, sheetTitles: string[]) => {
  const metadata = await getSpreadsheetMetadata(spreadsheetId, token);
  const existingSheets = metadata.sheets?.map((s: any) => s.properties.title) || [];
  
  const requests: any[] = [];
  for (const title of sheetTitles) {
    if (!existingSheets.includes(title)) {
      requests.push({
        addSheet: {
          properties: {
            title,
            gridProperties: {
              frozenRowCount: 1, // Freeze header row for professional look
            },
          },
        },
      });
    }
  }

  if (requests.length > 0) {
    await makeSheetsRequest(`${spreadsheetId}:batchUpdate`, "POST", { requests }, token);
  }
  return true;
};

// 3. Set or Overwrite a sheet's content (Headers + Values)
export const overwriteSheetValues = async (
  spreadsheetId: string,
  token: string,
  sheetName: string,
  headers: string[],
  rows: any[][]
) => {
  // First clear the existing sheet values to prevent leftovers
  await makeSheetsRequest(`${spreadsheetId}/values/${sheetName}!A:Z:clear`, "POST", {}, token);

  const data = [headers, ...rows];
  const body = {
    valueInputOption: "USER_ENTERED",
    data: [
      {
        range: `${sheetName}!A1`,
        values: data,
      },
    ],
  };

  await makeSheetsRequest(`${spreadsheetId}/values:batchUpdate`, "POST", body, token);
  return true;
};

// 4. Append a single or multiple rows to a sheet
export const appendSheetValues = async (
  spreadsheetId: string,
  token: string,
  sheetName: string,
  rows: any[][]
) => {
  const body = {
    values: rows,
  };
  await makeSheetsRequest(
    `${spreadsheetId}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`,
    "POST",
    body,
    token
  );
  return true;
};

// 5. Read all values from a sheet (excluding header row)
export const readSheetValues = async (
  spreadsheetId: string,
  token: string,
  sheetName: string
): Promise<any[][]> => {
  try {
    const result = await makeSheetsRequest(`${spreadsheetId}/values/${sheetName}!A:Z`, "GET", null, token);
    const values = result.values || [];
    if (values.length <= 1) return []; // Only headers or empty
    return values.slice(1); // Exclude header row
  } catch (err) {
    console.warn(`Sheet "${sheetName}" could not be read or does not exist:`, err);
    return [];
  }
};

// 6. Automatically append a single transaction item to Google Sheets (Real-time auto-sync)
export const appendTransactionToGoogleSheets = async (item: any, force: boolean = false) => {
  try {
    const isEnabled = typeof window !== "undefined" && (localStorage.getItem("wsm_sheets_auto_sync") === "true" || force);
    if (!isEnabled) return;

    const spreadsheetId = typeof window !== "undefined" ? localStorage.getItem("wsm_sheets_id") : null;
    const accessToken = getCachedAccessToken();

    if (!spreadsheetId || !accessToken) {
      console.warn("Google Sheets Auto-Sync is active but Spreadsheet ID or Google Access Token is missing.");
      return;
    }

    let tsStr = new Date().toLocaleString("th-TH");
    if (item.timestamp) {
      tsStr = new Date(item.timestamp).toLocaleString("th-TH");
    }

    const row = [
      item.id || `sync_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      item.labelId || "-",
      item.partNo || "",
      item.partName || "",
      item.customer || "",
      item.subCustomer || "-",
      item.type || "",
      item.subType || (item.type === "in" ? "สแกนรับเข้า" : "สแกนโอนออก"),
      Number(item.qty) || 0,
      item.location || "-",
      item.shift || "-",
      item.operatorId || "-",
      item.operatorName || "-",
      tsStr,
      item.printed ? "YES" : "NO"
    ];

    await appendSheetValues(spreadsheetId, accessToken, "InventoryLogs", [row]);
    console.log("Auto-synced transaction to Google Sheets:", item.id);
  } catch (err) {
    console.error("Google Sheets Auto-Sync Failed:", err);
  }
};

