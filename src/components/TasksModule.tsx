import React, { useMemo, useState } from 'react';
import {
  CheckSquare,
  Plus,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  PendingEmailDispatch,
  TaskItem,
  TaskPriority,
  TaskStatus,
  UserProfile,
  UserRole,
  VALIDATION_LIMITS,
} from '../types';
import { getTodayIsoDate } from '../utils/geo';
import { createInAppNotification } from '../utils/gmail';

interface TasksModuleProps {
  currentUser: UserProfile;
  effectiveRole: UserRole;
  allUsers: UserProfile[];
  tasks: TaskItem[];
  onQueueEmail: (payload: PendingEmailDispatch) => void;
}

export const TasksModule: React.FC<TasksModuleProps> = ({
  currentUser,
  effectiveRole,
  allUsers,
  tasks,
  onQueueEmail,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'todo' | 'goal'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | TaskStatus>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('ALL');
  const [modalOpen, setModalOpen] = useState(false);

  // Create form state
  const [assigneeId, setAssigneeId] = useState('');
  const [taskType, setTaskType] = useState<'todo' | 'goal'>('todo');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState(getTodayIsoDate());
  const [targetMetric, setTargetMetric] = useState('');
  const [kpiWeight, setKpiWeight] = useState(20);
  const [saving, setSaving] = useState(false);

  const isEmployeeView = effectiveRole === 'employee';
  const canAssignOthers =
    effectiveRole === 'lead' ||
    effectiveRole === 'hr_admin' ||
    effectiveRole === 'super_admin';

  const assignableUsers = useMemo(() => {
    if (effectiveRole === 'super_admin' || effectiveRole === 'hr_admin') {
      return allUsers;
    }
    if (effectiveRole === 'lead') {
      return allUsers.filter(
        (u) =>
          u.managerId === currentUser.uid ||
          (u.managerEmail && u.managerEmail === currentUser.email) ||
          u.uid === currentUser.uid
      );
    }
    return [currentUser];
  }, [allUsers, effectiveRole, currentUser]);

  const visibleTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        if (effectiveRole === 'employee') {
          if (t.assigneeId !== currentUser.uid && t.assigneeEmail !== currentUser.email) {
            return false;
          }
        } else if (effectiveRole === 'lead') {
          if (
            t.managerId !== currentUser.uid &&
            (!t.managerEmail || t.managerEmail !== currentUser.email) &&
            t.assignedById !== currentUser.uid &&
            t.assigneeId !== currentUser.uid &&
            t.assigneeEmail !== currentUser.email
          ) {
            return false;
          }
        }
        if (filterAssignee !== 'ALL' && t.assigneeEmail !== filterAssignee) return false;
        if (filterType !== 'all' && t.type !== filterType) return false;
        if (filterStatus !== 'all' && t.status !== filterStatus) return false;
        return true;
      })
      .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1));
  }, [
    tasks,
    effectiveRole,
    currentUser.uid,
    currentUser.email,
    filterAssignee,
    filterType,
    filterStatus,
  ]);

  const avgProgress = useMemo(() => {
    if (visibleTasks.length === 0) return 0;
    const sum = visibleTasks.reduce((acc, t) => acc + t.progressPercent, 0);
    return Math.round(sum / visibleTasks.length);
  }, [visibleTasks]);

  const handleOpenCreate = () => {
    setAssigneeId(assignableUsers[0]?.uid || currentUser.uid);
    setTaskType('todo');
    setTitle('');
    setDescription('');
    setPriority('medium');
    setDueDate(getTodayIsoDate());
    setTargetMetric('');
    setKpiWeight(20);
    setModalOpen(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const targetUser = isEmployeeView
      ? currentUser
      : assignableUsers.find((u) => u.uid === assigneeId) || currentUser;
    const resolvedType: 'todo' | 'goal' = isEmployeeView ? 'todo' : taskType;
    const resolvedManagerId = isEmployeeView
      ? currentUser.managerId || ''
      : targetUser.managerId || currentUser.uid;
    const resolvedManagerEmail = isEmployeeView
      ? currentUser.managerEmail || ''
      : targetUser.managerEmail || currentUser.email;

    setSaving(true);
    try {
      await addDoc(collection(db, 'tasks'), {
        assigneeId: targetUser.uid,
        assigneeName: targetUser.displayName.slice(0, VALIDATION_LIMITS.DISPLAY_NAME_MAX),
        assigneeEmail: targetUser.email,
        department: targetUser.department.slice(0, VALIDATION_LIMITS.DEPARTMENT_MAX),
        assignedById: currentUser.uid,
        assignedByName: currentUser.displayName.slice(0, VALIDATION_LIMITS.DISPLAY_NAME_MAX),
        managerId: resolvedManagerId,
        managerEmail: resolvedManagerEmail,
        type: resolvedType,
        title: title.trim().slice(0, VALIDATION_LIMITS.TASK_TITLE_MAX),
        description: description.trim().slice(0, VALIDATION_LIMITS.TASK_DESC_MAX),
        priority,
        dueDate,
        targetMetric: targetMetric.trim().slice(0, 160),
        progressPercent: 0,
        kpiWeight: Number(kpiWeight),
        status: 'todo',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setModalOpen(false);

      if (isEmployeeView && currentUser.managerEmail) {
        await createInAppNotification({
          recipientUserId: currentUser.managerId || '',
          recipientEmail: currentUser.managerEmail,
          title: `To-Do Baru dari ${currentUser.displayName}`,
          message: `${currentUser.displayName} menambahkan to-do mandiri "${title.trim()}" (tenggat ${dueDate}).`,
          category: 'task',
          emailSent: false,
          sender: currentUser,
        });
      } else if (!isEmployeeView) {
        await createInAppNotification({
          recipientUserId: targetUser.uid,
          recipientEmail: targetUser.email,
          title: `${resolvedType === 'goal' ? 'Goal Baru' : 'To-Do Baru'}: ${title.trim()}`,
          message: `${currentUser.displayName} menetapkan ${
            resolvedType === 'goal' ? 'goal' : 'to-do'
          } "${title.trim()}" dengan tenggat ${dueDate}.`,
          category: 'task',
          emailSent: false,
          sender: currentUser,
        });

        if (targetUser.email && targetUser.uid !== currentUser.uid) {
          onQueueEmail({
            to: [targetUser.email],
            subject: `[C-SYNC] Penugasan ${resolvedType === 'goal' ? 'Goal' : 'To-Do'}: ${title.trim()}`,
            body: `Halo ${targetUser.displayName},\n\n${currentUser.displayName} telah menetapkan ${
              resolvedType === 'goal' ? 'Goal KPI' : 'To-Do List'
            } baru untuk Anda:\n- Judul: ${title.trim()}\n- Prioritas: ${priority.toUpperCase()}\n- Target / Metrik: ${
              targetMetric.trim() || '-'
            }\n- Bobot KPI: ${kpiWeight}%\n- Tenggat Waktu: ${dueDate}\n\nSilakan perbarui progres Anda melalui C-SYNC HRIS.\n\nSalam,\nC-SYNC HRIS`,
            category: 'task',
            contextLabel: `Notifikasi Penugasan ke ${targetUser.displayName}`,
          });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tasks');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTaskProgress = async (
    task: TaskItem,
    nextStatus: TaskStatus,
    nextProgress: number
  ) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        status: nextStatus,
        progressPercent: nextProgress,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `tasks/${taskId}`);
    }
  };

  const statusLabel: Record<TaskStatus, string> = {
    todo: 'To Do',
    in_progress: 'In Progress',
    review: 'Review',
    completed: 'Selesai',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            {isEmployeeView
              ? 'To-Do List & Goals Saya'
              : 'Tracking To-Do List & Team Goals'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {isEmployeeView
              ? `Terhubung real-time dengan Lead (${
                  currentUser.managerName || currentUser.managerEmail || 'Belum dipetakan'
                }) dan HR Dashboard`
              : effectiveRole === 'lead'
                ? 'Tetapkan target, goal KPI, dan pantau progres to-do anggota tim Anda secara real-time'
                : 'Pemantauan progres tugas dan pencapaian sasaran kerja seluruh karyawan secara real-time'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-700 text-white text-xs font-semibold rounded-lg hover:bg-blue-800 transition-colors cursor-pointer whitespace-nowrap shrink-0 self-start"
        >
          <Plus className="w-4 h-4" />
          {isEmployeeView ? 'Tambah To-Do Mandiri' : 'Tetapkan To-Do / Goal'}
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Item Aktif</div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
            {visibleTasks.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Goals Strategis</div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
            {visibleTasks.filter((t) => t.type === 'goal').length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Selesai</div>
          <div className="text-2xl font-bold font-mono-tabular text-emerald-700 mt-1">
            {visibleTasks.filter((t) => t.status === 'completed').length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Rata-Rata Progres</div>
          <div className="text-2xl font-bold font-mono-tabular text-blue-700 mt-1">
            {avgProgress}%
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['all', 'todo', 'goal'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                filterType === t
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              {t === 'all' ? 'Semua' : t === 'todo' ? 'To-Do' : 'Goals'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAssignOthers && assignableUsers.length > 1 && (
            <select
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="ALL">Semua Karyawan</option>
              {assignableUsers.map((u) => (
                <option key={u.uid} value={u.email}>
                  {u.displayName} ({u.department})
                </option>
              ))}
            </select>
          )}

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | TaskStatus)}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">Semua Status</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="review">Review</option>
            <option value="completed">Selesai</option>
          </select>
        </div>
      </div>

      {/* Task List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {visibleTasks.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {isEmployeeView
              ? 'Belum ada to-do list untuk Anda. Tambahkan To-Do Mandiri atau tunggu penugasan dari Lead Anda.'
              : 'Belum ada tugas atau goal yang ditetapkan.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {visibleTasks.map((task) => {
              const canDelete =
                effectiveRole === 'super_admin' ||
                task.assignedById === currentUser.uid ||
                task.managerId === currentUser.uid ||
                (task.managerEmail && task.managerEmail === currentUser.email);
              return (
                <div
                  key={task.id}
                  className="p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 hover:bg-slate-50/60"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 font-medium text-blue-700">
                        {task.type === 'goal' ? (
                          <Target className="w-3.5 h-3.5" />
                        ) : (
                          <CheckSquare className="w-3.5 h-3.5" />
                        )}
                        {task.type === 'goal' ? 'Goal' : 'To-Do'}
                      </span>
                      <span>·</span>
                      <span>{task.assigneeName}</span>
                      <span>·</span>
                      <span>Oleh {task.assignedByName}</span>
                      {task.managerEmail && (
                        <>
                          <span>·</span>
                          <span>Lead: {task.managerEmail}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>Prioritas {task.priority}</span>
                      <span>·</span>
                      <span className="font-mono-tabular">Tenggat {task.dueDate}</span>
                      {task.kpiWeight > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-mono-tabular">Bobot {task.kpiWeight}%</span>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {task.title}
                    </h3>
                    {task.description && (
                      <p className="text-xs text-slate-600">{task.description}</p>
                    )}
                    {task.targetMetric && (
                      <p className="text-xs text-slate-500">
                        Target Metrik: <strong className="text-slate-700">{task.targetMetric}</strong>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="w-36 space-y-1">
                      <div className="flex justify-between text-[11px] font-mono-tabular text-slate-600">
                        <span>Progres</span>
                        <span>{task.progressPercent}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={10}
                        value={task.progressPercent}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const st: TaskStatus =
                            val === 100
                              ? 'completed'
                              : val > 0
                                ? 'in_progress'
                                : 'todo';
                          handleUpdateTaskProgress(task, st, val);
                        }}
                        className="w-full accent-blue-700 cursor-pointer"
                      />
                    </div>

                    <select
                      value={task.status}
                      onChange={(e) => {
                        const nextSt = e.target.value as TaskStatus;
                        const nextPct =
                          nextSt === 'completed'
                            ? 100
                            : nextSt === 'todo'
                              ? 0
                              : Math.max(25, task.progressPercent);
                        handleUpdateTaskProgress(task, nextSt, nextPct);
                      }}
                      className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      {(Object.keys(statusLabel) as TaskStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {statusLabel[st]}
                        </option>
                      ))}
                    </select>

                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeleteTask(task.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                        title="Hapus"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTask}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Tetapkan To-Do List / Goal Karyawan
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {canAssignOthers ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tipe Item
                    </label>
                    <select
                      value={taskType}
                      onChange={(e) => setTaskType(e.target.value as 'todo' | 'goal')}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="todo">To-Do Harian / Mingguan</option>
                      <option value="goal">Team Goal / KPI</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Karyawan
                    </label>
                    <select
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                    >
                      {assignableUsers.map((u) => (
                        <option key={u.uid} value={u.uid}>
                          {u.displayName} ({u.department})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  To-Do mandiri Anda akan langsung terlihat oleh Lead (
                  <strong className="text-slate-900">
                    {currentUser.managerName || currentUser.managerEmail || 'Belum dipetakan'}
                  </strong>
                  ) dan HR Dashboard secara real-time.
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Judul Tugas / Goal
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={VALIDATION_LIMITS.TASK_TITLE_MAX}
                  placeholder="Contoh: Finalisasi modul payroll Q4"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Deskripsi Detail
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={VALIDATION_LIMITS.TASK_DESC_MAX}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Prioritas
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tenggat
                  </label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bobot KPI (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={kpiWeight}
                    onChange={(e) => setKpiWeight(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-tabular"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Target Metrik (Opsional)
                </label>
                <input
                  type="text"
                  value={targetMetric}
                  onChange={(e) => setTargetMetric(e.target.value)}
                  placeholder="Contoh: 100% SLA tercapai / 5 klien onboarding"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Menyimpan...' : 'Simpan & Tugaskan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
