#!/usr/bin/env python3
import os
import re

def update_imports(filepath):
    """Update imports in a TypeScript file for new domain structure."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Mappings des anciens chemins vers les nouveaux
    replacements = {
        r"from ['\"].*/(usb-generator)\.js['\"]": r"from '../domains/usb/lib/\1.js'",
        r"from ['\"].*/(os-manager)\.js['\"]": r"from '../domains/install/lib/\1.js'",
        r"from ['\"].*/(hardware-monitor)\.js['\"]": r"from '../domains/install/lib/\1.js'",
        r"from ['\"].*/(package-service)\.js['\"]": r"from '../domains/registry/lib/\1.js'",
        r"from ['\"].*/(server-provisioner)\.js['\"]": r"from '../domains/provision/lib/\1.js'",
        r"from ['\"].*/(workspace-setup)\.js['\"]": r"from '../domains/provision/lib/\1.js'",
        r"from ['\"].*/(service-manager)\.js['\"]": r"from '../domains/services/lib/\1.js'",
        r"from ['\"].*/(optional-services)\.js['\"]": r"from '../domains/services/lib/\1.js'",
        r"from ['\"].*/(health-check)\.js['\"]": r"from '../domains/services/lib/\1.js'",
        r"from ['\"].*/(recovery)\.js['\"]": r"from '../domains/services/lib/\1.js'",
        r"from ['\"].*/(pangolin-service)\.js['\"]": r"from '../domains/services/lib/\1.js'",
        r"from ['\"].*/(whodb-service)\.js['\"]": r"from '../domains/services/lib/\1.js'",
        r"from ['\"].*/(state-manager)\.js['\"]": r"from '../domains/services/lib/\1.js'",
        r"from ['\"].*/(a2a-bridge)\.js['\"]": r"from '../domains/services/lib/\1.js'",
        r"from ['\"].*/(api-client)\.js['\"]": r"from '../domains/shared/lib/\1.js'",
        r"from ['\"].*/(validator)\.js['\"]": r"from '../domains/shared/lib/\1.js'",
        r"from ['\"].*/(test-suite)\.js['\"]": r"from '../domains/shared/lib/\1.js'",
        r"from ['\"].*/(hestia-definition)\.js['\"]": r"from '../domains/shared/lib/\1.js'",
        r"from ['\"].*/(task-list)\.js['\"]": r"from '../domains/shared/lib/\1.js'",
        r"from ['\"].*/(ai-chat-service)\.js['\"]": r"from '../domains/ai/lib/\1.js'",
        r"from ['\"].*/(openclaude-service)\.js['\"]": r"from '../domains/ai/lib/\1.js'",
        r"from ['\"].*/(openclaw-service)\.js['\"]": r"from '../domains/ai/lib/\1.js'",
    }
    
    for pattern, replacement in replacements.items():
        content = re.sub(pattern, replacement, content)
    
    # Écrire le fichier modifié
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return True

def main():
    core_dir = "/Users/antoine/Documents/Code/synap/hestia-cli/packages/core/src"
    
    # Parcourir tous les fichiers TypeScript
    for root, dirs, files in os.walk(core_dir):
        for file in files:
            if file.endswith('.ts'):
                filepath = os.path.join(root, file)
                try:
                    update_imports(filepath)
                    print(f"Updated imports in: {filepath}")
                except Exception as e:
                    print(f"Error processing {filepath}: {e}")

if __name__ == "__main__":
    main()