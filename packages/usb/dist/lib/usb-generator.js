// @ts-nocheck
/**
 * USB Generator for eve Installation
 *
 * Creates bootable USB keys for eve installation with:
 * - USB device management and safety checks
 * - Ubuntu Server ISO management
 * - Ventoy bootloader installation
 * - Autoinstall configuration generation
 * - Progress tracking and logging
 * - Dry-run mode for safety
 */
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { createInterface } from 'readline';
import { createLogger } from './logger.js';
import { spinner } from './spinner.js';
import { EventEmitter } from 'eventemitter3';
import YAML from 'yaml';
const execAsync = promisify(exec);
// ============== USB Generator Class ==============
export class USBGenerator extends EventEmitter {
    cacheDir;
    isoDir;
    ventoyDir;
    logger;
    isDryRun;
    activeOperations = new Map();
    progressInterval;
    startTime = 0;
    constructor(options = {}) {
        super();
        this.cacheDir = options.cacheDir || path.join(os.homedir(), '.eve', 'usb-cache');
        this.isoDir = path.join(this.cacheDir, 'isos');
        this.ventoyDir = path.join(this.cacheDir, 'ventoy');
        this.logger = createLogger('usb-gen');
        this.isDryRun = options.dryRun || false;
    }
    // ============== USB Device Management ==============
    async listUSBDevices() {
        this.logger.debug('Listing USB storage devices');
        try {
            // Get block devices with detailed info
            const { stdout } = await execAsync('lsblk -J -O');
            const data = JSON.parse(stdout);
            const devices = [];
            for (const blockdev of data.blockdevices || []) {
                if (this.isBlockDeviceUSB(blockdev)) {
                    const device = await this.parseBlockDevice(blockdev);
                    if (device) {
                        devices.push(device);
                    }
                }
            }
            this.logger.debug(`Found ${devices.length} USB storage devices`);
            return devices;
        }
        catch (error) {
            throw new USBError(`Failed to list USB devices: ${error.message}`, 'LIST_FAILED');
        }
    }
    isBlockDeviceUSB(blockdev) {
        // Check if it's a disk (not a partition)
        if (blockdev.type !== 'disk')
            return false;
        // Check hotplug attribute (USB devices usually have hotplug=1)
        if (blockdev.hotplug === '1')
            return true;
        // Check tran (transport) field
        if (blockdev.tran === 'usb')
            return true;
        // Check subsystem
        if (blockdev.subsystems?.includes('usb'))
            return true;
        // Check for removable flag
        if (blockdev.rm === '1' && blockdev.rota === '0') {
            // Removable non-rotational (likely USB flash)
            return true;
        }
        return false;
    }
    async parseBlockDevice(blockdev) {
        const devicePath = `/dev/${blockdev.name}`;
        // Get additional info from udev
        let vendor = blockdev.vendor || 'Unknown';
        let model = blockdev.model || 'Unknown';
        let serial = blockdev.serial;
        try {
            const { stdout: udevInfo } = await execAsync(`udevadm info --query=property --name=${blockdev.name} 2>/dev/null || echo ''`);
            const props = this.parseUdevProperties(udevInfo);
            vendor = props.ID_VENDOR || vendor;
            model = props.ID_MODEL || model;
            serial = props.ID_SERIAL || serial;
        }
        catch {
            // Ignore udev errors
        }
        // Parse partitions
        const partitions = [];
        if (blockdev.children) {
            for (const child of blockdev.children) {
                if (child.type === 'part') {
                    partitions.push({
                        name: child.name,
                        size: this.parseSize(child.size),
                        type: child.fstype,
                        mounted: child.mountpoints?.some((m) => m !== null) || false,
                        mountpoint: child.mountpoints?.find((m) => m !== null) || undefined,
                    });
                }
            }
        }
        // Check if mounted
        const mountpoints = blockdev.mountpoints?.filter((m) => m !== null) || [];
        const mounted = mountpoints.length > 0 || partitions.some((p) => p.mounted);
        return {
            device: blockdev.name,
            path: devicePath,
            size: this.parseSize(blockdev.size),
            model: model.trim(),
            vendor: vendor.trim(),
            serial: serial || undefined,
            removable: blockdev.rm === '1',
            readonly: blockdev.ro === '1',
            mounted,
            mountpoints: [...mountpoints, ...partitions.filter((p) => p.mounted).map((p) => p.mountpoint)],
            isUSB: true,
            partitions,
        };
    }
    parseUdevProperties(output) {
        const props = {};
        for (const line of output.split('\n')) {
            const [key, value] = line.split('=');
            if (key && value) {
                props[key] = value;
            }
        }
        return props;
    }
    parseSize(size) {
        if (!size)
            return 0;
        const match = size.match(/^([\d.]+)\s*(\w+)?$/);
        if (!match)
            return 0;
        const num = parseFloat(match[1]);
        const unit = (match[2] || 'B').toUpperCase();
        const multipliers = {
            B: 1,
            K: 1024,
            KB: 1024,
            M: 1024 ** 2,
            MB: 1024 ** 2,
            G: 1024 ** 3,
            GB: 1024 ** 3,
            T: 1024 ** 4,
            TB: 1024 ** 4,
        };
        return Math.round(num * (multipliers[unit] || 1));
    }
    async getDeviceInfo(device) {
        this.logger.debug(`Getting detailed info for device: ${device.device}`);
        try {
            // Get SMART info if available
            const smartInfo = await this.getSmartInfo(device.path);
            // Get filesystem info
            const fsInfo = await this.getFilesystemInfo(device);
            // Combine info
            return {
                ...device,
                ...smartInfo,
                ...fsInfo,
            };
        }
        catch (error) {
            this.logger.warn(`Failed to get detailed info: ${error.message}`);
            return device;
        }
    }
    async getSmartInfo(devicePath) {
        try {
            const { stdout } = await execAsync(`smartctl -i ${devicePath} 2>/dev/null || echo ''`, { timeout: 5000 });
            const info = {};
            // Parse SMART info if needed
            return info;
        }
        catch {
            return {};
        }
    }
    async getFilesystemInfo(device) {
        try {
            const { stdout } = await execAsync(`df -h ${device.path} 2>/dev/null | tail -1 || echo ''`);
            // Parse df output if needed
            return {};
        }
        catch {
            return {};
        }
    }
    isDeviceUSB(device) {
        return device.isUSB;
    }
    getDeviceSize(device) {
        return device.size;
    }
    async verifyDevice(device) {
        this.logger.info(`Verifying device: ${device.device}`);
        const warnings = [];
        // Check if device exists
        try {
            await fs.access(device.path);
        }
        catch {
            return {
                success: false,
                error: `Device ${device.device} does not exist`,
                duration: 0,
            };
        }
        // Check if it's a system disk
        if (await this.isSystemDisk(device)) {
            return {
                success: false,
                error: `Device ${device.device} appears to be a system disk. Operation blocked for safety.`,
                duration: 0,
            };
        }
        // Check if mounted
        if (device.mounted) {
            warnings.push('Device is currently mounted. Will attempt to unmount before operations.');
        }
        // Check size constraints
        const minSize = 4 * 1024 ** 3; // 4GB minimum
        if (device.size < minSize) {
            return {
                success: false,
                error: `Device ${device.device} is too small (${this.formatBytes(device.size)}). Minimum: 4GB`,
                duration: 0,
            };
        }
        // Check if readonly
        if (device.readonly) {
            return {
                success: false,
                error: `Device ${device.device} is read-only`,
                duration: 0,
            };
        }
        // Verify it's actually USB by checking the driver
        try {
            const { stdout } = await execAsync(`udevadm info --query=all --name=${device.device} | grep -i usb || echo ''`, { timeout: 3000 });
            if (!stdout.trim()) {
                warnings.push('Could not verify USB connection type');
            }
        }
        catch {
            warnings.push('Could not verify USB connection type');
        }
        this.logger.success(`Device ${device.device} verified`);
        return {
            success: true,
            data: device,
            warnings: warnings.length > 0 ? warnings : undefined,
            duration: Date.now() - this.startTime,
        };
    }
    // ============== ISO Management ==============
    async downloadUbuntu(version = '24.04') {
        const startTime = Date.now();
        this.logger.header(`Downloading Ubuntu Server ${version}`);
        const isoName = `ubuntu-${version}-live-server-amd64.iso`;
        const isoPath = path.join(this.isoDir, isoName);
        const url = `https://releases.ubuntu.com/${version}/${isoName}`;
        // Check if already downloaded and valid
        if (await this.isISOValid(isoPath)) {
            this.logger.success(`Using cached ISO: ${isoPath}`);
            return this.getISOInfo(isoPath);
        }
        await this.ensureDir(this.isoDir);
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would download: ${url}`);
            return {
                path: isoPath,
                name: isoName,
                size: 0,
                version,
                modifiedAt: new Date(),
                isValid: true,
            };
        }
        // Download with progress
        const spinnerId = `download-ubuntu-${version}`;
        spinner.start(spinnerId, `Downloading Ubuntu ${version}...`);
        try {
            // Get file size first
            const { stdout: sizeOutput } = await execAsync(`curl -sI "${url}" | grep -i content-length | awk '{print $2}' | tr -d '\\r'`);
            const totalSize = parseInt(sizeOutput.trim()) || 0;
            // Download with progress
            await this.downloadWithProgress(url, isoPath, totalSize, (progress) => {
                spinner.update(spinnerId, `Downloading Ubuntu ${version}... ${progress.percentage}%`);
                this.emit('progress', {
                    phase: 'download-iso',
                    current: progress.bytesTransferred,
                    total: totalSize,
                    percentage: progress.percentage,
                    message: `Downloading Ubuntu ${version}`,
                    eta: progress.eta,
                    speed: progress.speed,
                    bytesTransferred: progress.bytesTransferred,
                    totalBytes: totalSize,
                });
            });
            spinner.succeed(spinnerId, `Downloaded Ubuntu ${version}`);
            // Verify checksum
            await this.verifyISOChecksum(isoPath, version);
            return this.getISOInfo(isoPath);
        }
        catch (error) {
            spinner.fail(spinnerId, `Download failed: ${error.message}`);
            throw new USBError(`Failed to download Ubuntu: ${error.message}`, 'DOWNLOAD_FAILED');
        }
    }
    async downloadWithProgress(url, outputPath, totalSize, onProgress) {
        return new Promise((resolve, reject) => {
            let bytesReceived = 0;
            let lastUpdate = Date.now();
            let lastBytes = 0;
            const curl = spawn('curl', ['-fSL', '--progress-bar', '-o', outputPath, url], {
                stdio: ['ignore', 'ignore', 'pipe'],
            });
            curl.stderr?.on('data', (data) => {
                // curl progress bar output
                const line = data.toString();
                const match = line.match(/(\d+)\s+(\d+\.\d+\w?)\s+(\d+\.\d+\w?)\s+(\d+:\d+:\d+|\d+:\d+).*/);
                if (match && totalSize > 0) {
                    bytesReceived = parseInt(match[1]);
                    const percentage = Math.round((bytesReceived / totalSize) * 100);
                    const speed = match[3];
                    const etaStr = match[4];
                    const etaParts = etaStr.split(':').map(Number);
                    const eta = etaParts.length === 3
                        ? etaParts[0] * 3600 + etaParts[1] * 60 + etaParts[2]
                        : etaParts[0] * 60 + etaParts[1];
                    onProgress({
                        bytesTransferred: bytesReceived,
                        percentage,
                        eta,
                        speed,
                    });
                }
            });
            curl.on('close', (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error(`curl exited with code ${code}`));
                }
            });
            curl.on('error', reject);
        });
    }
    async verifyISO(isoPath) {
        this.logger.debug(`Verifying ISO: ${isoPath}`);
        // Check if file exists
        try {
            await fs.access(isoPath);
        }
        catch {
            return false;
        }
        // Verify it's a valid ISO file
        try {
            const { stdout } = await execAsync(`file "${isoPath}"`);
            if (!stdout.toLowerCase().includes('iso 9660')) {
                this.logger.warn(`File does not appear to be a valid ISO: ${stdout}`);
                return false;
            }
        }
        catch {
            return false;
        }
        // Check minimum size
        const stats = await fs.stat(isoPath);
        if (stats.size < 100 * 1024 * 1024) {
            // Less than 100MB
            this.logger.warn('ISO file is too small to be valid');
            return false;
        }
        return true;
    }
    async isISOValid(isoPath) {
        try {
            const stats = await fs.stat(isoPath);
            if (stats.size < 100 * 1024 * 1024)
                return false;
            const { stdout } = await execAsync(`file "${isoPath}"`);
            return stdout.toLowerCase().includes('iso 9660');
        }
        catch {
            return false;
        }
    }
    async verifyISOChecksum(isoPath, version) {
        this.logger.info('Verifying ISO checksum...');
        try {
            // Download SHA256SUMS
            const checksumsUrl = `https://releases.ubuntu.com/${version}/SHA256SUMS`;
            const { stdout: checksums } = await execAsync(`curl -sL "${checksumsUrl}"`);
            const isoName = path.basename(isoPath);
            const expectedLine = checksums.split('\n').find((line) => line.includes(isoName));
            if (!expectedLine) {
                this.logger.warn('Could not find expected checksum. Skipping verification.');
                return;
            }
            const expectedChecksum = expectedLine.split(' ')[0];
            // Calculate actual checksum
            const { stdout: actualChecksum } = await execAsync(`sha256sum "${isoPath}" | awk '{print $1}'`);
            if (actualChecksum.trim() !== expectedChecksum.trim()) {
                throw new USBError('ISO checksum verification failed', 'CHECKSUM_MISMATCH');
            }
            this.logger.success('ISO checksum verified');
        }
        catch (error) {
            if (error instanceof USBError)
                throw error;
            this.logger.warn(`Checksum verification skipped: ${error.message}`);
        }
    }
    async listAvailableISOs() {
        this.logger.debug('Listing available ISOs');
        try {
            await this.ensureDir(this.isoDir);
            const files = await fs.readdir(this.isoDir);
            const isos = [];
            for (const file of files) {
                if (file.endsWith('.iso')) {
                    const info = await this.getISOInfo(path.join(this.isoDir, file));
                    if (info.isValid) {
                        isos.push(info);
                    }
                }
            }
            return isos.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
        }
        catch (error) {
            this.logger.error(`Failed to list ISOs: ${error.message}`);
            return [];
        }
    }
    async getISOInfo(isoPath) {
        const stats = await fs.stat(isoPath);
        const name = path.basename(isoPath);
        // Extract version from filename
        const versionMatch = name.match(/ubuntu-(\d+(?:\.\d+)?)/);
        const version = versionMatch?.[1] || 'unknown';
        // Check if valid
        const isValid = await this.verifyISO(isoPath);
        return {
            path: isoPath,
            name,
            size: stats.size,
            version,
            modifiedAt: stats.mtime,
            isValid,
        };
    }
    // ============== Ventoy Management ==============
    async downloadVentoy(version = '1.0.96') {
        const startTime = Date.now();
        this.logger.header(`Downloading Ventoy ${version}`);
        const platform = os.platform();
        const arch = os.arch();
        const ventoyName = `ventoy-${version}-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}-${arch === 'arm64' ? 'aarch64' : arch === 'ia32' ? 'i386' : 'tar.gz'}`;
        const ventoyPath = path.join(this.ventoyDir, version);
        const ventoyBin = path.join(ventoyPath, platform === 'win32' ? 'Ventoy2Disk.exe' : 'Ventoy2Disk.sh');
        // Check if already downloaded
        try {
            await fs.access(ventoyBin);
            this.logger.success(`Using cached Ventoy ${version}`);
            return ventoyPath;
        }
        catch {
            // Not cached, download
        }
        await this.ensureDir(ventoyPath);
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would download Ventoy ${version}`);
            return ventoyPath;
        }
        const spinnerId = `download-ventoy-${version}`;
        spinner.start(spinnerId, `Downloading Ventoy ${version}...`);
        try {
            const url = `https://github.com/ventoy/Ventoy/releases/download/v${version}/ventoy-${version}-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}.tar.gz`;
            const downloadPath = path.join(this.ventoyDir, `ventoy-${version}.tar.gz`);
            await execAsync(`curl -fsSL -o "${downloadPath}" "${url}"`);
            await execAsync(`tar -xzf "${downloadPath}" -C "${ventoyPath}" --strip-components=1`);
            await fs.unlink(downloadPath);
            // Make executable
            if (platform !== 'win32') {
                await execAsync(`chmod +x "${ventoyPath}"/*.sh`);
                await execAsync(`chmod +x "${ventoyPath}"/tool/*`);
            }
            spinner.succeed(spinnerId, `Downloaded Ventoy ${version}`);
            // Verify
            await this.verifyVentoy(ventoyPath);
            return ventoyPath;
        }
        catch (error) {
            spinner.fail(spinnerId, `Download failed: ${error.message}`);
            throw new USBError(`Failed to download Ventoy: ${error.message}`, 'VENTOY_DOWNLOAD_FAILED');
        }
    }
    async verifyVentoy(ventoyPath) {
        this.logger.debug(`Verifying Ventoy installation: ${ventoyPath}`);
        try {
            const platform = os.platform();
            const ventoyBin = path.join(ventoyPath, platform === 'win32' ? 'Ventoy2Disk.exe' : 'Ventoy2Disk.sh');
            await fs.access(ventoyBin);
            // Check version
            const { stdout } = await execAsync(`"${ventoyBin}" -v 2>&1 || echo ''`);
            this.logger.debug(`Ventoy version: ${stdout.trim()}`);
            return true;
        }
        catch {
            return false;
        }
    }
    async installVentoy(device, ventoyPath) {
        const startTime = Date.now();
        this.logger.header(`Installing Ventoy to ${device.device}`);
        if (!ventoyPath) {
            ventoyPath = await this.downloadVentoy();
        }
        // Safety checks
        const verification = await this.verifyDevice(device);
        if (!verification.success) {
            return { ...verification, duration: Date.now() - startTime };
        }
        // Confirm destruction
        if (!verification.data?.unattended && !(await this.confirmDestruction(device))) {
            return {
                success: false,
                error: 'User cancelled operation',
                duration: Date.now() - startTime,
            };
        }
        // Backup if requested
        if (verification.data?.backupFirst) {
            await this.backupUSBData(device);
        }
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would install Ventoy to ${device.device}`);
            return { success: true, duration: Date.now() - startTime };
        }
        // Unmount if mounted
        if (device.mounted) {
            await this.unmountDevice(device);
        }
        const spinnerId = `install-ventoy-${device.device}`;
        spinner.start(spinnerId, `Installing Ventoy to ${device.device}...`);
        try {
            const platform = os.platform();
            const ventoyBin = path.join(ventoyPath, platform === 'win32' ? 'Ventoy2Disk.exe' : 'Ventoy2Disk.sh');
            // Install Ventoy
            const installCmd = platform === 'win32'
                ? `"${ventoyBin}" -i ${device.path}`
                : `sudo "${ventoyBin}" -i -I -s -r 0 ${device.path}`;
            const { stdout, stderr } = await execAsync(installCmd, { timeout: 120000 });
            if (stderr && !stderr.includes('OK')) {
                throw new Error(stderr);
            }
            spinner.succeed(spinnerId, `Ventoy installed on ${device.device}`);
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            spinner.fail(spinnerId, `Installation failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    async updateVentoy(device, ventoyPath) {
        const startTime = Date.now();
        this.logger.header(`Updating Ventoy on ${device.device}`);
        if (!ventoyPath) {
            ventoyPath = await this.downloadVentoy();
        }
        // Check if Ventoy is installed
        if (!(await this.isVentoyInstalled(device))) {
            return {
                success: false,
                error: 'Ventoy is not installed on this device. Use installVentoy instead.',
                duration: Date.now() - startTime,
            };
        }
        // Unmount if mounted
        if (device.mounted) {
            await this.unmountDevice(device);
        }
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would update Ventoy on ${device.device}`);
            return { success: true, duration: Date.now() - startTime };
        }
        const spinnerId = `update-ventoy-${device.device}`;
        spinner.start(spinnerId, `Updating Ventoy on ${device.device}...`);
        try {
            const platform = os.platform();
            const ventoyBin = path.join(ventoyPath, platform === 'win32' ? 'Ventoy2Disk.exe' : 'Ventoy2Disk.sh');
            const updateCmd = platform === 'win32'
                ? `"${ventoyBin}" -u ${device.path}`
                : `sudo "${ventoyBin}" -u -s ${device.path}`;
            await execAsync(updateCmd, { timeout: 120000 });
            spinner.succeed(spinnerId, `Ventoy updated on ${device.device}`);
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            spinner.fail(spinnerId, `Update failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    async isVentoyInstalled(device) {
        try {
            // Check for Ventoy partition label
            const { stdout } = await execAsync(`lsblk -o LABEL -n ${device.path}1 2>/dev/null | grep -i ventoy || echo ''`);
            return stdout.toLowerCase().includes('ventoy');
        }
        catch {
            return false;
        }
    }
    // ============== Configuration Generation ==============
    generateVentoyConfig(options = {}) {
        this.logger.debug('Generating Ventoy configuration');
        const config = {
            control: [
                {
                    VTOY_DEFAULT_MENU_MODE: 1,
                    VTOY_FILT_DOT_UNDERSCORE_FILE: 1,
                    VTOY_DEFAULT_SEARCH_ROOT: '/ISO',
                    VTOY_MENU_TIMEOUT: 10,
                },
            ],
        };
        // Add theme configuration
        config.theme = {
            file: '/ventoy/themes/eve/theme.txt',
            resolution: '1920x1080',
            default_mode: 'both',
        };
        // Add menu aliases for eve ISOs
        config.menu_alias = [
            {
                key: 'eve-safe',
                alias: 'eve Install (Safe - Preserve Data)',
            },
            {
                key: 'eve-wipe',
                alias: 'eve Install (Wipe Disk)',
            },
        ];
        // Add auto-install configuration
        if (options.mode) {
            const templates = [];
            if (options.mode === 'safe' || options.mode === 'both') {
                templates.push('/ventoy/eve/safe.yaml');
            }
            if (options.mode === 'wipe' || options.mode === 'both') {
                templates.push('/ventoy/eve/wipe.yaml');
            }
            config.auto_install = [
                {
                    image: '/ISO/eve-*.iso',
                    template: templates,
                },
            ];
        }
        return config;
    }
    generateAutoinstallSafe(options) {
        this.logger.debug('Generating safe autoinstall configuration');
        const config = {
            version: 1,
            interactive: false,
            early_commands: {
                '00-update-subiquity': 'snap refresh subiquity || true',
            },
            storage: {
                layout: {
                    name: 'direct',
                    match: {
                        ssd: true,
                    },
                    mode: 'preserve',
                },
                config: [
                    {
                        type: 'partition',
                        id: 'boot-partition',
                        device: options.diskConfig?.device || 'disk-volatile',
                        size: '1G',
                        wipe: 'superblock-recursive',
                        flag: 'boot',
                        number: 1,
                        preserve: false,
                        grub_device: true,
                    },
                    {
                        type: 'partition',
                        id: 'root-partition',
                        device: 'disk-volatile',
                        size: options.diskConfig?.rootSize || '100%',
                        wipe: 'superblock-recursive',
                        flag: '',
                        number: 2,
                        preserve: false,
                    },
                ],
            },
            identity: {
                hostname: options.hostname || 'eve',
                username: options.username || 'eve',
                password: options.password || this.generateTempPassword(),
                realname: 'eve Administrator',
                ssh_authorized_keys: options.sshKey ? [options.sshKey] : [],
            },
            locale: options.locale || 'en_US.UTF-8',
            keyboard: {
                layout: 'us',
            },
            network: this.generateNetworkConfig(options.networkConfig),
            proxy: options.networkConfig?.proxy?.http || '',
            apt: {
                preserve_sources_list: false,
                primary: [
                    {
                        arches: ['default'],
                        uri: 'http://archive.ubuntu.com/ubuntu',
                    },
                ],
                geoip: true,
            },
            packages: [
                'curl',
                'wget',
                'git',
                'vim',
                'htop',
                'docker.io',
                'docker-compose',
                'jq',
                'unzip',
                'ca-certificates',
                'gnupg',
                'lsb-release',
                ...(options.packages || []),
            ],
            user_data: this.generateCloudInitUserData(options),
            late_commands: {
                '00-eve-setup': 'curl -fsSL https://get.eve.io | bash',
                '01-eve-init': `eve init --unattended --hearth-name "${options.hearthName || 'My Digital Hearth'}" --install-type ${options.installType}`,
            },
            reporting: {
                type: 'eve',
                endpoint: options.podUrl || 'https://api.eve.io/v1/install/reports',
                token: options.apiKey,
            },
        };
        return config;
    }
    generateAutoinstallWipe(options) {
        this.logger.debug('Generating wipe autoinstall configuration');
        const config = this.generateAutoinstallSafe(options);
        // Modify for wipe mode
        config.storage.layout.mode = 'reformat_disk';
        config.storage.layout.wipe = 'superblock-recursive';
        // Add wipe confirmation in early commands
        config.early_commands = {
            ...config.early_commands,
            '01-wipe-warning': 'echo "WARNING: All data will be destroyed!"',
        };
        return config;
    }
    generateUserData(options) {
        return this.generateCloudInitUserData(options);
    }
    generateCloudInitUserData(options) {
        const userData = {
            package_update: true,
            package_upgrade: true,
            package_reboot_if_required: false,
            packages: ['curl', 'wget', 'git', 'vim', 'htop'],
            runcmd: [],
            write_files: [
                {
                    path: '/etc/eve/config.json',
                    content: JSON.stringify({
                        hearth: {
                            name: options.hearthName || 'My Digital Hearth',
                            type: options.installType,
                        },
                        intelligence: options.aiProvider
                            ? {
                                provider: options.aiProvider,
                                model: options.aiModel,
                                endpoint: options.aiEndpoint,
                            }
                            : undefined,
                        workspaceId: options.workspaceId,
                        podUrl: options.podUrl,
                    }, null, 2),
                    owner: 'root:root',
                    permissions: '0644',
                },
            ],
            users: [
                {
                    name: options.username || 'eve',
                    gecos: 'eve Administrator',
                    groups: ['sudo', 'docker'],
                    sudo: 'ALL=(ALL) NOPASSWD:ALL',
                    shell: '/bin/bash',
                    ssh_authorized_keys: options.sshKey ? [options.sshKey] : [],
                },
            ],
            ssh_pwauth: false,
            hostname: options.hostname || 'eve',
            timezone: options.timezone || 'UTC',
        };
        // Add post-install script if provided
        if (options.postInstallScript) {
            userData.write_files?.push({
                path: '/tmp/eve-post-install.sh',
                content: options.postInstallScript,
                owner: 'root:root',
                permissions: '0755',
            });
            userData.runcmd?.push('/tmp/eve-post-install.sh');
        }
        // Final message
        userData.final_message = 'eve installation complete! System will reboot in 5 seconds.';
        // Power state
        userData.power_state = {
            delay: '+5',
            mode: 'reboot',
            message: 'Rebooting for final configuration...',
            timeout: 300,
            condition: 'test -f /var/run/eve-install-complete',
        };
        return userData;
    }
    generateMetaData(options) {
        return {
            instance_id: `eve-${Date.now()}`,
            local_hostname: options.hostname || 'eve',
            hostname: options.hostname || 'eve',
            platform: 'eve',
            cloud_name: 'eve',
        };
    }
    generateGrubConfig(options) {
        const timeout = options.unattended ? 5 : 30;
        const defaultEntry = options.mode === 'wipe' ? 'eve Install (Wipe)' : 'eve Install (Safe)';
        return `set timeout=${timeout}
set default="${defaultEntry}"

# eve Boot Configuration
insmod all_video
insmod gfxterm
insmod part_gpt
insmod ext2
insmod loopback
insmod iso9660

# Set graphics mode
set gfxmode=auto
set gfxpayload=keep
terminal_output gfxterm

# Load theme if available
if [ -s /boot/grub/themes/eve/theme.txt ]; then
    set theme=/boot/grub/themes/eve/theme.txt
fi

# eve Install (Safe - Preserve Data)
menuentry "eve Install (Safe - Preserve Data)" {
    set isofile="/ISO/eve-safe.iso"
    loopback loop $isofile
    linux (loop)/casper/vmlinuz iso-scan/filename=$isofile autoinstall ds=nocloud;s=/cdrom/eve/
    initrd (loop)/casper/initrd
}

# eve Install (Wipe Disk)
menuentry "eve Install (Wipe Disk)" {
    set isofile="/ISO/eve-wipe.iso"
    loopback loop $isofile
    linux (loop)/casper/vmlinuz iso-scan/filename=$isofile autoinstall ds=nocloud;s=/cdrom/eve/
    initrd (loop)/casper/initrd
}

# Try Ubuntu without installing
menuentry "Try Ubuntu Server without installing" {
    set isofile="/ISO/ubuntu-server.iso"
    loopback loop $isofile
    linux (loop)/casper/vmlinuz iso-scan/filename=$isofile ---
    initrd (loop)/casper/initrd
}
`;
    }
    generateNetworkConfig(networkConfig) {
        if (!networkConfig || networkConfig.type === 'dhcp') {
            return {
                version: 2,
                ethernets: {
                    'id0': {
                        dhcp4: true,
                        dhcp6: true,
                    },
                },
            };
        }
        // Static configuration
        const network = {
            version: 2,
            ethernets: {
                [networkConfig.interface || 'id0']: {
                    dhcp4: false,
                    dhcp6: false,
                    addresses: networkConfig.ip ? [networkConfig.ip] : undefined,
                    gateway4: networkConfig.gateway,
                    nameservers: networkConfig.dns
                        ? {
                            addresses: networkConfig.dns,
                        }
                        : undefined,
                },
            },
        };
        // WiFi configuration
        if (networkConfig.wifi) {
            network.wifis = {
                [networkConfig.interface || 'wlan0']: {
                    dhcp4: true,
                    access_points: {
                        [networkConfig.wifi.ssid]: {
                            password: networkConfig.wifi.password || '',
                            hidden: networkConfig.wifi.hidden || false,
                        },
                    },
                },
            };
        }
        return network;
    }
    // ============== USB Creation ==============
    async createUSB(options, onProgress) {
        this.startTime = Date.now();
        this.logger.header('eve USB CREATOR');
        // Validate options
        if (!options.device) {
            throw new USBError('Device is required', 'MISSING_DEVICE');
        }
        if (!options.iso) {
            throw new USBError('ISO is required', 'MISSING_ISO');
        }
        this.logger.section('Configuration');
        this.logger.info(`Device: ${options.device.device} (${this.formatBytes(options.device.size)})`);
        this.logger.info(`ISO: ${options.iso.name}`);
        this.logger.info(`Mode: ${options.mode}`);
        this.logger.info(`Hearth: ${options.hearthName || 'My Digital Hearth'}`);
        this.logger.info(`Install Type: ${options.installType}`);
        if (options.dryRun) {
            this.logger.info('\n[DRY RUN] - No changes will be made');
        }
        // Verify device
        this.logger.section('Device Verification');
        const deviceCheck = await this.verifyDevice(options.device);
        if (!deviceCheck.success) {
            return deviceCheck;
        }
        // Generate all configurations
        this.logger.section('Generating Configurations');
        const ventoyConfig = this.generateVentoyConfig(options);
        const safeConfig = options.mode !== 'wipe' ? this.generateAutoinstallSafe(options) : null;
        const wipeConfig = options.mode !== 'safe' ? this.generateAutoinstallWipe(options) : null;
        const userData = this.generateUserData(options);
        const metaData = this.generateMetaData(options);
        const grubConfig = this.generateGrubConfig(options);
        this.logger.success('Configurations generated');
        // Create temporary config directory
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eve-usb-'));
        const configsDir = path.join(tempDir, 'configs');
        await this.ensureDir(configsDir);
        try {
            // Write configuration files
            await this.writeConfigFiles(configsDir, {
                ventoy: ventoyConfig,
                safe: safeConfig,
                wipe: wipeConfig,
                userData,
                metaData,
                grub: grubConfig,
            });
            // Install Ventoy
            this.logger.section('Installing Ventoy');
            const ventoyPath = await this.downloadVentoy(options.ventoyVersion);
            if (!options.dryRun) {
                const ventoyResult = await this.installVentoy(options.device, ventoyPath);
                if (!ventoyResult.success) {
                    return ventoyResult;
                }
            }
            // Copy ISO
            this.logger.section('Copying ISO');
            if (!options.dryRun) {
                await this.copyISO(options.device, options.iso.path, onProgress);
            }
            else {
                this.logger.info(`[DRY RUN] Would copy ISO to ${options.device.device}`);
            }
            // Copy configurations
            this.logger.section('Copying Configurations');
            if (!options.dryRun) {
                await this.copyConfigs(options.device, configsDir, onProgress);
            }
            else {
                this.logger.info(`[DRY RUN] Would copy configurations to ${options.device.device}`);
            }
            // Copy installer files
            this.logger.section('Copying Installer Files');
            if (!options.dryRun) {
                await this.copyInstaller(options.device, onProgress);
            }
            else {
                this.logger.info(`[DRY RUN] Would copy installer to ${options.device.device}`);
            }
            // Create bootloader
            this.logger.section('Creating Bootloader');
            if (!options.dryRun) {
                await this.createBootloader(options.device, configsDir);
            }
            // Final verification
            this.logger.section('Verification');
            if (!options.dryRun) {
                const verifyResult = await this.verifyUSB(options.device);
                if (!verifyResult.success) {
                    this.logger.warn('USB verification had issues, but bootable media was created');
                }
            }
            const duration = Date.now() - this.startTime;
            this.logger.newline();
            this.logger.success('USB creation complete!');
            this.logger.info(`Duration: ${this.formatDuration(duration)}`);
            this.logger.newline();
            this.logger.section('Next Steps');
            this.logger.info('1. Eject the USB drive safely');
            this.logger.info('2. Insert into target machine');
            this.logger.info('3. Boot from USB (may need to change BIOS/UEFI settings)');
            this.logger.info('4. Select eve installation option');
            return {
                success: true,
                duration,
            };
        }
        finally {
            // Cleanup
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        }
    }
    async writeConfigFiles(dir, configs) {
        // Write Ventoy config
        await fs.writeFile(path.join(dir, 'ventoy.json'), JSON.stringify(configs.ventoy, null, 2));
        // Write autoinstall configs
        if (configs.safe) {
            await fs.writeFile(path.join(dir, 'safe.yaml'), YAML.stringify(configs.safe));
        }
        if (configs.wipe) {
            await fs.writeFile(path.join(dir, 'wipe.yaml'), YAML.stringify(configs.wipe));
        }
        // Write cloud-init configs
        await fs.writeFile(path.join(dir, 'user-data'), YAML.stringify(configs.userData));
        await fs.writeFile(path.join(dir, 'meta-data'), YAML.stringify(configs.metaData));
        // Write GRUB config
        await fs.writeFile(path.join(dir, 'grub.cfg'), configs.grub);
        this.logger.success(`Configuration files written to ${dir}`);
    }
    async formatDevice(device, onProgress) {
        const startTime = Date.now();
        this.logger.header(`Formatting ${device.device}`);
        // Safety check
        if (await this.isSystemDisk(device)) {
            return {
                success: false,
                error: 'Cannot format system disk',
                duration: Date.now() - startTime,
            };
        }
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would format ${device.device}`);
            return { success: true, duration: Date.now() - startTime };
        }
        // Unmount
        if (device.mounted) {
            await this.unmountDevice(device);
        }
        const spinnerId = `format-${device.device}`;
        spinner.start(spinnerId, `Formatting ${device.device}...`);
        try {
            // Create new partition table
            await execAsync(`sudo parted -s ${device.path} mklabel gpt`);
            // Create FAT32 partition (for Ventoy compatibility)
            await execAsync(`sudo parted -s ${device.path} mkpart primary fat32 1MiB 100%`);
            // Format as FAT32
            await execAsync(`sudo mkfs.vfat -F 32 ${device.path}1`);
            spinner.succeed(spinnerId, `Formatted ${device.device}`);
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            spinner.fail(spinnerId, `Format failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    async copyISO(device, isoPath, onProgress) {
        const startTime = Date.now();
        const isoSize = (await fs.stat(isoPath)).size;
        this.logger.info(`Copying ISO (${this.formatBytes(isoSize)}) to USB...`);
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would copy ${isoPath} to ${device.device}`);
            return { success: true, duration: Date.now() - startTime };
        }
        // Mount the Ventoy partition
        const mountPoint = await this.mountDevice(device);
        try {
            // Ensure ISO directory exists
            const isoDir = path.join(mountPoint, 'ISO');
            await this.ensureDir(isoDir);
            // Copy with progress
            const destPath = path.join(isoDir, path.basename(isoPath));
            await this.copyFileWithProgress(isoPath, destPath, isoSize, onProgress);
            // Sync to ensure write is complete
            await execAsync('sync');
            this.logger.success('ISO copied successfully');
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        finally {
            await this.unmountDevice(device);
        }
    }
    async copyConfigs(device, configsDir, onProgress) {
        const startTime = Date.now();
        this.logger.info('Copying configuration files...');
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would copy configs from ${configsDir}`);
            return { success: true, duration: Date.now() - startTime };
        }
        // Mount the Ventoy partition
        const mountPoint = await this.mountDevice(device);
        try {
            // Copy to ventoy/eve directory
            const ventoyDir = path.join(mountPoint, 'ventoy', 'eve');
            await this.ensureDir(ventoyDir);
            // Copy all config files
            const files = await fs.readdir(configsDir);
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const src = path.join(configsDir, file);
                const dest = path.join(ventoyDir, file);
                await fs.copyFile(src, dest);
                onProgress?.({
                    phase: 'copy-configs',
                    current: i + 1,
                    total: files.length,
                    percentage: Math.round(((i + 1) / files.length) * 100),
                    message: `Copying ${file}`,
                });
            }
            // Sync
            await execAsync('sync');
            this.logger.success('Configuration files copied');
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        finally {
            await this.unmountDevice(device);
        }
    }
    async copyInstaller(device, onProgress) {
        const startTime = Date.now();
        this.logger.info('Copying eve installer files...');
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would copy installer to ${device.device}`);
            return { success: true, duration: Date.now() - startTime };
        }
        // Mount
        const mountPoint = await this.mountDevice(device);
        try {
            // Create eve directory structure
            const eveDir = path.join(mountPoint, 'eve');
            await this.ensureDir(eveDir);
            await this.ensureDir(path.join(eveDir, 'scripts'));
            await this.ensureDir(path.join(eveDir, 'assets'));
            // Write install script
            const installScript = this.generateInstallScript();
            await fs.writeFile(path.join(eveDir, 'install.sh'), installScript);
            // Write preseed for compatibility
            const preseed = this.generatePreseed();
            await fs.writeFile(path.join(eveDir, 'preseed.cfg'), preseed);
            // Sync
            await execAsync('sync');
            this.logger.success('Installer files copied');
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        finally {
            await this.unmountDevice(device);
        }
    }
    async createBootloader(device, configsDir) {
        const startTime = Date.now();
        this.logger.info('Creating bootloader configuration...');
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would create bootloader on ${device.device}`);
            return { success: true, duration: Date.now() - startTime };
        }
        // Mount
        const mountPoint = await this.mountDevice(device);
        try {
            // Create boot directory
            const bootDir = path.join(mountPoint, 'boot', 'grub');
            await this.ensureDir(bootDir);
            // Copy GRUB config
            const grubSrc = path.join(configsDir, 'grub.cfg');
            const grubDest = path.join(bootDir, 'grub.cfg');
            await fs.copyFile(grubSrc, grubDest);
            // Create themes directory
            const themesDir = path.join(bootDir, 'themes', 'eve');
            await this.ensureDir(themesDir);
            // Create basic theme
            await this.createBasicTheme(themesDir);
            // Sync
            await execAsync('sync');
            this.logger.success('Bootloader configuration created');
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        finally {
            await this.unmountDevice(device);
        }
    }
    async createBasicTheme(themesDir) {
        const themeTxt = `title-text: "eve Installation"
title-color: "#ffffff"
title-font: "DejaVu Sans Regular 16"

declare bg_image = Variable {
    image = "background.png"
}
declare theme_color = "#3498db"
declare selected_item_color = "#2ecc71"
declare title_color = "#ecf0f1"
declare terminal_box = "terminal_box_*.png"

+ boot_menu {
    left = 30%
    width = 40%
    top = 30%
    height = 40%
    item_font = "DejaVu Sans Regular 14"
    item_color = "#ffffff"
    selected_item_color = "#3498db"
    icon_width = 32
    icon_height = 32
    item_icon_space = 20
    item_height = 40
    item_padding = 15
    menu_pixmap_style = "menu_*.png"
}

+ label {
    left = 0
    top = 90%
    width = 100%
    align = "center"
    color = "#95a5a6"
    font = "DejaVu Sans Regular 12"
    text = "Use ↑ and ↓ keys to select, Enter to boot"
}
`;
        await fs.writeFile(path.join(themesDir, 'theme.txt'), themeTxt);
    }
    generateInstallScript() {
        return `#!/bin/bash
#
# eve Installer Script
# Automatically called during Ubuntu installation
#

set -e

echo "=========================================="
echo "  eve Installation"
echo "=========================================="

# Detect installation environment
HEARTH_CONFIG="/etc/eve/config.json"
INSTALL_LOG="/var/log/eve-install.log"

# Create log directory
mkdir -p "$(dirname "$INSTALL_LOG")"
exec 1> >(tee -a "$INSTALL_LOG")
exec 2>&1

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log "Starting eve installation..."

# Install prerequisites
log "Installing prerequisites..."
apt-get update
apt-get install -y \\
    curl \\
    wget \\
    git \\
    jq \\
    docker.io \\
    docker-compose \\
    ca-certificates \\
    gnupg \\
    lsb-release

# Setup Docker
log "Configuring Docker..."
systemctl enable docker
systemctl start docker
usermod -aG docker eve || true

# Download and install eve CLI
log "Installing eve CLI..."
curl -fsSL https://get.eve.io | bash

# Initialize eve if config exists
if [ -f "$HEARTH_CONFIG" ]; then
    log "Initializing eve from configuration..."
    hearth_name=$(jq -r '.hearth.name // "My Digital Hearth"' "$HEARTH_CONFIG")
    install_type=$(jq -r '.hearth.type // "local"' "$HEARTH_CONFIG")
    
    eve init --unattended \\
        --hearth-name "$hearth_name" \\
        --install-type "$install_type" || true
fi

# Mark installation as complete
log "Installation complete!"
touch /var/run/eve-install-complete

# Final reboot handled by cloud-init
`;
    }
    generatePreseed() {
        return `# eve Preseed Configuration
# For compatibility with older installers

d-i debian-installer/locale string en_US
d-i debian-installer/language string en
d-i debian-installer/country string US
d-i keyboard-configuration/xkb-keymap select us

d-i netcfg/choose_interface select auto
d-i netcfg/get_hostname string eve
d-i netcfg/get_domain string local

d-i mirror/country string manual
d-i mirror/http/hostname string archive.ubuntu.com
d-i mirror/http/directory string /ubuntu
d-i mirror/http/proxy string

d-i passwd/user-fullname string eve Administrator
d-i passwd/username string eve
d-i passwd/user-password-crypted password [CRYPTED_PASSWORD]
d-i passwd/user-default-groups string audio cdrom video sudo docker
d-i user-setup/allow-password-weak boolean true
d-i user-setup/encrypt-home boolean false

d-i clock-setup/utc boolean true
d-i time/zone string UTC
d-i clock-setup/ntp boolean true

# Partitioning - will be overridden by autoinstall
d-i partman-auto/method string regular
d-i partman-lvm/device_remove_lvm boolean true
d-i partman-md/device_remove_md boolean true
d-i partman-auto/choose_recipe select atomic

d-i pkgsel/include string curl wget git vim htop docker.io docker-compose jq
d-i pkgsel/upgrade select safe-upgrade

d-i grub-installer/only_debian boolean true
d-i grub-installer/bootdev string default

d-i finish-install/reboot_in_progress note

# Run eve setup after installation
d-i preseed/late_command string \\
    mkdir -p /target/etc/eve; \\
    cp -r /cdrom/eve/* /target/etc/eve/ 2>/dev/null || true; \\
    in-target bash /etc/eve/install.sh || true
`;
    }
    // ============== Verification ==============
    async verifyUSB(device) {
        const startTime = Date.now();
        this.logger.header(`Verifying USB: ${device.device}`);
        const warnings = [];
        try {
            // Check if device still exists
            await fs.access(device.path);
            // Verify partition table
            const { stdout: partInfo } = await execAsync(`parted -s ${device.path} print 2>&1 || echo 'ERROR'`);
            if (partInfo.includes('ERROR')) {
                return {
                    success: false,
                    error: 'USB partition table appears corrupted',
                    duration: Date.now() - startTime,
                };
            }
            // Mount and check contents
            const mountPoint = await this.mountDevice(device);
            try {
                // Check for required files
                const requiredFiles = ['ISO', 'ventoy', 'boot'];
                for (const file of requiredFiles) {
                    const filePath = path.join(mountPoint, file);
                    try {
                        await fs.access(filePath);
                    }
                    catch {
                        warnings.push(`Missing directory: ${file}`);
                    }
                }
                // Check for ISO files
                const isoDir = path.join(mountPoint, 'ISO');
                try {
                    const isos = await fs.readdir(isoDir);
                    const isoFiles = isos.filter((f) => f.endsWith('.iso'));
                    if (isoFiles.length === 0) {
                        warnings.push('No ISO files found in ISO directory');
                    }
                    else {
                        this.logger.success(`Found ${isoFiles.length} ISO file(s)`);
                    }
                }
                catch {
                    warnings.push('Cannot access ISO directory');
                }
                // Check Ventoy installation
                const ventoyDir = path.join(mountPoint, 'ventoy');
                try {
                    await fs.access(ventoyDir);
                    this.logger.success('Ventoy directory exists');
                }
                catch {
                    warnings.push('Ventoy directory not found');
                }
            }
            finally {
                await this.unmountDevice(device);
            }
            // Test bootloader config
            const bootResult = await this.testBootConfig(device);
            if (!bootResult.success) {
                warnings.push('Bootloader configuration test failed');
            }
            if (warnings.length > 0) {
                this.logger.warn('Verification warnings:');
                warnings.forEach((w) => this.logger.warn(`  - ${w}`));
            }
            this.logger.success('USB verification complete');
            return {
                success: true,
                warnings: warnings.length > 0 ? warnings : undefined,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    async testBootConfig(device) {
        const startTime = Date.now();
        this.logger.debug('Testing bootloader configuration...');
        try {
            // Check if GRUB config exists
            const mountPoint = await this.mountDevice(device);
            try {
                const grubConfig = path.join(mountPoint, 'boot', 'grub', 'grub.cfg');
                await fs.access(grubConfig);
                // Validate GRUB syntax (basic check)
                const content = await fs.readFile(grubConfig, 'utf-8');
                if (!content.includes('menuentry')) {
                    return {
                        success: false,
                        error: 'GRUB config missing menu entries',
                        duration: Date.now() - startTime,
                    };
                }
                this.logger.success('Bootloader config is valid');
                return {
                    success: true,
                    duration: Date.now() - startTime,
                };
            }
            finally {
                await this.unmountDevice(device);
            }
        }
        catch (error) {
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    async getUSBCapacity(device) {
        const startTime = Date.now();
        try {
            const mountPoint = await this.mountDevice(device);
            try {
                const { stdout } = await execAsync(`df -B1 ${mountPoint} | tail -1`);
                const parts = stdout.trim().split(/\s+/);
                const total = parseInt(parts[1]);
                const used = parseInt(parts[2]);
                const free = parseInt(parts[3]);
                return {
                    success: true,
                    data: { total, used, free },
                    duration: Date.now() - startTime,
                };
            }
            finally {
                await this.unmountDevice(device);
            }
        }
        catch (error) {
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    async estimateInstallTime(device) {
        const startTime = Date.now();
        try {
            // Estimate based on device type and size
            const isUSB3 = await this.isUSB3(device);
            const speed = isUSB3 ? 100 * 1024 * 1024 : 20 * 1024 * 1024; // MB/s
            const isoSize = 2 * 1024 ** 3; // Assume 2GB ISO
            const configSize = 10 * 1024 ** 2; // Assume 10MB configs
            const totalSize = isoSize + configSize;
            const seconds = Math.ceil(totalSize / speed);
            const formatted = this.formatDuration(seconds * 1000);
            return {
                success: true,
                data: { seconds, formatted },
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    async isUSB3(device) {
        try {
            const { stdout } = await execAsync(`udevadm info --query=property --name=${device.device} | grep -i "usb.*3\\|5000" || echo ''`);
            return stdout.includes('5000') || stdout.toLowerCase().includes('usb3');
        }
        catch {
            return false;
        }
    }
    // ============== Safety Features ==============
    async confirmDestruction(device) {
        if (process.env.eve_FORCE_USB_WRITE === '1') {
            return true;
        }
        this.logger.newline();
        this.logger.warn('⚠️  WARNING: All data on this device will be destroyed!');
        this.logger.info(`Device: ${device.device}`);
        this.logger.info(`Model: ${device.vendor} ${device.model}`);
        this.logger.info(`Size: ${this.formatBytes(device.size)}`);
        if (device.partitions.length > 0) {
            this.logger.info(`Partitions: ${device.partitions.length}`);
            device.partitions.forEach((p) => {
                this.logger.info(`  - ${p.name}: ${this.formatBytes(p.size)}`);
            });
        }
        this.logger.newline();
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        return new Promise((resolve) => {
            rl.question(`Type "DESTROY ${device.device}" to confirm: `, (answer) => {
                rl.close();
                resolve(answer === `DESTROY ${device.device}`);
            });
        });
    }
    async backupUSBData(device) {
        const startTime = Date.now();
        this.logger.info(`Backing up data from ${device.device}...`);
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would backup ${device.device}`);
            return { success: true, duration: Date.now() - startTime };
        }
        if (!device.mounted && device.partitions.length === 0) {
            this.logger.info('No data to backup');
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        const backupDir = path.join(os.homedir(), '.eve', 'backups', `usb-${device.device}-${Date.now()}`);
        await this.ensureDir(backupDir);
        try {
            const mountPoint = await this.mountDevice(device);
            try {
                // Copy all files
                await execAsync(`cp -r "${mountPoint}/." "${backupDir}/"`);
                this.logger.success(`Backed up to ${backupDir}`);
                return {
                    success: true,
                    data: backupDir,
                    duration: Date.now() - startTime,
                };
            }
            finally {
                await this.unmountDevice(device);
            }
        }
        catch (error) {
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    async isSystemDisk(device) {
        // Check if device contains root filesystem
        try {
            const { stdout: rootDev } = await execAsync('findmnt -n -o SOURCE / 2>/dev/null || echo ""');
            const rootDisk = rootDev.trim().replace(/\d+$/, ''); // Remove partition number
            if (device.path === rootDisk || device.path === rootDev.trim()) {
                return true;
            }
        }
        catch {
            // Ignore errors
        }
        // Check if device is mounted at critical locations
        const criticalMounts = ['/boot', '/home', '/var', '/etc', '/usr'];
        for (const mount of device.mountpoints) {
            if (criticalMounts.some((cm) => mount?.startsWith(cm))) {
                return true;
            }
        }
        // Check if device is in fstab
        try {
            const { stdout: fstab } = await execAsync(`grep ${device.device} /etc/fstab || echo ''`);
            if (fstab.trim()) {
                return true;
            }
        }
        catch {
            // Ignore errors
        }
        return false;
    }
    preventSystemDestruction() {
        // Set environment variable to prevent accidental writes
        process.env.eve_USB_SAFE_MODE = '1';
        // Register signal handlers
        const cleanup = () => {
            this.logger.info('Cleaning up...');
            this.cancelAllOperations();
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
    }
    // ============== Helper Methods ==============
    async ensureDir(dir) {
        await fs.mkdir(dir, { recursive: true });
    }
    async mountDevice(device) {
        const mountPoint = `/tmp/eve-mount-${device.device.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await this.ensureDir(mountPoint);
        // Find first partition or use device directly
        const partition = device.partitions[0]?.name || `${device.device}1`;
        const partitionPath = `/dev/${partition}`;
        try {
            await execAsync(`sudo mount ${partitionPath} ${mountPoint} 2>/dev/null || sudo mount ${device.path} ${mountPoint}`);
            return mountPoint;
        }
        catch (error) {
            // Try with different filesystem types
            const fsTypes = ['vfat', 'exfat', 'ntfs', 'ext4'];
            for (const fsType of fsTypes) {
                try {
                    await execAsync(`sudo mount -t ${fsType} ${partitionPath} ${mountPoint} 2>/dev/null || true`);
                    return mountPoint;
                }
                catch {
                    continue;
                }
            }
            throw new USBError(`Failed to mount device: ${error.message}`, 'MOUNT_FAILED');
        }
    }
    async unmountDevice(device) {
        try {
            // Unmount all partitions
            for (const partition of device.partitions) {
                if (partition.mounted && partition.mountpoint) {
                    await execAsync(`sudo umount "${partition.mountpoint}" 2>/dev/null || true`);
                }
            }
            // Unmount any eve temp mounts
            const { stdout } = await execAsync('mount | grep eve-mount | awk "{print \$3}" || echo ""');
            for (const mount of stdout.trim().split('\n').filter(Boolean)) {
                await execAsync(`sudo umount "${mount}" 2>/dev/null || true`);
            }
        }
        catch {
            // Ignore unmount errors
        }
    }
    async copyFileWithProgress(src, dest, totalSize, onProgress) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const readStream = require('fs').createReadStream(src);
            const writeStream = require('fs').createWriteStream(dest);
            let bytesTransferred = 0;
            let lastUpdate = Date.now();
            readStream.on('data', (chunk) => {
                bytesTransferred += chunk.length;
                // Throttle progress updates
                if (Date.now() - lastUpdate > 500) {
                    const percentage = Math.round((bytesTransferred / totalSize) * 100);
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = bytesTransferred / elapsed;
                    const remaining = totalSize - bytesTransferred;
                    const eta = Math.ceil(remaining / speed);
                    onProgress?.({
                        phase: 'copy-iso',
                        current: bytesTransferred,
                        total: totalSize,
                        percentage,
                        message: 'Copying ISO to USB',
                        eta,
                        speed: this.formatBytes(speed) + '/s',
                        bytesTransferred,
                        totalBytes: totalSize,
                    });
                    lastUpdate = Date.now();
                }
            });
            readStream.on('error', reject);
            writeStream.on('error', reject);
            writeStream.on('finish', resolve);
            readStream.pipe(writeStream);
        });
    }
    generateTempPassword() {
        return crypto.randomBytes(16).toString('base64').slice(0, 16);
    }
    formatBytes(bytes) {
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    }
    cancelAllOperations() {
        this.activeOperations.forEach((controller) => controller.abort());
        this.activeOperations.clear();
    }
    setDryRun(value) {
        this.isDryRun = value;
    }
    // ============== Utility Methods ==============
    /**
     * Find the best USB device for installation
     */
    async findBestDevice(minSize = 4 * 1024 ** 3) {
        const devices = await this.listUSBDevices();
        // Filter by size and prefer unmounted devices
        const candidates = devices
            .filter((d) => d.size >= minSize && !d.readonly)
            .sort((a, b) => {
            // Prefer unmounted devices
            if (a.mounted && !b.mounted)
                return 1;
            if (!a.mounted && b.mounted)
                return -1;
            // Prefer larger devices
            return b.size - a.size;
        });
        return candidates[0] || null;
    }
    /**
     * Check if a device is bootable
     */
    async isBootable(device) {
        try {
            // Check for boot sector signature
            const { stdout } = await execAsync(`sudo dd if=${device.path} bs=512 count=1 2>/dev/null | xxd | grep -E "55 aa|aa 55" || echo ''`);
            return stdout.includes('55 aa') || stdout.includes('aa 55');
        }
        catch {
            return false;
        }
    }
    /**
     * Get detailed partition information
     */
    async getPartitionInfo(device) {
        try {
            const { stdout } = await execAsync(`parted -s ${device.path} print 2>/dev/null | grep -E "^\\s*[0-9]" || echo ''`);
            const partitions = [];
            for (const line of stdout.trim().split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 4) {
                    partitions.push({
                        name: `${device.device}${parts[0]}`,
                        size: this.parseSize(parts[3]),
                        type: parts[4] || undefined,
                        mounted: false,
                    });
                }
            }
            return partitions;
        }
        catch {
            return device.partitions;
        }
    }
    /**
     * Wipe device securely
     */
    async wipeDevice(device, passes = 1) {
        const startTime = Date.now();
        this.logger.header(`Wiping ${device.device}`);
        if (await this.isSystemDisk(device)) {
            return {
                success: false,
                error: 'Cannot wipe system disk',
                duration: Date.now() - startTime,
            };
        }
        if (this.isDryRun) {
            this.logger.info(`[DRY RUN] Would wipe ${device.device} with ${passes} pass(es)`);
            return { success: true, duration: Date.now() - startTime };
        }
        // Unmount
        if (device.mounted) {
            await this.unmountDevice(device);
        }
        const spinnerId = `wipe-${device.device}`;
        spinner.start(spinnerId, `Wiping ${device.device}...`);
        try {
            for (let pass = 1; pass <= passes; pass++) {
                spinner.update(spinnerId, `Wiping pass ${pass}/${passes}...`);
                if (pass === 1) {
                    // First pass: zeros
                    await execAsync(`sudo dd if=/dev/zero of=${device.path} bs=1M status=progress 2>&1 || true`, {
                        timeout: 3600000, // 1 hour timeout
                    });
                }
                else {
                    // Random data for additional passes
                    await execAsync(`sudo dd if=/dev/urandom of=${device.path} bs=1M status=progress 2>&1 || true`, {
                        timeout: 3600000,
                    });
                }
            }
            // Final pass: zeros
            await execAsync(`sudo dd if=/dev/zero of=${device.path} bs=1M count=10 2>/dev/null || true`);
            spinner.succeed(spinnerId, `Wiped ${device.device}`);
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            spinner.fail(spinnerId, `Wipe failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
    /**
     * Eject device safely
     */
    async ejectDevice(device) {
        const startTime = Date.now();
        this.logger.info(`Ejecting ${device.device}...`);
        try {
            // Unmount
            await this.unmountDevice(device);
            // Eject
            await execAsync(`sudo eject ${device.path} 2>/dev/null || sudo umount -l ${device.path} 2>/dev/null || true`);
            this.logger.success(`Ejected ${device.device}`);
            return {
                success: true,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }
}
// ============== Error Classes ==============
export class USBError extends Error {
    code;
    recoverable;
    constructor(message, code, recoverable = false) {
        super(message);
        this.code = code;
        this.recoverable = recoverable;
        this.name = 'USBError';
    }
}
// ============== Exports ==============
export const usbGenerator = new USBGenerator();
export default USBGenerator;
//# sourceMappingURL=usb-generator.js.map