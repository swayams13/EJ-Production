with open("next-frontend/src/app/(main)/dashboard/planning/page.tsx", "r") as f:
    content = f.read()

# Replace table headers
content = content.replace('<th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Priority</th>', 
'<th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Deadline</th>\n                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Priority</th>')

# Replace table body
content = content.replace('<td className="px-6 py-4 whitespace-nowrap text-slate-600">{p.customer_name || "Internal"}</td>',
'<td className="px-6 py-4 whitespace-nowrap text-slate-600">{p.customer_name || "Internal"}</td>\n                    <td className="px-6 py-4 whitespace-nowrap text-slate-800 font-medium">{p.target_date ? new Date(p.target_date).toLocaleDateString(\'en-GB\') : <span className="text-orange-500 text-xs">Unscheduled</span>}</td>')

# Replace colSpan
content = content.replace('colSpan={4}', 'colSpan={5}')

with open("next-frontend/src/app/(main)/dashboard/planning/page.tsx", "w") as f:
    f.write(content)

print("Updated table headers.")
