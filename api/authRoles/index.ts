import { AzureFunction, Context, HttpRequest } from "@azure/functions";

/**
 * Azure SWA rolesSource function
 * Checks if user is a member of the adminagents group and returns appropriate roles
 *
 * Required environment variables:
 * - ADMINAGENTS_GROUP_ID: The Azure AD group object ID for adminagents
 * - ADMINAGENTS_MEMBERS: Comma-separated list of user object IDs (fallback if group claims not available)
 */

interface RolesRequest {
  identityProvider: string;
  userId: string;
  userDetails: string;
  claims: Array<{ typ: string; val: string }>;
}

interface RolesResponse {
  roles: string[];
}

// Azure AD claim types for groups
const GROUP_CLAIM_TYPES = [
  "groups",
  "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
];

const authRoles: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const payload = req.body as RolesRequest;

  if (!payload || !payload.userId) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { roles: [] },
    };
    return;
  }

  const adminGroupId = process.env.ADMINAGENTS_GROUP_ID;
  const adminMembers = process.env.ADMINAGENTS_MEMBERS?.split(",").map(s => s.trim()) || [];

  context.log(`Checking roles for user: ${payload.userDetails} (${payload.userId})`);

  const roles: string[] = [];
  let isAdmin = false;

  // Method 1: Check group claims in token
  if (adminGroupId && payload.claims) {
    for (const claim of payload.claims) {
      if (GROUP_CLAIM_TYPES.includes(claim.typ)) {
        // Group claim value might be a single ID or JSON array
        try {
          const groups = claim.val.startsWith("[")
            ? JSON.parse(claim.val)
            : [claim.val];

          if (groups.includes(adminGroupId)) {
            isAdmin = true;
            context.log(`User ${payload.userDetails} is in adminagents group (via token claim)`);
            break;
          }
        } catch {
          if (claim.val === adminGroupId) {
            isAdmin = true;
            context.log(`User ${payload.userDetails} is in adminagents group (via token claim)`);
            break;
          }
        }
      }
    }
  }

  // Method 2: Check explicit member list (fallback)
  if (!isAdmin && adminMembers.length > 0) {
    if (adminMembers.includes(payload.userId)) {
      isAdmin = true;
      context.log(`User ${payload.userDetails} is in adminagents list (via ADMINAGENTS_MEMBERS)`);
    }
  }

  if (isAdmin) {
    roles.push("adminagents");
  } else {
    context.log(`User ${payload.userDetails} is NOT authorized for adminagents role`);
  }

  const response: RolesResponse = { roles };

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: response,
  };
};

export default authRoles;
