"use client";

import { useEffect, useState } from "react";

export default function WipDashboard() {
  const [wipData, setWipData] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/dashboard/wip`)
      .then(res => res.json())
      .then(data => {
        setWipData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const departments = [
    { name: "Bellows Shop", color: "from-blue-500 to-cyan-500" },
    { name: "Fabrication Shop", color: "from-orange-500 to-amber-500" },
    { name: "Machining Shop", color: "from-purple-500 to-fuchsia-500" },
    { name: "Assembly Shop", color: "from-emerald-500 to-teal-500" },
    { name: "QC", color: "from-rose-500 to-pink-500" },
    { name: "Stores", color: "from-indigo-500 to-violet-500" },
    { name: "Dispatch", color: "from-slate-600 to-slate-500" }
  ];

  return (
    <div>
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-3xl font-extrabold text-white mb-2 tracking-tight">WIP Tracking Center</h1>
        <p className="text-slate-300 text-lg font-medium">Live work-in-progress inventory across all production departments.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {departments.map((dept) => {
            const data = wipData[dept.name] || { required: 0, completed: 0, pending: 0 };
            const progress = data.required > 0 ? (data.completed / data.required) * 100 : 0;

            return (
              <div key={dept.name} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow relative">
                <div className={`h-2 w-full bg-gradient-to-r ${dept.color}`}></div>
                <div className="p-6">
                  <h3 className="text-xl font-bold text-slate-800 mb-6">{dept.name}</h3>
                  
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="text-center p-3 bg-slate-50 rounded-xl">
                      <div className="text-2xl font-black text-slate-700">{data.required}</div>
                      <div className="text-xs font-bold text-slate-400 uppercase mt-1">Required</div>
                    </div>
                    <div className="text-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                      <div className="text-2xl font-black text-emerald-600">{data.completed}</div>
                      <div className="text-xs font-bold text-emerald-500 uppercase mt-1">Done</div>
                    </div>
                    <div className="text-center p-3 bg-rose-50 rounded-xl border border-rose-100">
                      <div className="text-2xl font-black text-rose-600">{data.pending}</div>
                      <div className="text-xs font-bold text-rose-500 uppercase mt-1">Pending</div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold mb-2">
                      <span className="text-slate-500 uppercase tracking-wider">Progress</span>
                      <span className="text-slate-700">{progress.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className={`h-2.5 rounded-full bg-gradient-to-r ${dept.color} transition-all duration-1000 ease-out`}
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
