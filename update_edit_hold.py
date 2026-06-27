import re

filepath = "next-frontend/src/app/(main)/projects/edit/page.tsx"
with open(filepath, "r") as f:
    content = f.read()

# Add hold_type to the initial state mapping
content = content.replace("target_date: p.target_date ? p.target_date.split('T')[0] : '',", "target_date: p.target_date ? p.target_date.split('T')[0] : '', hold_type: p.hold_type || '',")

# Add the UI field conditionally if status == 'Hold'
pattern = r'(<div>\s*<label[^>]*>Status Note</label>\s*<textarea[^>]*value=\{editingProject\.status_note\}[^>]*>\s*</textarea>\s*</div>)'

new_field = """
            {editingProject.status === 'Hold' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Hold Type</label>
                <select 
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  value={editingProject.hold_type || ''}
                  onChange={(e) => setEditingProject({...editingProject, hold_type: e.target.value})}
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

content = re.sub(pattern, new_field + r'\1', content)

with open(filepath, "w") as f:
    f.write(content)

print("Updated edit page for holds.")
