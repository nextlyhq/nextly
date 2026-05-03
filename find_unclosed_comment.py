with open('packages/admin/src/styles/globals.css', 'r') as f:
    content = f.read()

in_comment = False
start_pos = 0
i = 0
while i < len(content) - 1:
    if not in_comment:
        if content[i:i+2] == '/*':
            in_comment = True
            start_pos = i
            i += 2
            continue
    else:
        if content[i:i+2] == '*/':
            in_comment = False
            i += 2
            continue
    i += 1

if in_comment:
    # Find line number
    line_num = content[:start_pos].count('\n') + 1
    print(f"Unclosed comment starting at line {line_num}")
    print(content[start_pos:start_pos+200])
else:
    print("No unclosed comments found")
