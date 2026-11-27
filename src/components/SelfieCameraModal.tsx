import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, RefreshCw, Upload, X } from 'lucide-react';
import { compressImageElementToJpeg } from '../utils/geo';

interface SelfieCameraModalProps {
  isOpen: boolean;
  title: string;
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

export const SelfieCameraModal: React.FC<SelfieCameraModalProps> = ({
  isOpen,
  title,
  onCapture,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Peramban tidak mendukung akses kamera langsung.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Kamera tidak tersedia (${err.message}). Gunakan unggah foto selfie di bawah.`
          : 'Kamera tidak tersedia. Gunakan unggah foto selfie.'
      );
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setCapturedUrl(null);
      startCamera();
    } else {
      stopStream();
    }
    return () => stopStream();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTakePhoto = async () => {
    if (!videoRef.current) return;
    const dataUrl = await compressImageElementToJpeg(videoRef.current, 480, 0.7);
    setCapturedUrl(dataUrl);
    stopStream();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = async () => {
      try {
        const compressed = await compressImageElementToJpeg(img, 480, 0.68);
        setCapturedUrl(compressed);
        stopStream();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.src = objectUrl;
  };

  const handleRetake = () => {
    setCapturedUrl(null);
    startCamera();
  };

  const handleConfirm = () => {
    if (!capturedUrl) return;
    stopStream();
    onCapture(capturedUrl);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative aspect-[4/3] w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-200 flex items-center justify-center">
            {capturedUrl ? (
              <img
                src={capturedUrl}
                alt="Preview Selfie Absensi"
                className="w-full h-full object-cover"
              />
            ) : cameraError ? (
              <div className="p-5 text-center space-y-3">
                <Camera className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-xs text-slate-300 leading-relaxed">{cameraError}</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                {starting && (
                  <div className="absolute inset-0 bg-slate-900/70 flex items-center justify-center text-xs text-white">
                    Membuka kamera...
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {!capturedUrl ? (
              <>
                {!cameraError && (
                  <button
                    type="button"
                    onClick={handleTakePhoto}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-700 text-white text-xs font-medium rounded-lg hover:bg-blue-800 transition-colors cursor-pointer min-h-[44px]"
                  >
                    <Camera className="w-4 h-4" />
                    Ambil Foto Selfie
                  </button>
                )}
                <label className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors cursor-pointer min-h-[44px]">
                  <Upload className="w-4 h-4" />
                  <span>Unggah / Kamera HP</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-slate-700 border border-slate-200 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors cursor-pointer min-h-[44px]"
                >
                  <RefreshCw className="w-4 h-4" />
                  Ulangi Foto
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer min-h-[44px]"
                >
                  <Check className="w-4 h-4" />
                  Gunakan Selfie Ini
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
