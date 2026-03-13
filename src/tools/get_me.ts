import { createRequire } from "module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApi, toResult, toError } from "../telegram.js";

const require = createRequire(import.meta.url);
const { version: MCP_VERSION } = require("../../package.json") as { version: string };

const DESCRIPTION =
  "Returns basic information about the bot (id, username, name, capabilities) plus the running MCP server version.";

export function register(server: McpServer) {
  server.registerTool(
    "get_me",
    {
      description: DESCRIPTION,
    },
    async () => {
      try {
        const botInfo = await getApi().getMe();
        return toResult({ mcp_version: MCP_VERSION, ...botInfo });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
