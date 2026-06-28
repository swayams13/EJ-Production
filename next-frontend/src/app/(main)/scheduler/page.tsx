"use client";
import React, { useState, useEffect } from 'react';
import { apiFetch } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4500';

export default function SchedulerPage() {
    const [assignments, setAssignments] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchAssignments();
    }, [date]);

    const fetchAssignments = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await apiFetch(`${API_URL}/api/v1/scheduler/assignments?target_date=${date}`);
            if (response.ok) {
                const data = await response.json();
                setAssignments(data);
            } else {
                setError("Failed to fetch assignments. You may not be authorized or the server returned an error.");
            }
        } catch (error) {
            console.error("Error fetching assignments:", error);
            setError("Error fetching assignments. Please check your connection.");
        }
        setLoading(false);
    };

    const handleAutoAssign = async () => {
        if (!confirm("This will overwrite existing 'Pending' assignments for today. Continue?")) return;
        
        setLoading(true);
        setError(null);
        try {
            const response = await apiFetch(`${API_URL}/api/v1/scheduler/auto-assign?target_date=${date}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
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
                </div>
            </div>

            {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Task Assignments for {date}</h2>
                        <p className="text-slate-500 text-sm mt-1">Assignments are generated seamlessly every day based on worker attendance and Takt Time pacing.</p>
                    </div>
                    <button 
                        onClick={handleAutoAssign}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {loading ? 'Processing...' : 'Re-Run Auto-Assign'}
                    </button>
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
                                        <th className="p-4 font-medium">Worker Name</th>
                                        <th className="p-4 font-medium">Project (Quote No)</th>
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
                                            <td className="p-4 text-slate-800 font-medium">
                                                {task.user?.full_name || `User #${task.user_id}`}
                                            </td>
                                            <td className="p-4 text-slate-800">
                                                {task.project?.quotation_no || `Proj #${task.project_id}`}
                                            </td>
                                            <td className="p-4">
                                                <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium">
                                                    {task.process_type}
                                                </span>
                                            </td>
                                            <td className="p-4 text-slate-700">{task.target_feet}</td>
                                            <td className="p-4">
                                                {task.is_overtime ? (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                                        {task.user?.base_productivity ? `${Math.round((task.target_feet / task.user.base_productivity) * 10) / 10} hrs` : 'Yes'}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                                                        No
                                                    </span>
                                                )}
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
