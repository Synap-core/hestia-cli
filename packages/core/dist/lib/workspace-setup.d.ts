/**
 * Hestia Workspace Setup
 *
 * Creates a Hestia workspace using the standard Synap createFromDefinition API.
 * This follows the same pattern as synap-cli and relay-app workspace creation.
 */
interface CreateWorkspaceOptions {
    podUrl: string;
    apiKey: string;
    workspaceName?: string;
    description?: string;
}
interface CreateWorkspaceResult {
    workspaceId: string;
    success: boolean;
    error?: string;
}
/**
 * Create a Hestia workspace using the standard Synap createFromDefinition API.
 *
 * This uses the exact same pattern as synap-cli: calls workspaces.createFromDefinition
 * with the HESTIA_DEFINITION to create a complete workspace with profiles, views,
 * entity links, and bento layout.
 */
export declare function createHestiaWorkspace(options: CreateWorkspaceOptions): Promise<CreateWorkspaceResult>;
/**
 * Check if a Hestia workspace already exists on the pod.
 * Looks for workspaces with the Hestia infrastructure profile.
 */
export declare function findExistingHestiaWorkspace(podUrl: string, apiKey: string): Promise<string | null>;
/**
 * Get or create a Hestia workspace.
 * Returns existing workspace ID if found, otherwise creates new.
 */
export declare function getOrCreateHestiaWorkspace(options: CreateWorkspaceOptions): Promise<CreateWorkspaceResult>;
export {};
//# sourceMappingURL=workspace-setup.d.ts.map