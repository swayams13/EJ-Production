"use client";

export default function Dispatch() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Dispatch & Logistics</h1>
        <p className="text-slate-500">Manage packing, invoicing, and outward shipping.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
        <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path>
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Dispatch Module</h2>
        <p className="text-slate-500 max-w-md mx-auto">
          The Logistics and Dispatch module is scheduled for development in a future phase.
        </p>
      </div>
    </div>
  );
}
