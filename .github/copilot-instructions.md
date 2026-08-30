# MCP Server Development

- Use the official TypeScript MCP SDK: https://ts.sdk.modelcontextprotocol.io
- Follow the MCP tools specification: https://modelcontextprotocol.io/specification/latest/server/tools
- Stdio transports must write protocol messages only to stdout; application logs go to stderr.
- Never log or return OAuth tokens, client secrets, email bodies, or document content.