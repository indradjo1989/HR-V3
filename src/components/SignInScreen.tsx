import React, { useState } from 'react';
import { Building2, CheckCircle2, MailCheck, MapPin, ShieldCheck } from 'lucide-react';

interface SignInScreenProps {
  onSignIn: () => Promise<void>;
  error: string | null;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({ onSignIn, error }) => {
  const [loading, setLoading] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await onSignIn();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Architectural Visual Panel */}
      <div className="relative lg:w-1/2 min-h-[260px] lg:min-h-screen bg-slate-900 overflow-hidden flex flex-col justify-between">
        {!imgFailed ? (
          <img
            src="/src/assets/images/login_workspace_hero_1795753883223.jpg"
            alt="Ruang kerja modern C-SYNC"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-800" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-slate-950/25" />

        <div className="relative z-10 p-6 lg:p-10">
          <div className="flex items-center gap-3 text-white">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-display font-bold text-base tracking-tight">
              CS
            </div>
            <span className="font-display font-bold text-xl tracking-tight">
              C-SYNC
            </span>
          </div>
        </div>

        <div className="relative z-10 p-6 lg:p-10 max-w-xl">
          <p className="text-xs font-medium text-blue-200 mb-2">
            Human Resource Information System
          </p>
          <h1 className="text-2xl lg:text-4xl font-bold text-white leading-tight mb-4">
            Operasional SDM, absensi lokasi, cuti, dan rekrutmen dalam satu ritme real-time.
          </h1>
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-200 pt-2 border-t border-white/15">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-300 shrink-0" />
              <span>Geofence Radius &amp; Selfie Wajib</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-300 shrink-0" />
              <span>Kebijakan Cuti UU &amp; Personal</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-300 shrink-0" />
              <span>To-Do Tim &amp; KPI Eksekutif</span>
            </div>
            <div className="flex items-center gap-2">
              <MailCheck className="w-4 h-4 text-blue-300 shrink-0" />
              <span>Notifikasi Gmail Otomatis</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Sign-In Card */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16 bg-white">
        <div className="w-full max-w-md space-y-7">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
              <Building2 className="w-4 h-4 text-blue-700" />
              <span>Portal Karyawan &amp; Manajemen</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Masuk ke C-SYNC HRIS
            </h2>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
              Gunakan akun Google / Gmail perusahaan Anda untuk masuk serta mengaktifkan notifikasi email otomatis.
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <button
              type="button"
              onClick={handleClick}
              disabled={loading}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                </div>
                <span>{loading ? 'Menghubungkan ke Google...' : 'Sign in with Google'}</span>
              </div>
            </button>

            <div className="pt-4 border-t border-slate-200 space-y-2 text-xs text-slate-500">
              <p className="font-medium text-slate-700">Hak Akses Terintegrasi:</p>
              <p>
                Employee · Lead / Manager · HR Admin (Talent Acquisition) · Super Admin
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
