// src/QrScanner.js
import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const QrScanner = forwardRef(({ onScanSuccess, onScanError, qrbox = 250, fps = 10 }, ref) => {
  const qrCodeRegionId = "qr-code-region";
  const html5QrcodeScannerRef = useRef(null);
  const isScannerRunningRef = useRef(false);
  const [isScanning, setIsScanning] = useState(false);

  useImperativeHandle(ref, () => ({
    startScan,
    stopScan,
    isScanning: () => isScannerRunningRef.current,
  }));

  const startScan = async () => {
    if (!html5QrcodeScannerRef.current) {
      html5QrcodeScannerRef.current = new Html5Qrcode(qrCodeRegionId);
    }

    try {
await html5QrcodeScannerRef.current.start(
  {
    facingMode: "environment"
  },
  {
    fps,
    qrbox,
    aspectRatio: 1.0,
    videoConstraints: {
      facingMode: "environment",
      // 👇 Thêm mức zoom (chỉ hỗ trợ nếu camera hỗ trợ zoom bằng MediaTrackCapabilities)
      advanced: [{ zoom: 2.0 }] // Giá trị zoom tùy bạn chọn: 1.0 = bình thường, > 1.0 là phóng to
    }
  },
  (decodedText) => {
    onScanSuccess && onScanSuccess(decodedText);
  },
  (errorMessage) => {
    onScanError && onScanError(errorMessage);
  }
);

      isScannerRunningRef.current = true;
      setIsScanning(true);
    } catch (err) {
      console.error("Không thể khởi động camera: ", err);
      isScannerRunningRef.current = false;
    }
  };

  const stopScan = async () => {
    if (html5QrcodeScannerRef.current && isScannerRunningRef.current) {
      try {
        await html5QrcodeScannerRef.current.stop();
        await html5QrcodeScannerRef.current.clear();
        isScannerRunningRef.current = false;
        setIsScanning(false);
      } catch (err) {
        console.warn("Lỗi khi dừng scanner: ", err);
      }
    }
  };

  useEffect(() => {
    return () => {
      stopScan(); // cleanup khi unmount
    };
  }, []);

  return (
    <div>
      {isScanning && <div id={qrCodeRegionId} />}
    </div>
  );
});

export default QrScanner;
