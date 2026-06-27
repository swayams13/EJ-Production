import re

def update_file(filepath):
    with open(filepath, "r") as f:
        content = f.read()

    if "target_date:" not in content:
        # For add project
        if "quotation_no: ''" in content:
            content = content.replace("quotation_no: '',", "quotation_no: '', target_date: '',")
        
    # We want to add a target_date input in the form
    # Look for the Project Name input
    # <div>
    #    <label className="block text-sm font-semibold text-slate-700 mb-1">Project Name (Optional)</label>
    #    <input
    
    pattern = r'(<div>\s*<label[^>]*>Project Name \(Optional\)</label>\s*<input[^>]*value=\{formData\.project_name\}[^>]*>\s*</div>)'
    
    new_field = """
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Delivery Deadline</label>
            <input 
              type="date"
              className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              value={formData.target_date || ''}
              onChange={(e) => setFormData({...formData, target_date: e.target.value})}
            />
          </div>"""
          
    content = re.sub(pattern, r'\1' + new_field, content)
    
    with open(filepath, "w") as f:
        f.write(content)

update_file("next-frontend/src/app/(main)/projects/add/page.tsx")
print("Updated add page.")
