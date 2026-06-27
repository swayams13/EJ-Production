import re

filepath = "next-frontend/src/app/(main)/dashboard/planning/page.tsx"

with open(filepath, "r") as f:
    content = f.read()

# p.priority === 'Critical' ? 'bg-red-100 text-red-700' :
# p.priority === 'High' ? 'bg-orange-100 text-orange-700' :
# 'bg-emerald-100 text-emerald-700'

pattern = r"p\.priority === 'Critical' \? 'bg-red-100 text-red-700' :\s*p\.priority === 'High' \? 'bg-orange-100 text-orange-700' :\s*'bg-emerald-100 text-emerald-700'"
replacement = "p.priority === 'P1' ? 'bg-red-100 text-red-700' : p.priority === 'P2' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'"

content = re.sub(pattern, replacement, content)

with open(filepath, "w") as f:
    f.write(content)

print("Updated table priority.")
