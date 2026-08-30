# Problem Statement: Generic MCP Server for Gmail and Google Docs

## 1. Overview

Build a **generic Model Context Protocol (MCP) server** that exposes secure, reusable tools for AI agents to interact with Google Workspace.

The initial server must support two business capabilities:

1. **Gmail**
   - Create email drafts.
   - Send emails.
2. **Google Docs**
   - Append text content to an existing Google Document.

The MCP server must **not be tightly coupled to a single AI agent**. Any MCP-compatible AI agent or client should be able to discover and invoke the tools through standard MCP mechanisms.

The implementation should provide a clean abstraction over Google APIs so that AI agents interact with stable MCP tools rather than directly depending on Gmail or Google Docs API details.

---

## 2. Problem

AI agents can generate useful content, but they currently need application-specific integrations to take actions in Google Workspace.

For example:

- An AI agent may generate an email and need to send it through Gmail.
- An AI agent may generate a report, decision log, meeting summary, or notes and need to append that content to an existing Google Doc.

Building these integrations independently for every AI agent creates duplicated authentication, authorization, API handling, error handling, and security logic.

We need one reusable MCP server that provides these capabilities through a standardized agent-facing interface.

---

## 3. Goals

### Primary goals

- Expose Gmail and Google Docs capabilities through MCP.
- Make the MCP server usable by multiple independent AI agents.
- Abstract Google API implementation details from consuming agents.
- Use secure Google OAuth 2.0 authentication and least-privilege scopes.
- Provide deterministic, structured tool inputs and outputs.
- Provide actionable errors that AI agents can understand and recover from.
- Make the service easy to run locally and deploy as a production service.
- Keep the architecture extensible so additional Google Workspace capabilities can be added later.

### Secondary goals

- Support both human-driven and autonomous AI-agent workflows.
- Make operations observable through structured logs.
- Prevent accidental or ambiguous destructive actions.
- Make tool behavior idempotent where practical.

---

## 4. Non-Goals

The first version should **not** implement:

- Gmail inbox search/read operations.
- Gmail message deletion.
- Gmail label management.
- Gmail attachments.
- Google Drive file creation or deletion.
- Google Docs editing other than appending content.
- Google Sheets or Calendar functionality.
- Broad Google Workspace administration.
- Provider-agnostic email sending through SMTP or other email providers.

These can be considered future extensions.

---

## 5. Proposed Architecture

```text
+-------------------------+
|      AI Agent / LLM     |
|                         |
|  Any MCP-compatible     |
|  client/application     |
+------------+------------+
             |
             | MCP
             v
+-------------------------+
|       MCP Server        |
|                         |
|  Tool Discovery         |
|  Input Validation       |
|  Auth Context           |
|  Error Mapping          |
|  Audit/Logging          |
+------------+------------+
             |
       +-----+------+
       |            |
       v            v
+-------------+  +----------------+
| Gmail       |  | Google Docs    |
| Adapter     |  | Adapter        |
+------+------+  +-------+--------+
       |                 |
       v                 v
+-------------+  +----------------+
| Gmail API   |  | Docs API       |
+-------------+  +----------------+
```

The MCP layer should be independent of the consuming AI agent.

The Google integrations should be isolated behind provider adapters/services so the MCP tool implementations do not contain low-level Google API details.

---

## 6. MCP Tools

The server should expose the following tools.

### 6.1 `gmail_send_email`

Sends an email using the authenticated Gmail account.

#### Purpose

Allow an AI agent to send an email after generating the required content.

#### Input

```json
{
  "to": ["recipient@example.com"],
  "cc": ["optional@example.com"],
  "bcc": ["optional@example.com"],
  "subject": "Email subject",
  "body": "Email body",
  "is_html": false
}
```

#### Input requirements

- `to` is required and must contain at least one valid recipient.
- `cc` is optional.
- `bcc` is optional.
- `subject` is required.
- `body` is required and must not be empty.
- `is_html` defaults to `false`.
- The server must validate email addresses before calling Gmail.
- The server must not silently modify recipient addresses.

#### Output

Return a structured result similar to:

```json
{
  "success": true,
  "messageId": "gmail-message-id",
  "threadId": "gmail-thread-id"
}
```

#### Failure behavior

Return a structured MCP error with:

- Stable error code.
- Human-readable message.
- Whether the operation is retryable.
- Provider/API error details where safe.

Example:

```json
{
  "success": false,
  "error": {
    "code": "AUTHORIZATION_REQUIRED",
    "message": "The authenticated Google account does not have permission to send email.",
    "retryable": false
  }
}
```

---

### 6.2 `gmail_create_draft`

Creates a Gmail draft without sending it.

This is required because the AI-agent use case includes both **drafting** and **sending** email.

#### Input

```json
{
  "to": ["recipient@example.com"],
  "cc": ["optional@example.com"],
  "bcc": ["optional@example.com"],
  "subject": "Draft subject",
  "body": "Draft email body",
  "is_html": false
}
```

#### Output

```json
{
  "success": true,
  "draftId": "gmail-draft-id",
  "messageId": "gmail-message-id",
  "threadId": "gmail-thread-id"
}
```

#### Design rule

Creating a draft must never send the email.

The MCP tool description should explicitly state this to reduce the probability of an AI agent confusing draft and send operations.

---

### 6.3 `google_docs_append_content`

Appends content to an existing Google Doc.

#### Purpose

Allow an AI agent to add generated content to an existing document without requiring the agent to understand Google Docs API batch-update semantics.

#### Input

```json
{
  "documentId": "google-document-id",
  "content": "Content to append",
  "addNewline": true
}
```

#### Input requirements

- `documentId` is required.
- `content` is required and must not be empty.
- `addNewline` defaults to `true`.
- The server should append at the end of the document.
- The tool must not overwrite existing document content.

#### Output

```json
{
  "success": true,
  "documentId": "google-document-id",
  "appendedCharacters": 125
}
```

The exact output can be adjusted based on what can be reliably determined from the Google Docs API response.

---

## 7. Generic MCP Design Principles

The MCP server must be designed as a reusable integration service rather than an AI-agent-specific backend.

### 7.1 No agent-specific assumptions

Do not hard-code:

- AI agent names.
- Prompt formats.
- Agent-specific authentication.
- Agent-specific state.
- Agent-specific business logic.
- Agent-specific tool naming conventions.

The server should only expose generic capabilities.

### 7.2 Tool descriptions must be AI-friendly

Every MCP tool should have:

- A clear name.
- A concise description.
- Explicit input schema.
- Explicit required/optional fields.
- Side-effect description.
- Important safety constraints.

For operations with side effects, tool descriptions should clearly state that they perform external actions.

### 7.3 Stable contracts

The MCP tool contracts should not expose Google API-specific request structures.

For example, consumers should provide:

```json
{
  "documentId": "...",
  "content": "..."
}
```

rather than a raw Google Docs `batchUpdate` request.

This keeps the MCP contract stable even if the underlying Google implementation changes.

---

## 8. Authentication and Authorization

Use Google OAuth 2.0 for access to Gmail and Google Docs.

### Required principles

- Use least-privilege OAuth scopes.
- Never hard-code access tokens.
- Never expose refresh tokens through MCP responses.
- Store credentials securely.
- Tokens must be encrypted or stored through an approved secure credential mechanism in production.
- Handle token expiration and refresh automatically.
- Return an actionable authorization error when consent is required.
- Scope access to the authenticated Google identity.

The implementation should support a configurable OAuth client ID, client secret, redirect URI, and token storage mechanism through environment/configuration rather than source code.

### Suggested scopes

Use the narrowest Google scopes that satisfy the implemented operations.

The implementation should explicitly document the selected scopes and why each is required.

Avoid requesting unrelated Google Workspace permissions.

---

## 9. Identity Model

The MCP server should associate each request with a Google authorization context.

The implementation must make a clear distinction between:

1. **MCP client identity**
2. **Authenticated Google user identity**

The server must never assume that because an MCP client is trusted, it automatically has access to the user's Google account.

The Google authorization context must be established independently and securely.

For the initial implementation, a single-user/local development mode may be supported, but the architecture should not prevent a future multi-user deployment.

---

## 10. Security Requirements

Security is a first-class requirement because both Gmail send and Google Docs append are write operations.

### Required controls

- Validate all tool inputs.
- Reject malformed email addresses.
- Reject missing required fields.
- Apply reasonable maximum sizes to email and document content.
- Sanitize/validate HTML email content if HTML mode is supported.
- Never log OAuth access tokens or refresh tokens.
- Avoid logging full email bodies or document contents by default.
- Do not expose credentials in MCP responses.
- Use HTTPS/TLS for remote deployments.
- Protect OAuth callback endpoints.
- Validate OAuth state to prevent CSRF.
- Use secure token storage.
- Implement configurable rate limiting.
- Provide structured audit logs for write operations.

### Side-effect safety

The MCP server must clearly distinguish between:

- `gmail_create_draft` — creates a draft only.
- `gmail_send_email` — sends an email externally.
- `google_docs_append_content` — modifies an existing document.

The server should not automatically escalate one operation into another.

For example, `gmail_create_draft` must never send the message.

---

## 11. Validation

The server should validate requests before making calls to Google APIs.

### Email validation

Validate:

- At least one recipient exists.
- Recipient values are syntactically valid.
- Subject is present.
- Body is present.
- Optional CC/BCC values are valid.
- Reasonable size limits are enforced.

### Google Doc validation

Validate:

- `documentId` is present.
- `documentId` has an expected format/length.
- `content` is non-empty.
- Content size is within configured limits.

Google API authorization and document access errors must still be handled after local validation succeeds.

---

## 12. Error Handling

Use a consistent error model across all tools.

Recommended error categories:

```text
INVALID_INPUT
AUTHENTICATION_REQUIRED
AUTHORIZATION_DENIED
RESOURCE_NOT_FOUND
RATE_LIMITED
PROVIDER_ERROR
NETWORK_ERROR
TIMEOUT
CONFLICT
INTERNAL_ERROR
```

Each error should include:

```json
{
  "code": "RESOURCE_NOT_FOUND",
  "message": "The requested Google document was not found or is not accessible.",
  "retryable": false
}
```

Do not expose raw Google API errors directly when they contain implementation details or sensitive information.

### Retry behavior

Retry only transient failures such as:

- Network errors.
- Temporary provider availability errors.
- Rate limiting where the provider indicates retry is appropriate.

Do not blindly retry side-effecting operations because this could create duplicate emails or duplicate document content.

---

## 13. Idempotency and Duplicate Side Effects

Email sending and document appending are side-effecting operations.

The implementation should consider an idempotency mechanism.

### Email

Where feasible, accept an optional client-provided idempotency key:

```json
{
  "idempotencyKey": "agent-operation-123"
}
```

If the same operation is retried with the same key, the server should avoid sending duplicate emails.

### Google Docs

For append operations, duplicate content can occur if the client retries after a timeout.

The implementation should document this behavior clearly and, where feasible, support an idempotency key or operation tracking mechanism.

Idempotency does not need to be fully implemented in the first prototype, but the service boundaries should leave room for it.

---

## 14. Observability

Provide structured logging and metrics.

### Log

For each tool invocation, record:

- Request/operation ID.
- Tool name.
- Start/end time.
- Success/failure.
- Error category.
- Authenticated user identifier in a privacy-safe form.
- Provider operation status.

Do not log by default:

- OAuth tokens.
- Refresh tokens.
- Full email bodies.
- Full Google Doc content.
- Sensitive headers.

### Metrics

At minimum capture:

- Tool invocation count.
- Success/failure rate.
- Latency by tool.
- Google API error rate.
- Authentication failures.
- Rate-limit events.

---

## 15. Configuration

Configuration should be externalized.

Example environment configuration:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
GOOGLE_TOKEN_STORE
LOG_LEVEL
MAX_EMAIL_BODY_SIZE
MAX_DOCUMENT_APPEND_SIZE
REQUEST_TIMEOUT_MS
RATE_LIMIT_PER_MINUTE
```

Never commit secrets to source control.

Provide a `.env.example` file with placeholder values only.

---

## 16. Technology Expectations

The implementation language/framework can be chosen based on the project team's preference.

The selected stack must provide:

- Mature MCP server support.
- Google OAuth 2.0 support.
- Gmail API client support.
- Google Docs API client support.
- Strong input validation.
- Structured logging.
- Testability.

Keep the design modular:

```text
src/
  mcp/
    tools/
  services/
    gmail/
    google-docs/
  auth/
  validation/
  errors/
  config/
  logging/
  server/
tests/
```

The exact folder structure may be adjusted to match the selected framework.

---

## 17. Suggested Service Boundaries

### MCP Tool Layer

Responsible for:

- MCP tool registration.
- Tool descriptions.
- Input schemas.
- Calling application services.
- Translating application results to MCP responses.

### Gmail Service

Responsible for:

- Gmail API interaction.
- Message construction.
- Draft creation.
- Email sending.
- Gmail-specific error translation.

### Google Docs Service

Responsible for:

- Google Docs API interaction.
- Resolving document append position.
- Appending content.
- Docs-specific error translation.

### Auth Service

Responsible for:

- OAuth flow.
- Token acquisition.
- Token refresh.
- Secure token access.

### Validation Layer

Responsible for:

- Schema validation.
- Input constraints.
- Email address validation.
- Size limits.

---

## 18. MCP Tool Contract Summary

| Tool | Side Effect | Purpose |
|------|-------------|---------|
| `gmail_create_draft` | Yes - creates draft | Create a Gmail draft without sending |
| `gmail_send_email` | Yes - sends email | Send an email through Gmail |
| `google_docs_append_content` | Yes - modifies document | Append generated content to an existing Google Doc |

Future tools should follow the same naming convention:

```text
<provider>_<resource>_<action>
```

Examples:

```text
gmail_create_draft
gmail_send_email
google_docs_append_content
```

Avoid generic names such as `send`, `append`, or `execute`.

---

## 19. Example Agent Flows

### Flow A: Draft an email

```text
AI Agent
   |
   | gmail_create_draft
   v
MCP Server
   |
   | Google OAuth context
   v
Gmail API
   |
   v
Draft created
   |
   v
AI Agent receives draftId
```

### Flow B: Send an email

```text
AI Agent
   |
   | gmail_send_email
   v
MCP Server
   |
   v
Gmail API
   |
   v
Email sent
   |
   v
AI Agent receives messageId/threadId
```

### Flow C: Append content to a document

```text
AI Agent
   |
   | google_docs_append_content
   v
MCP Server
   |
   v
Google Docs API
   |
   v
Content appended
   |
   v
AI Agent receives success result
```

---

## 20. Acceptance Criteria

### MCP

- The server starts successfully as an MCP server.
- An MCP client can discover all supported tools.
- Each tool exposes a valid machine-readable input schema.
- Tool descriptions clearly identify their side effects.

### Gmail

- A valid request can create a Gmail draft.
- Creating a draft does not send the email.
- A valid request can send an email.
- Multiple recipients are supported.
- CC and BCC are supported.
- Invalid email addresses are rejected before calling Gmail.
- Authentication failures produce actionable errors.
- Authorization failures are handled safely.
- Provider failures do not expose secrets.
- Successful sends return a useful Gmail message identifier.

### Google Docs

- A valid request appends content to an existing Google Doc.
- Existing document content is preserved.
- Missing or invalid document IDs are rejected.
- Unauthorized document access is handled as an authorization error.
- Successful requests return a useful operation result.

### Security

- No secrets are committed to source control.
- OAuth tokens are never returned through MCP.
- Sensitive content is not written to normal application logs.
- OAuth state is validated.
- Production transport is protected by TLS.

### Reliability

- Transient provider errors are handled appropriately.
- Timeouts are bounded.
- Rate limiting is handled.
- Side-effecting operations are not blindly retried.

---

## 21. Testing Requirements

Implement unit and integration tests.

### Unit tests

Cover:

- Input validation.
- Email address validation.
- Message construction.
- MCP tool registration.
- Error mapping.
- Configuration validation.
- Authentication error handling.

### Integration tests

Cover, using test credentials or mocks where appropriate:

- Gmail draft creation.
- Gmail email sending.
- Google Docs append.
- OAuth token refresh.
- Provider error handling.

### MCP-level tests

Verify that a generic MCP client can:

1. Discover the tools.
2. Read their schemas.
3. Invoke each tool.
4. Receive structured success responses.
5. Receive structured errors.

---

## 22. Developer Experience

The repository should include:

```text
README.md
.env.example
```

The README must document:

- Prerequisites.
- Google Cloud project setup.
- Required Google APIs.
- OAuth consent/configuration.
- Required OAuth scopes.
- Local setup.
- How to start the MCP server.
- How to connect a generic MCP client.
- Example tool invocations.
- Production deployment considerations.

Provide example configuration and commands without including real credentials.

---

## 23. Extensibility

The architecture should make it straightforward to add future capabilities such as:

```text
gmail_search_messages
gmail_get_message
google_docs_create_document
google_docs_replace_content
google_drive_find_file
google_sheets_append_rows
google_calendar_create_event
```

Adding a new capability should not require changes to the existing Gmail or Google Docs tool contracts.

Provider-specific logic should remain behind dedicated service/adapter boundaries.

---

## 24. Recommended Implementation Order

1. Create project skeleton and MCP server bootstrap.
2. Implement configuration and secure secret handling.
3. Implement Google OAuth flow/token management.
4. Implement Gmail service.
5. Expose `gmail_create_draft`.
6. Expose `gmail_send_email`.
7. Implement Google Docs service.
8. Expose `google_docs_append_content`.
9. Add validation and standardized errors.
10. Add structured logging/metrics.
11. Add unit, integration, and MCP-level tests.
12. Add README and local setup instructions.
13. Validate with at least one independent MCP client to confirm the server is generic.

---

## 25. Definition of Done

The project is complete when:

- A developer can configure Google OAuth credentials and run the MCP server locally.
- A generic MCP client can discover the three tools.
- An authorized Google account can create a Gmail draft.
- An authorized Google account can send a Gmail email.
- An authorized Google account can append content to an existing Google Doc.
- Invalid requests fail before provider calls where possible.
- Provider/authentication errors are mapped to stable MCP-friendly errors.
- Sensitive information is protected from logs and responses.
- Tests cover the primary success and failure paths.
- Documentation is sufficient for another developer to configure and run the server without needing application-specific knowledge.

---

## 26. Key Architectural Decision

**Build the MCP server as a generic Google Workspace capability provider, not as an extension of a specific AI agent.**

The MCP interface is the stable contract.

The AI agent decides **when and why** to use a tool.

The MCP server decides **how** to safely and reliably execute the requested Google Workspace operation.

This separation allows multiple AI agents to reuse the same server while keeping authentication, authorization, provider APIs, validation, security, and operational concerns centralized.
