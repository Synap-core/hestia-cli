# Hestia USB Bundle

## What is Hestia?

Hestia is sovereign AI infrastructure that gives you full control over your data and AI models.

## Bundle Contents

This USB bundle contains everything needed to run Hestia:

- **bin/hestia** - Main CLI tool
- **scripts/** - Installation and maintenance scripts
- **config/** - Configuration templates
- **docker/** - Docker compose files
- **docs/** - Documentation

## Quick Start

1. Insert USB drive
2. Copy contents to target machine: `cp -r /path/to/usb /opt/hestia`
3. Run installation: `sudo ./scripts/install.sh`
4. Initialize: `./bin/hestia init --name "My Hearth"`
5. Start: `./bin/hestia ignite`
6. Open browser: http://localhost:4000

## Advanced Usage

### USB Boot Mode
Use Ventoy (included) to make USB bootable with Ubuntu Server + auto-installation.

### Custom Configuration
Edit config files in `config/` directory before installation.

### Updating
Run `./bin/hestia update` to get latest versions.

## Support

- Documentation: https://synap.dev/docs
- Community: https://github.com/synap-dev/hestia
- Issues: https://github.com/synap-dev/hestia/issues

## License

Apache 2.0 - See LICENSE file
