#!/usr/bin/env python3
import os
import re
import sys

def fix_imports_in_file(filepath):
    """Fix imports in a single TypeScript file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        original_content = f.read()
    
    content = original_content
    
    # Replace @eve/types imports
    content = re.sub(
        r"from ['\"]@eve/types['\"]",
        "from '../lib/types/index'",
        content
    )
    
    # Replace @eve/utils imports
    content = re.sub(
        r"from ['\"]@eve/utils['\"]",
        "from '../lib/utils/index'",
        content
    )
    
    # Replace type imports
    content = re.sub(
        r"import type .* from ['\"]@eve/types['\"]",
        lambda m: m.group(0).replace("@eve/types", "../lib/types/index"),
        content
    )
    
    content = re.sub(
        r"import type .* from ['\"]@eve/utils['\"]",
        lambda m: m.group(0).replace("@eve/utils", "../lib/utils/index"),
        content
    )
    
    # Write back
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return content != original_content

def main():
    core_dir = "/Users/antoine/Documents/Code/synap/eve-cli/packages/core/src"
    
    for root, dirs, files in os.walk(core_dir):
        for file in files:
            if file.endswith('.ts'):
                filepath = os.path.join(root, file)
                try:
                    original_content = open(filepath, 'r', encoding='utf-8').read()
                    if '@eve/types' in original_content or '@eve/utils' in original_content:
                        fix_imports_in_file(filepath)
                        print(f"Fixed imports in: {filepath}")
                except Exception as e:
                    print(f"Error processing {filepath}: {e}")

if __name__ == "__main__":
    main()