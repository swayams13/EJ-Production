import os
import glob

# Find all tsx files in next-frontend/src/app/(main)/
files = glob.glob('next-frontend/src/app/(main)/**/*.tsx', recursive=True)

for file in files:
    with open(file, 'r') as f:
        content = f.read()

    # Skip if fetch is not used or if it's already importing apiFetch
    if 'fetch(' not in content:
        continue
        
    # Replace fetch( with apiFetch(
    new_content = content.replace('fetch(', 'apiFetch(')
    
    # Add import if not present
    if 'apiFetch' in new_content and 'import { apiFetch }' not in new_content:
        # insert after 'use client'; or at top
        if '"use client";' in new_content:
            new_content = new_content.replace('"use client";', '"use client";\nimport { apiFetch } from "@/lib/api";', 1)
        else:
            new_content = 'import { apiFetch } from "@/lib/api";\n' + new_content

    # The Next.js generic response requires `await res.json()`. Does apiFetch return the standard Response?
    # Yes, apiFetch returns `await fetch(url, config)`, which is a standard Response object.
    
    with open(file, 'w') as f:
        f.write(new_content)
        
print("Done fixing fetch calls.")
