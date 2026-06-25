import os

base_dir = "/Users/sonusingh/AI DEVELOPMENT DESPL/Precise Engineers/EJ Production Tracker/next-frontend/src"
for root, _, files in os.walk(base_dir):
    for f in files:
        if f.endswith(".tsx") or f.endswith(".ts"):
            path = os.path.join(root, f)
            with open(path, "r") as file:
                content = file.read()
            
            if "http://localhost:8002/api/mes" in content:
                # Handle double quotes: "http://localhost:8002/api/mes/xyz" -> `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/xyz`
                import re
                content = re.sub(r'"http://localhost:8002/api/mes([^"]*)"', r'`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api\1`', content)
                content = re.sub(r'`http://localhost:8002/api/mes([^`]*)`', r'`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api\1`', content)
                
                with open(path, "w") as file:
                    file.write(content)
                print(f"Updated {path}")
