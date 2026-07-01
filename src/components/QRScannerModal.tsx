import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X, AlertCircle, RefreshCw } from "lucide-react";

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
}

export default function QRScannerModal({ isOpen, onClose, onScanSuccess }: QRScannerModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const elementId = "qr-reader-element";

  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    setScanning(true);

    // Short delay to let the modal mount and render the div element
    const timer = setTimeout(() => {
      try {
        const html5QrCode = new Html5Qrcode(elementId);
        scannerRef.current = html5QrCode;

        html5QrCode
          .start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
            },
            (decodedText) => {
              onScanSuccess(decodedText);
              handleStopScanner();
            },
            () => {
              // Ignore scanning errors (no QR code found in current frame)
            }
          )
          .catch((err) => {
            console.error("Failed to start camera scanner:", err);
            setError("ไม่สามารถเข้าใช้งานกล้องได้ หรือสิทธิ์การใช้กล้องถูกปฏิเสธ");
            setScanning(false);
          });
      } catch (err: any) {
        console.error("Scanner init error:", err);
        setError("ไม่สามารถเชื่อมต่อระบบสแกนเนอร์ได้");
        setScanning(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      handleStopScanner();
    };
  }, [isOpen]);

  const handleStopScanner = () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current = null;
          setScanning(false);
        })
        .catch((err) => {
          console.error("Failed to stop scanner:", err);
        });
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      onScanSuccess(manualInput.trim());
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col">
        <div className="bg-red-600 p-4 text-white flex justify-between items-center">
          <div className="flex items-center gap-2 font-semibold">
            <Camera className="w-5 h-5 animate-pulse" />
            <span>สแกน QR Code / บาร์โค้ด</span>
          </div>
          <button onClick={onClose} className="hover:bg-red-700 p-1.5 rounded-full transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex-1 flex flex-col items-center justify-center space-y-4">
          {error ? (
            <div className="w-full bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold">{error}</p>
                <p className="text-xs text-red-500 mt-1">
                  กรุณากรอกรหัสด้วยตนเองด้านล่าง หรือตรวจสอบสิทธิ์กล้องในเว็บเบราว์เซอร์
                </p>
              </div>
            </div>
          ) : (
            <div className="relative w-full aspect-square max-w-[280px] bg-black rounded-xl overflow-hidden flex items-center justify-center border border-gray-200">
              <div id={elementId} className="w-full h-full"></div>
              {scanning && (
                <div className="absolute inset-0 border-2 border-red-500 rounded-xl pointer-events-none animate-pulse">
                  <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500/80 shadow-[0_0_10px_#ef4444] animate-bounce"></div>
                </div>
              )}
            </div>
          )}

          <div className="w-full text-center text-xs text-gray-500 font-medium">
            {scanning ? "เล็งกล้องไปที่รูปภาพ QR Code" : "ระบบกล้องไม่ทำงาน"}
          </div>

          <div className="w-full border-t border-gray-100 pt-4 mt-2">
            <form onSubmit={submitManual} className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600 text-left">
                หรือกรอกรหัสด้วยตนเอง (Manual Input)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="พิมพ์ Part No / Label ID..."
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <button
                  type="submit"
                  className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
                >
                  ยืนยัน
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
