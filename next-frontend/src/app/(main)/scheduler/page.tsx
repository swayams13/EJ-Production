"use client";
import React, { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003/api/v1';

export default function SchedulerPage() {
    const [assignments, setAssignments] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchAssignments();
    }, [date]);

    const getHeaders = () => {
        return {
            'Content-Type': 'application/json',
            'X-User-Role': localStorage.getItem('user_role') || 'Supervisor'
        };
    };

    const fetchAssignments = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_URL}/scheduler/assignments?target_date=${date}`, {
                headers: getHeaders()
            });
            if (response.ok) {
                const data = await response.json();
                setAssignments(data);
            } else {
                setError("Failed to fetch assignments");
            }
        } catch (error) {
            console.error("Error fetching assignments:", error);
            setError("Error fetching assignments");
        }
        setLoading(false);
    };

    const handleAutoAssign = async () => {
        if (!confirm("This will overwrite existing 'Pending' assignments for today. Continue?")) return;
        
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_URL}/scheduler/auto-assign?target_date=${date}`, {
                method: 'POST',
                headers: getHeaders()
            });
            const data = await response.json();
            if (data.success) {
                alert("Auto-assignment complete!");
                fetchAssignments();
            } else {
                alert(data.message || "Failed to auto-assign");
            }
        } catch (error) {
            console.error("Error running auto-assign:", error);
            alert("Error running auto-assign");
        }
        setLoading(false);
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800">Daily Scheduler</h1>
                    <p className="text-slate-500">Smart Task Allocation Engine</p>
                </div>
                <div className="flex gap-4 items-center">
                    <input 
                        type="date" 
                        value={date} 
                        onChange={(e) => setDate(e.target.value)} 
                        className="px-4 py-2 border border-slate-300 rounded-lg shadow-sm focus:ring focus:ring-indigo-200 focus:outline-none"
                    />
                    <button 
                        onClick={handleAutoAssign}
                        disabled={loading}
                        className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg shadow hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                        {loading ? 'Processing...' : 'Run Auto-Assign'}
                    </button>
                </div>
            </div>

            {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-200">
                    <h2 className="text-xl font-semibold text-slate-800">Task Assignments for {date}</h2>
                </div>
                <div className="p-0">
                    {loading && assignments.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">Loading assignments...</div>
                    ) : assignments.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">No assignments for this date. Run Auto-Assign to generate.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-sm text-slate-600">
                                        <th className="p-4 font-medium">User ID</th>
                                        <th className="p-4 font-medium">Project ID</th>
                                        <th className="p-4 font-medium">Process Type</th>
                                        <th className="p-4 font-medium">Target Feet</th>
                                        <th className="p-4 font-medium">Overtime</th>
                                        <th className="p-4 font-medium">Status</th>
                                        <th className="p-4 font-medium">Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {assignments.map((task: any) => (
                                        <tr key={task.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                            <td className="p-4 text-slate-800 font-medium">{task.user_id}</td>
                                            <td className="p-4 text-slate-800">{task.project_id}</td>
                                            <td className="p-4">
                                                <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium">
                                                    {task.process_type}
                                                </span>
                                            </td>
                                            <td className="p-4 text-slate-700">{task.target_feet}</td>
                                            <td className="p-4">
                                                {task.is_overtime ? 
                                                    <span className="px-2.5 py-1 bg-purple-100 text-purple-800 rounded-md text-xs font-medium">Yes</span> : 
                                                    <span className="text-slate-400 text-sm">No</span>
                                                }
                                            </td>
                                            <td className="p-4">
                                                <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                                                    task.status === 'Completed' ? 'bg-green-100 text-green-800' :
                                                    task.status === 'Pending' ? 'bg-amber-100 text-amber-800' :
                                                    'bg-slate-100 text-slate-800'
                                                }`}>
                                                    {task.status}
                                                </span>
                                            </td>
                                            <td className="p-4 text-slate-500 text-sm max-w-xs truncate">
                                                {task.notes || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
