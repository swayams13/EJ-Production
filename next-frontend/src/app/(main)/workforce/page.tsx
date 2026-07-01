"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";

export default function WorkforceDashboard() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState("Present");
  const [submitting, setSubmitting] = useState(false);

  const fetchMetrics = () => {
    setLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/workforce/metrics`)
      .then(res => res.json())
      .then(resData => {
        setMetrics(resData.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const handleAttendanceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setSubmitting(true);

    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/workforce/attendance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        user_id: selectedUser,
        date: new Date().toISOString().split('T')[0],
        status: attendanceStatus
      })
    })
    .then(res => res.json())
    .then(() => {
      setSubmitting(false);
      alert("Attendance recorded successfully!");
      fetchMetrics();
    })
    .catch(err => {
      console.error(err);
      setSubmitting(false);
      alert("Failed to record attendance.");
    });
  };

  return (
    <div>
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Workforce Intelligence</h1>
        <p className="text-slate-300 text-lg font-medium">Worker metrics, efficiency rankings, and attendance tracking.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Attendance Tracker */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 lg:col-span-1">
          <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wide mb-6">Mark Daily Attendance</h2>
          <form onSubmit={handleAttendanceSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Select Worker</label>
              <select 
                value={selectedUser || ""} 
                onChange={e => setSelectedUser(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg p-2 text-slate-800"
                required
              >
                <option value="" disabled>Select a worker...</option>
                {metrics.map(user => (
                  <option key={user.user_id} value={user.user_id}>{user.name} ({user.department || user.skill || 'Unknown'})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Status (Today)</label>
              <select 
                value={attendanceStatus}
                onChange={e => setAttendanceStatus(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-slate-800"
              >
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Leave">Leave</option>
                <option value="Overtime">Overtime</option>
              </select>
            </div>
            <button 
              type="submit" 
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              {submitting ? "Saving..." : "Record Attendance"}
            </button>
          </form>
        </div>

        {/* Worker Rankings */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 lg:col-span-2">
          <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wide mb-6">Worker Performance Metrics</h2>
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Dept / Skill</th>
                    <th className="py-3 px-4">Attendance</th>
                    <th className="py-3 px-4">Efficiency</th>
                    <th className="py-3 px-4">Quality</th>
                    <th className="py-3 px-4">Reliability</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {metrics.map(user => (
                    <tr key={user.user_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-slate-800">{user.name}</td>
                      <td className="py-3 px-4 text-slate-600">
                        {user.department || user.skill || 'N/A'} {user.department && user.skill ? `/ ${user.skill}` : ''}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${user.attendance_score >= 80 ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'}`}>
                          {user.attendance_score}%
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-blue-600 font-semibold">{user.efficiency_score}%</span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700">{user.quality_score}%</td>
                      <td className="py-3 px-4 font-semibold text-purple-700">{user.reliability_score}%</td>
                    </tr>
                  ))}
                  {metrics.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">No workforce data available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
