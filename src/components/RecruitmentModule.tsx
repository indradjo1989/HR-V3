import React, { useMemo, useState } from 'react';
import {
  Archive,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  FileUp,
  LayoutGrid,
  List,
  Search,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  Candidate,
  PendingEmailDispatch,
  RECRUITMENT_STAGES,
  RecruitmentStage,
  UserProfile,
  UserRole,
  VALIDATION_LIMITS,
} from '../types';
import { readFileAsDataUrl, sanitizeEmailToId } from '../utils/geo';

interface RecruitmentModuleProps {
  currentUser: UserProfile;
  effectiveRole: UserRole;
  candidates: Candidate[];
  onQueueEmail: (payload: PendingEmailDispatch) => void;
}

const OFFER_STATUS_LABELS: Record<
  NonNullable<Candidate['offerStatus']>,
  { label: string; colorClass: string }
> = {
  draft: { label: 'Draft Offer', colorClass: 'text-slate-600' },
  sent: { label: 'Offer Terkirim', colorClass: 'text-blue-700' },
  negotiating: { label: 'Negosiasi', colorClass: 'text-amber-700' },
  accepted: { label: 'Diterima (Accepted)', colorClass: 'text-emerald-700' },
  declined: { label: 'Ditolak Kandidat', colorClass: 'text-red-700' },
};

export const RecruitmentModule: React.FC<RecruitmentModuleProps> = ({
  currentUser,
  effectiveRole,
  candidates,
  onQueueEmail,
}) => {
  const [viewTab, setViewTab] = useState<'pipeline' | 'offering' | 'bank' | 'archive'>('pipeline');
  const [pipelineLayout, setPipelineLayout] = useState<'board' | 'table'>('board');
  const [offeringFilter, setOfferingFilter] = useState<'all' | 'offering' | 'hired'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // Add Candidate state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('Engineering');
  const [source, setSource] = useState('LinkedIn / Referral');
  const [assessmentRequired, setAssessmentRequired] = useState(true);
  const [isBanked, setIsBanked] = useState(true);
  const [screeningScore, setScreeningScore] = useState(80);
  const [cvFile, setCvFile] = useState<{
    name: string;
    mimeType: string;
    size: number;
    dataUrl: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit Candidate detail notes
  const [editDraft, setEditDraft] = useState<Candidate | null>(null);
  const [updating, setUpdating] = useState(false);

  const activePipelineStageIds: RecruitmentStage[] = [
    'cv_screening',
    'hr_interview',
    'user_interview',
    'assessment',
    'ceo_interview',
  ];

  const counts = useMemo(() => {
    return {
      pipeline: candidates.filter((c) => activePipelineStageIds.includes(c.stage)).length,
      offering: candidates.filter((c) => c.stage === 'offering' || c.stage === 'hired').length,
      bank: candidates.filter((c) => c.isBanked || c.stage === 'talent_bank').length,
      archive: candidates.filter((c) => c.stage === 'rejected').length,
    };
  }, [candidates]);

  const filteredCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return candidates.filter((c) => {
      if (viewTab === 'pipeline' && !activePipelineStageIds.includes(c.stage)) {
        return false;
      }
      if (viewTab === 'offering') {
        if (c.stage !== 'offering' && c.stage !== 'hired') return false;
        if (offeringFilter === 'offering' && c.stage !== 'offering') return false;
        if (offeringFilter === 'hired' && c.stage !== 'hired') return false;
      }
      if (viewTab === 'bank' && !c.isBanked && c.stage !== 'talent_bank') {
        return false;
      }
      if (viewTab === 'archive' && c.stage !== 'rejected') {
        return false;
      }
      if (!q) return true;
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.position.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    });
  }, [candidates, viewTab, offeringFilter, searchQuery]);

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > VALIDATION_LIMITS.MAX_CV_BYTES) {
      setFormError(
        `Ukuran file CV maksimal ${Math.round(VALIDATION_LIMITS.MAX_CV_BYTES / 1000)} KB.`
      );
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setCvFile({
      name: file.name.slice(0, 180),
      mimeType: file.type || 'application/pdf',
      size: file.size,
      dataUrl,
    });
  };

  const handleCreateCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!fullName.trim() || !email.trim() || !position.trim()) {
      setFormError('Nama, email, dan posisi wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      const candidateId = `cand_${Date.now()}`;
      const batch = writeBatch(db);
      let cvFileId = '';

      if (cvFile) {
        cvFileId = `cv_${candidateId}`;
        batch.set(doc(db, 'candidate_cvs', cvFileId), {
          candidateId,
          fileName: cvFile.name,
          mimeType: cvFile.mimeType,
          fileSizeBytes: cvFile.size,
          dataUrl: cvFile.dataUrl,
          uploadedBy: currentUser.uid,
          createdAt: serverTimestamp(),
        });
      }

      const candPayload: Record<string, unknown> = {
        fullName: fullName.trim().slice(0, 120),
        email: email.trim().slice(0, 160),
        phone: phone.trim().slice(0, 40),
        position: position.trim().slice(0, 120),
        department: department.trim().slice(0, 80),
        source: source.trim().slice(0, 80),
        stage: 'cv_screening',
        assessmentRequired,
        isBanked,
        screeningScore: Number(screeningScore),
        hrNotes: '',
        userNotes: '',
        assessmentNotes: '',
        ceoNotes: '',
        offerSalary: '',
        offerStatus: 'draft',
        expectedJoinDate: '',
        convertedToEmployee: false,
        recruiterId: currentUser.uid,
        recruiterName: currentUser.displayName.slice(0, 120),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (cvFile && cvFileId) {
        candPayload.cvFileName = cvFile.name;
        candPayload.cvFileId = cvFileId;
      }

      batch.set(doc(db, 'candidates', candidateId), candPayload);
      await batch.commit();

      setAddModalOpen(false);
      setFullName('');
      setEmail('');
      setPhone('');
      setPosition('');
      setCvFile(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'candidates');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadCv = async (cand: Candidate) => {
    if (!cand.cvFileId) return;
    try {
      const snap = await getDoc(doc(db, 'candidate_cvs', cand.cvFileId));
      if (!snap.exists()) return;
      const data = snap.data();
      const link = document.createElement('a');
      link.href = data.dataUrl;
      link.download = data.fileName || `${cand.fullName}-CV.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `candidate_cvs/${cand.cvFileId}`);
    }
  };

  const getNextStage = (cand: Candidate): RecruitmentStage | null => {
    switch (cand.stage) {
      case 'cv_screening':
        return 'hr_interview';
      case 'hr_interview':
        return 'user_interview';
      case 'user_interview':
        return cand.assessmentRequired ? 'assessment' : 'ceo_interview';
      case 'assessment':
        return 'ceo_interview';
      case 'ceo_interview':
        return 'offering';
      case 'offering':
        return 'hired';
      default:
        return null;
    }
  };

  const handleSaveCandidateDetail = async (nextStageOverride?: RecruitmentStage) => {
    if (!editDraft) return;
    setUpdating(true);
    try {
      const targetStage = nextStageOverride || editDraft.stage;
      const nextOfferStatus =
        targetStage === 'hired'
          ? 'accepted'
          : targetStage === 'offering' && !editDraft.offerStatus
            ? 'sent'
            : editDraft.offerStatus || 'draft';

      await updateDoc(doc(db, 'candidates', editDraft.id), {
        stage: targetStage,
        assessmentRequired: editDraft.assessmentRequired,
        isBanked: targetStage === 'talent_bank' ? true : editDraft.isBanked,
        screeningScore: Number(editDraft.screeningScore),
        hrNotes: (editDraft.hrNotes || '').slice(0, VALIDATION_LIMITS.CANDIDATE_NOTES_MAX),
        userNotes: (editDraft.userNotes || '').slice(0, VALIDATION_LIMITS.CANDIDATE_NOTES_MAX),
        assessmentNotes: (editDraft.assessmentNotes || '').slice(
          0,
          VALIDATION_LIMITS.CANDIDATE_NOTES_MAX
        ),
        ceoNotes: (editDraft.ceoNotes || '').slice(0, VALIDATION_LIMITS.CANDIDATE_NOTES_MAX),
        offerSalary: (editDraft.offerSalary || '').slice(0, 100),
        offerStatus: nextOfferStatus,
        expectedJoinDate: (editDraft.expectedJoinDate || '').slice(0, 20),
        updatedAt: serverTimestamp(),
      });

      const stageMeta = RECRUITMENT_STAGES.find((s) => s.id === targetStage);
      if (nextStageOverride && editDraft.email) {
        onQueueEmail({
          to: [editDraft.email],
          subject: `[C-SYNC Careers] Pembaruan Tahap Rekrutmen: ${stageMeta?.label || targetStage}`,
          body: `Halo ${editDraft.fullName},\n\nTerima kasih telah mengikuti proses rekrutmen untuk posisi ${editDraft.position} di C-SYNC.\nStatus lamaran Anda saat ini telah diperbarui ke tahap: ${stageMeta?.label || targetStage}.\n\nTim Talent Acquisition kami akan menghubungi Anda untuk jadwal dan langkah selanjutnya.\n\nSalam hangat,\n${currentUser.displayName}\nTalent Acquisition · C-SYNC`,
          category: 'recruitment',
          contextLabel: `Kirim Update Rekrutmen ke ${editDraft.fullName}`,
        });
      }

      setSelectedCandidate(null);
      setEditDraft(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `candidates/${editDraft.id}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleConvertToEmployee = async (cand: Candidate) => {
    setUpdating(true);
    try {
      const normalizedEmail = cand.email.trim().toLowerCase();
      const emailKey = sanitizeEmailToId(normalizedEmail);
      const inviteId = `inv_${emailKey}`;
      const batch = writeBatch(db);

      batch.set(doc(db, 'user_invites', inviteId), {
        email: normalizedEmail,
        displayName: cand.fullName.slice(0, 120),
        role: 'employee',
        department: cand.department.slice(0, 80),
        jobTitle: cand.position.slice(0, 80),
        managerId: '',
        managerName: '',
        managerEmail: '',
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (effectiveRole === 'super_admin') {
        const preUserId = `emp_${emailKey}`;
        batch.set(doc(db, 'users', preUserId), {
          uid: preUserId,
          email: normalizedEmail,
          displayName: cand.fullName.slice(0, 120),
          photoURL: '',
          role: 'employee',
          department: cand.department.slice(0, 80),
          jobTitle: cand.position.slice(0, 80),
          managerId: '',
          managerName: '',
          managerEmail: '',
          inviteId,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      batch.update(doc(db, 'candidates', cand.id), {
        stage: 'hired',
        offerStatus: 'accepted',
        convertedToEmployee: true,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      setActionToast(
        `${cand.fullName} berhasil diintegrasikan sebagai karyawan baru (${normalizedEmail}).`
      );
      setTimeout(() => setActionToast(null), 5000);
      setSelectedCandidate(null);
      setEditDraft(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'user_invites');
    } finally {
      setUpdating(false);
    }
  };

  const activePipelineStages = RECRUITMENT_STAGES.filter((s) =>
    activePipelineStageIds.includes(s.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Talent Acquisition &amp; Proses Rekrutmen
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Pipeline Seleksi, Offering &amp; Onboarding terpisah rapi, CV Bank, dan Arsip Kandidat
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-700 text-white text-xs font-semibold rounded-lg hover:bg-blue-800 cursor-pointer whitespace-nowrap shrink-0 self-start"
        >
          <UserPlus className="w-4 h-4" />
          Tambah Kandidat
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setViewTab('pipeline')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
              viewTab === 'pipeline'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Pipeline Seleksi ({counts.pipeline})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('offering')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
              viewTab === 'offering'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Offering &amp; Onboarding ({counts.offering})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('bank')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
              viewTab === 'bank'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            CV Bank ({counts.bank})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('archive')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
              viewTab === 'archive'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Arsip ({counts.archive})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari kandidat atau posisi..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </div>

          {viewTab === 'pipeline' && (
            <div className="inline-flex p-1 bg-slate-100 border border-slate-200 rounded-lg">
              <button
                type="button"
                onClick={() => setPipelineLayout('board')}
                className={`p-1.5 rounded cursor-pointer ${
                  pipelineLayout === 'board' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                }`}
                title="Tampilan Board"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPipelineLayout('table')}
                className={`p-1.5 rounded cursor-pointer ${
                  pipelineLayout === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                }`}
                title="Tampilan Tabel"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {actionToast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionToast}</span>
        </div>
      )}

      {/* TAB 1: Active Selection Pipeline */}
      {viewTab === 'pipeline' && pipelineLayout === 'board' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {activePipelineStages.map((stage) => {
            const stageCandidates = filteredCandidates.filter((c) => c.stage === stage.id);
            return (
              <div
                key={stage.id}
                className="bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden"
              >
                <div className="px-3.5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div>
                    <h2 className="text-xs font-semibold text-slate-900">{stage.label}</h2>
                    {stage.optional && (
                      <p className="text-[10px] text-slate-500">Opsional</p>
                    )}
                  </div>
                  <span className="font-mono-tabular text-xs font-semibold text-slate-700">
                    {stageCandidates.length}
                  </span>
                </div>

                <div className="p-2.5 space-y-2.5 flex-1">
                  {stageCandidates.length === 0 ? (
                    <div className="py-8 text-center text-[11px] text-slate-400">
                      Kosong
                    </div>
                  ) : (
                    stageCandidates.map((cand) => (
                      <div
                        key={cand.id}
                        onClick={() => {
                          setSelectedCandidate(cand);
                          setEditDraft({ ...cand });
                        }}
                        className="p-3 border border-slate-200 rounded-lg hover:border-blue-500 hover:bg-blue-50/25 transition-colors cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-xs text-slate-900 truncate">
                            {cand.fullName}
                          </div>
                          <span className="font-mono-tabular text-[11px] font-semibold text-blue-700 shrink-0">
                            {cand.screeningScore}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">
                          {cand.position} · {cand.department}
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                          <span className="truncate max-w-[110px]">
                            {cand.cvFileName || 'Tanpa CV'}
                          </span>
                          {cand.isBanked && (
                            <span className="text-emerald-700 font-medium">CV Bank</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewTab === 'pipeline' && pipelineLayout === 'table' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-4">Kandidat</th>
                  <th className="py-2.5 px-4">Posisi &amp; Dept</th>
                  <th className="py-2.5 px-4">Tahap Seleksi</th>
                  <th className="py-2.5 px-4">Skor</th>
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredCandidates.map((cand) => (
                  <tr key={cand.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{cand.fullName}</div>
                      <div className="text-slate-500">{cand.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      {cand.position} · {cand.department}
                    </td>
                    <td className="py-3 px-4 font-medium text-blue-700">
                      {RECRUITMENT_STAGES.find((s) => s.id === cand.stage)?.label}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular">{cand.screeningScore}/100</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCandidate(cand);
                          setEditDraft({ ...cand });
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                      >
                        Kelola
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Offering & Onboarding (Rapi & Terstruktur) */}
      {viewTab === 'offering' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Offering &amp; Onboarding Karyawan Baru
              </h2>
              <p className="text-xs text-slate-500">
                Kelola status penawaran gaji, tanggal bergabung, hingga integrasi otomatis ke direktori karyawan C-SYNC
              </p>
            </div>
            <div className="inline-flex p-1 bg-slate-100 rounded-lg self-start">
              {(['all', 'offering', 'hired'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setOfferingFilter(f)}
                  className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                    offeringFilter === f
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  {f === 'all' ? 'Semua' : f === 'offering' ? 'Proses Offering' : 'Hired / Selesai'}
                </button>
              ))}
            </div>
          </div>

          {filteredCandidates.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Belum ada kandidat pada tahap Offering atau Hired.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                    <th className="py-2.5 px-4">Kandidat</th>
                    <th className="py-2.5 px-4">Posisi &amp; Dept</th>
                    <th className="py-2.5 px-4">Kompensasi / Join</th>
                    <th className="py-2.5 px-4">Status Offering</th>
                    <th className="py-2.5 px-4">Integrasi HRIS</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredCandidates.map((cand) => {
                    const oStatus = cand.offerStatus || (cand.stage === 'hired' ? 'accepted' : 'sent');
                    const oMeta = OFFER_STATUS_LABELS[oStatus];
                    return (
                      <tr key={cand.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{cand.fullName}</div>
                          <div className="text-slate-500">{cand.email}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-900">{cand.position}</div>
                          <div className="text-slate-500">{cand.department}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-900 font-medium">
                            {cand.offerSalary || 'Belum diisi'}
                          </div>
                          <div className="text-slate-500 font-mono-tabular">
                            Join: {cand.expectedJoinDate || '-'}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-semibold ${oMeta.colorClass}`}>
                            {oMeta.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {cand.convertedToEmployee ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Terintegrasi
                            </span>
                          ) : (
                            <span className="text-slate-400">Belum masuk karyawan</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCandidate(cand);
                              setEditDraft({ ...cand });
                            }}
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            Edit Offer
                          </button>
                          {!cand.convertedToEmployee && (
                            <button
                              type="button"
                              disabled={updating}
                              onClick={() => handleConvertToEmployee(cand)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 cursor-pointer"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              Jadikan Karyawan
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

      {/* TAB 3 & 4: CV Bank & Archive */}
      {(viewTab === 'bank' || viewTab === 'archive') && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              {viewTab === 'bank'
                ? 'CV Bank / Talent Pool Tersimpan'
                : 'Arsip Kandidat (Not Selected)'}
            </h2>
            <p className="text-xs text-slate-500">
              {viewTab === 'bank'
                ? 'Kandidat potensial yang CV-nya tersimpan untuk kebutuhan posisi mendatang'
                : 'Kandidat yang tidak melanjutkan proses atau menolak offering'}
            </p>
          </div>
          {filteredCandidates.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Belum ada data kandidat di daftar ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                    <th className="py-2.5 px-4">Kandidat</th>
                    <th className="py-2.5 px-4">Posisi &amp; Dept</th>
                    <th className="py-2.5 px-4">Tahap</th>
                    <th className="py-2.5 px-4">Skor</th>
                    <th className="py-2.5 px-4">Lampiran CV</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredCandidates.map((cand) => (
                    <tr key={cand.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{cand.fullName}</div>
                        <div className="text-slate-500">{cand.email}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-900">{cand.position}</div>
                        <div className="text-slate-500">{cand.department}</div>
                      </td>
                      <td className="py-3 px-4">
                        {RECRUITMENT_STAGES.find((s) => s.id === cand.stage)?.label || cand.stage}
                      </td>
                      <td className="py-3 px-4 font-mono-tabular font-semibold">
                        {cand.screeningScore}/100
                      </td>
                      <td className="py-3 px-4">
                        {cand.cvFileId ? (
                          <button
                            type="button"
                            onClick={() => handleDownloadCv(cand)}
                            className="inline-flex items-center gap-1 text-blue-700 hover:underline cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {cand.cvFileName || 'Unduh CV'}
                          </button>
                        ) : (
                          <span className="text-slate-400">Tidak ada</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCandidate(cand);
                            setEditDraft({ ...cand });
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                        >
                          Detail &amp; Proses
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add Candidate Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCandidate}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl max-h-[90vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Tambah Kandidat (CV Screening &amp; Banking)
              </h3>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Kandidat
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Posisi Dilamar
                  </label>
                  <input
                    type="text"
                    required
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="Contoh: Senior Backend Engineer"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Departemen
                  </label>
                  <input
                    type="text"
                    required
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    No. Telepon
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Sumber
                  </label>
                  <input
                    type="text"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Skor Screening
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={screeningScore}
                    onChange={(e) => setScreeningScore(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Lampirkan File CV (PDF / DOCX / Gambar, maks 650 KB)
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-600 hover:border-blue-600 cursor-pointer">
                  <FileUp className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="truncate">
                    {cvFile ? `${cvFile.name} (${Math.round(cvFile.size / 1024)} KB)` : 'Unggah file CV kandidat...'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,image/*"
                    onChange={handleCvUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2 pt-1 text-xs text-slate-700">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isBanked}
                    onChange={(e) => setIsBanked(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Simpan CV ke Talent Pool (CV Banking)
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assessmentRequired}
                    onChange={(e) => setAssessmentRequired(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Tahap Assessment diperlukan setelah User Interview
                </label>
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {formError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Menyimpan...' : 'Simpan Kandidat'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Candidate Detail & Stage Progression Modal */}
      {selectedCandidate && editDraft && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {editDraft.fullName} · {editDraft.position}
                </h3>
                <p className="text-xs text-slate-500">
                  {editDraft.email} {editDraft.phone ? `· ${editDraft.phone}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedCandidate(null);
                  setEditDraft(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  <span className="text-slate-500">Tahap Saat Ini: </span>
                  <select
                    value={editDraft.stage}
                    onChange={(e) =>
                      setEditDraft({
                        ...editDraft,
                        stage: e.target.value as RecruitmentStage,
                      })
                    }
                    className="ml-1 px-2.5 py-1 border border-slate-200 rounded bg-white font-medium text-slate-900"
                  >
                    {RECRUITMENT_STAGES.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                {editDraft.cvFileId && (
                  <button
                    type="button"
                    onClick={() => handleDownloadCv(editDraft)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-blue-700 font-medium rounded-lg hover:bg-blue-50 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Unduh CV
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={editDraft.assessmentRequired}
                    onChange={(e) =>
                      setEditDraft({
                        ...editDraft,
                        assessmentRequired: e.target.checked,
                      })
                    }
                    className="rounded border-slate-300"
                  />
                  Perlu Tahap Assessment
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={editDraft.isBanked}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, isBanked: e.target.checked })
                    }
                    className="rounded border-slate-300"
                  />
                  Simpan di CV Bank
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Catatan HR / Initial Interview
                  </label>
                  <textarea
                    rows={2}
                    value={editDraft.hrNotes || ''}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, hrNotes: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Catatan User Interview
                  </label>
                  <textarea
                    rows={2}
                    value={editDraft.userNotes || ''}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, userNotes: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Catatan Assessment (Jika Perlu)
                  </label>
                  <textarea
                    rows={2}
                    value={editDraft.assessmentNotes || ''}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, assessmentNotes: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Catatan CEO Interview
                  </label>
                  <textarea
                    rows={2}
                    value={editDraft.ceoNotes || ''}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, ceoNotes: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Detail Offering / Kompensasi
                  </label>
                  <input
                    type="text"
                    value={editDraft.offerSalary || ''}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, offerSalary: e.target.value })
                    }
                    placeholder="Contoh: Rp 18.000.000/bln"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Status Offering
                  </label>
                  <select
                    value={editDraft.offerStatus || 'draft'}
                    onChange={(e) =>
                      setEditDraft({
                        ...editDraft,
                        offerStatus: e.target.value as Candidate['offerStatus'],
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="draft">Draft Offer</option>
                    <option value="sent">Offer Terkirim</option>
                    <option value="negotiating">Negosiasi</option>
                    <option value="accepted">Diterima (Accepted)</option>
                    <option value="declined">Ditolak Kandidat</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Target Tanggal Gabung
                  </label>
                  <input
                    type="date"
                    value={editDraft.expectedJoinDate || ''}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, expectedJoinDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono-tabular"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleSaveCandidateDetail('talent_bank')}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                  CV Bank
                </button>
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleSaveCandidateDetail('rejected')}
                  className="px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
                >
                  Arsip / Tolak
                </button>
                {(editDraft.stage === 'offering' || editDraft.stage === 'hired') &&
                  !editDraft.convertedToEmployee && (
                    <button
                      type="button"
                      disabled={updating}
                      onClick={() => handleConvertToEmployee(editDraft)}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Jadikan Karyawan
                    </button>
                  )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleSaveCandidateDetail()}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  Simpan Perubahan
                </button>
                {getNextStage(editDraft) && (
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() => handleSaveCandidateDetail(getNextStage(editDraft)!)}
                    className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 cursor-pointer"
                  >
                    Lanjut ke{' '}
                    {
                      RECRUITMENT_STAGES.find(
                        (s) => s.id === getNextStage(editDraft)
                      )?.shortLabel
                    }
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
