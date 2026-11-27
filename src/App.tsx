import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarClock,
  CheckSquare,
  Clock,
  LogOut,
  Mail,
  Settings,
  UserCircle2,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import {
  db,
  getAccessToken,
  googleSignIn,
  handleFirestoreError,
  initAuth,
  logout,
  OperationType,
  testConnection,
} from './firebase';
import {
  AttendanceRecord,
  BOOTSTRAPPED_SUPER_ADMIN_EMAIL,
  Candidate,
  CompanySettings,
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_GLOBAL_POLICY,
  LeavePolicy,
  LeaveRequest,
  NavTab,
  NotificationItem,
  PendingEmailDispatch,
  ROLE_LABELS,
  TaskItem,
  UserInvite,
  UserProfile,
  UserRole,
} from './types';
import { sanitizeEmailToId } from './utils/geo';
import { sendGmailMessage } from './utils/gmail';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SignInScreen } from './components/SignInScreen';
import { EmailConfirmModal } from './components/EmailConfirmModal';
import { AttendanceModule } from './components/AttendanceModule';
import { LeaveModule } from './components/LeaveModule';
import { TasksModule } from './components/TasksModule';
import { RecruitmentModule } from './components/RecruitmentModule';
import { KpiDashboardModule } from './components/KpiDashboardModule';
import { SettingsModule } from './components/SettingsModule';

function mergeById<T extends { id: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>();
  lists.forEach((list) => {
    list.forEach((item) => map.set(item.id, item));
  });
  return Array.from(map.values());
}

function dedupeUsersByEmail(users: UserProfile[]): UserProfile[] {
  const byEmail = new Map<string, UserProfile>();
  users.forEach((u) => {
    const key = (u.email || u.uid).toLowerCase();
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, u);
      return;
    }
    // Prefer live Firebase Auth UID document over pre-provisioned emp_ placeholder
    if (existing.uid.startsWith('emp_') && !u.uid.startsWith('emp_')) {
      byEmail.set(key, u);
    }
  });
  return Array.from(byEmail.values());
}

function getAllowedTabs(role: UserRole): NavTab[] {
  switch (role) {
    case 'employee':
      return ['attendance', 'leave', 'tasks'];
    case 'lead':
      return ['attendance', 'leave', 'tasks'];
    case 'hr_admin':
      return ['kpi', 'attendance', 'leave', 'tasks', 'recruitment'];
    case 'super_admin':
      return ['kpi', 'attendance', 'leave', 'tasks', 'recruitment', 'settings'];
  }
}

const NAV_META: Record<
  NavTab,
  { label: string; shortLabel: string; icon: React.FC<{ className?: string }> }
> = {
  kpi: { label: 'HR & KPI Dashboard', shortLabel: 'Dashboard', icon: BarChart3 },
  attendance: { label: 'Absensi & Lokasi', shortLabel: 'Absensi', icon: Clock },
  leave: { label: 'Izin & Cuti', shortLabel: 'Cuti', icon: CalendarClock },
  tasks: { label: 'To-Do & Goals', shortLabel: 'To-Do', icon: CheckSquare },
  recruitment: { label: 'Rekrutmen', shortLabel: 'Rekrut', icon: Briefcase },
  settings: { label: 'Pengaturan', shortLabel: 'Setelan', icon: Settings },
};

function AppContent() {
  const [authInitialized, setAuthInitialized] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('attendance');

  // Real-time Firestore state
  const [settings, setSettings] = useState<CompanySettings>({
    id: 'company',
    ...DEFAULT_COMPANY_SETTINGS,
  });
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [userInvites, setUserInvites] = useState<UserInvite[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leavePolicies, setLeavePolicies] = useState<LeavePolicy[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // UI overlays
  const [notifOpen, setNotifOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<PendingEmailDispatch | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    testConnection();
    const unsub = initAuth((user, token) => {
      setFirebaseUser(user);
      setGmailToken(token || getAccessToken());
      setAuthInitialized(true);
    });
    return () => unsub();
  }, []);

  // Provision or load current user profile when authenticated
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.email) {
      setCurrentUser(null);
      return;
    }

    let unsubProfile: (() => void) | undefined;
    const userRef = doc(db, 'users', firebaseUser.uid);

    const bootstrapProfile = async () => {
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const emailLower = firebaseUser.email!.toLowerCase();
          const emailKey = sanitizeEmailToId(emailLower);
          const isBootSuper =
            emailLower === BOOTSTRAPPED_SUPER_ADMIN_EMAIL.toLowerCase();

          let inviteDoc: (UserInvite & { id: string }) | null = null;
          if (!isBootSuper) {
            const invSnap = await getDocs(
              query(collection(db, 'user_invites'), where('email', '==', emailLower))
            );
            if (!invSnap.empty) {
              const first = invSnap.docs[0];
              inviteDoc = { id: first.id, ...(first.data() as Omit<UserInvite, 'id'>) };
            }
          }

          const preUsersSnap = await getDocs(
            query(collection(db, 'users'), where('email', '==', emailLower))
          );
          const preUserDoc =
            preUsersSnap.docs.find((d) => d.id === `emp_${emailKey}`) ||
            preUsersSnap.docs.find((d) => d.id.startsWith('emp_'));
          const preUser = preUserDoc ? (preUserDoc.data() as UserProfile) : null;

          const batch = writeBatch(db);
          batch.set(userRef, {
            uid: firebaseUser.uid,
            email: emailLower,
            displayName:
              preUser?.displayName ||
              inviteDoc?.displayName ||
              firebaseUser.displayName ||
              emailLower.split('@')[0],
            photoURL: firebaseUser.photoURL || preUser?.photoURL || '',
            role: isBootSuper
              ? 'super_admin'
              : inviteDoc?.role || preUser?.role || 'employee',
            department: isBootSuper
              ? 'Executive'
              : preUser?.department || inviteDoc?.department || 'Operations',
            jobTitle: isBootSuper
              ? 'Super Admin'
              : preUser?.jobTitle || inviteDoc?.jobTitle || 'Employee',
            managerId: preUser?.managerId || inviteDoc?.managerId || '',
            managerName: preUser?.managerName || inviteDoc?.managerName || '',
            managerEmail: preUser?.managerEmail || inviteDoc?.managerEmail || '',
            inviteId: inviteDoc?.id || preUser?.inviteId || '',
            status: 'active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          preUsersSnap.docs.forEach((d) => {
            if (d.id.startsWith('emp_')) {
              batch.delete(d.ref);
            }
          });

          await batch.commit();
        }

        unsubProfile = onSnapshot(
          userRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data() as UserProfile;
              setCurrentUser(data);
            }
          },
          (err) => handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`)
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}`);
      }
    };

    bootstrapProfile();
    return () => {
      if (unsubProfile) unsubProfile();
    };
  }, [firebaseUser]);

  // Attach real-time Firestore listeners scoped by currentUser.role
  useEffect(() => {
    if (!currentUser) return;
    const unsubs: (() => void)[] = [];

    // 1. Company settings
    const settingsRef = doc(db, 'settings', 'company');
    unsubs.push(
      onSnapshot(
        settingsRef,
        async (snap) => {
          if (snap.exists()) {
            setSettings({ id: snap.id, ...(snap.data() as Omit<CompanySettings, 'id'>) });
          } else if (currentUser.role === 'super_admin') {
            await setDoc(settingsRef, {
              ...DEFAULT_COMPANY_SETTINGS,
              updatedBy: currentUser.uid,
              updatedAt: serverTimestamp(),
            });
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'settings/company')
      )
    );

    // 2. Leave policies
    if (currentUser.role === 'hr_admin' || currentUser.role === 'super_admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'leave_policies'),
          async (snap) => {
            if (snap.empty) {
              await setDoc(doc(db, 'leave_policies', 'global'), {
                ...DEFAULT_GLOBAL_POLICY,
                updatedBy: currentUser.uid,
                updatedAt: serverTimestamp(),
              });
              return;
            }
            setLeavePolicies(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeavePolicy, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'leave_policies')
        )
      );
    } else {
      let globalPol: LeavePolicy | null = null;
      let personalPol: LeavePolicy | null = null;
      const syncPol = () => {
        const list: LeavePolicy[] = [];
        if (globalPol) list.push(globalPol);
        if (personalPol) list.push(personalPol);
        setLeavePolicies(list);
      };
      unsubs.push(
        onSnapshot(
          doc(db, 'leave_policies', 'global'),
          (snap) => {
            globalPol = snap.exists()
              ? { id: snap.id, ...(snap.data() as Omit<LeavePolicy, 'id'>) }
              : null;
            syncPol();
          },
          (err) => handleFirestoreError(err, OperationType.GET, 'leave_policies/global')
        )
      );
      unsubs.push(
        onSnapshot(
          doc(db, 'leave_policies', `emp_${currentUser.uid}`),
          (snap) => {
            personalPol = snap.exists()
              ? { id: snap.id, ...(snap.data() as Omit<LeavePolicy, 'id'>) }
              : null;
            syncPol();
          },
          (err) =>
            handleFirestoreError(err, OperationType.GET, `leave_policies/emp_${currentUser.uid}`)
        )
      );
    }

    // 3. Users directory
    if (currentUser.role === 'hr_admin' || currentUser.role === 'super_admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => {
            setAllUsers(dedupeUsersByEmail(snap.docs.map((d) => d.data() as UserProfile)));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );
    } else if (currentUser.role === 'lead') {
      let reportsByUid: UserProfile[] = [];
      let reportsByEmail: UserProfile[] = [];
      const syncLeadUsers = () => {
        setAllUsers(dedupeUsersByEmail([currentUser, ...reportsByUid, ...reportsByEmail]));
      };
      unsubs.push(
        onSnapshot(
          query(collection(db, 'users'), where('managerId', '==', currentUser.uid)),
          (snap) => {
            reportsByUid = snap.docs.map((d) => d.data() as UserProfile);
            syncLeadUsers();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'users'), where('managerEmail', '==', currentUser.email)),
          (snap) => {
            reportsByEmail = snap.docs.map((d) => d.data() as UserProfile);
            syncLeadUsers();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );
    } else {
      setAllUsers([currentUser]);
    }

    // 4. User invites (Super Admin only)
    if (currentUser.role === 'super_admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'user_invites'),
          (snap) => {
            setUserInvites(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserInvite, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'user_invites')
        )
      );
    } else {
      setUserInvites([]);
    }

    // 5. Attendance
    if (currentUser.role === 'hr_admin' || currentUser.role === 'super_admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'attendance'),
          (snap) => {
            setAttendance(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<AttendanceRecord, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'attendance')
        )
      );
    } else if (currentUser.role === 'lead') {
      let mine: AttendanceRecord[] = [];
      let teamById: AttendanceRecord[] = [];
      let teamByEmail: AttendanceRecord[] = [];
      const syncLeadAtt = () =>
        setAttendance(mergeById([mine, teamById, teamByEmail]));
      unsubs.push(
        onSnapshot(
          query(collection(db, 'attendance'), where('userId', '==', currentUser.uid)),
          (snap) => {
            mine = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<AttendanceRecord, 'id'>),
            }));
            syncLeadAtt();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'attendance')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'attendance'), where('managerId', '==', currentUser.uid)),
          (snap) => {
            teamById = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<AttendanceRecord, 'id'>),
            }));
            syncLeadAtt();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'attendance')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'attendance'), where('managerEmail', '==', currentUser.email)),
          (snap) => {
            teamByEmail = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<AttendanceRecord, 'id'>),
            }));
            syncLeadAtt();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'attendance')
        )
      );
    } else {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'attendance'), where('userId', '==', currentUser.uid)),
          (snap) => {
            setAttendance(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<AttendanceRecord, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'attendance')
        )
      );
    }

    // 6. Leave requests
    if (currentUser.role === 'hr_admin' || currentUser.role === 'super_admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'leave_requests'),
          (snap) => {
            setLeaveRequests(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<LeaveRequest, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
        )
      );
    } else if (currentUser.role === 'lead') {
      let mine: LeaveRequest[] = [];
      let teamById: LeaveRequest[] = [];
      let teamByEmail: LeaveRequest[] = [];
      const syncLeadLeaves = () =>
        setLeaveRequests(mergeById([mine, teamById, teamByEmail]));
      unsubs.push(
        onSnapshot(
          query(collection(db, 'leave_requests'), where('userId', '==', currentUser.uid)),
          (snap) => {
            mine = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<LeaveRequest, 'id'>),
            }));
            syncLeadLeaves();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'leave_requests'), where('managerId', '==', currentUser.uid)),
          (snap) => {
            teamById = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<LeaveRequest, 'id'>),
            }));
            syncLeadLeaves();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'leave_requests'), where('managerEmail', '==', currentUser.email)),
          (snap) => {
            teamByEmail = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<LeaveRequest, 'id'>),
            }));
            syncLeadLeaves();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
        )
      );
    } else {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'leave_requests'), where('userId', '==', currentUser.uid)),
          (snap) => {
            setLeaveRequests(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<LeaveRequest, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
        )
      );
    }

    // 7. Tasks
    if (currentUser.role === 'hr_admin' || currentUser.role === 'super_admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'tasks'),
          (snap) => {
            setTasks(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaskItem, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
        )
      );
    } else if (currentUser.role === 'lead') {
      let byManagerId: TaskItem[] = [];
      let byManagerEmail: TaskItem[] = [];
      let byAssigner: TaskItem[] = [];
      let mineByUid: TaskItem[] = [];
      let mineByEmail: TaskItem[] = [];
      const syncLeadTasks = () =>
        setTasks(mergeById([byManagerId, byManagerEmail, byAssigner, mineByUid, mineByEmail]));
      unsubs.push(
        onSnapshot(
          query(collection(db, 'tasks'), where('managerId', '==', currentUser.uid)),
          (snap) => {
            byManagerId = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TaskItem, 'id'>),
            }));
            syncLeadTasks();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'tasks'), where('managerEmail', '==', currentUser.email)),
          (snap) => {
            byManagerEmail = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TaskItem, 'id'>),
            }));
            syncLeadTasks();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'tasks'), where('assignedById', '==', currentUser.uid)),
          (snap) => {
            byAssigner = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TaskItem, 'id'>),
            }));
            syncLeadTasks();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'tasks'), where('assigneeId', '==', currentUser.uid)),
          (snap) => {
            mineByUid = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TaskItem, 'id'>),
            }));
            syncLeadTasks();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'tasks'), where('assigneeEmail', '==', currentUser.email)),
          (snap) => {
            mineByEmail = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TaskItem, 'id'>),
            }));
            syncLeadTasks();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
        )
      );
    } else {
      let mineByUid: TaskItem[] = [];
      let mineByEmail: TaskItem[] = [];
      const syncEmployeeTasks = () => setTasks(mergeById([mineByUid, mineByEmail]));
      unsubs.push(
        onSnapshot(
          query(collection(db, 'tasks'), where('assigneeId', '==', currentUser.uid)),
          (snap) => {
            mineByUid = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TaskItem, 'id'>),
            }));
            syncEmployeeTasks();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'tasks'), where('assigneeEmail', '==', currentUser.email)),
          (snap) => {
            mineByEmail = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TaskItem, 'id'>),
            }));
            syncEmployeeTasks();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
        )
      );
    }

    // 8. Candidates (HR Admin & Super Admin only)
    if (currentUser.role === 'hr_admin' || currentUser.role === 'super_admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'candidates'),
          (snap) => {
            setCandidates(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<Candidate, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'candidates')
        )
      );
    } else {
      setCandidates([]);
    }

    // 9. Notifications
    let byEmail: NotificationItem[] = [];
    let byUid: NotificationItem[] = [];
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'notifications'),
          where('recipientEmail', '==', currentUser.email)
        ),
        (snap) => {
          byEmail = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<NotificationItem, 'id'>),
          }));
          setNotifications(
            mergeById([byEmail, byUid]).sort(
              (a, b) =>
                (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
            )
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'notifications'),
          where('recipientUserId', '==', currentUser.uid)
        ),
        (snap) => {
          byUid = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<NotificationItem, 'id'>),
          }));
          setNotifications(
            mergeById([byEmail, byUid]).sort(
              (a, b) =>
                (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
            )
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [currentUser]);

  const effectiveRole: UserRole =
    currentUser?.role === 'super_admin' && previewRole
      ? previewRole
      : currentUser?.role || 'employee';

  const allowedTabs = useMemo(
    () => getAllowedTabs(effectiveRole),
    [effectiveRole]
  );

  useEffect(() => {
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [allowedTabs, activeTab]);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      const res = await googleSignIn();
      setFirebaseUser(res.user);
      setGmailToken(res.accessToken);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Gagal masuk dengan akun Google Anda.'
      );
    }
  };

  const handleReconnectGmail = async (): Promise<boolean> => {
    try {
      const res = await googleSignIn();
      setGmailToken(res.accessToken);
      return Boolean(res.accessToken);
    } catch {
      return false;
    }
  };

  const handleConfirmSendEmail = async (subject: string, body: string) => {
    if (!pendingEmail) return;
    const token = gmailToken || getAccessToken();
    if (!token) {
      throw new Error('Token Gmail tidak tersedia.');
    }

    const recipients = Array.from(
      new Set(pendingEmail.to.map((e) => e.trim()).filter(Boolean))
    );
    for (const emailAddr of recipients) {
      const res = await sendGmailMessage(token, emailAddr, subject, body);
      if (!res.success) {
        throw new Error(res.error || `Gagal mengirim ke ${emailAddr}`);
      }
    }

    setPendingEmail(null);
    setToast(`Email notifikasi terkirim via Gmail ke ${recipients.join(', ')}`);
    setTimeout(() => setToast(null), 5000);
  };

  const unreadNotifCount = notifications.filter((n) => !n.isRead).length;

  const markNotificationRead = async (n: NotificationItem) => {
    if (n.isRead) return;
    try {
      await updateDoc(doc(db, 'notifications', n.id), { isRead: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${n.id}`);
    }
  };

  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600 font-medium">
          Memuat C-SYNC HRIS...
        </div>
      </div>
    );
  }

  if (!firebaseUser || !currentUser) {
    return <SignInScreen onSignIn={handleSignIn} error={authError} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200">
          <div className="w-8 h-8 rounded-lg bg-blue-700 text-white flex items-center justify-center font-display font-bold text-sm">
            CS
          </div>
          <span className="font-display font-bold text-lg text-slate-900 tracking-tight whitespace-nowrap">
            C-SYNC
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {allowedTabs.map((tabId) => {
            const meta = NAV_META[tabId];
            const Icon = meta.icon;
            const isActive = activeTab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{meta.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center gap-3 min-w-0">
            {currentUser.photoURL ? (
              <img
                src={currentUser.photoURL}
                alt={currentUser.displayName}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <UserCircle2 className="w-9 h-9 text-slate-400 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {currentUser.displayName}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {ROLE_LABELS[effectiveRole]} · {currentUser.department}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar Akun
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen pb-20 lg:pb-0">
        {/* Top Bar Contract: 3 zones */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
          {/* Zone 1: Brand / Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden font-display font-bold text-base text-slate-900 whitespace-nowrap shrink-0">
              C-SYNC
            </span>
            <span className="hidden lg:inline text-sm font-medium text-slate-500 whitespace-nowrap truncate">
              {settings.companyName} / {NAV_META[activeTab].label}
            </span>
          </div>

          {/* Zone 2: Concise Desktop Info */}
          <div className="hidden md:flex items-center gap-4 text-xs text-slate-500 whitespace-nowrap">
            <span>{currentUser.email}</span>
            <span aria-hidden="true">·</span>
            <span>
              Gmail {gmailToken ? 'Terhubung' : 'Siap Otorisasi'}
            </span>
          </div>

          {/* Zone 3: Notification Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              className="relative inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Bell className="w-4 h-4 text-slate-600" />
              <span className="hidden sm:inline">Notifikasi</span>
              {unreadNotifCount > 0 && (
                <span className="font-mono-tabular text-[11px] font-bold text-blue-700">
                  ({unreadNotifCount})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="lg:hidden p-2 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              aria-label="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Super Admin Role Simulation Bar (Workspace Toolbar below Top Bar) */}
        {currentUser.role === 'super_admin' && (
          <div className="bg-slate-100 border-b border-slate-200 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-600 font-medium">
              Pratinjau Tampilan Role (Super Admin):
            </span>
            <div className="inline-flex flex-wrap items-center gap-1">
              {(['super_admin', 'hr_admin', 'lead', 'employee'] as UserRole[]).map(
                (r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setPreviewRole(r === 'super_admin' ? null : r)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      effectiveRole === r
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Toast feedback */}
        {toast && (
          <div className="mx-4 sm:mx-6 mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Mail className="w-4 h-4 shrink-0" />
              {toast}
            </span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'attendance' && (
            <AttendanceModule
              currentUser={currentUser}
              effectiveRole={effectiveRole}
              settings={settings}
              allAttendance={attendance}
              onQueueEmail={setPendingEmail}
            />
          )}

          {activeTab === 'leave' && (
            <LeaveModule
              currentUser={currentUser}
              effectiveRole={effectiveRole}
              settings={settings}
              allUsers={allUsers}
              leavePolicies={leavePolicies}
              leaveRequests={leaveRequests}
              onQueueEmail={setPendingEmail}
            />
          )}

          {activeTab === 'tasks' && (
            <TasksModule
              currentUser={currentUser}
              effectiveRole={effectiveRole}
              allUsers={allUsers}
              tasks={tasks}
              onQueueEmail={setPendingEmail}
            />
          )}

          {activeTab === 'recruitment' && (
            <RecruitmentModule
              currentUser={currentUser}
              effectiveRole={effectiveRole}
              candidates={candidates}
              onQueueEmail={setPendingEmail}
            />
          )}

          {activeTab === 'kpi' &&
            (effectiveRole === 'super_admin' || effectiveRole === 'hr_admin') && (
              <KpiDashboardModule
                effectiveRole={effectiveRole}
                allUsers={allUsers}
                allAttendance={attendance}
                leaveRequests={leaveRequests}
                tasks={tasks}
                candidates={candidates}
              />
            )}

          {activeTab === 'settings' && effectiveRole === 'super_admin' && (
            <SettingsModule
              currentUser={currentUser}
              settings={settings}
              allUsers={allUsers}
              userInvites={userInvites}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (<= 15% mobile height) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30 flex items-center justify-around px-1 py-1">
        {allowedTabs.map((tabId) => {
          const meta = NAV_META[tabId];
          const Icon = meta.icon;
          const isActive = activeTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 min-h-[44px] min-w-[52px] rounded-lg text-[11px] font-medium cursor-pointer ${
                isActive ? 'text-blue-700' : 'text-slate-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-[60px]">{meta.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Real-Time Notifications Slide-Over */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 flex justify-end">
          <div className="bg-white w-full max-w-md h-full border-l border-slate-200 flex flex-col shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Pusat Notifikasi Real-Time
                </h2>
                <p className="text-xs text-slate-500">
                  {unreadNotifCount} belum dibaca
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNotifOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
              {notifications.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  Belum ada notifikasi baru untuk akun Anda.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markNotificationRead(n)}
                    className={`p-4 space-y-1 cursor-pointer transition-colors ${
                      n.isRead ? 'bg-white' : 'bg-blue-50/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900">
                        {n.title}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {n.isRead ? 'Dibaca' : 'Baru'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {n.message}
                    </p>
                    <div className="text-[11px] text-slate-400">
                      Dari {n.senderName} ·{' '}
                      {n.createdAt
                        ? n.createdAt.toDate().toLocaleString('id-ID')
                        : 'Baru saja'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Explicit Gmail Dispatch Confirmation Modal */}
      <EmailConfirmModal
        pending={pendingEmail}
        hasGmailToken={Boolean(gmailToken || getAccessToken())}
        onReconnectGmail={handleReconnectGmail}
        onConfirmSend={handleConfirmSendEmail}
        onSkip={() => setPendingEmail(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
