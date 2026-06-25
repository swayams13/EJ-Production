"use client";

export default function Inspection() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Quality Inspection</h1>
        <p className="text-slate-500">Record QC results and manage non-conformances.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Inspection Module</h2>
        <p className="text-slate-500 max-w-md mx-auto">
          The Quality Control and Inspection module is scheduled for development in a future phase.
        </p>
      </div>
    </div>
  );
}
