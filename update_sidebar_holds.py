with open("next-frontend/src/components/Sidebar.tsx", "r") as f:
    content = f.read()

# I will add the Holds link under Planning
new_link = """          <li>
            <Link href="/dashboard/holds" className={`flex items-center px-4 py-3 rounded-xl transition-all ${
              isActive('/dashboard/holds') 
                ? 'bg-blue-600/10 text-blue-600 font-bold' 
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 font-medium'
            }`}>
              <svg className="w-5 h-5 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isActive('/dashboard/holds') ? 2.5 : 2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Hold Center
            </Link>
          </li>"""

content = content.replace("          {/* Dashboard Items based on Role */}", "          {/* Dashboard Items based on Role */}\n" + new_link)

with open("next-frontend/src/components/Sidebar.tsx", "w") as f:
    f.write(content)

print("Updated Sidebar for Holds.")
