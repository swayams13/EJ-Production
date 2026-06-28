import pandas as pd
df = pd.read_excel("ANALYSIS DISMANTLING JOINT WELDING FEETS PER SIZE_27.06.2026.xlsx")
print(df.head(10).to_string())
print(df.columns)
