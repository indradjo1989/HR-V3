import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  FileUp,
  Scale,
  Settings2,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CompanySettings,
  DEFAULT_GLOBAL_POLICY,
  LEAVE_TYPES,
  LeavePolicy,
  LeaveRequest,
  LeaveType,
  PendingEmailDispatch,
  UserProfile,
  UserRole,
  VALIDATION_LIMITS,
} from '../types';
import {
  computeDaysInclusive,
  getTodayIsoDate,
  readFileAsDataUrl,
} from '../utils/geo';
import { createInAppNotification } from '../utils/gmail';

interface LeaveModuleProps {
  currentUser: UserProfile;
  effectiveRole: UserRole;
  settings: CompanySettings;
  allUsers: UserProfile[];
  leavePolicies: LeavePolicy[];
  leaveRequests: LeaveRequest[];
  onQueueEmail: (payload: PendingEmailDispatch) => void;
}

export const LeaveModule: React.FC<LeaveModuleProps> = ({
  currentUser,
  effectiveRole,
  settings,
  allUsers,
  leavePolicies,
  leaveRequests,
  onQueueEmail,
}) => {
  const [subTab, setSubTab] = useState<'my' | 'approvals' | 'policies'>('my');

  // Form state
  const [leaveType, setLeaveType] = useState<LeaveType>('cuti_tahunan');
  const [startDate, setStartDate] = useState(getTodayIsoDate());
  const [endDate, setEndDate] = useState(getTodayIsoDate());
  const [reason, setReason] = useState('');
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentDataUrl, setAttachmentDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Review state
  const [reviewReq, setReviewReq] = useState<LeaveRequest | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  // Policy Editor state (HR Admin & Super Admin)
  const [policyScope, setPolicyScope] = useState<'global' | 'personal'>('global');
  const [selectedEmpUid, setSelectedEmpUid] = useState<string>('');
  const [policyDraft, setPolicyDraft] = useState<Omit<LeavePolicy, 'id' | 'updatedAt'>>({
    ...DEFAULT_GLOBAL_POLICY,
    updatedBy: currentUser.uid,
  });
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);

  const canApprove =
    effectiveRole === 'lead' ||
    effectiveRole === 'hr_admin' ||
    effectiveRole === 'super_admin';
  const canManagePolicies =
    effectiveRole === 'hr_admin' || effectiveRole === 'super_admin';

  useEffect(() => {
    if (subTab === 'approvals' && !canApprove) setSubTab('my');
    if (subTab === 'policies' && !canManagePolicies) setSubTab('my');
  }, [effectiveRole, subTab, canApprove, canManagePolicies]);

  const globalPolicy = useMemo(() => {
    return (
      leavePolicies.find((p) => p.id === 'global' || p.scope === 'global') || {
        id: 'global',
        ...DEFAULT_GLOBAL_POLICY,
      }
    );
  }, [leavePolicies]);

  const activeUserPolicy = useMemo(() => {
    return (
      leavePolicies.find(
        (p) => p.scope === 'personal' && p.targetUserId === currentUser.uid
      ) || globalPolicy
    );
  }, [leavePolicies, currentUser.uid, globalPolicy]);

  // Sync policy editor draft when switching scope or employee
  useEffect(() => {
    if (policyScope === 'global') {
      setPolicyDraft({
        ...globalPolicy,
        scope: 'global',
        targetUserId: '',
        targetUserName: '',
        updatedBy: currentUser.uid,
      });
    } else if (selectedEmpUid) {
      const existingPersonal = leavePolicies.find(
        (p) => p.scope === 'personal' && p.targetUserId === selectedEmpUid
      );
      const emp = allUsers.find((u) => u.uid === selectedEmpUid);
      if (existingPersonal) {
        setPolicyDraft({
          ...existingPersonal,
          scope: 'personal',
          targetUserId: selectedEmpUid,
          targetUserName: emp?.displayName || existingPersonal.targetUserName || '',
          updatedBy: currentUser.uid,
        });
      } else {
        setPolicyDraft({
          ...globalPolicy,
          scope: 'personal',
          targetUserId: selectedEmpUid,
          targetUserName: emp?.displayName || '',
          customNotes: `Kebijakan personal untuk ${emp?.displayName || 'karyawan'}`,
          updatedBy: currentUser.uid,
        });
      }
    }
  }, [policyScope, selectedEmpUid, globalPolicy, leavePolicies, allUsers, currentUser.uid]);

  const myRequests = useMemo(
    () =>
      leaveRequests
        .filter((r) => r.userId === currentUser.uid)
        .sort((a, b) => (b.startDate > a.startDate ? 1 : -1)),
    [leaveRequests, currentUser.uid]
  );

  const usedAnnualDays = useMemo(
    () =>
      myRequests
        .filter((r) => r.leaveType === 'cuti_tahunan' && r.overallStatus === 'approved')
        .reduce((sum, r) => sum + r.totalDays, 0),
    [myRequests]
  );

  const usedSickDays = useMemo(
    () =>
      myRequests
        .filter((r) => r.leaveType === 'sakit' && r.overallStatus === 'approved')
        .reduce((sum, r) => sum + r.totalDays, 0),
    [myRequests]
  );

  const approvalQueue = useMemo(() => {
    return leaveRequests
      .filter((r) => {
        if (effectiveRole === 'super_admin' || effectiveRole === 'hr_admin') return true;
        if (effectiveRole === 'lead') {
          return (
            r.managerId === currentUser.uid ||
            (r.managerEmail && r.managerEmail === currentUser.email) ||
            r.userId === currentUser.uid
          );
        }
        return false;
      })
      .sort((a, b) => (b.startDate > a.startDate ? 1 : -1));
  }, [leaveRequests, effectiveRole, currentUser.uid]);

  const totalDays = computeDaysInclusive(startDate, endDate);
  const selectedLeaveMeta =
    LEAVE_TYPES.find((t) => t.value === leaveType) || LEAVE_TYPES[0];

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 320000) {
      setFeedback({
        type: 'err',
        text: 'Ukuran lampiran maksimal 300 KB (gunakan gambar/PDF ringkas).',
      });
      return;
    }
    const url = await readFileAsDataUrl(file);
    if (url.length > VALIDATION_LIMITS.MAX_LEAVE_ATTACHMENT_CHARS) {
      setFeedback({ type: 'err', text: 'File terlalu besar untuk diunggah.' });
      return;
    }
    setAttachmentName(file.name.slice(0, 160));
    setAttachmentDataUrl(url);
    setFeedback(null);
  };

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (endDate < startDate) {
      setFeedback({ type: 'err', text: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' });
      return;
    }
    if (reason.trim().length < 3) {
      setFeedback({ type: 'err', text: 'Alasan pengajuan wajib diisi.' });
      return;
    }
    if (
      leaveType === 'cuti_tahunan' &&
      usedAnnualDays + totalDays > activeUserPolicy.annualQuota
    ) {
      setFeedback({
        type: 'err',
        text: `Sisa kuota cuti tahunan Anda tidak mencukupi (tersisa ${Math.max(
          0,
          activeUserPolicy.annualQuota - usedAnnualDays
        )} hari).`,
      });
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        userId: currentUser.uid,
        userName: currentUser.displayName.slice(0, VALIDATION_LIMITS.DISPLAY_NAME_MAX),
        userEmail: currentUser.email,
        department: currentUser.department.slice(0, VALIDATION_LIMITS.DEPARTMENT_MAX),
        managerId: currentUser.managerId || '',
        managerEmail: currentUser.managerEmail || '',
        leaveType,
        leaveLabel: selectedLeaveMeta.label,
        startDate,
        endDate,
        totalDays,
        reason: reason.trim().slice(0, VALIDATION_LIMITS.NOTES_MAX),
        leadApprovalStatus: 'pending',
        hrApprovalStatus: 'pending',
        overallStatus: 'pending_lead',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (attachmentName && attachmentDataUrl) {
        payload.attachmentName = attachmentName;
        payload.attachmentDataUrl = attachmentDataUrl;
      }

      await addDoc(collection(db, 'leave_requests'), payload);

      setReason('');
      setAttachmentName(null);
      setAttachmentDataUrl(null);
      setFeedback({
        type: 'ok',
        text: 'Pengajuan izin/cuti berhasil dikirim dan menunggu persetujuan Lead & HR Admin.',
      });

      const recipients: string[] = [];
      if (currentUser.managerEmail) {
        recipients.push(currentUser.managerEmail);
        await createInAppNotification({
          recipientUserId: currentUser.managerId,
          recipientEmail: currentUser.managerEmail,
          title: `Pengajuan ${selectedLeaveMeta.label} - ${currentUser.displayName}`,
          message: `${currentUser.displayName} mengajukan ${selectedLeaveMeta.label} (${startDate} s/d ${endDate}, ${totalDays} hari). Alasan: ${reason.trim()}`,
          category: 'leave',
          emailSent: false,
          sender: currentUser,
        });
      }
      if (settings.hrNotificationEmail) {
        recipients.push(settings.hrNotificationEmail);
        await createInAppNotification({
          recipientEmail: settings.hrNotificationEmail,
          title: `Pengajuan ${selectedLeaveMeta.label} (${currentUser.department})`,
          message: `${currentUser.displayName} mengajukan ${selectedLeaveMeta.label} (${totalDays} hari: ${startDate} – ${endDate}).`,
          category: 'leave',
          emailSent: false,
          sender: currentUser,
        });
      }
      if (recipients.length > 0) {
        onQueueEmail({
          to: recipients,
          subject: `[C-SYNC] Pengajuan ${selectedLeaveMeta.label} - ${currentUser.displayName}`,
          body: `Halo Lead & Tim HR,\n\nKaryawan ${currentUser.displayName} (${currentUser.department}) mengajukan permohonan izin/cuti:\n- Jenis: ${selectedLeaveMeta.label} (${selectedLeaveMeta.legalBasis})\n- Periode: ${startDate} s/d ${endDate} (${totalDays} hari)\n- Alasan: ${reason.trim()}\n\nMohon tinjau persetujuan melalui C-SYNC HRIS.\n\nTerima kasih,\nC-SYNC HRIS`,
          category: 'leave',
          contextLabel: 'Notifikasi Pengajuan Izin/Cuti ke Lead & HR',
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'leave_requests');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLeaveApproval = async (
    req: LeaveRequest,
    tier: 'lead' | 'hr',
    decision: 'approved' | 'rejected'
  ) => {
    setReviewLoading(true);
    try {
      const nextLead = tier === 'lead' ? decision : req.leadApprovalStatus;
      const nextHr = tier === 'hr' ? decision : req.hrApprovalStatus;

      let nextOverall: LeaveRequest['overallStatus'] = 'pending_lead';
      if (nextLead === 'rejected' || nextHr === 'rejected') {
        nextOverall = 'rejected';
      } else if (nextLead === 'approved' && nextHr === 'approved') {
        nextOverall = 'approved';
      } else if (nextLead === 'approved' && nextHr === 'pending') {
        nextOverall = 'pending_hr';
      } else {
        nextOverall = 'pending_lead';
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

      await updateDoc(doc(db, 'leave_requests', req.id), payload);

      const label = decision === 'approved' ? 'Disetujui' : 'Ditolak';
      await createInAppNotification({
        recipientUserId: req.userId,
        recipientEmail: req.userEmail,
        title: `${req.leaveLabel} ${label} (${tier === 'lead' ? 'Lead' : 'HR'})`,
        message: `Pengajuan ${req.leaveLabel} (${req.startDate} – ${req.endDate}) telah ${label.toLowerCase()} oleh ${currentUser.displayName}. Status akhir: ${nextOverall}.`,
        category: 'leave',
        emailSent: false,
        sender: currentUser,
      });

      onQueueEmail({
        to: [req.userEmail],
        subject: `[C-SYNC] Update Pengajuan ${req.leaveLabel}: ${label}`,
        body: `Halo ${req.userName},\n\nPengajuan ${req.leaveLabel} Anda untuk tanggal ${req.startDate} s/d ${req.endDate} (${req.totalDays} hari) telah ditinjau oleh ${tier === 'lead' ? 'Lead/Manager' : 'HR Admin'} (${currentUser.displayName}) dengan hasil: ${label}.\n\nStatus saat ini: ${nextOverall.toUpperCase()}\nCatatan: ${reviewNote.trim() || '-'}\n\nSalam,\nC-SYNC HRIS`,
        category: 'leave',
        contextLabel: `Notifikasi Keputusan Cuti ke ${req.userName}`,
      });

      setReviewReq(null);
      setReviewNote('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `leave_requests/${req.id}`);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setPolicyMessage(null);
    if (policyScope === 'personal' && !selectedEmpUid) {
      setPolicyMessage('Pilih karyawan terlebih dahulu untuk kebijakan personal.');
      return;
    }

    setPolicySaving(true);
    try {
      const policyId =
        policyScope === 'global' ? 'global' : `emp_${selectedEmpUid}`;
      const emp = allUsers.find((u) => u.uid === selectedEmpUid);

      await setDoc(doc(db, 'leave_policies', policyId), {
        scope: policyScope,
        targetUserId: policyScope === 'personal' ? selectedEmpUid : '',
        targetUserName: policyScope === 'personal' ? emp?.displayName || '' : '',
        annualQuota: Number(policyDraft.annualQuota),
        sickQuota: Number(policyDraft.sickQuota),
        maternityDays: Number(policyDraft.maternityDays),
        miscarriageDays: Number(policyDraft.miscarriageDays),
        menstrualDaysPerMonth: Number(policyDraft.menstrualDaysPerMonth),
        marriageDays: Number(policyDraft.marriageDays),
        paternityDays: Number(policyDraft.paternityDays),
        bereavementDays: Number(policyDraft.bereavementDays),
        religiousDays: Number(policyDraft.religiousDays),
        requireMedicalNoteAfterDays: Number(policyDraft.requireMedicalNoteAfterDays),
        allowCarryOver: Boolean(policyDraft.allowCarryOver),
        maxCarryOverDays: Number(policyDraft.maxCarryOverDays),
        customNotes: (policyDraft.customNotes || '').slice(0, 500),
        updatedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });

      setPolicyMessage(
        policyScope === 'global'
          ? 'Kebijakan cuti global perusahaan berhasil diperbarui.'
          : `Kebijakan cuti personal untuk ${emp?.displayName || 'karyawan'} berhasil disimpan.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'leave_policies');
    } finally {
      setPolicySaving(false);
    }
  };

  const handleDeletePersonalPolicy = async (policyId: string) => {
    try {
      await deleteDoc(doc(db, 'leave_policies', policyId));
      setPolicyMessage('Kebijakan personal dihapus; karyawan kembali mengikuti kebijakan global.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `leave_policies/${policyId}`);
    }
  };

  const renderOverallStatus = (st: LeaveRequest['overallStatus']) => {
    switch (st) {
      case 'approved':
        return <span className="text-emerald-700 font-medium">Disetujui Penuh</span>;
      case 'pending_lead':
        return <span className="text-amber-700 font-medium">Menunggu Lead</span>;
      case 'pending_hr':
        return <span className="text-blue-700 font-medium">Menunggu HR Admin</span>;
      case 'rejected':
        return <span className="text-red-700 font-medium">Ditolak</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Izin, Cuti &amp; Kebijakan Ketenagakerjaan
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Pengajuan izin sakit, cuti tahunan, melahirkan, dan cuti UU dengan approval berjenjang Lead &amp; HR
          </p>
        </div>

        {(canApprove || canManagePolicies) && (
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
              Pengajuan Saya
            </button>
            {canApprove && (
              <button
                type="button"
                onClick={() => setSubTab('approvals')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  subTab === 'approvals'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Approval ({approvalQueue.filter((r) => r.overallStatus === 'pending_lead' || r.overallStatus === 'pending_hr').length})
              </button>
            )}
            {canManagePolicies && (
              <button
                type="button"
                onClick={() => setSubTab('policies')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  subTab === 'policies'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pengaturan Kebijakan
              </button>
            )}
          </div>
        )}
      </div>

      {subTab === 'my' && (
        <>
          {/* Quota Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Sisa Cuti Tahunan</div>
              <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
                {Math.max(0, activeUserPolicy.annualQuota - usedAnnualDays)}{' '}
                <span className="text-xs font-normal text-slate-500">
                  / {activeUserPolicy.annualQuota} hr
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {activeUserPolicy.scope === 'personal'
                  ? 'Kebijakan Personal Aktif'
                  : 'Kebijakan Standar Perusahaan'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Kuota Izin Sakit</div>
              <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
                {Math.max(0, activeUserPolicy.sickQuota - usedSickDays)}{' '}
                <span className="text-xs font-normal text-slate-500">
                  / {activeUserPolicy.sickQuota} hr
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Surat dokter &gt; {activeUserPolicy.requireMedicalNoteAfterDays} hari
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Cuti Melahirkan (UU)</div>
              <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
                {activeUserPolicy.maternityDays}{' '}
                <span className="text-xs font-normal text-slate-500">hari</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Pasal 82 UU Ketenagakerjaan
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Pengajuan Berjalan</div>
              <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
                {
                  myRequests.filter(
                    (r) =>
                      r.overallStatus === 'pending_lead' ||
                      r.overallStatus === 'pending_hr'
                  ).length
                }
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Approval Lead &amp; HR Admin
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Submit Form */}
            <form
              onSubmit={handleSubmitLeave}
              className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <div className="pb-3 border-b border-slate-200">
                <h2 className="text-base font-semibold text-slate-900">
                  Ajukan Izin atau Cuti
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Otomatis diteruskan ke Lead &amp; HR Admin
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Jenis Izin / Cuti
                </label>
                <select
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                >
                  {LEAVE_TYPES.map((lt) => (
                    <option key={lt.value} value={lt.value}>
                      {lt.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span>
                    {selectedLeaveMeta.legalBasis} · {selectedLeaveMeta.defaultDaysLabel}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tanggal Mulai
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tanggal Selesai
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                  />
                </div>
              </div>

              <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
                <span>Total Durasi Pengajuan</span>
                <span className="font-mono-tabular font-semibold text-slate-900">
                  {totalDays} hari
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alasan / Keterangan
                </label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={VALIDATION_LIMITS.NOTES_MAX}
                  required
                  placeholder="Jelaskan alasan pengajuan izin atau cuti Anda..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Lampiran Dokumen (Surat Dokter / Pendukung, maks 300 KB)
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-600 hover:border-blue-600 cursor-pointer">
                  <FileUp className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="truncate">
                    {attachmentName || 'Pilih file gambar atau PDF...'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleAttachment}
                    className="hidden"
                  />
                </label>
              </div>

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

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-blue-700 text-white text-sm font-semibold rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors cursor-pointer min-h-[44px]"
              >
                {submitting ? 'Mengirim Pengajuan...' : 'Kirim Pengajuan Cuti / Izin'}
              </button>
            </form>

            {/* Personal History */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200">
                <h2 className="text-base font-semibold text-slate-900">
                  Riwayat Pengajuan Saya
                </h2>
                <p className="text-xs text-slate-500">
                  Status approval Lead &amp; HR Admin secara real-time
                </p>
              </div>

              {myRequests.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  Belum ada pengajuan izin atau cuti.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {myRequests.map((req) => (
                    <div key={req.id} className="p-4 space-y-2 hover:bg-slate-50/60">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-sm text-slate-900">
                          {req.leaveLabel}
                        </div>
                        <div className="text-xs">{renderOverallStatus(req.overallStatus)}</div>
                      </div>
                      <div className="text-xs font-mono-tabular text-slate-600 flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {req.startDate} s/d {req.endDate} ({req.totalDays} hari)
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">{req.reason}</p>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
                        <div>
                          Lead: <strong>{req.leadApprovalStatus}</strong> · HR:{' '}
                          <strong>{req.hrApprovalStatus}</strong>
                        </div>
                        {req.overallStatus === 'pending_lead' && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await deleteDoc(doc(db, 'leave_requests', req.id));
                              } catch (err) {
                                handleFirestoreError(
                                  err,
                                  OperationType.DELETE,
                                  `leave_requests/${req.id}`
                                );
                              }
                            }}
                            className="text-red-600 hover:underline cursor-pointer"
                          >
                            Batalkan Pengajuan
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Approval Queue */}
      {subTab === 'approvals' && canApprove && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Antrean Persetujuan Izin &amp; Cuti
            </h2>
            <p className="text-xs text-slate-500">
              Persetujuan dua tahap oleh Lead/Manager dan HR Admin
            </p>
          </div>

          {approvalQueue.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Tidak ada pengajuan izin atau cuti yang perlu ditinjau.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                    <th className="py-2.5 px-4">Karyawan</th>
                    <th className="py-2.5 px-4">Jenis Cuti / Izin</th>
                    <th className="py-2.5 px-4">Periode</th>
                    <th className="py-2.5 px-4">Lead / HR</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {approvalQueue.map((req) => {
                    const isTerminal =
                      req.overallStatus === 'approved' || req.overallStatus === 'rejected';
                    const canLeadAct =
                      !isTerminal &&
                      (effectiveRole === 'lead' || effectiveRole === 'super_admin') &&
                      req.leadApprovalStatus === 'pending' &&
                      (req.managerId === currentUser.uid ||
                        (req.managerEmail && req.managerEmail === currentUser.email) ||
                        effectiveRole === 'super_admin');
                    const canHrAct =
                      !isTerminal &&
                      (effectiveRole === 'hr_admin' || effectiveRole === 'super_admin') &&
                      req.hrApprovalStatus === 'pending';

                    return (
                      <tr key={req.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">{req.userName}</div>
                          <div className="text-slate-500">{req.department}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">{req.leaveLabel}</div>
                          <div className="text-slate-600 max-w-[240px] truncate" title={req.reason}>
                            {req.reason}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular whitespace-nowrap">
                          <div>
                            {req.startDate} → {req.endDate}
                          </div>
                          <div className="text-slate-500">{req.totalDays} hari</div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600">
                          <div>Lead: {req.leadApprovalStatus}</div>
                          <div>HR: {req.hrApprovalStatus}</div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {renderOverallStatus(req.overallStatus)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          {req.attachmentDataUrl && (
                            <a
                              href={req.attachmentDataUrl}
                              download={req.attachmentName || 'lampiran'}
                              className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                            >
                              Lampiran
                            </a>
                          )}
                          {(canLeadAct || canHrAct) && (
                            <button
                              type="button"
                              onClick={() => {
                                setReviewReq(req);
                                setReviewNote('');
                              }}
                              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 cursor-pointer"
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
      )}

      {/* Policy Settings (HR Admin & Super Admin) */}
      {subTab === 'policies' && canManagePolicies && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSavePolicy}
            className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-blue-700" />
                  Pengaturan Kebijakan Cuti (Menyeluruh &amp; Personal)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Atur hak cuti standar perusahaan atau buat pengecualian kuota per karyawan
                </p>
              </div>
              <div className="inline-flex p-1 bg-slate-100 border border-slate-200 rounded-lg self-start">
                <button
                  type="button"
                  onClick={() => setPolicyScope('global')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    policyScope === 'global'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Global Perusahaan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPolicyScope('personal');
                    if (!selectedEmpUid && allUsers.length > 0) {
                      setSelectedEmpUid(allUsers[0].uid);
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    policyScope === 'personal'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Personal Karyawan
                </button>
              </div>
            </div>

            {policyScope === 'personal' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Pilih Karyawan
                </label>
                <select
                  value={selectedEmpUid}
                  onChange={(e) => setSelectedEmpUid(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="">-- Pilih Karyawan --</option>
                  {allUsers.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.displayName} ({u.department} · {u.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cuti Tahunan (hari/thn)
                </label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={policyDraft.annualQuota}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, annualQuota: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Kuota Sakit (hari/thn)
                </label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={policyDraft.sickQuota}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, sickQuota: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cuti Melahirkan (hari)
                </label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={policyDraft.maternityDays}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, maternityDays: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cuti Keguguran (hari)
                </label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={policyDraft.miscarriageDays}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, miscarriageDays: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cuti Haid (hari/bln)
                </label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={policyDraft.menstrualDaysPerMonth}
                  onChange={(e) =>
                    setPolicyDraft({
                      ...policyDraft,
                      menstrualDaysPerMonth: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cuti Menikah (hari)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={policyDraft.marriageDays}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, marriageDays: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Istri Melahirkan (hari)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={policyDraft.paternityDays}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, paternityDays: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cuti Duka (hari)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={policyDraft.bereavementDays}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, bereavementDays: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Wajib Surat Dokter (&gt; hr)
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={policyDraft.requireMedicalNoteAfterDays}
                  onChange={(e) =>
                    setPolicyDraft({
                      ...policyDraft,
                      requireMedicalNoteAfterDays: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyDraft.allowCarryOver}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, allowCarryOver: e.target.checked })
                  }
                  className="rounded border-slate-300"
                />
                Izinkan Carry-Over Sisa Cuti Tahunan
              </label>
              {policyDraft.allowCarryOver && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600">Maks Carry-Over:</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={policyDraft.maxCarryOverDays}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        maxCarryOverDays: Number(e.target.value),
                      })
                    }
                    className="w-16 px-2 py-1 border border-slate-200 rounded font-mono-tabular"
                  />
                  <span>hari</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Catatan Kebijakan
              </label>
              <textarea
                rows={2}
                value={policyDraft.customNotes || ''}
                onChange={(e) =>
                  setPolicyDraft({ ...policyDraft, customNotes: e.target.value })
                }
                maxLength={500}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            {policyMessage && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                {policyMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={policySaving}
              className="px-4 py-2.5 bg-blue-700 text-white text-sm font-semibold rounded-lg hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              {policySaving
                ? 'Menyimpan...'
                : policyScope === 'global'
                  ? 'Simpan Kebijakan Global'
                  : 'Simpan Kebijakan Personal Karyawan'}
            </button>
          </form>

          {/* Active Personal Overrides List */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Daftar Kebijakan Personal Aktif
              </h3>
              <p className="text-xs text-slate-500">
                Karyawan di bawah ini memiliki kuota cuti khusus di luar kebijakan global
              </p>
            </div>
            <div className="divide-y divide-slate-200">
              {leavePolicies.filter((p) => p.scope === 'personal').length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Belum ada kebijakan personal karyawan. Seluruh karyawan mengikuti kebijakan global.
                </div>
              ) : (
                leavePolicies
                  .filter((p) => p.scope === 'personal')
                  .map((p) => (
                    <div key={p.id} className="p-4 flex items-center justify-between gap-3">
                      <div className="text-xs space-y-1">
                        <div className="font-semibold text-slate-900">
                          {p.targetUserName || p.targetUserId}
                        </div>
                        <div className="font-mono-tabular text-slate-600">
                          Tahunan: {p.annualQuota}h · Sakit: {p.sickQuota}h · Melahirkan: {p.maternityDays}h
                        </div>
                        {p.customNotes && (
                          <div className="text-slate-500">{p.customNotes}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeletePersonalPolicy(p.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                        title="Hapus Override Personal"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Review Leave Modal */}
      {reviewReq && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Approval {reviewReq.leaveLabel} · {reviewReq.userName}
              </h3>
              <button
                type="button"
                onClick={() => setReviewReq(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                <div>
                  <strong>Periode:</strong> {reviewReq.startDate} s/d {reviewReq.endDate} (
                  {reviewReq.totalDays} hari)
                </div>
                <div>
                  <strong>Alasan:</strong> {reviewReq.reason}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Catatan Persetujuan / Penolakan
                </label>
                <textarea
                  rows={2}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  maxLength={VALIDATION_LIMITS.APPROVAL_NOTE_MAX}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="flex flex-col gap-2">
                {(effectiveRole === 'lead' || effectiveRole === 'super_admin') &&
                  reviewReq.leadApprovalStatus === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={reviewLoading}
                        onClick={() => handleLeaveApproval(reviewReq, 'lead', 'approved')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Setujui (Lead)
                      </button>
                      <button
                        type="button"
                        disabled={reviewLoading}
                        onClick={() => handleLeaveApproval(reviewReq, 'lead', 'rejected')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Tolak (Lead)
                      </button>
                    </div>
                  )}
                {(effectiveRole === 'hr_admin' || effectiveRole === 'super_admin') &&
                  reviewReq.hrApprovalStatus === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={reviewLoading}
                        onClick={() => handleLeaveApproval(reviewReq, 'hr', 'approved')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-700 text-white font-medium rounded-lg hover:bg-blue-800 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Setujui (HR)
                      </button>
                      <button
                        type="button"
                        disabled={reviewLoading}
                        onClick={() => handleLeaveApproval(reviewReq, 'hr', 'rejected')}
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
