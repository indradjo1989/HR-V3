import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AttendanceRecord,
  CompanySettings,
  PendingEmailDispatch,
  UserProfile,
  UserRole,
  VALIDATION_LIMITS,
  WORK_MODE_LABELS,
  WorkMode,
} from '../types';
import {
  calculateDistanceMeters,
  exportAttendanceToCsv,
  getMonthRange,
  getTodayIsoDate,
  getWeekRangeFromDate,
} from '../utils/geo';
import { createInAppNotification } from '../utils/gmail';
import { SelfieCameraModal } from './SelfieCameraModal';

interface AttendanceModuleProps {
  currentUser: UserProfile;
  effectiveRole: UserRole;
  settings: CompanySettings;
  allAttendance: AttendanceRecord[];
  onQueueEmail: (payload: PendingEmailDispatch) => void;
}

export const AttendanceModule: React.FC<AttendanceModuleProps> = ({
  currentUser,
  effectiveRole,
  settings,
  allAttendance,
  onQueueEmail,
}) => {
  const [subTab, setSubTab] = useState<'my' | 'team' | 'all'>('my');
  const [now, setNow] = useState(() => new Date());

  // GPS state
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [simMode, setSimMode] = useState<'gps' | 'office' | 'outside'>('gps');

  // Clock action state
  const [workMode, setWorkMode] = useState<WorkMode>('WFO');
  const [notes, setNotes] = useState('');
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters for All / Team
  const initialToday = getTodayIsoDate();
  const [periodMode, setPeriodMode] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'custom'>('all');
  const [dailyDate, setDailyDate] = useState(initialToday);
  const [weeklyRefDate, setWeeklyRefDate] = useState(initialToday);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [customStart, setCustomStart] = useState(() => {
    const nowDt = new Date();
    return `${nowDt.getFullYear()}-${String(nowDt.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [customEnd, setCustomEnd] = useState(initialToday);
  const [filterDept, setFilterDept] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterEmployee, setFilterEmployee] = useState('ALL');

  // Approval modal state
  const [reviewRecord, setReviewRecord] = useState<AttendanceRecord | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  // Selfie preview modal
  const [selfiePreview, setSelfiePreview] = useState<{
    title: string;
    inUrl?: string;
    outUrl?: string;
  } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchGps = () => {
    setGpsLoading(true);
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('Geolocation tidak didukung browser ini.');
      setGpsLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
        setSimMode('gps');
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(`Akses GPS ditolak atau tidak tersedia (${err.message}).`);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  };

  useEffect(() => {
    fetchGps();
  }, []);

  const activeCoords = useMemo(() => {
    if (simMode === 'office') {
      return { lat: settings.officeLat, lng: settings.officeLng };
    }
    if (simMode === 'outside') {
      // ~1.4 km away from office for verification testing
      return {
        lat: Number((settings.officeLat + 0.011).toFixed(6)),
        lng: Number((settings.officeLng + 0.008).toFixed(6)),
      };
    }
    return coords;
  }, [simMode, coords, settings.officeLat, settings.officeLng]);

  const distanceMeters = useMemo(() => {
    if (!activeCoords) return null;
    return calculateDistanceMeters(
      activeCoords.lat,
      activeCoords.lng,
      settings.officeLat,
      settings.officeLng
    );
  }, [activeCoords, settings.officeLat, settings.officeLng]);

  const isOutsideRadius =
    distanceMeters !== null ? distanceMeters > settings.radiusMeters : false;

  const requiresApprovalNow = isOutsideRadius || workMode !== 'WFO';

  const todayDate = getTodayIsoDate();

  const myRecords = useMemo(
    () =>
      allAttendance
        .filter((r) => r.userId === currentUser.uid)
        .sort((a, b) => (b.date > a.date ? 1 : -1)),
    [allAttendance, currentUser.uid]
  );

  const todayRecord = useMemo(
    () => myRecords.find((r) => r.date === todayDate) || null,
    [myRecords, todayDate]
  );

  const activePeriod = useMemo(() => {
    if (periodMode === 'daily') {
      return {
        start: dailyDate,
        end: dailyDate,
        label: `Harian: ${dailyDate}`,
        tag: `harian-${dailyDate}`,
      };
    }
    if (periodMode === 'weekly') {
      const range = getWeekRangeFromDate(weeklyRefDate);
      return {
        start: range.start,
        end: range.end,
        label: `Mingguan: ${range.start} s/d ${range.end}`,
        tag: `mingguan-${range.start}_sd_${range.end}`,
      };
    }
    if (periodMode === 'monthly') {
      const range = getMonthRange(selectedYear, selectedMonth);
      const monthName = new Date(selectedYear, selectedMonth - 1, 1).toLocaleDateString('id-ID', {
        month: 'long',
        year: 'numeric',
      });
      return {
        start: range.start,
        end: range.end,
        label: `Bulanan: ${monthName} (${range.start} s/d ${range.end})`,
        tag: `bulanan-${range.ym}`,
      };
    }
    if (periodMode === 'custom') {
      const start = customStart <= customEnd ? customStart : customEnd;
      const end = customStart <= customEnd ? customEnd : customStart;
      return {
        start,
        end,
        label: `Custom: ${start || '-'} s/d ${end || '-'}`,
        tag: `custom-${start}_sd_${end}`,
      };
    }
    return {
      start: '',
      end: '',
      label: 'Semua Periode',
      tag: `semua-${todayDate}`,
    };
  }, [periodMode, dailyDate, weeklyRefDate, selectedYear, selectedMonth, customStart, customEnd, todayDate]);

  const teamRecords = useMemo(() => {
    return allAttendance
      .filter((r) => {
        const isTeamMember =
          r.userId === currentUser.uid ||
          r.managerId === currentUser.uid ||
          (r.managerEmail && r.managerEmail === currentUser.email);
        if (!isTeamMember) return false;
        if (activePeriod.start && r.date < activePeriod.start) return false;
        if (activePeriod.end && r.date > activePeriod.end) return false;
        if (filterStatus !== 'ALL' && r.overallStatus !== filterStatus) return false;
        return true;
      })
      .sort((a, b) => (b.date > a.date ? 1 : -1));
  }, [allAttendance, currentUser.uid, currentUser.email, activePeriod, filterStatus]);

  const departments = useMemo(() => {
    const set = new Set(allAttendance.map((r) => r.department).filter(Boolean));
    return Array.from(set).sort();
  }, [allAttendance]);

  const employeeOptions = useMemo(() => {
    const map = new Map<string, string>();
    allAttendance.forEach((r) => {
      if (r.userEmail && r.userName) {
        map.set(r.userEmail, r.userName);
      }
    });
    return Array.from(map.entries())
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allAttendance]);

  const filteredAllRecords = useMemo(() => {
    return allAttendance
      .filter((r) => {
        if (activePeriod.start && r.date < activePeriod.start) return false;
        if (activePeriod.end && r.date > activePeriod.end) return false;
        if (filterDept !== 'ALL' && r.department !== filterDept) return false;
        if (filterStatus !== 'ALL' && r.overallStatus !== filterStatus) return false;
        if (filterEmployee !== 'ALL' && r.userEmail !== filterEmployee) return false;
        return true;
      })
      .sort((a, b) => (b.date > a.date ? 1 : -1));
  }, [allAttendance, activePeriod, filterDept, filterStatus, filterEmployee]);

  const handleClockIn = async () => {
    setFeedback(null);
    if (!activeCoords || distanceMeters === null) {
      setFeedback({ type: 'err', text: 'Koordinat GPS wajib tersedia sebelum Clock In.' });
      return;
    }
    if (!selfieDataUrl) {
      setFeedback({ type: 'err', text: 'Foto selfie wajib diambil sebelum Clock In.' });
      return;
    }
    if (requiresApprovalNow && notes.trim().length < 5) {
      setFeedback({
        type: 'err',
        text: 'Catatan alasan wajib diisi (minimal 5 karakter) untuk WFH, Client Visit, Supervisi, atau absensi di luar radius kantor.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const attendanceId = `att_${currentUser.uid}_${todayDate}_${Date.now()}`;
      const mediaId = `med_in_${attendanceId}`;

      const batch = writeBatch(db);
      batch.set(doc(db, 'attendance_media', mediaId), {
        userId: currentUser.uid,
        managerId: currentUser.managerId || '',
        attendanceId,
        type: 'clock_in',
        imageDataUrl: selfieDataUrl.slice(0, VALIDATION_LIMITS.MAX_SELFIE_DATAURL_CHARS),
        createdAt: serverTimestamp(),
      });

      const needsApproval = requiresApprovalNow;
      batch.set(doc(db, 'attendance', attendanceId), {
        userId: currentUser.uid,
        userName: currentUser.displayName.slice(0, VALIDATION_LIMITS.DISPLAY_NAME_MAX),
        userEmail: currentUser.email,
        department: currentUser.department.slice(0, VALIDATION_LIMITS.DEPARTMENT_MAX),
        managerId: currentUser.managerId || '',
        managerEmail: currentUser.managerEmail || '',
        date: todayDate,
        workMode,
        clockInTime: serverTimestamp(),
        clockInLat: activeCoords.lat,
        clockInLng: activeCoords.lng,
        clockInDistanceMeters: distanceMeters,
        clockInOutsideRadius: isOutsideRadius,
        clockInSelfieId: mediaId,
        needsApproval,
        notes: notes.trim().slice(0, VALIDATION_LIMITS.NOTES_MAX),
        leadApprovalStatus: needsApproval ? 'pending' : 'not_required',
        hrApprovalStatus: needsApproval ? 'pending' : 'not_required',
        overallStatus: needsApproval ? 'pending_approval' : 'present',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      setSelfieDataUrl(null);
      setNotes('');
      setFeedback({
        type: 'ok',
        text: needsApproval
          ? 'Clock In tercatat dan menunggu approval Lead & HR Admin.'
          : 'Clock In berhasil tercatat di dalam radius kantor.',
      });

      if (needsApproval) {
        const recipients: string[] = [];
        if (currentUser.managerEmail) {
          recipients.push(currentUser.managerEmail);
          await createInAppNotification({
            recipientUserId: currentUser.managerId,
            recipientEmail: currentUser.managerEmail,
            title: `Approval Absensi Luar Radius / ${workMode}`,
            message: `${currentUser.displayName} melakukan Clock In (${WORK_MODE_LABELS[workMode]}, jarak ${distanceMeters}m dari kantor). Catatan: ${notes.trim()}`,
            category: 'attendance',
            emailSent: false,
            sender: currentUser,
          });
        }
        if (settings.hrNotificationEmail) {
          recipients.push(settings.hrNotificationEmail);
          await createInAppNotification({
            recipientEmail: settings.hrNotificationEmail,
            title: `Approval HR Absensi (${workMode})`,
            message: `${currentUser.displayName} (${currentUser.department}) Clock In ${WORK_MODE_LABELS[workMode]} (${distanceMeters}m). Catatan: ${notes.trim()}`,
            category: 'attendance',
            emailSent: false,
            sender: currentUser,
          });
        }
        if (recipients.length > 0) {
          onQueueEmail({
            to: recipients,
            subject: `[C-SYNC] Permintaan Approval Absensi ${workMode} - ${currentUser.displayName}`,
            body: `Halo Lead & Tim HR,\n\nKaryawan ${currentUser.displayName} (${currentUser.department}) telah melakukan Clock In dengan status yang memerlukan persetujuan:\n- Tanggal: ${todayDate}\n- Mode Kerja: ${WORK_MODE_LABELS[workMode]}\n- Jarak dari kantor: ${distanceMeters} meter (Batas radius: ${settings.radiusMeters}m)\n- Catatan: ${notes.trim()}\n\nSilakan tinjau dan setujui melalui dashboard C-SYNC HRIS.\n\nTerima kasih,\nC-SYNC HRIS`,
            category: 'attendance',
            contextLabel: 'Notifikasi Approval Clock In ke Lead & HR',
          });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'attendance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClockOut = async () => {
    if (!todayRecord) return;
    setFeedback(null);
    if (!activeCoords || distanceMeters === null) {
      setFeedback({ type: 'err', text: 'Koordinat GPS wajib tersedia sebelum Clock Out.' });
      return;
    }
    if (!selfieDataUrl) {
      setFeedback({ type: 'err', text: 'Foto selfie wajib diambil sebelum Clock Out.' });
      return;
    }

    const outNeedsApproval =
      todayRecord.needsApproval || isOutsideRadius || todayRecord.workMode !== 'WFO';
    if (outNeedsApproval && !todayRecord.notes && notes.trim().length < 5) {
      setFeedback({
        type: 'err',
        text: 'Catatan wajib diisi untuk Clock Out di luar radius kantor.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const mediaId = `med_out_${todayRecord.id}_${Date.now()}`;
      await setDoc(doc(db, 'attendance_media', mediaId), {
        userId: currentUser.uid,
        managerId: currentUser.managerId || '',
        attendanceId: todayRecord.id,
        type: 'clock_out',
        imageDataUrl: selfieDataUrl.slice(0, VALIDATION_LIMITS.MAX_SELFIE_DATAURL_CHARS),
        createdAt: serverTimestamp(),
      });

      const mergedNotes = notes.trim()
        ? `${todayRecord.notes ? todayRecord.notes + ' | ' : ''}Out: ${notes.trim()}`
        : todayRecord.notes;

      const leadSt =
        outNeedsApproval && todayRecord.leadApprovalStatus === 'not_required'
          ? 'pending'
          : todayRecord.leadApprovalStatus;
      const hrSt =
        outNeedsApproval && todayRecord.hrApprovalStatus === 'not_required'
          ? 'pending'
          : todayRecord.hrApprovalStatus;

      const nextOverall =
        leadSt === 'rejected' || hrSt === 'rejected'
          ? 'rejected'
          : outNeedsApproval && (leadSt !== 'approved' || hrSt !== 'approved')
            ? 'pending_approval'
            : outNeedsApproval
              ? 'approved'
              : 'present';

      await updateDoc(doc(db, 'attendance', todayRecord.id), {
        clockOutTime: serverTimestamp(),
        clockOutLat: activeCoords.lat,
        clockOutLng: activeCoords.lng,
        clockOutDistanceMeters: distanceMeters,
        clockOutOutsideRadius: isOutsideRadius,
        clockOutSelfieId: mediaId,
        needsApproval: outNeedsApproval,
        notes: mergedNotes.slice(0, VALIDATION_LIMITS.NOTES_MAX),
        leadApprovalStatus: leadSt,
        hrApprovalStatus: hrSt,
        overallStatus: nextOverall,
        updatedAt: serverTimestamp(),
      });

      setSelfieDataUrl(null);
      setNotes('');
      setFeedback({ type: 'ok', text: 'Clock Out berhasil tercatat beserta selfie.' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `attendance/${todayRecord.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenSelfiePreview = async (record: AttendanceRecord) => {
    try {
      const inSnap = await getDoc(doc(db, 'attendance_media', record.clockInSelfieId));
      let outUrl: string | undefined;
      if (record.clockOutSelfieId) {
        const outSnap = await getDoc(doc(db, 'attendance_media', record.clockOutSelfieId));
        if (outSnap.exists()) outUrl = outSnap.data().imageDataUrl;
      }
      setSelfiePreview({
        title: `${record.userName} · ${record.date}`,
        inUrl: inSnap.exists() ? inSnap.data().imageDataUrl : undefined,
        outUrl,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'attendance_media');
    }
  };

  const handleApprovalDecision = async (
    record: AttendanceRecord,
    tier: 'lead' | 'hr',
    decision: 'approved' | 'rejected'
  ) => {
    setReviewLoading(true);
    try {
      const nextLead = tier === 'lead' ? decision : record.leadApprovalStatus;
      const nextHr = tier === 'hr' ? decision : record.hrApprovalStatus;

      let nextOverall: AttendanceRecord['overallStatus'] = 'pending_approval';
      if (nextLead === 'rejected' || nextHr === 'rejected') {
        nextOverall = 'rejected';
      } else if (
        (nextLead === 'approved' || nextLead === 'not_required') &&
        (nextHr === 'approved' || nextHr === 'not_required')
      ) {
        nextOverall = 'approved';
      }

      const payload: Record<string, unknown> = {
        overallStatus: nextOverall,
        updatedAt: serverTimestamp(),
      };
      if (tier === 'lead') {
        payload.leadApprovalStatus = decision;
        payload.leadApprovedBy = currentUser.displayName;
        payload.leadNote = reviewNote.trim().slice(0, VALIDATION_LIMITS.APPROVAL_NOTE_MAX);
        payload.leadActionAt = serverTimestamp();
      } else {
        payload.hrApprovalStatus = decision;
        payload.hrApprovedBy = currentUser.displayName;
        payload.hrNote = reviewNote.trim().slice(0, VALIDATION_LIMITS.APPROVAL_NOTE_MAX);
        payload.hrActionAt = serverTimestamp();
      }

      await updateDoc(doc(db, 'attendance', record.id), payload);

      const decisionLabel = decision === 'approved' ? 'Disetujui' : 'Ditolak';
      await createInAppNotification({
        recipientUserId: record.userId,
        recipientEmail: record.userEmail,
        title: `Absensi ${record.date} ${decisionLabel} (${tier === 'lead' ? 'Lead' : 'HR'})`,
        message: `Pengajuan absensi ${WORK_MODE_LABELS[record.workMode]} tanggal ${record.date} telah ${decisionLabel.toLowerCase()} oleh ${currentUser.displayName}.${reviewNote.trim() ? ` Catatan: ${reviewNote.trim()}` : ''}`,
        category: 'attendance',
        emailSent: false,
        sender: currentUser,
      });

      onQueueEmail({
        to: [record.userEmail],
        subject: `[C-SYNC] Status Absensi ${record.date}: ${decisionLabel}`,
        body: `Halo ${record.userName},\n\nAbsensi Anda pada ${record.date} (${WORK_MODE_LABELS[record.workMode]}) telah ditinjau oleh ${tier === 'lead' ? 'Lead/Manager' : 'HR Admin'} (${currentUser.displayName}) dengan keputusan: ${decisionLabel}.\n\nStatus akhir saat ini: ${nextOverall.toUpperCase()}\nCatatan reviewer: ${reviewNote.trim() || '-'}\n\nSalam,\nC-SYNC HRIS`,
        category: 'attendance',
        contextLabel: `Notifikasi Keputusan Approval ke ${record.userName}`,
      });

      setReviewRecord(null);
      setReviewNote('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `attendance/${record.id}`);
    } finally {
      setReviewLoading(false);
    }
  };

  const canSeeTeamTab = effectiveRole === 'lead' || effectiveRole === 'super_admin';
  const canSeeAllTab = effectiveRole === 'hr_admin' || effectiveRole === 'super_admin';

  useEffect(() => {
    if (subTab === 'team' && !canSeeTeamTab) setSubTab('my');
    if (subTab === 'all' && !canSeeAllTab) setSubTab('my');
  }, [effectiveRole, subTab, canSeeTeamTab, canSeeAllTab]);

  const statusBadge = (status: AttendanceRecord['overallStatus']) => {
    switch (status) {
      case 'present':
        return <span className="text-emerald-700 font-medium">Hadir (WFO)</span>;
      case 'approved':
        return <span className="text-emerald-700 font-medium">Disetujui</span>;
      case 'pending_approval':
        return <span className="text-amber-700 font-medium">Menunggu Approval</span>;
      case 'rejected':
        return <span className="text-red-700 font-medium">Ditolak</span>;
    }
  };

  const monthOptions = [
    { value: 1, label: 'Januari' },
    { value: 2, label: 'Februari' },
    { value: 3, label: 'Maret' },
    { value: 4, label: 'April' },
    { value: 5, label: 'Mei' },
    { value: 6, label: 'Juni' },
    { value: 7, label: 'Juli' },
    { value: 8, label: 'Agustus' },
    { value: 9, label: 'September' },
    { value: 10, label: 'Oktober' },
    { value: 11, label: 'November' },
    { value: 12, label: 'Desember' },
  ];

  const currentYearNum = new Date().getFullYear();
  const yearOptions = [currentYearNum - 2, currentYearNum - 1, currentYearNum, currentYearNum + 1];

  const renderApprovalTable = (records: AttendanceRecord[], isAllView: boolean) => (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {isAllView ? 'Seluruh Data & Penarikan Absensi Perusahaan' : 'Absensi & Approval Tim'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono-tabular">
              {records.length} catatan ditemukan · {activePeriod.label}
            </p>
          </div>

          {isAllView && (
            <button
              type="button"
              onClick={() => exportAttendanceToCsv(records, 'csync-absensi', activePeriod.tag)}
              disabled={records.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0 self-start"
            >
              <Download className="w-3.5 h-3.5" />
              Tarik Data CSV ({records.length})
            </button>
          )}
        </div>

        {/* Period & Attribute Filter Bar */}
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'daily', label: 'Harian' },
                  { id: 'weekly', label: 'Mingguan' },
                  { id: 'monthly', label: 'Bulanan' },
                  { id: 'custom', label: 'Custom Tanggal' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setPeriodMode(mode.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    periodMode === mode.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {periodMode === 'daily' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={dailyDate}
                  onChange={(e) => setDailyDate(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-mono-tabular"
                />
                <button
                  type="button"
                  onClick={() => setDailyDate(todayDate)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                >
                  Hari Ini
                </button>
              </div>
            )}

            {periodMode === 'weekly' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Tanggal acuan:</span>
                <input
                  type="date"
                  value={weeklyRefDate}
                  onChange={(e) => setWeeklyRefDate(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-mono-tabular"
                />
                <button
                  type="button"
                  onClick={() => setWeeklyRefDate(todayDate)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                >
                  Minggu Ini
                </button>
              </div>
            )}

            {periodMode === 'monthly' && (
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-mono-tabular"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {periodMode === 'custom' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-mono-tabular"
                  aria-label="Tanggal mulai"
                />
                <span className="text-xs text-slate-400">s/d</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-mono-tabular"
                  aria-label="Tanggal akhir"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAllView && (
              <>
                <select
                  value={filterDept}
                  onChange={(e) => setFilterDept(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  <option value="ALL">Semua Departemen</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select
                  value={filterEmployee}
                  onChange={(e) => setFilterEmployee(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white max-w-[180px]"
                >
                  <option value="ALL">Semua Karyawan</option>
                  {employeeOptions.map((emp) => (
                    <option key={emp.email} value={emp.email}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="ALL">Semua Status</option>
              <option value="present">Hadir WFO</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Disetujui</option>
              <option value="rejected">Ditolak</option>
            </select>
          </div>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-500">
          Belum ada catatan absensi yang sesuai dengan filter saat ini.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-4">Karyawan</th>
                <th className="py-2.5 px-4">Tanggal</th>
                <th className="py-2.5 px-4">Mode &amp; Radius</th>
                <th className="py-2.5 px-4">Clock In / Out</th>
                <th className="py-2.5 px-4">Approval Lead / HR</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {records.map((rec) => {
                const canLeadAct =
                  (effectiveRole === 'lead' || effectiveRole === 'super_admin') &&
                  rec.needsApproval &&
                  rec.leadApprovalStatus === 'pending' &&
                  (rec.managerId === currentUser.uid ||
                    (rec.managerEmail && rec.managerEmail === currentUser.email) ||
                    effectiveRole === 'super_admin');
                const canHrAct =
                  (effectiveRole === 'hr_admin' || effectiveRole === 'super_admin') &&
                  rec.needsApproval &&
                  rec.hrApprovalStatus === 'pending';

                return (
                  <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{rec.userName}</div>
                      <div className="text-slate-500">{rec.department}</div>
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-700 whitespace-nowrap">
                      {rec.date}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">
                        {WORK_MODE_LABELS[rec.workMode]}
                      </div>
                      <div className="font-mono-tabular text-slate-500">
                        {rec.clockInDistanceMeters}m{' '}
                        {rec.clockInOutsideRadius ? '(Luar Radius)' : '(Dalam Radius)'}
                      </div>
                      {rec.notes && (
                        <div className="text-slate-600 mt-0.5 max-w-[220px] truncate" title={rec.notes}>
                          Catatan: {rec.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-700 whitespace-nowrap">
                      <div>
                        In:{' '}
                        {rec.clockInTime
                          ? rec.clockInTime.toDate().toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
                      </div>
                      <div className="text-slate-500">
                        Out:{' '}
                        {rec.clockOutTime
                          ? rec.clockOutTime.toDate().toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Belum Clock Out'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {rec.needsApproval ? (
                        <div className="space-y-0.5">
                          <div>Lead: {rec.leadApprovalStatus}</div>
                          <div>HR: {rec.hrApprovalStatus}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Otomatis WFO</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">{statusBadge(rec.overallStatus)}</td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenSelfiePreview(rec)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Selfie
                      </button>
                      {(canLeadAct || canHrAct) && (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewRecord(rec);
                            setReviewNote('');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 cursor-pointer"
                        >
                          Tinjau
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Absensi &amp; Verifikasi Radius
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {settings.officeName} · Radius Kantor {settings.radiusMeters}m · Jam Kerja {settings.workStartTime}–{settings.workEndTime}
          </p>
        </div>

        {(canSeeTeamTab || canSeeAllTab) && (
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setSubTab('my')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                subTab === 'my'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Absensi Saya
            </button>
            {canSeeTeamTab && (
              <button
                type="button"
                onClick={() => setSubTab('team')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  subTab === 'team'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Absensi Tim ({teamRecords.filter((r) => r.leadApprovalStatus === 'pending').length})
              </button>
            )}
            {canSeeAllTab && (
              <button
                type="button"
                onClick={() => setSubTab('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  subTab === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Semua &amp; Export ({allAttendance.filter((r) => r.hrApprovalStatus === 'pending').length})
              </button>
            )}
          </div>
        )}
      </div>

      {subTab === 'my' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Clock-In / Clock-Out Station */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <div className="text-xs font-medium text-slate-500">Waktu Saat Ini</div>
                <div className="text-3xl font-bold font-mono-tabular text-slate-900 mt-1">
                  {now.toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {now.toLocaleDateString('id-ID', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Status Hari Ini</div>
                <div className="text-sm font-semibold text-slate-900 mt-1">
                  {!todayRecord
                    ? 'Belum Clock In'
                    : !todayRecord.clockOutTime
                      ? 'Sedang Bekerja'
                      : 'Selesai Hari Ini'}
                </div>
              </div>
            </div>

            {/* GPS Radius Check */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-blue-700" />
                  Validasi Geofence Radius ({settings.radiusMeters}m)
                </span>
                <button
                  type="button"
                  onClick={fetchGps}
                  disabled={gpsLoading}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${gpsLoading ? 'animate-spin' : ''}`} />
                  Perbarui GPS
                </button>
              </div>

              <div className="flex items-center gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                {/* Concentric Radar SVG */}
                <svg viewBox="0 0 64 64" className="w-14 h-14 shrink-0">
                  <circle cx="32" cy="32" r="28" fill="#EFF6FF" stroke="#BFDBFE" strokeWidth="1.5" strokeDasharray="3 3" />
                  <circle cx="32" cy="32" r="16" fill="#DBEAFE" stroke="#93C5FD" strokeWidth="1.5" />
                  <circle cx="32" cy="32" r="4" fill="#1D4ED8" />
                  {distanceMeters !== null && (
                    <circle
                      cx={isOutsideRadius ? 55 : 39}
                      cy={isOutsideRadius ? 14 : 26}
                      r="4.5"
                      fill={isOutsideRadius ? '#D97706' : '#16A34A'}
                      stroke="#FFFFFF"
                      strokeWidth="1.5"
                    />
                  )}
                </svg>

                <div className="min-w-0 flex-1 text-xs space-y-1">
                  {activeCoords && distanceMeters !== null ? (
                    <>
                      <div className="font-semibold text-slate-900">
                        Jarak: <span className="font-mono-tabular">{distanceMeters} m</span> dari{' '}
                        {settings.officeName}
                      </div>
                      <div className={isOutsideRadius ? 'text-amber-700 font-medium' : 'text-emerald-700 font-medium'}>
                        {isOutsideRadius
                          ? `Di luar radius kantor (> ${settings.radiusMeters}m) — Wajib Approval Lead & HR`
                          : `Di dalam radius kantor (≤ ${settings.radiusMeters}m)`}
                      </div>
                      <div className="font-mono-tabular text-[11px] text-slate-500">
                        {activeCoords.lat}, {activeCoords.lng}
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-600">
                      {gpsLoading ? 'Mengambil koordinat GPS...' : gpsError || 'Lokasi belum tersedia.'}
                    </div>
                  )}
                </div>
              </div>

              {/* Fallback location tester when browser GPS is unavailable */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <span>Sumber koordinat:</span>
                <button
                  type="button"
                  onClick={() => setSimMode('gps')}
                  className={`px-2 py-0.5 rounded border cursor-pointer ${
                    simMode === 'gps' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  GPS Perangkat
                </button>
                <button
                  type="button"
                  onClick={() => setSimMode('office')}
                  className={`px-2 py-0.5 rounded border cursor-pointer ${
                    simMode === 'office' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  Titik Kantor
                </button>
                <button
                  type="button"
                  onClick={() => setSimMode('outside')}
                  className={`px-2 py-0.5 rounded border cursor-pointer ${
                    simMode === 'outside' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  Uji Luar Radius
                </button>
              </div>
            </div>

            {/* Work Mode */}
            {!todayRecord && (
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-2">
                  Mode Kerja
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(WORK_MODE_LABELS) as WorkMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setWorkMode(mode)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors cursor-pointer min-h-[40px] ${
                        workMode === mode
                          ? 'bg-blue-50 border-blue-600 text-blue-800'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {WORK_MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Mandatory Selfie */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-800">
                  Foto Selfie Wajib
                </label>
                {selfieDataUrl && (
                  <span className="text-xs text-emerald-700 font-medium">Selfie siap</span>
                )}
              </div>

              {selfieDataUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-slate-200 aspect-[4/3] bg-slate-100">
                  <img
                    src={selfieDataUrl}
                    alt="Selfie Absensi"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    className="absolute bottom-2.5 right-2.5 px-3 py-1.5 text-xs font-medium bg-white/95 text-slate-800 border border-slate-200 rounded-lg shadow-sm hover:bg-white cursor-pointer"
                  >
                    Ambil Ulang
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  disabled={Boolean(todayRecord?.clockOutTime)}
                  className="w-full py-3 px-4 border border-dashed border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:border-blue-600 hover:text-blue-700 hover:bg-blue-50/40 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 min-h-[44px]"
                >
                  <Camera className="w-4 h-4" />
                  Ambil Foto Selfie Sekarang
                </button>
              )}
            </div>

            {/* Notes (Required for WFH / Client Visit / Supervisi / Outside Radius) */}
            {!todayRecord?.clockOutTime && (
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                  Catatan / Keterangan{' '}
                  {requiresApprovalNow ? (
                    <span className="text-amber-700">(Wajib untuk WFH / Luar Radius)</span>
                  ) : (
                    <span className="text-slate-400">(Opsional)</span>
                  )}
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={VALIDATION_LIMITS.NOTES_MAX}
                  placeholder={
                    requiresApprovalNow
                      ? 'Contoh: Client visit di PT Mitra Utama / WFH koordinasi sprint / Supervisi proyek...'
                      : 'Tambahkan catatan kerja jika diperlukan...'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            )}

            {requiresApprovalNow && !todayRecord && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Karena Anda memilih <strong>{WORK_MODE_LABELS[workMode]}</strong> atau berada di luar radius kantor, absensi ini otomatis memerlukan persetujuan <strong>Lead/Manager</strong> dan <strong>HR Admin</strong>.
                </span>
              </div>
            )}

            {feedback && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  feedback.type === 'ok'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {feedback.text}
              </div>
            )}

            {/* Primary Clock Button */}
            <div>
              {!todayRecord ? (
                <button
                  type="button"
                  onClick={handleClockIn}
                  disabled={submitting}
                  className="w-full py-3 px-4 bg-blue-700 text-white text-sm font-semibold rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors cursor-pointer min-h-[44px]"
                >
                  {submitting ? 'Memproses Clock In...' : 'Clock In Sekarang'}
                </button>
              ) : !todayRecord.clockOutTime ? (
                <button
                  type="button"
                  onClick={handleClockOut}
                  disabled={submitting}
                  className="w-full py-3 px-4 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer min-h-[44px]"
                >
                  {submitting ? 'Memproses Clock Out...' : 'Clock Out Sekarang'}
                </button>
              ) : (
                <div className="py-3 px-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium rounded-lg text-center">
                  Anda sudah menyelesaikan Clock In &amp; Clock Out hari ini.
                </div>
              )}
            </div>
          </div>

          {/* Right: Personal Attendance History */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Riwayat Absensi Saya
                </h2>
                <p className="text-xs text-slate-500">
                  {myRecords.length} hari tercatat · Klik Selfie untuk melihat bukti foto
                </p>
              </div>
            </div>

            {myRecords.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                Belum ada catatan absensi. Lakukan Clock In pertama Anda di sebelah kiri.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {myRecords.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/60"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono-tabular font-semibold text-slate-900">
                          {rec.date}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-medium text-slate-800">
                          {WORK_MODE_LABELS[rec.workMode]}
                        </span>
                        <span className="text-slate-300">·</span>
                        {statusBadge(rec.overallStatus)}
                      </div>
                      <div className="text-xs font-mono-tabular text-slate-600 flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          In:{' '}
                          {rec.clockInTime
                            ? rec.clockInTime.toDate().toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '-'}
                        </span>
                        <span>
                          Out:{' '}
                          {rec.clockOutTime
                            ? rec.clockOutTime.toDate().toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '-'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {rec.clockInDistanceMeters}m
                        </span>
                      </div>
                      {rec.notes && (
                        <div className="text-xs text-slate-600 flex items-start gap-1.5 pt-0.5">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <span>{rec.notes}</span>
                        </div>
                      )}
                      {rec.needsApproval && (
                        <div className="text-[11px] text-slate-500">
                          Approval Lead: <strong>{rec.leadApprovalStatus}</strong> · Approval HR:{' '}
                          <strong>{rec.hrApprovalStatus}</strong>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenSelfiePreview(rec)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer self-start sm:self-center whitespace-nowrap shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Lihat Selfie
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'team' && canSeeTeamTab && renderApprovalTable(teamRecords, false)}
      {subTab === 'all' && canSeeAllTab && renderApprovalTable(filteredAllRecords, true)}

      {/* Selfie Camera Modal */}
      <SelfieCameraModal
        isOpen={cameraOpen}
        title={todayRecord ? 'Selfie Wajib Clock Out' : 'Selfie Wajib Clock In'}
        onCapture={(url) => {
          setSelfieDataUrl(url);
          setCameraOpen(false);
        }}
        onClose={() => setCameraOpen(false)}
      />

      {/* Selfie Preview Modal */}
      {selfiePreview && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full overflow-hidden shadow-xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Bukti Selfie · {selfiePreview.title}
              </h3>
              <button
                type="button"
                onClick={() => setSelfiePreview(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-medium text-slate-600 mb-1.5">Selfie Clock In</div>
                {selfiePreview.inUrl ? (
                  <img
                    src={selfiePreview.inUrl}
                    alt="Selfie Clock In"
                    className="w-full aspect-[4/3] object-cover rounded-lg border border-slate-200"
                  />
                ) : (
                  <div className="aspect-[4/3] bg-slate-100 rounded-lg flex items-center justify-center text-xs text-slate-400">
                    Tidak tersedia
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-slate-600 mb-1.5">Selfie Clock Out</div>
                {selfiePreview.outUrl ? (
                  <img
                    src={selfiePreview.outUrl}
                    alt="Selfie Clock Out"
                    className="w-full aspect-[4/3] object-cover rounded-lg border border-slate-200"
                  />
                ) : (
                  <div className="aspect-[4/3] bg-slate-100 rounded-lg flex items-center justify-center text-xs text-slate-400">
                    Belum Clock Out
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Approval Modal */}
      {reviewRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Approval Absensi · {reviewRecord.userName}
              </h3>
              <button
                type="button"
                onClick={() => setReviewRecord(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                <div>
                  <strong>Tanggal:</strong> {reviewRecord.date} ·{' '}
                  {WORK_MODE_LABELS[reviewRecord.workMode]}
                </div>
                <div>
                  <strong>Jarak Clock In:</strong> {reviewRecord.clockInDistanceMeters}m{' '}
                  {reviewRecord.clockInOutsideRadius ? '(Luar Radius)' : '(Dalam Radius)'}
                </div>
                <div>
                  <strong>Catatan Karyawan:</strong> {reviewRecord.notes || '-'}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Catatan Reviewer (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  maxLength={VALIDATION_LIMITS.APPROVAL_NOTE_MAX}
                  placeholder="Contoh: Disetujui untuk agenda kunjungan klien..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <div className="flex flex-col gap-2 pt-2">
                {(effectiveRole === 'lead' || effectiveRole === 'super_admin') &&
                  reviewRecord.leadApprovalStatus === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={reviewLoading}
                        onClick={() => handleApprovalDecision(reviewRecord, 'lead', 'approved')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Setujui (Lead)
                      </button>
                      <button
                        type="button"
                        disabled={reviewLoading}
                        onClick={() => handleApprovalDecision(reviewRecord, 'lead', 'rejected')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Tolak (Lead)
                      </button>
                    </div>
                  )}

                {(effectiveRole === 'hr_admin' || effectiveRole === 'super_admin') &&
                  reviewRecord.hrApprovalStatus === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={reviewLoading}
                        onClick={() => handleApprovalDecision(reviewRecord, 'hr', 'approved')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-700 text-white font-medium rounded-lg hover:bg-blue-800 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Setujui (HR)
                      </button>
                      <button
                        type="button"
                        disabled={reviewLoading}
                        onClick={() => handleApprovalDecision(reviewRecord, 'hr', 'rejected')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Tolak (HR)
                      </button>
                    </div>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
