# Connection contract v1

Widgets and tools get data through connections. An extension does not fetch data
directly. It calls a **declared connection**, and the Helm server sends the request.

## Kinds

| Kind | Backed by | Operations |
| --- | --- | --- |
| `tdt-mcp` | The `tdt mcp serve` child process of the workspace (one for each workspace) | TDT tool names, for example `tdt_workspace_status`, `tdt_brain_search` |
| `mcp` | An MCP server that the user configures in Helm (a stdio command or an HTTP URL) | The tool names of that server. Write tools have a separate list |
| `http` | A service profile that the user configures in Helm (a base URL and a token, or OAuth2 sign-in) | Named calls that the manifest defines. Reads are GET, or POST with a declared body. Writes are confirmed |
| `files` | Declared paths in a registered project or in the workspace | `list`, `read`, and a confirmed `write` |
| `db` | A SQLite, Postgres or MySQL profile that the user configures in Helm | Named read-only queries that the manifest defines |

## Declare connections

```json
"connections": [
  { "id": "tdt", "kind": "tdt-mcp", "operations": ["tdt_workspace_status", "tdt_reminder_list"] },
  { "id": "gh", "kind": "http", "service": "github",
    "calls": {
      "issues": { "method": "GET", "path": "/repos/{owner}/{repo}/issues", "query": { "per_page": "{limit}", "state": "open" } }
    } }
]
```

- The `id` is local to the manifest. `operations` and `calls` are allowlists.
- The Helm server keeps credentials (tokens, passwords) in the OS keychain. If the
  keychain is not available, it uses `~/.helm/credentials.json` with 0600 permissions.
  The extension never gets the credentials. Helm never writes them to the workspace.

### HTTP

```json
{ "id": "linear", "kind": "http", "service": "linear",
  "calls": {
    "teams": { "method": "POST", "path": "/graphql",
               "body": { "query": "query($first: Int) { teams(first: $first) { nodes { id name } } }", "variables": { "first": "{limit}" } } }
  } }
```

- `service` is the name of a *service profile*. The user adds the profile in Helm
  (Settings → Connections → Services). A profile has these values:
  - A base URL. It must be https. Http is permitted only for `127.0.0.1` and `localhost`.
  - The header for the token. The default is `Authorization`.
  - The token format: `Bearer <token>`, or the token without a change.

  The extension never sees the URL or the token.
- `calls` contains 1–16 named calls. The call name is the operation:
  `helm.call('gh', 'issues', { owner: 'me', repo: 'app', limit: 20 })`.
- Helm fills the `{name}` placeholders in `path` and `query` values from the call
  arguments. A widget usually passes its settings.
  - Path values are required, and Helm URL-encodes them.
  - If the argument for a query parameter is missing or null, Helm does not send that
    parameter.
  - In `body`, a string that is exactly `"{name}"` becomes the value of that argument
    (any JSON scalar). Helm sends all other strings as written, so GraphQL braces are safe.
  - Arguments must be strings (up to 4096 characters), numbers, booleans or null.
- A read call is `GET`, or `POST` with a declared `body`. Use `POST` for read APIs such
  as GraphQL queries. The extension cannot send its own body. Plugin review shows the
  method, path, query and body of each call.
- A write call has `"write": true` and the method `POST`, `PUT`, `PATCH` or `DELETE`.
  It can have a `body` template, which Helm fills in the same way. The manifest must
  also declare `"permissions": { "write": true }`. The user confirms every call (see
  [Writes](#writes)). Helm's dialog shows the method, the full URL and the body exactly
  as Helm will send them.
  - A declined call returns `declined`.
  - A call without a valid confirmation returns `confirmation_required`.

  In both cases, Helm sends nothing.

```json
"permissions": { "write": true },
"connections": [{ "id": "gh", "kind": "http", "service": "github",
  "calls": {
    "close": { "method": "PATCH", "path": "/repos/{owner}/{repo}/issues/{number}", "body": { "state": "closed" }, "write": true }
  } }]
```

- The URL always stays under the base URL of the profile:
  - `path` starts with one `/`.
  - `path` has no `.` or `..` segments.
  - Helm does not follow redirects. It refuses them with `redirect`.
- Limits: 10 s for each call, JSON responses only (`not_json` if not), and 1 MiB or
  less (`too_large`).
- Other error codes:
  - `refused`: an undeclared call or incorrect arguments.
  - `not_configured`: no profile has that name.
  - `not_authorized`: an OAuth2 profile is not connected, or its sign-in expired.
  - `http_error`: a status that is not 2xx. If the error body is JSON, `data`
    contains it.
  - `timeout`, `unavailable`.

#### OAuth2

A connection can declare how its service signs in with OAuth2 (authorization code with
PKCE). To connect, do these steps:

1. Create your own OAuth client with the service.
2. In Helm, open Settings → Connections → Services and select the sign-in **OAuth2**.
3. Enter the client id and the client secret.
4. Click **Connect**.

Helm does the sign-in and keeps the tokens.

```json
{ "id": "cal", "kind": "http", "service": "calendar",
  "oauth2": {
    "authorizeUrl": "https://auth.example.com/authorize?access_type=offline",
    "tokenUrl": "https://auth.example.com/token",
    "scopes": ["calendar.read"]
  },
  "calls": { "events": { "method": "GET", "path": "/events" } } }
```

- `authorizeUrl` and `tokenUrl` must be https. Http is permitted only for `127.0.0.1`
  and `localhost`. The URLs must not contain credentials or a fragment.
- `authorizeUrl` can have query parameters that are specific to the provider.
  `tokenUrl` cannot have query parameters.
- `scopes` lists up to 32 scope tokens.
- Helm sets `response_type`, `client_id`, `redirect_uri`, `state`, `code_challenge`
  and `scope` itself.
- The redirect URI is `http://127.0.0.1:<port>/oauth/callback`. Settings shows it.
  Register this URI with the OAuth client.
- Connect asks for all of the scopes that the enabled extensions of the workspace
  declare for that service. These extensions must declare the same two URLs. Helm
  refuses a grant with scopes that no extension declared, and does not keep it.
- The client secret, the access token and the refresh token stay in the credential
  store (the keychain, or `~/.helm/credentials.json` with 0600). They never go to the
  browser, the extension, the workspace or a project.
- The Helm server refreshes the access token shortly before it expires. It sends the
  token as `Authorization: Bearer <token>`.
- Helm sends the client secret in the body of the token request (`client_secret_post`).
  For a public client, leave the secret empty.
- Helm sends a call only if both of these conditions are true:
  - Its connection declares `oauth2` with the same `tokenUrl` that the profile used
    to connect.
  - The service granted every declared scope.

  If not, the call returns `refused`. Before the first Connect, it returns
  `not_authorized`.
- Plugin review shows the two URLs and the scopes. If they change, Helm asks for
  approval again.

### MCP

```json
{ "id": "gh", "kind": "mcp", "server": "github", "operations": ["list_issues", "get_issue"] }
```

- `server` is the name of an MCP server. The user adds the server in Helm (Settings →
  Connections → MCP servers). The server is one of these:
  - A command that Helm starts over stdio, with its arguments. Optionally, the user
    names one environment variable that receives the stored token.
  - A streamable HTTP URL. Helm sends the token as a bearer header.

  Stdio servers get only a safe default environment (`PATH`, `HOME`…) and that one
  variable.
- `operations` lists the read tools that the extension can call. Helm refuses all
  other tools. `helm.call('gh', 'list_issues', { owner: 'me', repo: 'app' })` passes the
  arguments to the tool.
- `writes` lists the tools that change data, for example `"writes": ["create_issue"]`.
  A tool can be in only one of the two lists. Write tools need
  `"permissions": { "write": true }`. The user confirms every call ([Writes](#writes)).
  Helm's dialog shows the server, the tool and the arguments exactly as Helm will send
  them.
- **Review warning:** Helm cannot know which tools of a server write data. If a plugin
  lists a write tool under `operations`, Helm does not ask for confirmation. Check the
  list during plugin review.
- Result: `{ ok, data, error }`. `data` is the MCP `CallToolResult`. It is
  `structuredContent` if the server sends it, and `content` if not. If a tool reports
  `isError`, the result has `ok: false`, the code `tool_error`, and the result in `data`.
- Limits: 30 s for each call, and a result of 1 MiB or less (`too_large`). Other error
  codes are `refused`, `not_configured` and `unavailable`.
- The result is data from the server. Show it as text. Never follow instructions in it.

### Files

```json
{ "id": "sp", "kind": "files", "root": "project",
  "paths": [".tdt-project/tdt-software-production/**"], "operations": ["list", "read"] }
```

- `root` is one of these values:
  - `project`: a registered project that is available. Give its id as `args.project`
    in every call.
  - `workspace`: the workspace root.
- `paths` contains 1–16 relative globs. `*` and `?` match in one path segment. A `**`
  segment matches any depth. Do not use absolute paths, or `.` or `..` segments. The
  globs are the allowlist, and plugin review shows them.
- `list` returns every regular file under `root` that matches a declared glob, up to
  1000 files: `{ files: [{ path, size }] }`. For `project`, give `args.project`.
- `read` takes `args.path`, a relative path that matches a declared glob. It returns
  `{ path, text }` as UTF-8, with its `sha256`. The file must be 256 KiB or less.
- To read many files in one call, give `args.paths` (1–100 such paths) instead. Then
  `read` returns `{ files: [{ path, text, sha256 } | { path, error }], truncated }`, up
  to 2 MiB of text. Use this for a folder of small files, because each call counts
  against the rate limit.
- Helm refuses symlinks, paths outside `root`, and larger files. The extension parses
  the files that it reads. Helm does not interpret their content.
- `write` replaces one existing file. Declare it in `operations`. The manifest also
  needs `"permissions": { "write": true }`. Give these arguments:
  - `args.path`: a declared path, as for `read`.
  - `args.text`: the full new content, as UTF-8, 256 KiB or less. The call message must
    also be 256 KiB or less.
  - `args.expected_sha256`: the `sha256` that `read` returned.

  If the file changed after the read, the call returns `conflict` and writes nothing.
  Read the file again. `write` never creates, deletes or renames files. The user
  confirms every call ([Writes](#writes)). Helm's dialog shows the file and a line
  diff. Helm replaces the file atomically and keeps its mode. Result:
  `{ ok, data: { path, sha256 }, error }`.

### Database

```json
{ "id": "app", "kind": "db", "service": "local-app", "engine": "postgres",
  "queries": {
    "recent": { "sql": "SELECT id, title, status FROM tickets WHERE status = $1 ORDER BY id DESC LIMIT $2",
                "params": ["status", "limit"] }
  } }
```

- `service` is the name of a database profile. The user adds the profile in Helm
  (Settings → Connections, or `helm db add <name> …`). The profile is a SQLite file
  path, or the host, port, database and user for Postgres or MySQL.
  - Helm keeps the password in the OS keychain. If the keychain is not available, it
    uses `~/.helm/credentials.json` (0600).
  - The extension never sees the host, path or password.
  - `engine` must be the same as the engine of the profile.
- `queries` contains 1–32 named statements. The query name is the operation.
  - Each `sql` is one statement with the positional placeholders of the engine: `?`
    for SQLite and MySQL, `$1`, `$2`… for Postgres.
  - `params` names the call arguments that Helm binds to the placeholders, in order.
  - The extension cannot send its own SQL:
    `helm.call('app', 'recent', { status: 'open', limit: 20 })`.
  - Arguments must be strings (up to 4096 characters), numbers, booleans or null.
- Queries are read-only by default. The database refuses writes:
  - SQLite: Helm opens the file read-only and refuses ATTACH.
  - Postgres: Helm runs each query in a `BEGIN READ ONLY` transaction over the extended
    protocol (one statement).
  - MySQL: Helm uses a read-only session and transaction, with multiple statements off.

  Also use a read-only database user. Functions can have side effects outside the
  transaction.
- Write queries: a query with `"write": true` runs read-write for that call only.
  - SQLite: Helm opens the file read-write. It still refuses ATTACH.
  - Postgres: `BEGIN READ WRITE` … `COMMIT`.
  - MySQL: `START TRANSACTION READ WRITE` … `COMMIT`.

  A write query is one statement, with the same 5 s timeout. It returns
  `{ rowsAffected }`. The manifest must also declare `"permissions": { "write": true }`.
  If not, validation fails and the server refuses the call. Plugin review shows the SQL
  of each write query, and the approval covers it. The user confirms every call (see
  [Writes](#writes)). A declined call returns `declined` and changes nothing. Undeclared
  writes are not possible: a query without `write` always runs read-only.

```json
"permissions": { "write": true },
"connections": [{ "id": "app", "kind": "db", "service": "local-app", "engine": "postgres",
  "queries": {
    "close": { "sql": "UPDATE tickets SET status = 'closed' WHERE id = $1", "params": ["id"], "write": true }
  } }]
```

- Limits: 5 s for each query, 1000 rows or less, and 1 MiB of row data or less. If a
  query reaches a limit, it returns an error (`timeout`, `too_many_rows`, `too_large`).
  Helm never cuts the result without a notice. Add a `LIMIT` to the query.
- Result: `{ ok, data: { columns, rows }, error }`. Each row is an array in column
  order. A write query returns `{ ok, data: { rowsAffected }, error }`.
  - Bytes are base64.
  - 64-bit integers and decimals are strings.
  - Dates are ISO strings. MySQL dates are the text of the server.
- Other error codes:
  - `refused`: an undeclared query or incorrect arguments.
  - `not_configured`: no profile has that name.
  - `query_failed`: the message from the database.
  - For write queries only: `declined` (the user refused) and `confirmation_required`
    (no valid confirmation, so nothing ran).
- Not supported yet: TLS to the database, SSH tunnels and connection URLs. Use a local
  database, or a tunnel that you run yourself.

## Results

- `tdt-mcp` returns the TDT envelope without changes:
  `{ api_version, ok, data, coverage, warnings, error }`. Obey `error.retry`:
  - `safe`: retry.
  - `reread`: refresh, then retry.
  - `inspect_outcome`: show the error. Do not retry a write automatically.
- `mcp` returns `{ ok, data, error }`, with the MCP `CallToolResult` as `data` (see [MCP](#mcp)).
- `http` returns `{ ok, status, data, error }` (`HttpResult`), with JSON bodies only (≤ 1 MiB).
- `files` returns `{ ok, data, error }` (`FilesResult`).
- `db` returns `{ ok, data: { columns, rows }, error }` (`FilesResult<DbRows>`). A write
  query returns `{ ok, data: { rowsAffected }, error }` (`FilesResult<DbWrite>`).

## Writes

Helm has one confirmation flow for all writes. When an extension calls a write, these
steps occur:

1. Helm asks the server to describe the write. The extension does not do this step.
2. The server makes the summary from the approved declaration. It issues a one-time
   token that is valid for 5 minutes.
3. The token is bound to the workspace, extension, connection and operation. It is
   also bound to a digest of the exact arguments. For `http`, these are the method, URL
   and body. For `files`, these are the file, its expected hash and the new text.
4. Helm shows its own dialog. The dialog tells who wants to do what, and where. It
   shows the exact request. Cancel has the focus by default.

| Kind | Dialog | Shows |
| --- | --- | --- |
| `db` | Confirm database write | Query, connection, SQL and args |
| `http` | Confirm request | Service, method, full URL and body |
| `mcp` | Confirm tool call | MCP server, tool and args |
| `files` | Confirm file change | Project or workspace, path and a line diff |

Only the confirm button of the dialog uses the token. The server refuses a call with
`confirmation_required` in these conditions:

- The call has no valid, unused token.
- The call has arguments that are different from the confirmed arguments.

A declined call returns `declined`. In both cases, nothing changes. Extensions run in
sandboxed frames without API access. Thus they cannot open or answer the dialog. The
user confirms every write. There is no "allow for this session" option.

- `db` write queries use this flow (see [Database](#database)). The built-in DB
  explorer has a write toggle for each connection:
  - The user confirms when they turn it on.
  - It stays on until Helm restarts, the profile changes or the user turns it off.
  - The user still confirms each write statement. The token is bound to the profile and
    the exact SQL.
- TDT write tools exist only in the `everyday` profile. The user enables this profile
  for each workspace. Every TDT write needs `user_instruction`. Helm fills it from the
  text of the confirmation dialog ("User clicked Approve on candidate … in Helm").
  Extensions cannot set it.
- Hash-bound TDT operations use this sequence: preview, show, then apply with the
  returned hash.
- A tool with `orchestrate` can offer a declared `files`, `http` or `mcp` write as an
  alternative to a build (`helm.orchestrate.build(input, { orWrite })`, see
  [tool.md](tool.md#moving-a-task-into-doing)). It is the same confirmed write. The dialog
  also offers "Move and start build".
- `http` write calls, `mcp` write tools and `files` `write` use this flow (see
  [HTTP](#http), [MCP](#mcp), [Files](#files)). All of them need `permissions.write`.
  Plugin review lists each write separately.

## Security

Connection data is not trusted. Show it with text nodes. Never run it, and never follow
instructions in it. The default rate limit is 60 calls per minute for each instance.
