# Connections

Plugins get data through connections. You set up each connection one time in Helm.
Helm keeps the passwords and tokens. Plugins never see them. See
[Security](security.md#credentials).

Open **System settings** → **Connections**. The page has three sections: Databases,
Services and MCP servers.

## Databases

A database profile connects to a SQLite, Postgres or MySQL database.

1. Click **Add database**.
2. Select the engine: **SQLite**, **Postgres** or **MySQL**.
3. Enter a **Name**. Plugins refer to the profile by this name.
4. For SQLite, enter the **File path**. For Postgres and MySQL, enter the **Host**,
   **Port**, **Database**, **User** and **Password**.
5. Click **Save and test**.

If the test succeeds, Helm shows "Connected; a read-only query ran." Helm runs plugin
queries read-only, unless the plugin declares a write and you confirm it.

Use a database user with read-only rights where possible.

### Database commands

You can also manage database profiles in a terminal:

```sh
helm db list                                     # show database profiles (never passwords)
helm db add <name> --sqlite <file>               # a SQLite file, opened read-only
helm db add <name> --postgres|--mysql --host <h> [--port <p>] --database <d> --user <u> [--no-password]
                                                 # prompts for the password (or reads it from stdin)
helm db remove <name>                            # remove a profile and its stored password
helm db test <name>                              # connect and run a read-only SELECT 1
```

Run these commands from the Helm repository root as `npx helm db …`. See
[Plugin commands](plugins.md#plugin-commands).

TLS, SSH tunnels and connection URLs are not supported yet.

## Services

A service profile connects to an HTTP API, for example GitHub or Linear.

1. Click **Add service**.
2. Enter a **Name**, for example `github`. The name must match the `service` that the
   plugin declares.
3. Enter the **Base URL**. It must use https. Http is permitted only for `127.0.0.1`
   and `localhost`.
4. Select the sign-in: **Token** or **OAuth2**.

For **Token**:

1. Enter the **Header**. The default is `Authorization`.
2. Select the **Token format**: **Bearer token** or **Token as is**.
3. Enter the **Token**, and click **Save**.

For **OAuth2**:

1. Create an OAuth client with the service. Register the redirect URI that Helm shows.
2. Enter the **Client ID** and the **Client secret**. A public client has no secret.
3. Click **Save**, then click **Connect**. A sign-in window opens.

If the browser blocks the sign-in window, allow pop-ups for Helm and click **Connect**
again. If the sign-in expires, click **Reconnect**.

## MCP servers

An MCP server profile connects to a server that gives tools to plugins.

1. Click **Add MCP server**.
2. Enter a **Name**. It must match the `server` that the plugin declares.
3. Select the transport:
   - **Command**: enter the **Command** and the **Arguments, one per line**. If the
     server needs a token, enter the **Token variable** (the name of the environment
     variable) and the **Token**.
   - **HTTP URL**: enter the **URL** and the token. Helm sends the token as a bearer
     header.
4. Click **Save and test**. If the test succeeds, Helm shows the tools of the server.

## DB explorer

The DB explorer is a built-in tool. Use it to look at a database without a plugin.

1. In the left rail, under **Tools**, click **DB explorer**.
2. Select a database profile.
3. Select a table to browse it, or type one SQL statement and click **Run**
   (Ctrl+Enter).

Queries are read-only, with limits of 5 seconds, 1000 rows and 1 MiB.

### Writes in the DB explorer

1. Click **Writes off**. Helm asks you to confirm.
2. Click **Turn on writes**. The toggle shows **Writes on**, and **Run write** appears.
3. Type one statement and click **Run write**. Helm asks you to confirm each statement.

Writes stay on until you turn them off, Helm restarts or the profile changes.
