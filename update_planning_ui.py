import re

with open("next-frontend/src/app/(main)/dashboard/planning/page.tsx", "r") as f:
    content = f.read()

# We need to add state for weekly_forecast, monthly_forecast
# The state initialization line:
# const [metrics, setMetrics] = useState({ weekly_target: 0, current_load: 0, on_time_delivery: 100 });
state_replacement = """const [metrics, setMetrics] = useState({ 
    weekly_target: 0, 
    current_load: 0, 
    on_time_delivery: 100, 
    weekly_forecast: [], 
    monthly_forecast: [], 
    unscheduled_demand: 0,
    factory_weekly_capacity: 0 
  });"""
content = content.replace("const [metrics, setMetrics] = useState({ weekly_target: 0, current_load: 0, on_time_delivery: 100 });", state_replacement)

# Now we want to insert the Forecasting section right after the Capacity Overview div.
forecast_ui = """
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-8">
        <h2 className="text-xl font-bold text-slate-800 mb-6">4-Week Capacity Forecast</h2>
        <div className="space-y-6">
          {metrics.weekly_forecast && metrics.weekly_forecast.map((week: any) => {
            const loadPct = week.capacity > 0 ? (week.demand / week.capacity) * 100 : 0;
            const isOverCapacity = loadPct > 100;
            return (
              <div key={week.id} className="relative">
                <div className="flex justify-between items-end mb-2">
                  <span className="font-bold text-slate-700">{week.name}</span>
                  <div className="text-sm font-medium">
                    <span className={isOverCapacity ? "text-red-600" : "text-slate-600"}>{week.demand} ft Demand</span>
                    <span className="text-slate-400 mx-2">/</span>
                    <span className="text-slate-500">{week.capacity} ft Capacity</span>
                  </div>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3">
                  <div 
                    className={`h-3 rounded-full ${isOverCapacity ? 'bg-red-500' : 'bg-emerald-500'}`} 
                    style={{ width: `${Math.min(loadPct, 100)}%` }}
                  ></div>
                </div>
                {isOverCapacity && (
                  <div className="mt-1 text-xs font-semibold text-red-500 text-right">
                    Over capacity by {Math.round(week.demand - week.capacity)} ft (Requires Overtime or Shift Extension)
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {metrics.unscheduled_demand > 0 && (
          <div className="mt-6 p-4 bg-orange-50 border border-orange-100 rounded-xl">
             <h3 className="text-sm font-bold text-orange-800 mb-1">Unscheduled Backlog</h3>
             <p className="text-sm text-orange-700">There is currently <strong>{metrics.unscheduled_demand} ft</strong> of required work from projects that do not have a Target Date set. Assign deadlines to them to factor them into the capacity forecast.</p>
          </div>
        )}
      </div>
"""

# Insert it before the Master Schedule section
# The string to search is: <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
# We'll split and re-join
parts = content.split('<div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">')
new_content = parts[0] + forecast_ui + '<div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">' + parts[1]

# Write back
with open("next-frontend/src/app/(main)/dashboard/planning/page.tsx", "w") as f:
    f.write(new_content)

print("Updated planning UI.")
