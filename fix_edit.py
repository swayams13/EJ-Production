import re

filepath = "next-frontend/src/app/(main)/projects/edit/page.tsx"

with open(filepath, "r") as f:
    content = f.read()

# Add holdType state
if "const [holdType, setHoldType] = useState<string>(\"\");" not in content:
    content = content.replace('const [statusNote, setStatusNote] = useState<string>("");', 'const [statusNote, setStatusNote] = useState<string>("");\n  const [holdType, setHoldType] = useState<string>("");')

# set holdType in handleProjectSelect
if "setHoldType(p.hold_type || \"\");" not in content:
    content = content.replace('setStatusNote(p.status_note || "");', 'setStatusNote(p.status_note || "");\n        setHoldType(p.hold_type || "");')

# Add hold_type to the payload in handleSave
if "hold_type: holdType" not in content:
    content = content.replace('hold_until_date: status === "Hold" && holdUntilDate ? holdUntilDate : null,', 'hold_until_date: status === "Hold" && holdUntilDate ? holdUntilDate : null,\n          hold_type: status === "Hold" ? holdType : null,')

# Add the UI for holdType
new_ui = """              {status === 'Hold' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Hold Type</label>
                  <select 
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    value={holdType}
                    onChange={(e) => setHoldType(e.target.value)}
                  >
                    <option value="">Select Hold Reason</option>
                    <option value="Client Hold">Client Hold</option>
                    <option value="Material Hold">Material Hold</option>
                    <option value="Engineering Hold">Engineering Hold</option>
                    <option value="Inspection Hold">Inspection Hold</option>
                    <option value="Financial Hold">Financial Hold</option>
                    <option value="Vendor Hold">Vendor Hold</option>
                    <option value="General Hold">General Hold</option>
                  </select>
                </div>
              )}
"""

# Insert it before the Status Note text area if it doesn't exist
if "Select Hold Reason" not in content:
    pattern = r'(\{\(status === "Hold" \|\| status === "Cancelled"\) && \(\s*<div>\s*<label)'
    content = re.sub(pattern, new_ui + r'\n              \1', content)

with open(filepath, "w") as f:
    f.write(content)

print("Fixed edit page.")
