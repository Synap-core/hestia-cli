/**
 * OpenClaude Service - Placeholder
 * Service pour gérer l'intégration OpenClaude
 */

export const openclaudeService = {
  getStatus: () => ({ isRunning: false, pid: null, uptime: 0, errors: [] }),
  getProviderConfig: async () => null,
  listMCPServers: async () => [],
  configureProvider: async () => {},
  installMCPServer: async () => {},
  uninstallMCPServer: async () => {},
  toggleMCPServer: async () => {},
  start: async () => {},
  stop: async () => {},
};
