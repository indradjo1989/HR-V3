import { Timestamp } from 'firebase/firestore';

export type UserRole = 'employee' | 'lead' | 'hr_admin' | 'super_admin';
export type WorkMode = 'WFO' | 'WFH' | 'CLIENT_VISIT' | 'SUPERVISI';
export type ApprovalDecision = 'not_required' | 'pending' | 'approved' | 'rejected';

export type LeaveType =
  | 'sakit'
  | 'cuti_tahunan'
  | 'cuti_melahirkan'
  | 'cuti_keguguran'
  | 'cuti_haid'
  | 'cuti_menikah'
  | 'cuti_anak'
  | 'cuti_istri_melahirkan'
  | 'cuti_duka'
  | 'cuti_ibadah'
  | 'izin_khusus';

export type RecruitmentStage =
  | 'cv_screening'
  | 'hr_interview'
  | 'user_interview'
  | 'assessment'
  | 'ceo_interview'
  | 'offering'
  | 'hired'
  | 'talent_bank'
  | 'rejected';

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high';

export type NavTab =
  | 'attendance'
  | 'leave'
  | 'tasks'
  | 'recruitment'
  | 'kpi'
  | 'settings';

export interface CompanySettings {
  id: string;
  companyName: string;
  officeName: string;
  officeLat: number;
  officeLng: number;
  radiusMeters: number;
  workStartTime: string;
  workEndTime: string;
  hrNotificationEmail: string;
  updatedBy: string;
  updatedAt?: Timestamp;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  department: string;
  jobTitle: string;
  managerId?: string;
  managerName?: string;
  managerEmail?: string;
  inviteId?: string;
  status: 'active' | 'inactive';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface UserInvite {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  department: string;
  jobTitle: string;
  managerId?: string;
  managerName?: string;
  managerEmail?: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  department: string;
  managerId?: string;
  managerEmail?: string;
  date: string;
  workMode: WorkMode;
  clockInTime: Timestamp;
  clockInLat: number;
  clockInLng: number;
  clockInDistanceMeters: number;
  clockInOutsideRadius: boolean;
  clockInSelfieId: string;
  clockOutTime?: Timestamp;
  clockOutLat?: number;
  clockOutLng?: number;
  clockOutDistanceMeters?: number;
  clockOutOutsideRadius?: boolean;
  clockOutSelfieId?: string;
  needsApproval: boolean;
  notes: string;
  leadApprovalStatus: ApprovalDecision;
  leadApprovedBy?: string;
  leadNote?: string;
  leadActionAt?: Timestamp;
  hrApprovalStatus: ApprovalDecision;
  hrApprovedBy?: string;
  hrNote?: string;
  hrActionAt?: Timestamp;
  overallStatus: 'present' | 'pending_approval' | 'approved' | 'rejected';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LeavePolicy {
  id: string;
  scope: 'global' | 'personal';
  targetUserId?: string;
  targetUserName?: string;
  annualQuota: number;
  sickQuota: number;
  maternityDays: number;
  miscarriageDays: number;
  menstrualDaysPerMonth: number;
  marriageDays: number;
  paternityDays: number;
  bereavementDays: number;
  religiousDays: number;
  requireMedicalNoteAfterDays: number;
  allowCarryOver: boolean;
  maxCarryOverDays: number;
  customNotes?: string;
  updatedBy: string;
  updatedAt?: Timestamp;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  department: string;
  managerId?: string;
  managerEmail?: string;
  leaveType: LeaveType;
  leaveLabel: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  attachmentName?: string;
  attachmentDataUrl?: string;
  leadApprovalStatus: 'pending' | 'approved' | 'rejected';
  leadApprovedBy?: string;
  leadNote?: string;
  leadActionAt?: Timestamp;
  hrApprovalStatus: 'pending' | 'approved' | 'rejected';
  hrApprovedBy?: string;
  hrNote?: string;
  hrActionAt?: Timestamp;
  overallStatus: 'pending_lead' | 'pending_hr' | 'approved' | 'rejected';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TaskItem {
  id: string;
  assigneeId: string;
  assigneeName: string;
  assigneeEmail: string;
  department: string;
  assignedById: string;
  assignedByName: string;
  managerId?: string;
  managerEmail?: string;
  type: 'todo' | 'goal';
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate: string;
  targetMetric?: string;
  progressPercent: number;
  kpiWeight: number;
  status: TaskStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Candidate {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  position: string;
  department: string;
  source?: string;
  stage: RecruitmentStage;
  assessmentRequired: boolean;
  isBanked: boolean;
  cvFileName?: string;
  cvFileId?: string;
  screeningScore: number;
  hrNotes?: string;
  userNotes?: string;
  assessmentNotes?: string;
  ceoNotes?: string;
  offerSalary?: string;
  offerStatus?: 'draft' | 'sent' | 'negotiating' | 'accepted' | 'declined';
  expectedJoinDate?: string;
  convertedToEmployee?: boolean;
  recruiterId: string;
  recruiterName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface NotificationItem {
  id: string;
  recipientUserId?: string;
  recipientEmail: string;
  title: string;
  message: string;
  category: 'attendance' | 'leave' | 'task' | 'recruitment' | 'system';
  isRead: boolean;
  emailSent: boolean;
  senderId: string;
  senderName: string;
  createdAt?: Timestamp;
}

export interface PendingEmailDispatch {
  to: string[];
  subject: string;
  body: string;
  category: NotificationItem['category'];
  contextLabel: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  employee: 'Employee',
  lead: 'Lead / Manager',
  hr_admin: 'HR Admin',
  super_admin: 'Super Admin',
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  WFO: 'WFO (Kantor)',
  WFH: 'WFH (Remote)',
  CLIENT_VISIT: 'Client Visit',
  SUPERVISI: 'Supervisi Lapangan',
};

export interface LeaveTypeMeta {
  value: LeaveType;
  label: string;
  legalBasis: string;
  defaultDaysLabel: string;
  deductsAnnual: boolean;
}

export const LEAVE_TYPES: LeaveTypeMeta[] = [
  {
    value: 'sakit',
    label: 'Izin Sakit',
    legalBasis: 'UU Ketenagakerjaan Pasal 93',
    defaultDaysLabel: 'Sesuai kuota sakit / surat dokter',
    deductsAnnual: false,
  },
  {
    value: 'cuti_tahunan',
    label: 'Cuti Tahunan',
    legalBasis: 'UU Ketenagakerjaan Pasal 79',
    defaultDaysLabel: '12 hari kerja/tahun',
    deductsAnnual: true,
  },
  {
    value: 'cuti_melahirkan',
    label: 'Cuti Melahirkan',
    legalBasis: 'UU Ketenagakerjaan Pasal 82 (1)',
    defaultDaysLabel: '90 hari kalender (3 bulan)',
    deductsAnnual: false,
  },
  {
    value: 'cuti_keguguran',
    label: 'Cuti Keguguran',
    legalBasis: 'UU Ketenagakerjaan Pasal 82 (2)',
    defaultDaysLabel: '45 hari kalender (1.5 bulan)',
    deductsAnnual: false,
  },
  {
    value: 'cuti_haid',
    label: 'Cuti Haid',
    legalBasis: 'UU Ketenagakerjaan Pasal 81',
    defaultDaysLabel: '2 hari per bulan',
    deductsAnnual: false,
  },
  {
    value: 'cuti_menikah',
    label: 'Cuti Pekerja Menikah',
    legalBasis: 'UU Ketenagakerjaan Pasal 93 (4a)',
    defaultDaysLabel: '3 hari',
    deductsAnnual: false,
  },
  {
    value: 'cuti_anak',
    label: 'Cuti Menikahkan / Khitan / Baptis Anak',
    legalBasis: 'UU Ketenagakerjaan Pasal 93 (4b-d)',
    defaultDaysLabel: '2 hari',
    deductsAnnual: false,
  },
  {
    value: 'cuti_istri_melahirkan',
    label: 'Cuti Istri Melahirkan / Keguguran',
    legalBasis: 'UU Ketenagakerjaan Pasal 93 (4e)',
    defaultDaysLabel: '2 hari',
    deductsAnnual: false,
  },
  {
    value: 'cuti_duka',
    label: 'Cuti Duka Keluarga Inti Meninggal',
    legalBasis: 'UU Ketenagakerjaan Pasal 93 (4f-g)',
    defaultDaysLabel: '2 hari (1 hari serumah)',
    deductsAnnual: false,
  },
  {
    value: 'cuti_ibadah',
    label: 'Cuti Ibadah Keagamaan',
    legalBasis: 'UU Ketenagakerjaan Pasal 93 (2e)',
    defaultDaysLabel: 'Sesuai jadwal ibadah',
    deductsAnnual: false,
  },
  {
    value: 'izin_khusus',
    label: 'Izin Khusus / Keperluan Mendesak',
    legalBasis: 'Kebijakan Internal Perusahaan',
    defaultDaysLabel: 'Sesuai persetujuan Lead & HR',
    deductsAnnual: false,
  },
];

export const RECRUITMENT_STAGES: {
  id: RecruitmentStage;
  label: string;
  shortLabel: string;
  optional?: boolean;
}[] = [
  { id: 'cv_screening', label: 'CV Screening', shortLabel: 'Screening' },
  { id: 'hr_interview', label: 'Initial / HR Interview', shortLabel: 'HR Interview' },
  { id: 'user_interview', label: 'User Interview', shortLabel: 'User Interview' },
  { id: 'assessment', label: 'Assessment', shortLabel: 'Assessment', optional: true },
  { id: 'ceo_interview', label: 'CEO Interview', shortLabel: 'CEO Interview' },
  { id: 'offering', label: 'Offering', shortLabel: 'Offering' },
  { id: 'hired', label: 'Hired', shortLabel: 'Hired' },
  { id: 'talent_bank', label: 'CV Bank / Talent Pool', shortLabel: 'CV Bank' },
  { id: 'rejected', label: 'Not Selected', shortLabel: 'Rejected' },
];

export const BOOTSTRAPPED_SUPER_ADMIN_EMAIL = 'collabsync.hub@gmail.com';

export const DEFAULT_COMPANY_SETTINGS: Omit<CompanySettings, 'id'> = {
  companyName: 'C-SYNC Enterprise',
  officeName: 'Headquarters Jakarta',
  officeLat: -6.208763,
  officeLng: 106.845599,
  radiusMeters: 150,
  workStartTime: '09:00',
  workEndTime: '18:00',
  hrNotificationEmail: 'collabsync.hub@gmail.com',
  updatedBy: 'system',
};

export const DEFAULT_GLOBAL_POLICY: Omit<LeavePolicy, 'id'> = {
  scope: 'global',
  annualQuota: 12,
  sickQuota: 14,
  maternityDays: 90,
  miscarriageDays: 45,
  menstrualDaysPerMonth: 2,
  marriageDays: 3,
  paternityDays: 2,
  bereavementDays: 2,
  religiousDays: 30,
  requireMedicalNoteAfterDays: 2,
  allowCarryOver: true,
  maxCarryOverDays: 4,
  customNotes: 'Mengacu pada UU Ketenagakerjaan & UU Cipta Kerja.',
  updatedBy: 'system',
};

export const VALIDATION_LIMITS = {
  DISPLAY_NAME_MAX: 120,
  DEPARTMENT_MAX: 80,
  JOB_TITLE_MAX: 80,
  NOTES_MAX: 600,
  APPROVAL_NOTE_MAX: 300,
  TASK_TITLE_MAX: 160,
  TASK_DESC_MAX: 800,
  CANDIDATE_NOTES_MAX: 800,
  MAX_SELFIE_DATAURL_CHARS: 195000,
  MAX_LEAVE_ATTACHMENT_CHARS: 420000,
  MAX_CV_BYTES: 650000,
};
