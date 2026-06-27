import re

filepath = "next-frontend/src/app/(main)/projects/edit/page.tsx"
with open(filepath, "r") as f:
    content = f.read()

# Add target_date to the initial state mapping
content = content.replace("status_note: p.status_note || '',", "status_note: p.status_note || '', target_date: p.target_date ? p.target_date.split('T')[0] : '',")

# Add the UI field
pattern = r'(<div>\s*<label[^>]*>Status Note</label>\s*<textarea[^>]*value=\{editingProject\.status_note\}[^>]*>\s*</textarea>\s*</div>)'

new_field = """
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Delivery Deadline</label>
              <input 
                type="date"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                value={editingProject.target_date || ''}
                onChange={(e) => setEditingProject({...editingProject, target_date: e.target.value})}
              />
            </div>"""
          
content = re.sub(pattern, r'\1' + new_field, content)

with open(filepath, "w") as f:
    f.write(content)

print("Updated edit page.")
