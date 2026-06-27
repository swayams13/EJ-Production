with open("backend/app/projects/schemas.py", "r") as f:
    content = f.read()

# Add hold_type to ProjectUpdate
content = content.replace("status_note: Optional[str] = None", "status_note: Optional[str] = None\n    hold_type: Optional[str] = None")

with open("backend/app/projects/schemas.py", "w") as f:
    f.write(content)
