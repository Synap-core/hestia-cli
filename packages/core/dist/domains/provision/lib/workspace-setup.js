// @ts-nocheck
/**
 * Hestia Workspace Setup
 *
 * Creates a Hestia workspace using the standard Synap createFromDefinition API.
 * This follows the same pattern as synap-cli and relay-app workspace creation.
 */
import { HESTIA_DEFINITION } from '../../../domains/shared/lib/hestia-definition.js';
import { logger } from '../../lib/utils/index';
/**
 * Create a Hestia workspace using the standard Synap createFromDefinition API.
 *
 * This uses the exact same pattern as synap-cli: calls workspaces.createFromDefinition
 * with the HESTIA_DEFINITION to create a complete workspace with profiles, views,
 * entity links, and bento layout.
 */
export async function createHestiaWorkspace(options) {
    const { podUrl, apiKey, workspaceName, description } = options;
    try {
        logger.info("Creating Hestia workspace via createFromDefinition...");
        // Prepare the definition with optional overrides
        const definition = {
            ...HESTIA_DEFINITION,
            workspaceName: workspaceName || HESTIA_DEFINITION.workspaceName,
            description: description || HESTIA_DEFINITION.description,
        };
        // Call the standard Synap workspaces.createFromDefinition endpoint
        const response = await fetch(`${podUrl}/trpc/workspaces.createFromDefinition`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                definition,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create workspace: ${response.status} ${errorText}`);
        }
        const result = await response.json();
        if (result.error) {
            throw new Error(result.error.message || "Workspace creation failed");
        }
        const workspaceId = result.result?.data?.workspaceId;
        if (!workspaceId) {
            throw new Error("No workspace ID returned from server");
        }
        logger.success(`Hestia workspace created: ${workspaceId}`);
        logger.info(`Profiles created: ${HESTIA_DEFINITION.profiles.length}`);
        logger.info(`Views created: ${HESTIA_DEFINITION.views.length}`);
        return {
            workspaceId,
            success: true,
        };
    }
    catch (error) {
        logger.error("Failed to create Hestia workspace:", error);
        return {
            workspaceId: "",
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * Check if a Hestia workspace already exists on the pod.
 * Looks for workspaces with the Hestia infrastructure profile.
 */
export async function findExistingHestiaWorkspace(podUrl, apiKey) {
    try {
        // List workspaces
        const response = await fetch(`${podUrl}/trpc/workspaces.list`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });
        if (!response.ok) {
            return null;
        }
        const result = await response.json();
        const workspaces = result.result?.data || [];
        // Look for workspace with Hestia in the name or description
        const hestiaWorkspace = workspaces.find((w) => w.name?.toLowerCase().includes("hestia") ||
            w.description?.toLowerCase().includes("infrastructure"));
        return hestiaWorkspace?.id || null;
    }
    catch {
        return null;
    }
}
/**
 * Get or create a Hestia workspace.
 * Returns existing workspace ID if found, otherwise creates new.
 */
export async function getOrCreateHestiaWorkspace(options) {
    const existingId = await findExistingHestiaWorkspace(options.podUrl, options.apiKey);
    if (existingId) {
        logger.info(`Found existing Hestia workspace: ${existingId}`);
        return {
            workspaceId: existingId,
            success: true,
        };
    }
    return createHestiaWorkspace(options);
}
//# sourceMappingURL=workspace-setup.js.map