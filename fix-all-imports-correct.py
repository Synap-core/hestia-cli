#!/usr/bin/env python3
import os
import re

def calculate_relative_path(from_path, to_module):
    """
    Calcule le chemin relatif correct d'un fichier à un module.
    from_path: chemin du fichier .ts
    to_module: module cible (ex: 'lib/utils/index')
    """
    # Obtenir le répertoire du fichier source
    dir_path = os.path.dirname(from_path)
    
    # Le module cible est relatif à src
    target_path = os.path.join('src', to_module)
    
    # Calculer le chemin relatif
    rel_path = os.path.relpath(target_path, dir_path)
    
    # Normaliser pour supprimer .js à la fin (TypeScript l'ajoute)
    if rel_path.startswith('../'):
        return rel_path
    else:
        return './' + rel_path

def fix_imports_in_file(filepath):
    """Fix imports in a TypeScript file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Obtenir le chemin depuis la racine core
    rel_to_core = os.path.relpath(filepath, '/Users/antoine/Documents/Code/synap/hestia-cli/packages/core')
    
    # Patterns à corriger
    patterns = [
        # Imports de lib/utils/index ou lib/types/index
        (r'''from ['"](\.\./)*lib/(utils|types)/index['"]''', 
         lambda m: f'''from '{calculate_relative_path(filepath, f'lib/{m.group(2)}/index')}\''''),
    ]
    
    for pattern, replacement in patterns:
        content = re.sub(pattern, replacement, content)
    
    # Écrire le fichier
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return True

def main():
    core_dir = "/Users/antoine/Documents/Code/synap/hestia-cli/packages/core"
    
    # Fichiers problématiques identifiés
    problem_files = [
        'src/domains/ai/commands/ai-chat.ts',
        'src/domains/ai/lib/ai-chat-service.ts',
        'src/domains/ai/lib/openclaude-service.ts',
        'src/domains/ai/lib/openclaw-service.ts',
        'src/domains/services/commands/recovery.ts',
    ]
    
    for rel_path in problem_files:
        filepath = os.path.join(core_dir, rel_path)
        if os.path.exists(filepath):
            print(f"Fixing: {rel_path}")
            fix_imports_in_file(filepath)
    
    print("Fixed problematic imports!")

if __name__ == "__main__":
    main()