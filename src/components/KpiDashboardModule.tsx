import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Briefcase,
  CheckCircle2,
  Clock,
  Search,
  Target,
  Users,
} from 'lucide-react';
import {
  AttendanceRecord,
  Candidate,
  LeaveRequest,
  RECRUITMENT_STAGES,
  TaskItem,
  TaskStatus,
  UserProfile,
  UserRole,
} from '../types';
import { getTodayIsoDate } from '../utils/geo';

interface KpiDashboardModuleProps {
  effectiveRole?: UserRole;
  allUsers: UserProfile[];
  allAttendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  tasks: TaskItem[];
  candidates: Candidate[];
}

export const KpiDashboardModule: React.FC<KpiDashboardModuleProps> = ({
  effectiveRole = 'super_admin',
  allUsers,
  allAttendance,
  leaveRequests,
  tasks,
  candidates,
}) => {
  const [taskSearch, setTaskSearch] = useState('');
  const [taskDeptFilter, setTaskDeptFilter] = useState('ALL');
  const [taskStatusFilter, setTaskStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const today = getTodayIsoDate();

  const metrics = useMemo(() => {
    const activeUsers = allUsers.filter((u) => u.status === 'active');
    const todayAttendance = allAttendance.filter((a) => a.date === today);
    const presentToday = todayAttendance.filter(
      (a) => a.overallStatus !== 'rejected'
    ).length;
    const attendanceRate =
      activeUsers.length > 0
        ? Math.round((presentToday / activeUsers.length) * 100)
        : 0;

    const approvedOrPresent = allAttendance.filter(
      (a) => a.overallStatus === 'present' || a.overallStatus === 'approved'
    ).length;
    const wfoCount = allAttendance.filter((a) => a.workMode === 'WFO').length;
    const wfhOutsideCount = allAttendance.filter(
      (a) => a.workMode !== 'WFO' || a.clockInOutsideRadius
    ).length;

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === 'completed').length;
    const avgKpiProgress =
      totalTasks > 0
        ? Math.round(
            tasks.reduce((sum, t) => sum + t.progressPercent, 0) / totalTasks
          )
        : 0;

    const pendingApprovals =
      allAttendance.filter((a) => a.overallStatus === 'pending_approval').length +
      leaveRequests.filter(
        (l) => l.overallStatus === 'pending_lead' || l.overallStatus === 'pending_hr'
      ).length;

    const hiredCount = candidates.filter((c) => c.stage === 'hired').length;
    const offeringCount = candidates.filter((c) => c.stage === 'offering').length;

    return {
      totalUsers: activeUsers.length,
      presentToday,
      attendanceRate,
      approvedOrPresent,
      wfoCount,
      wfhOutsideCount,
      totalTasks,
      completedTasks,
      avgKpiProgress,
      pendingApprovals,
      hiredCount,
      offeringCount,
    };
  }, [allUsers, allAttendance, leaveRequests, tasks, candidates, today]);

  // Department KPI breakdown
  const departmentBreakdown = useMemo(() => {
    const deptSet = new Set<string>();
    allUsers.forEach((u) => u.department && deptSet.add(u.department));
    tasks.forEach((t) => t.department && deptSet.add(t.department));

    return Array.from(deptSet)
      .sort()
      .map((dept) => {
        const members = allUsers.filter((u) => u.department === dept);
        const deptTasks = tasks.filter((t) => t.department === dept);
        const deptAtt = allAttendance.filter(
          (a) => a.department === dept && a.date === today
        );
        const deptLeaves = leaveRequests.filter(
          (l) => l.department === dept && l.overallStatus === 'approved'
        );

        const goalAvg =
          deptTasks.length > 0
            ? Math.round(
                deptTasks.reduce((s, t) => s + t.progressPercent, 0) /
                  deptTasks.length
              )
            : 0;
        const attPct =
          members.length > 0
            ? Math.round((deptAtt.length / members.length) * 100)
            : 0;

        return {
          dept,
          headcount: members.length,
          presentToday: deptAtt.length,
          attPct,
          taskCount: deptTasks.length,
          goalAvg,
          approvedLeaveDays: deptLeaves.reduce((s, l) => s + l.totalDays, 0),
        };
      });
  }, [allUsers, tasks, allAttendance, leaveRequests, today]);

  // Recruitment funnel counts
  const funnelStages = useMemo(() => {
    const stageKeys = [
      'cv_screening',
      'hr_interview',
      'user_interview',
      'assessment',
      'ceo_interview',
      'offering',
      'hired',
    ];
    const maxCount = Math.max(
      1,
      ...stageKeys.map((k) => candidates.filter((c) => c.stage === k).length)
    );
    return stageKeys.map((k) => {
      const meta = RECRUITMENT_STAGES.find((s) => s.id === k);
      const count = candidates.filter((c) => c.stage === k).length;
      return {
        id: k,
        label: meta?.shortLabel || k,
        count,
        widthPct: Math.round((count / maxCount) * 100),
      };
    });
  }, [candidates]);

  const taskDepartments = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => t.department && set.add(t.department));
    return Array.from(set).sort();
  }, [tasks]);

  const filteredLiveTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    return tasks
      .filter((t) => {
        if (taskDeptFilter !== 'ALL' && t.department !== taskDeptFilter) return false;
        if (taskStatusFilter !== 'ALL' && t.status !== taskStatusFilter) return false;
        if (!q) return true;
        return (
          t.title.toLowerCase().includes(q) ||
          t.assigneeName.toLowerCase().includes(q) ||
          (t.managerEmail || '').toLowerCase().includes(q) ||
          t.assignedByName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1));
  }, [tasks, taskSearch, taskDeptFilter, taskStatusFilter]);

  const taskStatusMeta: Record<TaskStatus, { label: string; colorClass: string }> = {
    todo: { label: 'To Do', colorClass: 'text-slate-600' },
    in_progress: { label: 'In Progress', colorClass: 'text-blue-700' },
    review: { label: 'Review', colorClass: 'text-amber-700' },
    completed: { label: 'Selesai', colorClass: 'text-emerald-700' },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          {effectiveRole === 'super_admin'
            ? 'KPI Tracking Eksekutif (Super Admin)'
            : 'HR & KPI Tracking Dashboard'}
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Pemantauan disiplin kehadiran, to-do list &amp; target karyawan/Lead, antrean approval, dan efektivitas rekrutmen secara real-time
        </p>
      </div>

      {/* Top KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Kehadiran Hari Ini</span>
            <Users className="w-4 h-4 text-blue-700" />
          </div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1.5">
            {metrics.attendanceRate}%
          </div>
          <div className="text-[11px] font-mono-tabular text-slate-500 mt-1">
            {metrics.presentToday} / {metrics.totalUsers} karyawan aktif
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Capaian KPI &amp; Goals</span>
            <Target className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1.5">
            {metrics.avgKpiProgress}%
          </div>
          <div className="text-[11px] font-mono-tabular text-slate-500 mt-1">
            {metrics.completedTasks} / {metrics.totalTasks} tugas selesai
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Antrean Approval</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1.5">
            {metrics.pendingApprovals}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Absensi luar radius &amp; pengajuan cuti
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Kandidat Offering / Hired</span>
            <Briefcase className="w-4 h-4 text-blue-700" />
          </div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1.5">
            {metrics.offeringCount} / {metrics.hiredCount}
          </div>
          <div className="text-[11px] font-mono-tabular text-slate-500 mt-1">
            Total {candidates.length} kandidat terdata
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Work Mode & Attendance Composition */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Distribusi Kehadiran &amp; Mode Kerja
              </h2>
              <p className="text-xs text-slate-500">
                Perbandingan WFO vs WFH / Luar Radius
              </p>
            </div>
            <CheckCircle2 className="w-4 h-4 text-slate-400" />
          </div>

          <div className="flex items-center gap-6 py-2">
            {/* Clean SVG Donut */}
            <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0">
              <circle
                cx="60"
                cy="60"
                r="46"
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="14"
              />
              {allAttendance.length > 0 && (
                <circle
                  cx="60"
                  cy="60"
                  r="46"
                  fill="none"
                  stroke="#1D4ED8"
                  strokeWidth="14"
                  strokeDasharray={`${Math.round(
                    (metrics.wfoCount / Math.max(1, allAttendance.length)) * 289
                  )} 289`}
                  transform="rotate(-90 60 60)"
                />
              )}
              <text
                x="60"
                y="64"
                textAnchor="middle"
                className="fill-slate-900 text-lg font-bold font-mono-tabular"
              >
                {allAttendance.length}
              </text>
            </svg>

            <div className="flex-1 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">WFO (Dalam Radius)</span>
                <span className="font-mono-tabular font-semibold text-blue-700">
                  {metrics.wfoCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">WFH / Visit / Luar Radius</span>
                <span className="font-mono-tabular font-semibold text-amber-700">
                  {metrics.wfhOutsideCount}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="text-slate-600">Terverifikasi / Disetujui</span>
                <span className="font-mono-tabular font-semibold text-emerald-700">
                  {metrics.approvedOrPresent}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Recruitment Funnel Chart */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Funnel Proses Rekrutmen
              </h2>
              <p className="text-xs text-slate-500">
                Sebaran kandidat di setiap tahapan seleksi
              </p>
            </div>
            <BarChart3 className="w-4 h-4 text-slate-400" />
          </div>

          <div className="space-y-2.5">
            {funnelStages.map((st) => (
              <div key={st.id} className="grid grid-cols-12 items-center gap-3 text-xs">
                <div className="col-span-4 sm:col-span-3 text-slate-700 truncate">
                  {st.label}
                </div>
                <div className="col-span-6 sm:col-span-8 bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-700 rounded-full transition-all"
                    style={{ width: `${st.count > 0 ? Math.max(8, st.widthPct) : 0}%` }}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 text-right font-mono-tabular font-semibold text-slate-900">
                  {st.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Department KPI Scorecard Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            Scorecard KPI per Departemen
          </h2>
          <p className="text-xs text-slate-500">
            Agregasi real-time kehadiran, pencapaian target tugas, dan penggunaan cuti
          </p>
        </div>

        {departmentBreakdown.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Belum ada data departemen yang tercatat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-4">Departemen</th>
                  <th className="py-2.5 px-4 text-right">Headcount</th>
                  <th className="py-2.5 px-4 text-right">Hadir Hari Ini</th>
                  <th className="py-2.5 px-4 text-right">Total Tugas</th>
                  <th className="py-2.5 px-4 text-right">Progres Goal</th>
                  <th className="py-2.5 px-4 text-right">Cuti Disetujui</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {departmentBreakdown.map((row) => (
                  <tr key={row.dept} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {row.dept}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-700">
                      {row.headcount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-700">
                      {row.presentToday} ({row.attPct}%)
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-700">
                      {row.taskCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-blue-700">
                      {row.goalAvg}%
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-700">
                      {row.approvedLeaveDays} hr
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Real-Time Employee & Lead To-Do List Integration */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Monitoring To-Do List &amp; Goals Karyawan (Real-Time)
            </h2>
            <p className="text-xs text-slate-500">
              Tersinkronisasi langsung dari setiap karyawan dan Lead/Manager masing-masing ({filteredLiveTasks.length} item)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                placeholder="Cari karyawan, tugas, atau Lead..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white w-52"
              />
            </div>

            <select
              value={taskDeptFilter}
              onChange={(e) => setTaskDeptFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="ALL">Semua Departemen</option>
              {taskDepartments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              value={taskStatusFilter}
              onChange={(e) => setTaskStatusFilter(e.target.value as 'ALL' | TaskStatus)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="ALL">Semua Status</option>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="completed">Selesai</option>
            </select>
          </div>
        </div>

        {filteredLiveTasks.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Belum ada data to-do list atau goal yang cocok dengan filter saat ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-4">Karyawan</th>
                  <th className="py-2.5 px-4">Lead / Pemberi Tugas</th>
                  <th className="py-2.5 px-4">To-Do / Goal</th>
                  <th className="py-2.5 px-4">Tenggat</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Progres</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredLiveTasks.map((t) => {
                  const st = taskStatusMeta[t.status] || taskStatusMeta.todo;
                  const leadUser = allUsers.find(
                    (u) =>
                      (t.managerId && u.uid === t.managerId) ||
                      (t.managerEmail && u.email === t.managerEmail)
                  );
                  return (
                    <tr key={t.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{t.assigneeName}</div>
                        <div className="text-[11px] text-slate-500">{t.department}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-800 font-medium">
                          {leadUser?.displayName || t.assignedByName}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {t.managerEmail || 'Pemberi: ' + t.assignedByName}
                        </div>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-medium text-slate-900 truncate">{t.title}</div>
                        <div className="text-[11px] text-slate-500">
                          {t.type === 'goal' ? 'Goal KPI' : 'To-Do'} · Prioritas {t.priority}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono-tabular text-slate-700 whitespace-nowrap">
                        {t.dueDate}
                      </td>
                      <td className={`py-3 px-4 font-medium whitespace-nowrap ${st.colorClass}`}>
                        {st.label}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-700 rounded-full"
                              style={{ width: `${t.progressPercent}%` }}
                            />
                          </div>
                          <span className="font-mono-tabular font-semibold text-slate-900 w-9 text-right">
                            {t.progressPercent}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
