import React, { useState, useEffect } from "react";
import { collection, doc, writeBatch, setDoc, onSnapshot } from "firebase/firestore";
import { db, auth } from "../firebase";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { Employee } from "../types";
import { 
  Settings, Shield, Plus, Key, Layers, Compass, HelpCircle, User, 
  Phone, Image, Calendar, History, UploadCloud, Loader2, CloudLightning, CheckCircle2 
} from "lucide-react";

interface SettingsViewProps {
  currentUser: Employee | null;
}

interface LocationBatch {
  id: string;
  prefix: string;
  startIndex: number;
  endIndex: number;
  totalCreated: number;
  createdBy: string;
  createdAt: any;
}

export default function SettingsView({ currentUser }: SettingsViewProps) {
  // PIN update states
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  // Profile Edit states
  const [profileName, setProfileName] = useState(currentUser?.name || "");
  const [profileLastName, setProfileLastName] = useState(currentUser?.lastName || "");
  const [profilePhone, setProfilePhone] = useState(currentUser?.phone || "");
  const [profileAvatar, setProfileAvatar] = useState(currentUser?.avatarUrl || "");

  // Google Drive Integration states
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [isDriveUploading, setIsDriveUploading] = useState(false);
  const [driveUploadError, setDriveUploadError] = useState("");
  const [showPopupWarning, setShowPopupWarning] = useState(false);

  // Preset Avatars
  const presetAvatars = [
    { name: "Operator F", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" },
    { name: "Operator M", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80" },
    { name: "Leader F", url: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80" },
    { name: "3D Avatar", url: "https://images.unsplash.com/photo-1628157582853-a796fa650a6a?w=150&auto=format&fit=crop&q=80" },
  ];

  // Location Batch Generator
  const [locPrefix, setLocPrefix] = useState("CTC");
  const [locStart, setLocStart] = useState<number>(0);
  const [locEnd, setLocEnd] = useState<number>(12);
  const [batchLoading, setBatchLoading] = useState(false);

  // History list of location batches
  const [batches, setBatches] = useState<LocationBatch[]>([]);

  const isAuthorized = currentUser?.role === "admin" || currentUser?.role === "leader";

  // Sync profile editing fields with current logged-in user when it changes
  useEffect(() => {
    if (currentUser) {
      setProfileName(currentUser.name || "");
      setProfileLastName(currentUser.lastName || "");
      setProfilePhone(currentUser.phone || "");
      setProfileAvatar(currentUser.avatarUrl || "");
    }
  }, [currentUser]);

  // Read previously created location batches
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "location_batches"), (snapshot) => {
      const items: LocationBatch[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...d.data() } as LocationBatch);
      });
      // Sort by createdAt descending safely
      items.sort((a, b) => {
        const t1 = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
        const t2 = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
        return t2 - t1;
      });
      setBatches(items);
    });
    return unsub;
  }, []);

  const handleGoogleDriveLogin = async (): Promise<string | null> => {
    if (driveToken) return driveToken;
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/drive.file");
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      if (token) {
        setDriveToken(token);
        setShowPopupWarning(false);
        return token;
      } else {
        throw new Error("ไม่สามารถเรียกดู Access Token ของ Google Drive ได้");
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === "auth/popup-blocked" || err.message?.includes("popup-blocked") || err.message?.includes("popup")) {
        setShowPopupWarning(true);
        alert("⚠️ เบราว์เซอร์บล็อกหน้าต่างเข้าสู่ระบบ (Popup Blocked) เนื่องจากแอปทำงานอยู่ใน iFrame ของระบบ AI Studio\n\nโปรดกดปุ่มสีส้ม 'เปิดแอปในแท็บใหม่' ที่แสดงขึ้นมาใต้ปุ่มอัปโหลด เพื่อให้สามารถเชื่อมต่อ Google Drive ได้อย่างปลอดภัยและราบรื่น!");
      } else {
        alert(`เชื่อมต่อสิทธิ์ Google Drive ไม่สำเร็จ: ${err.message || err}`);
      }
      return null;
    }
  };

  const handleFileChangeAndUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการอัปโหลดภาพได้");
      return;
    }

    setIsDriveUploading(true);
    setDriveUploadError("");

    try {
      // 1. Authenticate with Google and get Access Token
      const token = await handleGoogleDriveLogin();
      if (!token) {
        setIsDriveUploading(false);
        return;
      }

      // 2. Read file to base64 format
      const reader = new FileReader();
      const fileDataPromise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64Data = (reader.result as string).split(",")[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const base64Data = await fileDataPromise;

      // 3. Setup file metadata for Google Drive
      const metadata = {
        name: `employee_avatar_${currentUser?.id || "unknown"}_${Date.now()}_${file.name}`,
        mimeType: file.type,
      };

      // 4. Construct Multipart Request Body
      const boundary = "314159265358979323846";
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody =
        delimiter +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${file.type}\r\n` +
        "Content-Transfer-Encoding: base64\r\n\r\n" +
        base64Data +
        closeDelimiter;

      // 5. Send POST multipart upload request to Google Drive API
      const uploadResponse = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        throw new Error(`Google Drive API upload failure: ${errText}`);
      }

      const fileData = await uploadResponse.json();
      const fileId = fileData.id;

      // 6. Set public reader permission for newly uploaded avatar
      try {
        const permissionResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              role: "reader",
              type: "anyone",
            }),
          }
        );
        if (!permissionResponse.ok) {
          console.warn("Unable to share file public permission", await permissionResponse.text());
        }
      } catch (permissionErr) {
        console.error("Error writing Google Drive permissions:", permissionErr);
      }

      // 7. Get standard fast image thumbnail source
      const driveThumbnailUrl = `https://drive.google.com/thumbnail?sz=w500&id=${fileId}`;
      setProfileAvatar(driveThumbnailUrl);
      alert("🎉 อัปโหลดไฟล์ภาพและนำไปฝากไว้ที่ Google Drive เรียบร้อยแล้ว! กรุณากดปุ่ม 'บันทึกข้อมูลส่วนตัว' เพื่ออัปเดตลงฐานข้อมูลพนักงาน");
    } catch (err: any) {
      console.error(err);
      setDriveUploadError(err.message || "เกิดข้อผิดพลาดในการเชื่อมโยงไฟล์");
      alert(`อัปโหลดไฟล์ไม่สำเร็จ: ${err.message || err}`);
    } finally {
      setIsDriveUploading(false);
      e.target.value = ""; // clear input
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถดำเนินการแก้ไขข้อมูลส่วนตัวได้");
      return;
    }

    try {
      await setDoc(
        doc(db, "employees", currentUser.id),
        {
          name: profileName.trim(),
          lastName: profileLastName.trim(),
          phone: profilePhone.trim(),
          avatarUrl: profileAvatar.trim(),
        },
        { merge: true }
      );
      alert("อัปเดตข้อมูลส่วนตัวในระบบสำเร็จเรียบร้อย!");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการอัปเดตข้อมูลส่วนตัว");
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (oldPin !== currentUser.pin) {
      alert("PIN เดิมไม่ถูกต้อง");
      return;
    }
    if (newPin.length !== 6) {
      alert("PIN ใหม่ต้องมีความยาว 6 หลัก");
      return;
    }
    if (newPin !== confirmPin) {
      alert("การยืนยัน PIN ใหม่ไม่ตรงกัน");
      return;
    }

    try {
      await setDoc(doc(db, "employees", currentUser.id), { pin: newPin }, { merge: true });
      alert("เปลี่ยน PIN รหัสผ่านสำเร็จ");
      // Update local state reference
      currentUser.pin = newPin;
      setOldPin("");
      setNewPin("");
      setConfirmPin("");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการแก้ PIN");
    }
  };

  // Automated Location Batch Creator
  const handleGenerateLocations = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (currentUser?.approved === false) {
      alert("สิทธิ์การใช้งานของคุณคือเข้าดูระบบได้เท่านั้น ไม่สามารถสร้างพิกัดได้");
      return;
    }
    if (!locPrefix.trim()) {
      alert("กรุณาระบุคำนำหน้า Location (Prefix)");
      return;
    }
    if (locStart < 0 || locEnd < locStart) {
      alert("ดัชนีเริ่มต้นและสิ้นสุดไม่ถูกต้อง");
      return;
    }

    setBatchLoading(true);
    try {
      const batch = writeBatch(db);
      const generatedCount = locEnd - locStart + 1;

      for (let i = locStart; i <= locEnd; i++) {
        const paddedNum = i.toString().padStart(2, "0");
        const locName = `${locPrefix.trim().toUpperCase()}-${paddedNum}`;
        const ref = doc(db, "locations", locName);
        batch.set(ref, {
          name: locName,
          created: new Date(),
        });
      }

      await batch.commit();

      // Log metadata to location_batches collection
      const batchLogRef = doc(collection(db, "location_batches"));
      await setDoc(batchLogRef, {
        prefix: locPrefix.trim().toUpperCase(),
        startIndex: locStart,
        endIndex: locEnd,
        totalCreated: generatedCount,
        createdBy: `${currentUser.name} ${currentUser.lastName}`,
        createdAt: new Date(),
      });

      alert(`สร้างพิกัดจัดเก็บสินค้า Location จำนวน ${generatedCount} พิกัด สำเร็จเรียบร้อย!`);
    } catch (err) {
      console.error("Batch Location Generation failure:", err);
      alert("ไม่สามารถบันทึกคีย์ Location ลงระบบได้");
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">ตั้งค่าระบบ (Settings)</h2>
          <p className="text-sm text-gray-500 mt-1">แก้ไขข้อมูลส่วนตัว อัปโหลดภาพไปยัง Google Drive และสร้างพิกัดอัตโนมัติ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* LEFT COLUMN: Profile & PIN Settings */}
        <div className="space-y-6">
          
          {/* Profile Details Edit Card */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <User className="w-5 h-5 text-red-600" /> แก้ไขข้อมูลส่วนตัว (Edit Personal Profile)
            </h3>
            <p className="text-xs text-gray-400">อัปเดตข้อมูล ชื่อ นามสกุล เบอร์โทรศัพท์ และอัปโหลดภาพโปรไฟล์ฝากไว้ที่ Google Drive</p>

            <form onSubmit={handleUpdateProfile} className="space-y-4">
              
              {/* Profile Avatar Preview & Select */}
              <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div className="shrink-0 relative">
                  {profileAvatar ? (
                    <img
                      src={profileAvatar}
                      alt="avatar-preview"
                      className="w-20 h-20 rounded-2xl object-cover border-2 border-white shadow-md bg-white"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-slate-200 border-2 border-white shadow-md flex items-center justify-center text-xs text-slate-400 font-bold uppercase text-center p-1">
                      ไม่มีภาพ
                    </div>
                  )}
                  {profileAvatar && profileAvatar.includes("google") && (
                    <span className="absolute -bottom-1.5 -right-1.5 bg-blue-600 text-white p-0.5 rounded-full text-[8px] font-bold shadow-xs border border-white" title="ฝากไฟล์ไว้ที่ Google Drive">
                      GD
                    </span>
                  )}
                </div>
                
                <div className="flex-1 space-y-2 text-center sm:text-left w-full">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">ภาพโปรไฟล์ของคุณ</span>
                  
                  {/* Google Drive Upload Area */}
                  <div className="space-y-1.5">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChangeAndUpload}
                      id="google-drive-uploader"
                      className="hidden"
                      disabled={isDriveUploading}
                    />
                    <label
                      htmlFor="google-drive-uploader"
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer shadow-2xs ${
                        isDriveUploading
                          ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                          : driveToken
                          ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                          : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100/70"
                      }`}
                    >
                      {isDriveUploading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>กำลังอัปโหลดไปยัง Google Drive...</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud className="w-3.5 h-3.5" />
                          <span>{driveToken ? "อัปโหลดภาพไปที่ Google Drive" : "เชื่อมต่อ & อัปโหลดภาพไป Google Drive"}</span>
                        </>
                      )}
                    </label>

                    {driveToken && (
                      <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold justify-center sm:justify-start">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>เชื่อมโยงสิทธิ์บัญชี Google Drive สำเร็จ</span>
                      </div>
                    )}

                    {driveUploadError && (
                      <p className="text-[10px] text-red-500 font-medium">{driveUploadError}</p>
                    )}

                    {showPopupWarning && (
                      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 space-y-2 text-[10px] leading-relaxed text-left">
                        <p className="font-bold text-amber-900 flex items-center gap-1">
                          <span>⚠️ เบราว์เซอร์บล็อกป๊อปอัพ (Popup Blocked)</span>
                        </p>
                        <p>
                          เนื่องจากหน้าทดสอบนี้ทำงานอยู่ภายใต้ iFrame ของ AI Studio บัญชี Google จึงอาจบล็อกป๊อปอัพเพื่อความปลอดภัย
                        </p>
                        <p className="font-bold text-amber-950">
                          วิธีแก้ไข: โปรดคลิกเปิดลิงก์ด้านล่างเพื่อรันระบบในแท็บใหม่ จะสามารถเชื่อมต่อสิทธิ์ Google Drive และอัปโหลดได้ 100%!
                        </p>
                        <a
                          href={window.location.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-1 px-3 rounded-lg transition"
                        >
                          เปิดระบบในแท็บใหม่ (Open in New Tab)
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="pt-1.5 border-t border-slate-200/50">
                    <span className="text-[9px] text-slate-400 font-medium block">หรือเลือกภาพสำเร็จรูปด่วน:</span>
                    <div className="flex flex-wrap gap-1 justify-center sm:justify-start mt-1">
                      {presetAvatars.map((avatar, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setProfileAvatar(avatar.url)}
                          className={`px-1.5 py-0.5 text-[9px] font-bold rounded-lg border transition cursor-pointer flex items-center gap-0.5 ${
                            profileAvatar === avatar.url
                              ? "bg-red-50 border-red-500 text-red-600"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <span>{avatar.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ชื่อจริง</label>
                  <input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="เช่น สมชาย"
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-xs focus:ring-1 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 block">นามสกุล</label>
                  <input
                    type="text"
                    required
                    value={profileLastName}
                    onChange={(e) => setProfileLastName(e.target.value)}
                    placeholder="เช่น ใจดี"
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-xs focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">เบอร์โทรศัพท์ (Phone Number)</label>
                  <div className="relative mt-1">
                    <Phone className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value.replace(/[^\d+-\s]/g, ""))}
                      placeholder="เช่น 089-123-4567"
                      className="w-full pl-9 pr-3 py-2 border rounded-xl text-xs focus:ring-1 focus:ring-red-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ลิงก์รูปภาพโปรไฟล์ (Image URL)</label>
                  <div className="relative mt-1">
                    <Image className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="url"
                      value={profileAvatar}
                      onChange={(e) => setProfileAvatar(e.target.value)}
                      placeholder="วาง URL รูปภาพโปรไฟล์ของคุณที่นี่ หรือใช้ปุ่มอัปโหลดด้านบน"
                      className="w-full pl-9 pr-3 py-2 border rounded-xl text-[11px] focus:ring-1 focus:ring-red-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer w-full flex items-center justify-center gap-1.5"
              >
                <User className="w-4 h-4" />
                <span>บันทึกข้อมูลส่วนตัว</span>
              </button>
            </form>
          </div>

          {/* Change Password / PIN Card */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Key className="w-5 h-5 text-red-600" /> เปลี่ยน PIN ล็อกอินส่วนตัว
            </h3>
            <p className="text-xs text-gray-400">PIN ใช้สำหรับยืนยันสแกนเข้าทำงาน และแก้ไขข้อมูลสิทธิ์สำคัญในระบบ</p>

            <form onSubmit={handleUpdatePin} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 block">กรอก PIN ปัจจุบันของคุณ</label>
                <input
                  type="password"
                  maxLength={6}
                  required
                  placeholder="• • • • • •"
                  value={oldPin}
                  onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block">กรอก PIN 6 หลักใหม่</label>
                  <input
                    type="password"
                    maxLength={6}
                    required
                    placeholder="• • • • • •"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 block">ยืนยัน PIN ใหม่</label>
                  <input
                    type="password"
                    maxLength={6}
                    required
                    placeholder="• • • • • •"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                    className="w-full mt-1 px-3 py-2 border rounded-xl text-sm text-center tracking-widest focus:ring-1 focus:ring-red-500 font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="bg-black hover:bg-gray-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer w-full flex items-center justify-center gap-1.5"
              >
                <Key className="w-4 h-4" />
                <span>อัปเดตรหัส PIN พนักงาน</span>
              </button>
            </form>
          </div>

        </div>

        {/* RIGHT COLUMN: Automated Location Batch Creator & List */}
        <div className="space-y-6">
          
          {/* Location Generator Form Card */}
          {isAuthorized ? (
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Compass className="w-5 h-5 text-red-600" /> สร้างชุดพิกัดจัดเก็บสินค้าอัตโนมัติ (Location Batch Creator)
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                เครื่องมือสร้างรหัส Location สโตร์อย่างรวดเร็ว โดยโปรแกรมจะสร้าง Location (ตั้งแต่เริ่มถึงสิ้นสุด) และจัดเก็บลงฐานข้อมูลให้อัตโนมัติ เช่น กำหนด CTC ตั้งแต่ 0 ถึง 12 จะสร้างรหัส CTC-00, CTC-01, จนถึง CTC-12 ทันที
              </p>

              <form onSubmit={handleGenerateLocations} className="space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Prefix คำนำหน้า</label>
                    <input
                      type="text"
                      required
                      placeholder="เช่น CTC, WIP, FG"
                      value={locPrefix}
                      onChange={(e) => setLocPrefix(e.target.value)}
                      className="w-full mt-1 p-2 border rounded-lg font-bold uppercase"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-600">เลขดัชนีเริ่มต้น</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={locStart}
                      onChange={(e) => setLocStart(Number(e.target.value))}
                      className="w-full mt-1 p-2 border rounded-lg text-center"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-600">เลขดัชนีสิ้นสุด</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={locEnd}
                      onChange={(e) => setLocEnd(Number(e.target.value))}
                      className="w-full mt-1 p-2 border rounded-lg text-center"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={batchLoading}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-1 transition shadow-sm cursor-pointer disabled:bg-gray-300 disabled:cursor-not-allowed w-full"
                >
                  <Plus className="w-4 h-4" />
                  <span>{batchLoading ? "กำลังทำการบันทึกข้อมูล..." : "สร้างและเขียนพิกัดลงฐานข้อมูล"}</span>
                </button>
              </form>
            </div>
          ) : (
            <div className="bg-gray-50 border p-12 rounded-2xl text-center text-gray-400 italic">
              ส่วนเครื่องมือแอดมินสำหรับสร้าง Location อัตโนมัติ (เฉพาะสิทธิ์ผู้ดูแลระบบ/หัวหน้างานขึ้นไป)
            </div>
          )}

          {/* Newly requested list of previously created batches */}
          {isAuthorized && (
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <History className="w-5 h-5 text-red-600" /> ชุดพิกัดที่สร้างไปแล้ว (Created Location Batches)
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                แสดงประวัติและรายการชุดรหัสพิกัดจัดเก็บสินค้าที่เคยถูกสร้างขึ้นอัตโนมัติในฐานข้อมูลระบบ
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50 text-slate-500 font-bold uppercase">
                      <th className="py-2.5 px-3">ชื่อ (Prefix)</th>
                      <th className="py-2.5 px-3 text-center">เริ่มต้น</th>
                      <th className="py-2.5 px-3 text-center">สิ้นสุด</th>
                      <th className="py-2.5 px-3 text-center">รวมที่สร้าง</th>
                      <th className="py-2.5 px-3">ผู้บันทึก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 italic bg-slate-50/20 rounded-b-xl">
                          ยังไม่มีประวัติการจัดสร้างในระบบคลาวด์
                        </td>
                      </tr>
                    ) : (
                      batches.map((batchItem) => (
                        <tr key={batchItem.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition font-medium">
                          <td className="py-2 px-3 font-extrabold text-red-600 uppercase font-mono">{batchItem.prefix}</td>
                          <td className="py-2 px-3 text-center font-mono text-slate-600">{batchItem.startIndex.toString().padStart(2, "0")}</td>
                          <td className="py-2 px-3 text-center font-mono text-slate-600">{batchItem.endIndex.toString().padStart(2, "0")}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="bg-slate-100 text-slate-800 font-bold font-mono text-[10px] px-2 py-0.5 rounded-full">
                              {batchItem.totalCreated} พิกัด
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-500 truncate max-w-[100px]" title={batchItem.createdBy}>
                            {batchItem.createdBy || "System"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* System info */}
      <div className="bg-gray-900 text-gray-400 p-6 rounded-2xl space-y-3.5 border border-gray-800">
        <h4 className="text-white font-bold text-sm flex items-center gap-1.5">
          <Settings className="w-4.5 h-4.5 text-red-505 animate-spin" /> ข้อมูลระบบเวอร์ชันแอปพลิเคชัน
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px] font-mono leading-relaxed">
          <div>
            <p className="text-gray-500">เวอร์ชันรหัสสินค้า:</p>
            <p className="font-bold text-white mt-0.5">v2.5.0-Stable</p>
          </div>
          <div>
            <p className="text-gray-500">อัปเดตล่าสุดเมื่อ:</p>
            <p className="font-bold text-white mt-0.5">30 มิถุนายน พ.ศ. 2569</p>
          </div>
          <div>
            <p className="text-gray-500">สภาพแวดล้อมจัดเก็บ:</p>
            <p className="font-bold text-green-400 mt-0.5">Google Cloud Firestore</p>
          </div>
          <div>
            <p className="text-gray-500">ผู้พัฒนาแอป:</p>
            <p className="font-bold text-white mt-0.5">Full-Stack AI Architect</p>
          </div>
        </div>
      </div>
    </div>
  );
}
