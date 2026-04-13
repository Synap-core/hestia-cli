#!/usr/bin/env python3
import os
import re

def fix_imports_in_file(filepath):
    """Fix all imports in a TypeScript file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Obtenir le chemin relatif depuis src
    rel_path = os.path.relpath(filepath, '/Users/antoine/Documents/Code/synap/hestia-cli/packages/core/src')
    
    # Déterminer le niveau de profondeur
    depth = rel_path.count('/')
    
    # Créer le préfixe de chemin retour
    if depth == 0:
        prefix = './'
    else:
        prefix = '../' * depth
    
    # Patterns de remplacement
    patterns = [
        # Imports de lib/utils et lib/types
        (r'''from ['\"](\.\./)*lib/(utils|types)/index['\"]''', 
         lambda m: f'''from '{prefix}lib/{m.group(2)}/index\''''),
        
        # Imports de fichiers dans d'autres domaines
        (r'''from ['\"](\.\./)*domains/([^/]+)/(lib|commands)/([^\.]+)\.js['\"]''',
         lambda m: f'''from '{prefix}domains/{m.group(2)}/{m.group(3)}/{m.group(4)}.js\''''),
        
        # Imports de fichiers dans le même domaine
        (r'''from ['\"]\.\./([^/]+)/(lib|commands)/([^\.]+)\.js['\"]''',
         lambda m: f'''from '../{m.group(2)}/{m.group(3)}.js\''''),
        
        # Imports de fichiers dans le même dossier
        (r'''from ['\"]\./([^\.]+)\.js['\"]''', r'''from './\1.js\''''),
        
        # @hestia/ai (à remplacer par le chemin local)
        (r'''from ['\"]@hestia/ai['\"]''', f'''from '{prefix}domains/ai/lib/openclaude-service.js\''''),
    ]
    
    for pattern, replacement in patterns:
        if callable(replacement):
            content = re.sub(pattern, replacement, content)
        else:
            content = re.sub(pattern, replacement, content)
    
    # Écrire le fichier
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return True

def main():
    core_dir = "/Users/antoine/Documents/Code/synap/hestia-cli/packages/core/src"
    
    # Parcourir tous les fichiers TypeScript
    files_to_fix = []
    for root, dirs, files in os.walk(core_dir):
        for file in files:
            if file.endswith('.ts'):
                filepath = os.path.join(root, file)
                files_to_fix.append(filepath)
    
    print(f"Found {len(files_to_fix)} TypeScript files")
    
    # Traiter les fichiers
    for i, filepath in enumerate(files_to_fix):
        try:
            fix_imports_in_file(filepath)
            if i % 10 == 0:
                print(f"Progress: {i}/{len(files_to_fix)}")
        except Exception as e:
            print(f"Error processing {filepath}: {e}")
    
    print("All imports fixed!")

if __name__ == "__main__":
    main()