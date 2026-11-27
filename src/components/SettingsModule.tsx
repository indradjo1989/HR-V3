import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  GitBranch,
  Link2,
  MapPin,
  Navigation,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CompanySettings,
  ROLE_LABELS,
  UserInvite,
  UserProfile,
  UserRole,
} from '../types';
import { getTodayIsoDate, sanitizeEmailToId } from '../utils/geo';

interface SettingsModuleProps {
  currentUser: UserProfile;
  settings: CompanySettings;
  allUsers: UserProfile[];
  userInvites: UserInvite[];
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  currentUser,
  settings,
  allUsers,
  userInvites,
}) => {
  const [subTab, setSubTab] = useState<'office' | 'employees' | 'team_map'>('office');

  // Office & GPS state
  const [companyDraft, setCompanyDraft] = useState({
    companyName: settings.companyName,
    officeName: settings.officeName,
    officeLat: String(settings.officeLat),
    officeLng: String(settings.officeLng),
    radiusMeters: String(settings.radiusMeters),
    workStartTime: settings.workStartTime,
    workEndTime: settings.workEndTime,
    hrNotificationEmail: settings.hrNotificationEmail,
  });
  const [mapsPasteInput, setMapsPasteInput] = useState('');
  const [gpsStatus, setGpsStatus] = useState<{ type: 'info' | 'err'; text: string } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Add Integrated Employee state
  const [empEmail, setEmpEmail] = useState('');
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState<UserRole>('employee');
  const [empDept, setEmpDept] = useState('Engineering');
  const [empJob, setEmpJob] = useState('Software Engineer');
  const [empManagerId, setEmpManagerId] = useState('');
  const [savingEmp, setSavingEmp] = useState(false);
  const [empMsg, setEmpMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [empSearch, setEmpSearch] = useState('');

  // Mapping Lead & Tim state
  const [selectedLeadUid, setSelectedLeadUid] = useState<string>('');
  const [teamSearch, setTeamSearch] = useState('');
  const [mappingBusyUid, setMappingBusyUid] = useState<string | null>(null);
  const [mappingMsg, setMappingMsg] = useState<string | null>(null);

  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    setCompanyDraft({
      companyName: settings.companyName,
      officeName: settings.officeName,
      officeLat: String(settings.officeLat),
      officeLng: String(settings.officeLng),
      radiusMeters: String(settings.radiusMeters),
      workStartTime: settings.workStartTime,
      workEndTime: settings.workEndTime,
      hrNotificationEmail: settings.hrNotificationEmail,
    });
  }, [settings]);

  const leadsAndAdmins = useMemo(
    () =>
      allUsers.filter(
        (u) =>
          u.role === 'lead' || u.role === 'super_admin' || u.role === 'hr_admin'
      ),
    [allUsers]
  );

  useEffect(() => {
    if (!selectedLeadUid && leadsAndAdmins.length > 0) {
      const preferredLead =
        leadsAndAdmins.find((u) => u.role === 'lead') || leadsAndAdmins[0];
      setSelectedLeadUid(preferredLead.uid);
    }
  }, [leadsAndAdmins, selectedLeadUid]);

  const selectedLead = useMemo(
    () => allUsers.find((u) => u.uid === selectedLeadUid) || null,
    [allUsers, selectedLeadUid]
  );

  const handleUseCurrentGps = () => {
    setGpsStatus(null);
    if (!navigator.geolocation) {
      setGpsStatus({
        type: 'err',
        text: 'Browser tidak mendukung Geolocation. Masukkan koordinat atau tempel link Google Maps secara manual.',
      });
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        setCompanyDraft((prev) => ({
          ...prev,
          officeLat: lat,
          officeLng: lng,
        }));
        setGpsStatus({
          type: 'info',
          text: `Koordinat perangkat terdeteksi: ${lat}, ${lng}. Klik "Simpan Pengaturan Kantor" untuk menerapkan.`,
        });
        setGpsLoading(false);
      },
      (err) => {
        setGpsStatus({
          type: 'err',
          text: `Gagal mengambil GPS (${err.message}). Silakan ketik koordinat langsung atau tempel link Google Maps di kolom bawah.`,
        });
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleParseMapsOrCoords = (rawValue: string) => {
    setMapsPasteInput(rawValue);
    setGpsStatus(null);
    const match = rawValue.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
    if (match) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        setCompanyDraft((prev) => ({
          ...prev,
          officeLat: String(lat),
          officeLng: String(lng),
        }));
        setGpsStatus({
          type: 'info',
          text: `Koordinat berhasil diekstrak: ${lat}, ${lng}. Jangan lupa simpan pengaturan.`,
        });
      }
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMsg(null);

    const parsedLat = Number(companyDraft.officeLat);
    const parsedLng = Number(companyDraft.officeLng);
    const parsedRadius = Number(companyDraft.radiusMeters);

    if (Number.isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      setSettingsMsg({ type: 'err', text: 'Latitude harus berupa angka antara -90 s/d 90.' });
      return;
    }
    if (Number.isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      setSettingsMsg({ type: 'err', text: 'Longitude harus berupa angka antara -180 s/d 180.' });
      return;
    }
    if (Number.isNaN(parsedRadius) || parsedRadius < 10 || parsedRadius > 50000) {
      setSettingsMsg({ type: 'err', text: 'Radius harus antara 10 hingga 50.000 meter.' });
      return;
    }

    setSavingSettings(true);
    try {
      await setDoc(doc(db, 'settings', 'company'), {
        companyName: companyDraft.companyName.trim(),
        officeName: companyDraft.officeName.trim(),
        officeLat: parsedLat,
        officeLng: parsedLng,
        radiusMeters: parsedRadius,
        workStartTime: companyDraft.workStartTime,
        workEndTime: companyDraft.workEndTime,
        hrNotificationEmail: companyDraft.hrNotificationEmail.trim(),
        updatedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });
      setSettingsMsg({
        type: 'ok',
        text: `Pengaturan GPS (${parsedLat}, ${parsedLng}) & radius ${parsedRadius}m berhasil disimpan dan langsung aktif untuk seluruh karyawan.`,
      });
    } catch (err) {
      setSettingsMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan kantor.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddIntegratedEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmpMsg(null);
    const normalizedEmail = empEmail.trim().toLowerCase();
    if (!normalizedEmail || !empName.trim()) return;

    const existingUser = allUsers.find(
      (u) => u.email.toLowerCase() === normalizedEmail
    );
    if (existingUser) {
      setEmpMsg({
        type: 'err',
        text: `Karyawan dengan email ${normalizedEmail} sudah terdaftar atas nama ${existingUser.displayName}.`,
      });
      return;
    }

    setSavingEmp(true);
    try {
      const emailKey = sanitizeEmailToId(normalizedEmail);
      const inviteId = `inv_${emailKey}`;
      const preUserId = `emp_${emailKey}`;
      const mgr = allUsers.find((u) => u.uid === empManagerId);

      const batch = writeBatch(db);
      batch.set(doc(db, 'user_invites', inviteId), {
        email: normalizedEmail,
        displayName: empName.trim().slice(0, 120),
        role: empRole,
        department: empDept.trim().slice(0, 80),
        jobTitle: empJob.trim().slice(0, 80),
        managerId: mgr?.uid || '',
        managerName: mgr?.displayName || '',
        managerEmail: mgr?.email || '',
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'users', preUserId), {
        uid: preUserId,
        email: normalizedEmail,
        displayName: empName.trim().slice(0, 120),
        photoURL: '',
        role: empRole,
        department: empDept.trim().slice(0, 80),
        jobTitle: empJob.trim().slice(0, 80),
        managerId: mgr?.uid || '',
        managerName: mgr?.displayName || '',
        managerEmail: mgr?.email || '',
        inviteId,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      setEmpEmail('');
      setEmpName('');
      setEmpMsg({
        type: 'ok',
        text: `Karyawan ${empName.trim()} (${ROLE_LABELS[empRole]}) ditambahkan & langsung terintegrasi di direktori, cuti, tugas, dan login Gmail.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users');
    } finally {
      setSavingEmp(false);
    }
  };

  const handleUpdateUser = async (
    target: UserProfile,
    updates: Partial<UserProfile>
  ) => {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', target.uid), {
        ...updates,
        updatedAt: serverTimestamp(),
      });

      const inviteId = target.inviteId || `inv_${sanitizeEmailToId(target.email)}`;
      const hasInvite = userInvites.some((inv) => inv.id === inviteId);
      if (hasInvite) {
        const invitePatch: Record<string, unknown> = { updatedAt: serverTimestamp() };
        if (updates.role !== undefined) invitePatch.role = updates.role;
        if (updates.department !== undefined) invitePatch.department = updates.department;
        if (updates.jobTitle !== undefined) invitePatch.jobTitle = updates.jobTitle;
        if (updates.managerId !== undefined) invitePatch.managerId = updates.managerId;
        if (updates.managerName !== undefined) invitePatch.managerName = updates.managerName;
        if (updates.managerEmail !== undefined) invitePatch.managerEmail = updates.managerEmail;
        batch.update(doc(db, 'user_invites', inviteId), invitePatch);
      }

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${target.uid}`);
    }
  };

  const handleDeletePreUser = async (target: UserProfile) => {
    try {
      await deleteDoc(doc(db, 'users', target.uid));
      const invId = target.inviteId || `inv_${sanitizeEmailToId(target.email)}`;
      if (userInvites.some((i) => i.id === invId)) {
        await deleteDoc(doc(db, 'user_invites', invId));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${target.uid}`);
    }
  };

  const handleAssignToSelectedLead = async (member: UserProfile, assign: boolean) => {
    if (!selectedLead) return;
    setMappingBusyUid(member.uid);
    setMappingMsg(null);
    try {
      await handleUpdateUser(member, {
        managerId: assign ? selectedLead.uid : '',
        managerName: assign ? selectedLead.displayName : '',
        managerEmail: assign ? selectedLead.email : '',
      });
      setMappingMsg(
        assign
          ? `${member.displayName} sekarang melapor ke ${selectedLead.displayName}.`
          : `${member.displayName} dilepas dari tim ${selectedLead.displayName}.`
      );
    } finally {
      setMappingBusyUid(null);
    }
  };

  const handleSeedInitialSampleData = async () => {
    setSeeding(true);
    try {
      const batch = writeBatch(db);
      const today = getTodayIsoDate();

      batch.set(doc(db, 'tasks', 'sample_goal_q4_1'), {
        assigneeId: currentUser.uid,
        assigneeName: currentUser.displayName,
        assigneeEmail: currentUser.email,
        department: currentUser.department,
        assignedById: currentUser.uid,
        assignedByName: currentUser.displayName,
        managerId: currentUser.uid,
        managerEmail: currentUser.email,
        type: 'goal',
        title: 'Standardisasi Kebijakan Cuti & Geofence Q4',
        description: 'Pastikan seluruh departemen telah mengonfigurasi radius WFO dan kuota cuti tahunan.',
        priority: 'high',
        dueDate: today,
        targetMetric: '100% departemen terkalibrasi',
        progressPercent: 70,
        kpiWeight: 40,
        status: 'in_progress',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'candidates', 'sample_cand_1'), {
        fullName: 'Nadia Kusuma',
        email: 'nadia.kusuma@example.com',
        phone: '+62 812-3456-7890',
        position: 'Product Designer',
        department: 'Design',
        source: 'LinkedIn',
        stage: 'user_interview',
        assessmentRequired: true,
        isBanked: true,
        screeningScore: 91,
        hrNotes: 'Portofolio enterprise SaaS sangat kuat.',
        userNotes: 'Dijadwalkan diskusi studi kasus desain.',
        assessmentNotes: '',
        ceoNotes: '',
        offerSalary: '',
        offerStatus: 'draft',
        expectedJoinDate: '',
        convertedToEmployee: false,
        recruiterId: currentUser.uid,
        recruiterName: currentUser.displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'candidates', 'sample_cand_2'), {
        fullName: 'Bima Pratama',
        email: 'bima.pratama@example.com',
        phone: '+62 813-9876-5432',
        position: 'Senior Backend Engineer',
        department: 'Engineering',
        source: 'Referral',
        stage: 'offering',
        assessmentRequired: false,
        isBanked: true,
        screeningScore: 94,
        hrNotes: 'Pengalaman arsitektur microservices 6 tahun.',
        userNotes: 'Lolos technical deep dive dengan nilai tinggi.',
        assessmentNotes: 'Tidak diperlukan (skip langsung ke CEO).',
        ceoNotes: 'Disetujui untuk offering.',
        offerSalary: 'Rp 24.000.000/bulan',
        offerStatus: 'sent',
        expectedJoinDate: today,
        convertedToEmployee: false,
        recruiterId: currentUser.uid,
        recruiterName: currentUser.displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      setSettingsMsg({ type: 'ok', text: 'Data contoh Tugas dan Rekrutmen berhasil dimuat.' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'batch_seed');
    } finally {
      setSeeding(false);
    }
  };

  const filteredDirectory = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q)
    );
  }, [allUsers, empSearch]);

  const currentTeamMembers = useMemo(() => {
    if (!selectedLead) return [];
    return allUsers.filter(
      (u) =>
        u.uid !== selectedLead.uid &&
        (u.managerId === selectedLead.uid ||
          (u.managerEmail && u.managerEmail === selectedLead.email))
    );
  }, [allUsers, selectedLead]);

  const availableEmployeesForTeam = useMemo(() => {
    if (!selectedLead) return [];
    const q = teamSearch.trim().toLowerCase();
    return allUsers.filter((u) => {
      if (u.uid === selectedLead.uid) return false;
      const alreadyInThisTeam =
        u.managerId === selectedLead.uid ||
        (u.managerEmail && u.managerEmail === selectedLead.email);
      if (alreadyInThisTeam) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [allUsers, selectedLead, teamSearch]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Pengaturan Sistem, Karyawan &amp; Struktur Tim
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Atur koordinat GPS kantor, tambah karyawan terintegrasi otomatis, dan petakan Lead beserta anggota timnya
          </p>
        </div>

        <button
          type="button"
          onClick={handleSeedInitialSampleData}
          disabled={seeding}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer self-start whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-700" />
          {seeding ? 'Memuat Contoh...' : 'Isi Data Contoh'}
        </button>
      </div>

      {/* Sub-Tabs */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
        <button
          type="button"
          onClick={() => setSubTab('office')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            subTab === 'office' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          GPS Kantor &amp; Radius
        </button>
        <button
          type="button"
          onClick={() => setSubTab('employees')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            subTab === 'employees' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Tambah &amp; Kelola Karyawan ({allUsers.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('team_map')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            subTab === 'team_map' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" />
          Mapping Lead &amp; Tim ({leadsAndAdmins.length} Lead)
        </button>
      </div>

      {/* TAB 1: GPS Kantor & Radius */}
      {subTab === 'office' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5 max-w-3xl"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-700" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Lokasi GPS Kantor &amp; Radius Absensi
                </h2>
                <p className="text-xs text-slate-500">
                  Masukkan koordinat manual, tempel link Google Maps, atau gunakan GPS perangkat
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleUseCurrentGps}
              disabled={gpsLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 cursor-pointer self-start whitespace-nowrap shrink-0"
            >
              <Navigation className="w-3.5 h-3.5" />
              {gpsLoading ? 'Mencari GPS...' : 'Ambil GPS Saya'}
            </button>
          </div>

          {/* Smart Google Maps Link / Coordinate Paste */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-blue-700" />
              Cara Cepat: Tempel Koordinat atau URL Google Maps
            </label>
            <input
              type="text"
              value={mapsPasteInput}
              onChange={(e) => handleParseMapsOrCoords(e.target.value)}
              placeholder="Contoh: -6.208763, 106.845599 atau https://www.google.com/maps/@-6.208763,106.845599,17z"
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
            {gpsStatus && (
              <div
                className={`text-xs ${
                  gpsStatus.type === 'err' ? 'text-red-700' : 'text-blue-700'
                }`}
              >
                {gpsStatus.text}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nama Perusahaan
              </label>
              <input
                type="text"
                required
                value={companyDraft.companyName}
                onChange={(e) =>
                  setCompanyDraft({ ...companyDraft, companyName: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nama Lokasi Kantor
              </label>
              <input
                type="text"
                required
                value={companyDraft.officeName}
                onChange={(e) =>
                  setCompanyDraft({ ...companyDraft, officeName: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Latitude Kantor
              </label>
              <input
                type="number"
                step="any"
                required
                value={companyDraft.officeLat}
                onChange={(e) =>
                  setCompanyDraft({ ...companyDraft, officeLat: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Longitude Kantor
              </label>
              <input
                type="number"
                step="any"
                required
                value={companyDraft.officeLng}
                onChange={(e) =>
                  setCompanyDraft({ ...companyDraft, officeLng: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Radius Absensi (Meter)
              </label>
              <input
                type="number"
                min={10}
                max={50000}
                required
                value={companyDraft.radiusMeters}
                onChange={(e) =>
                  setCompanyDraft({ ...companyDraft, radiusMeters: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Jam Masuk
              </label>
              <input
                type="time"
                required
                value={companyDraft.workStartTime}
                onChange={(e) =>
                  setCompanyDraft({ ...companyDraft, workStartTime: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Jam Pulang
              </label>
              <input
                type="time"
                required
                value={companyDraft.workEndTime}
                onChange={(e) =>
                  setCompanyDraft({ ...companyDraft, workEndTime: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Email Notifikasi HR
              </label>
              <input
                type="email"
                required
                value={companyDraft.hrNotificationEmail}
                onChange={(e) =>
                  setCompanyDraft({
                    ...companyDraft,
                    hrNotificationEmail: e.target.value,
                  })
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          {settingsMsg && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                settingsMsg.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {settingsMsg.text}
            </div>
          )}

          <button
            type="submit"
            disabled={savingSettings}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-blue-700 text-white text-xs font-semibold rounded-lg hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
          >
            <MapPin className="w-4 h-4" />
            {savingSettings ? 'Menyimpan...' : 'Simpan Pengaturan Kantor'}
          </button>
        </form>
      )}

      {/* TAB 2: Tambah Karyawan (Auto-Terintegrasi) & Direktori */}
      {subTab === 'employees' && (
        <div className="space-y-6">
          <form
            onSubmit={handleAddIntegratedEmployee}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="pb-3 border-b border-slate-200 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-700" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Tambah Karyawan Baru (Auto-Terintegrasi)
                </h2>
                <p className="text-xs text-slate-500">
                  Karyawan langsung masuk ke direktori, struktur tim, kuota cuti, target tugas, dan otomatis terhubung saat login via Gmail
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={empName}
                  onChange={(e) => setEmpName(e.target.value)}
                  placeholder="Contoh: Raka Mahendra"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alamat Gmail Karyawan
                </label>
                <input
                  type="email"
                  required
                  value={empEmail}
                  onChange={(e) => setEmpEmail(e.target.value)}
                  placeholder="raka@gmail.com"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Hak Akses Role
                </label>
                <select
                  value={empRole}
                  onChange={(e) => setEmpRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="employee">Employee</option>
                  <option value="lead">Lead / Manager</option>
                  <option value="hr_admin">HR Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Departemen
                </label>
                <input
                  type="text"
                  required
                  value={empDept}
                  onChange={(e) => setEmpDept(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Jabatan
                </label>
                <input
                  type="text"
                  required
                  value={empJob}
                  onChange={(e) => setEmpJob(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Lead / Atasan Langsung
                </label>
                <select
                  value={empManagerId}
                  onChange={(e) => setEmpManagerId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="">-- Belum Dipetakan --</option>
                  {leadsAndAdmins.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.displayName} ({ROLE_LABELS[u.role]})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {empMsg && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  empMsg.type === 'ok'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {empMsg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={savingEmp}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-700 text-white text-xs font-semibold rounded-lg hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {savingEmp ? 'Mengintegrasikan...' : 'Tambah & Integrasikan Karyawan'}
            </button>
          </form>

          {/* Directory Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Direktori Seluruh Karyawan ({allUsers.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Perubahan role, departemen, dan atasan langsung tersinkronisasi ke seluruh modul
                </p>
              </div>
              <div className="relative sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Cari nama, email, dept..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                    <th className="py-2.5 px-4">Karyawan</th>
                    <th className="py-2.5 px-4">Departemen &amp; Jabatan</th>
                    <th className="py-2.5 px-4">Role Akses</th>
                    <th className="py-2.5 px-4">Lead / Atasan</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Hapus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredDirectory.map((u) => (
                    <tr key={u.uid} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{u.displayName}</div>
                        <div className="text-slate-500">
                          {u.email}{' '}
                          {u.uid.startsWith('emp_') ? '· Menunggu Login Gmail' : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-900">{u.department}</div>
                        <div className="text-slate-500">{u.jobTitle}</div>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={u.role}
                          onChange={(e) =>
                            handleUpdateUser(u, { role: e.target.value as UserRole })
                          }
                          className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-medium"
                        >
                          <option value="employee">Employee</option>
                          <option value="lead">Lead / Manager</option>
                          <option value="hr_admin">HR Admin</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={u.managerId || ''}
                          onChange={(e) => {
                            const mgr = allUsers.find((m) => m.uid === e.target.value);
                            handleUpdateUser(u, {
                              managerId: mgr?.uid || '',
                              managerName: mgr?.displayName || '',
                              managerEmail: mgr?.email || '',
                            });
                          }}
                          className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs max-w-[190px]"
                        >
                          <option value="">Belum dipetakan</option>
                          {leadsAndAdmins
                            .filter((m) => m.uid !== u.uid)
                            .map((m) => (
                              <option key={m.uid} value={m.uid}>
                                {m.displayName} ({ROLE_LABELS[m.role]})
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={u.status}
                          onChange={(e) =>
                            handleUpdateUser(u, {
                              status: e.target.value as 'active' | 'inactive',
                            })
                          }
                          className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs"
                        >
                          <option value="active">Aktif</option>
                          <option value="inactive">Nonaktif</option>
                        </select>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {u.uid !== currentUser.uid && (
                          <button
                            type="button"
                            onClick={() => handleDeletePreUser(u)}
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                            title="Hapus Karyawan"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Mapping Lead & Tim */}
      {subTab === 'team_map' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Select Lead */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                1. Pilih Lead / Manager
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Hanya pengguna dengan role Lead, HR Admin, atau Super Admin yang dapat memimpin tim
              </p>
            </div>
            <div className="divide-y divide-slate-200">
              {leadsAndAdmins.map((lead) => {
                const teamCount = allUsers.filter(
                  (u) =>
                    u.uid !== lead.uid &&
                    (u.managerId === lead.uid ||
                      (u.managerEmail && u.managerEmail === lead.email))
                ).length;
                const isSelected = selectedLead?.uid === lead.uid;

                return (
                  <button
                    key={lead.uid}
                    type="button"
                    onClick={() => {
                      setSelectedLeadUid(lead.uid);
                      setMappingMsg(null);
                    }}
                    className={`w-full p-4 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {lead.displayName}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {ROLE_LABELS[lead.role]} · {lead.department}
                      </div>
                    </div>
                    <div className="font-mono-tabular text-xs font-semibold text-blue-700 shrink-0">
                      {teamCount} anggota
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Team Members & Available Pool */}
          <div className="lg:col-span-8 space-y-6">
            {mappingMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                {mappingMsg}
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">
                  2. Anggota Tim di Bawah {selectedLead?.displayName || 'Lead'} ({currentTeamMembers.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Lead dapat melihat absensi, menyetujui izin/cuti, serta menetapkan to-do &amp; goals untuk anggota ini
                </p>
              </div>
              {currentTeamMembers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Belum ada anggota tim yang dipetakan ke Lead ini. Pilih karyawan di daftar bawah untuk menambahkan.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {currentTeamMembers.map((member) => (
                    <div
                      key={member.uid}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/70"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {member.displayName}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {member.jobTitle} · {member.department} · {member.email}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={mappingBusyUid === member.uid}
                        onClick={() => handleAssignToSelectedLead(member, false)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer shrink-0"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        Lepas
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    3. Tambahkan Karyawan ke Tim {selectedLead?.displayName || ''}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Klik Tambah ke Tim untuk memetakan karyawan (atau memindahkan dari Lead lain)
                  </p>
                </div>
                <div className="relative sm:w-56">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    placeholder="Cari karyawan..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {availableEmployeesForTeam.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Tidak ada karyawan lain yang tersedia. Tambahkan karyawan baru di tab &ldquo;Tambah &amp; Kelola Karyawan&rdquo;.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {availableEmployeesForTeam.map((emp) => (
                    <div
                      key={emp.uid}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/70"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {emp.displayName}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {emp.jobTitle} · {emp.department} ·{' '}
                          {emp.managerName
                            ? `Lead saat ini: ${emp.managerName}`
                            : 'Belum punya Lead'}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={mappingBusyUid === emp.uid || !selectedLead}
                        onClick={() => handleAssignToSelectedLead(emp, true)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 cursor-pointer shrink-0"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Masukkan ke Tim
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
