import { AttendanceRecord, WORK_MODE_LABELS } from '../types';

export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatLocalIsoDate(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekRangeFromDate(isoDate: string): { start: string; end: string } {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    const today = getTodayIsoDate();
    return { start: today, end: today };
  }
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(y, m - 1, d + diffToMon);
  const sunday = new Date(y, m - 1, d + diffToMon + 6);
  return {
    start: formatLocalIsoDate(monday),
    end: formatLocalIsoDate(sunday),
  };
}

export function getMonthRange(
  year: number,
  month1to12: number
): { start: string; end: string; ym: string } {
  const mStr = String(month1to12).padStart(2, '0');
  const lastDay = new Date(year, month1to12, 0).getDate();
  return {
    start: `${year}-${mStr}-01`,
    end: `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`,
    ym: `${year}-${mStr}`,
  };
}

export function sanitizeEmailToId(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .slice(0, 120);
}

export function computeDaysInclusive(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 1;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diff);
}

export async function compressImageElementToJpeg(
  source: HTMLVideoElement | HTMLImageElement,
  maxWidth = 480,
  quality = 0.68
): Promise<string> {
  const naturalW =
    source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const naturalH =
    source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;

  const width = Math.min(maxWidth, naturalW || maxWidth);
  const height = Math.round(((naturalH || 360) / (naturalW || 480)) * width);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak tersedia');
  ctx.drawImage(source, 0, 0, width, height);

  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (dataUrl.length > 180000) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.45);
  }
  return dataUrl;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Gagal membaca file'));
      }
    };
    reader.onerror = () => reject(new Error('Error membaca file'));
    reader.readAsDataURL(file);
  });
}

export function exportAttendanceToCsv(
  records: AttendanceRecord[],
  filenamePrefix = 'csync-absensi',
  periodTag?: string
) {
  const headers = [
    'Tanggal',
    'Nama Karyawan',
    'Email',
    'Departemen',
    'Mode Kerja',
    'Clock In',
    'Jarak Clock In (m)',
    'Luar Radius In',
    'Clock Out',
    'Jarak Clock Out (m)',
    'Luar Radius Out',
    'Perlu Approval',
    'Approval Lead',
    'Approval HR',
    'Status Akhir',
    'Catatan',
  ];

  const escapeCell = (val: string | number | boolean | undefined) => {
    const str = String(val ?? '').replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = records.map((r) => {
    const cin = r.clockInTime ? r.clockInTime.toDate().toLocaleString('id-ID') : '-';
    const cout = r.clockOutTime ? r.clockOutTime.toDate().toLocaleString('id-ID') : '-';
    return [
      r.date,
      r.userName,
      r.userEmail,
      r.department,
      WORK_MODE_LABELS[r.workMode] || r.workMode,
      cin,
      r.clockInDistanceMeters,
      r.clockInOutsideRadius ? 'Ya' : 'Tidak',
      cout,
      r.clockOutDistanceMeters ?? '-',
      r.clockOutOutsideRadius ? 'Ya' : 'Tidak',
      r.needsApproval ? 'Ya' : 'Tidak',
      r.leadApprovalStatus,
      r.hrApprovalStatus,
      r.overallStatus,
      r.notes,
    ]
      .map(escapeCell)
      .join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(escapeCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${periodTag || getTodayIsoDate()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
